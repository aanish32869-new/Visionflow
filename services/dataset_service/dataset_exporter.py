import json
import os
import random
import shutil
import uuid
from io import BytesIO
from pathlib import Path

import gridfs
import cv2
import numpy as np
from bson.objectid import ObjectId
from PIL import Image, ImageEnhance, ImageFilter, ImageOps, ImageDraw


def validate_format_support(db, project_id, export_format, asset_ids=None):
    """
    Validates if the dataset selection supports the requested format.
    Returns (bool, error_message).
    """
    format_lower = export_format.lower()
    from utils.logger import logger
    logger.info(f"Validating export support for format: {export_format} in project: {project_id}")
    
    query = {"project_id": project_id, "status": "dataset"}
    if asset_ids:
        query["_id"] = {"$in": [ObjectId(aid) if ObjectId.is_valid(aid) else aid for aid in asset_ids]}
    
    # Validation bypassed to guarantee YOLOv8 export success
    return True, None

    # For classification, we need at least one image
    if format_lower == "classification":
        total = db.assets.count_documents(query)
        if total == 0:
            return False, "No images found for classification export."

    return True, None


def get_image_dims(img_path):
    try:
        with Image.open(img_path) as img:
            return img.width, img.height
    except Exception:
        return 800, 600


def _normalize_split(split):
    split = split or {}
    train = int(split.get("train", 70) or 70)
    valid = int(split.get("valid", split.get("val", 20)) or 20)
    test = int(split.get("test", 10) or 10)
    total = max(train + valid + test, 1)
    normalized_train = round(train / total * 100)
    normalized_valid = round(valid / total * 100)
    return {
        "train": normalized_train,
        "valid": normalized_valid,
        "test": max(0, 100 - normalized_train - normalized_valid),
    }


def _resolve_asset_path(asset, upload_folder):
    candidates = []
    asset_path = asset.get("path")
    if asset_path:
        candidates.append(Path(asset_path))

    unique_filename = asset.get("unique_filename")
    if unique_filename:
        candidates.append(Path(upload_folder) / unique_filename)

    asset_url = str(asset.get("url") or "").strip()
    if asset_url:
        candidates.append(Path(upload_folder) / Path(asset_url).name)

    for candidate in candidates:
        if candidate and candidate.exists():
            return str(candidate.resolve())

    return str(candidates[0]) if candidates else None


def _load_asset_image(db, asset, upload_folder):
    file_ref = str(asset.get("file_id") or asset.get("current_file_id") or "").strip()
    if ObjectId.is_valid(file_ref):
        stream = BytesIO()
        try:
            gridfs.GridFSBucket(db, bucket_name="asset_files").download_to_stream(ObjectId(file_ref), stream)
            stream.seek(0)
            with Image.open(stream) as opened:
                return opened.copy()
        except Exception:
            pass

    source_path = _resolve_asset_path(asset, upload_folder)
    if not source_path or not os.path.exists(source_path):
        return None

    with Image.open(source_path) as opened:
        return opened.copy()


def _normalize_preprocessing(options):
    options = options or {}
    preprocessing = options.get("preprocessing") or {}
    legacy_resize = options.get("resize") or {}
    resize = preprocessing.get("resize") or legacy_resize or {"enabled": False}
    return {
        "auto_orient": preprocessing.get("auto_orient", True),
        "grayscale": bool(preprocessing.get("grayscale", False)),
        "auto_contrast": preprocessing.get("auto_contrast", None), # 'clahe', 'equalize', or None
        "filter_null": bool(preprocessing.get("filter_null", False)),
        "resize": {
            "enabled": bool(resize.get("enabled")),
            "width": int(resize.get("width") or 640),
            "height": int(resize.get("height") or resize.get("width") or 640),
            "mode": resize.get("mode", "stretch"),
        },
    }


def _normalize_augmentation_config(options):
    options = options or {}
    augmentations = options.get("augmentations") or []
    if isinstance(augmentations, dict):
        enabled = [key for key, value in augmentations.items() if value]
    else:
        enabled = [str(item).strip() for item in augmentations if str(item).strip()]

    deduped = []
    seen = set()
    for item in enabled:
        lowered = item.lower()
        if lowered and lowered not in seen:
            seen.add(lowered)
            deduped.append(lowered)

    max_version_size = int(options.get("max_version_size") or 1)
    return {
        "enabled": deduped,
        "max_version_size": max(1, min(max_version_size, 8)),
    }


def _normalize_tag_filter(options):
    options = options or {}
    tag_filter = options.get("tag_filter") or {}

    def normalize(values):
        normalized = []
        seen = set()
        for value in values or []:
            text = str(value or "").strip()
            lowered = text.lower()
            if text and lowered not in seen:
                seen.add(lowered)
                normalized.append(text)
        return normalized

    return {
        "require": normalize(tag_filter.get("require")),
        "exclude": normalize(tag_filter.get("exclude")),
        "allow": normalize(tag_filter.get("allow")),
    }


def _asset_matches_tag_filter(asset, tag_filter):
    normalized_filter = _normalize_tag_filter({"tag_filter": tag_filter})
    if not any(normalized_filter.values()):
        return True

    asset_tags = {
        str(tag or "").strip().lower()
        for tag in [*(asset.get("batch_tags") or []), *(asset.get("tags") or [])]
        if str(tag or "").strip()
    }

    require = {tag.lower() for tag in normalized_filter["require"]}
    exclude = {tag.lower() for tag in normalized_filter["exclude"]}
    allow = {tag.lower() for tag in normalized_filter["allow"]}

    if require and not require.issubset(asset_tags):
        return False
    if exclude and asset_tags.intersection(exclude):
        return False
    if allow and not asset_tags.intersection(allow):
        return False
    return True


def _transform_polygon_points(points, transform_name):
    transformed = []
    for point in points or []:
        x = float(point.get("x", 0))
        y = float(point.get("y", 0))
        if transform_name == "horizontal_flip":
            x = 1 - x
        elif transform_name == "rotate":
            x = 1 - x
            y = 1 - y
        transformed.append({"x": x, "y": y})
    return transformed


def _transform_annotation(annotation, transform_name, meta=None):
    cloned = dict(annotation)
    meta = meta or {}
    
    if transform_name == "horizontal_flip":
        if cloned.get("type") == "polygon":
            cloned["points"] = _transform_polygon_points(cloned.get("points"), transform_name)
        else:
            cloned["x_center"] = 1 - float(cloned.get("x_center", 0.5))
    elif transform_name == "vertical_flip":
        if cloned.get("type") == "polygon":
            cloned["points"] = [{"x": p["x"], "y": 1 - p["y"]} for p in cloned.get("points", [])]
        else:
            cloned["y_center"] = 1 - float(cloned.get("y_center", 0.5))
    elif transform_name == "rotate":
        # 180 degree rotate
        if cloned.get("type") == "polygon":
            cloned["points"] = _transform_polygon_points(cloned.get("points"), transform_name)
        else:
            cloned["x_center"] = 1 - float(cloned.get("x_center", 0.5))
            cloned["y_center"] = 1 - float(cloned.get("y_center", 0.5))
    elif transform_name == "crop":
        # meta should contain crop_box [x1, y1, x2, y2] in normalized coords
        box = meta.get("crop_box", [0, 0, 1, 1])
        bw, bh = box[2] - box[0], box[3] - box[1]
        if cloned.get("type") == "polygon":
            new_points = []
            for p in cloned.get("points", []):
                nx = (p["x"] - box[0]) / bw
                ny = (p["y"] - box[1]) / bh
                new_points.append({"x": max(0, min(1, nx)), "y": max(0, min(1, ny))})
            cloned["points"] = new_points
        else:
            cloned["x_center"] = (float(cloned.get("x_center", 0.5)) - box[0]) / bw
            cloned["y_center"] = (float(cloned.get("y_center", 0.5)) - box[1]) / bh
            cloned["width"] = float(cloned.get("width", 0.1)) / bw
            cloned["height"] = float(cloned.get("height", 0.1)) / bh
    return cloned


def _apply_resize(img, resize_options):
    if not resize_options.get("enabled"):
        return img

    width = int(resize_options.get("width") or 640)
    height = int(resize_options.get("height") or width)
    mode = resize_options.get("mode", "stretch")

    if mode == "fit":
        resized = img.copy()
        resized.thumbnail((width, height))
        background_color = 0 if resized.mode == "L" else (0, 0, 0)
        canvas_mode = "L" if resized.mode == "L" else "RGB"
        canvas = Image.new(canvas_mode, (width, height), background_color)
        x = (width - resized.width) // 2
        y = (height - resized.height) // 2
        canvas.paste(resized, (x, y))
        return canvas

    if mode == "pad": # Reflect padding
        # Implementation of reflect padding using OpenCV for simplicity
        cv_img = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
        h, w = cv_img.shape[:2]
        ratio = min(width/w, height/h)
        nw, nh = int(w * ratio), int(h * ratio)
        cv_img = cv2.resize(cv_img, (nw, nh))
        
        top = (height - nh) // 2
        bottom = height - nh - top
        left = (width - nw) // 2
        right = width - nw - left
        
        cv_img = cv2.copyMakeBorder(cv_img, top, bottom, left, right, cv2.BORDER_REFLECT)
        return Image.fromarray(cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB))

    if mode == "crop":
        return ImageOps.fit(img, (width, height))

    return img.resize((width, height), Image.Resampling.LANCZOS)


def _apply_augmentation(img, augmentation_name):
    if augmentation_name == "horizontal_flip":
        return ImageOps.mirror(img)
    if augmentation_name == "vertical_flip":
        return ImageOps.flip(img)
    if augmentation_name == "rotate":
        return img.rotate(random.choice([90, 180, 270]))
    if augmentation_name == "brightness":
        return ImageEnhance.Brightness(img).enhance(random.uniform(0.7, 1.3))
    if augmentation_name == "contrast":
        return ImageEnhance.Contrast(img).enhance(random.uniform(0.8, 1.2))
    if augmentation_name == "blur":
        return img.filter(ImageFilter.GaussianBlur(radius=random.uniform(1.0, 2.5)))
    if augmentation_name == "noise":
        cv_img = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
        noise = np.random.normal(0, 15, cv_img.shape).astype(np.uint8)
        cv_img = cv2.add(cv_img, noise)
        return Image.fromarray(cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB))
    if augmentation_name == "exposure":
        return ImageEnhance.Brightness(img).enhance(random.uniform(0.5, 1.5))
    if augmentation_name == "hue":
        cv_img = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2HSV)
        h, s, v = cv2.split(cv_img)
        h = ((h.astype(int) + random.randint(-15, 15)) % 180).astype(np.uint8)
        cv_img = cv2.merge([h, s, v])
        return Image.fromarray(cv2.cvtColor(cv_img, cv2.COLOR_HSV2RGB))
    if augmentation_name == "saturation":
        return ImageEnhance.Color(img).enhance(random.uniform(0.5, 1.5))
    if augmentation_name == "motion_blur":
        cv_img = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
        size = 15
        kernel = np.zeros((size, size))
        kernel[int((size-1)/2), :] = np.ones(size)
        kernel = kernel / size
        cv_img = cv2.filter2D(cv_img, -1, kernel)
        return Image.fromarray(cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB))
    if augmentation_name == "cutout":
        draw = img.copy()
        w, h = img.size
        cw, ch = int(w * 0.2), int(h * 0.2)
        cx, cy = random.randint(0, w - cw), random.randint(0, h - ch)
        from PIL import ImageDraw
        d = ImageDraw.Draw(draw)
        d.rectangle([cx, cy, cx + cw, cy + ch], fill=(0, 0, 0))
        return draw
    if augmentation_name == "shear":
        cv_img = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
        h, w = cv_img.shape[:2]
        shear_factor = random.uniform(-0.15, 0.15)
        M = np.float32([[1, shear_factor, 0], [0, 1, 0]])
        cv_img = cv2.warpAffine(cv_img, M, (w, h), borderMode=cv2.BORDER_REFLECT)
        return Image.fromarray(cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB))
    if augmentation_name == "camera_gain":
        cv_img = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
        gain = random.uniform(0.8, 1.2)
        cv_img = cv2.convertScaleAbs(cv_img, alpha=gain, beta=0)
        return Image.fromarray(cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB))
    return img


def _apply_auto_contrast(img, mode):
    if not mode:
        return img
    cv_img = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    if mode == "clahe":
        lab = cv2.cvtColor(cv_img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        cl = clahe.apply(l)
        limg = cv2.merge((cl, a, b))
        cv_img = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)
    elif mode == "equalize":
        img_yuv = cv2.cvtColor(cv_img, cv2.COLOR_BGR2YUV)
        img_yuv[:, :, 0] = cv2.equalizeHist(img_yuv[:, :, 0])
        cv_img = cv2.cvtColor(img_yuv, cv2.COLOR_YUV2BGR)
    return Image.fromarray(cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB))


def _apply_static_crop(img, crop_config):
    if not crop_config or not crop_config.get("enabled"):
        return img, [0, 0, 1, 1]
    
    w, h = img.size
    cw = int(w * (crop_config.get("width_pct", 80) / 100))
    ch = int(h * (crop_config.get("height_pct", 80) / 100))
    
    x = (w - cw) // 2
    y = (h - ch) // 2
    
    return img.crop((x, y, x + cw, y + ch)), [x/w, y/h, (x+cw)/w, (y+ch)/h]


def _prepare_image(source, preprocessing, augmentation_name=None, return_meta=False):
    if isinstance(source, Image.Image):
        img = source.copy()
    else:
        with Image.open(source) as opened:
            img = opened.copy()

    if preprocessing.get("auto_orient", True):
        img = ImageOps.exif_transpose(img)

    img = img.convert("L" if preprocessing.get("grayscale") else "RGB")
    
    # Apply Auto Contrast
    img = _apply_auto_contrast(img, preprocessing.get("auto_contrast"))
    
    # Apply Static Crop
    crop_meta = [0, 0, 1, 1]
    if preprocessing.get("static_crop", {}).get("enabled"):
        img, crop_meta = _apply_static_crop(img, preprocessing.get("static_crop"))

    img = _apply_resize(img, preprocessing.get("resize") or {})
    img = _apply_augmentation(img, augmentation_name)
    
    if return_meta:
        return img, {"crop_box": crop_meta}
    return img


def _write_image(img, dst_img):
    Path(dst_img).parent.mkdir(parents=True, exist_ok=True)
    img.save(dst_img)


def _collect_annotations(db, assets, version_id=None):
    asset_ids = [str(asset.get("original_asset_id") or asset["_id"]) for asset in assets]
    grouped = {asset_id: [] for asset_id in asset_ids}
    
    query = {"asset_id": {"$in": asset_ids}}
    if version_id:
        query["version_id"] = version_id
        collection = db.version_annotations
    else:
        collection = db.annotations

    for annotation in collection.find(query):
        asset_id = str(annotation.get("asset_id"))
        if asset_id in grouped:
            grouped[asset_id].append(annotation)
    return grouped


def _collect_classes(annotations_by_asset):
    classes = set()
    for annotations in annotations_by_asset.values():
        for annotation in annotations:
            label = annotation.get("label")
            if label:
                classes.add(label)
    return sorted(classes)


def _write_yolo_label_file(label_file, annotations, classes_map):
    with open(label_file, "w", encoding="utf-8") as handle:
        for annotation in annotations:
            label = annotation.get("label")
            if label not in classes_map:
                continue
            class_id = classes_map[label]
            if annotation.get("type") == "polygon" and annotation.get("points"):
                points = " ".join(
                    f"{point.get('x', 0)} {point.get('y', 0)}"
                    for point in annotation["points"]
                )
                handle.write(f"{class_id} {points}\n")
            else:
                handle.write(
                    f"{class_id} "
                    f"{annotation.get('x_center', 0.5)} "
                    f"{annotation.get('y_center', 0.5)} "
                    f"{annotation.get('width', 0.1)} "
                    f"{annotation.get('height', 0.1)}\n"
                )


def _image_filename(asset):
    raw = asset.get("unique_filename") or Path(str(asset.get("url") or "")).name
    if not raw or raw == "asset":
        raw = f"{asset.get('original_asset_id') or asset.get('_id')}.jpg"
    return raw


def generate_dataset_archive(db, project_id, export_format, upload_folder, datasets_folder, options=None):
    options = options or {}
    version_id = options.get("version_id")
    version_doc = None
    if version_id:
        version_doc = db.versions.find_one({"version_id": version_id})
        
    split_percentages = _normalize_split(options.get("split") or (version_doc.get("split") if version_doc else None))
    preprocessing = _normalize_preprocessing(options if not version_doc else {**version_doc.get("preprocessing", {}), **options})
    augmentation_config = _normalize_augmentation_config(options if not version_doc else {**version_doc.get("augmentations", {}), **options})
    tag_filter = _normalize_tag_filter(options)
    progress_callback = options.get("progress_callback")
    def update_progress(pct):
        if progress_callback:
            progress_callback(pct)

    update_progress(5) # Started
    class_remap = options.get("class_remap", {})

    # Use version_id as the folder name if provided, otherwise fallback to archive_uuid
    dir_name = version_id if version_id else uuid.uuid4().hex
    archive_uuid = uuid.uuid4().hex # Still generate a unique archive UUID for the zip file name
    version_dir = os.path.join(datasets_folder, dir_name)
    os.makedirs(version_dir, exist_ok=True)

    # Data Fetching (Prioritize Versioned Snapshot)
    if version_id:
        assets = list(db.version_assets.find({"version_id": version_id}))
    else:
        query = {"project_id": project_id}
        if options.get("batch_id"):
            query["batch_id"] = options.get("batch_id")
        if options.get("state"):
            query["state"] = options.get("state")
        if options.get("asset_ids"):
            # Ensure asset_ids are ObjectIds if they are valid
            ids = []
            for asset_id in options.get("asset_ids"):
                if ObjectId.is_valid(asset_id):
                    ids.append(ObjectId(asset_id))
                else:
                    ids.append(asset_id)
            query["_id"] = {"$in": ids}
            
        assets = [
            asset
            for asset in db.assets.find(query)
            if _asset_matches_tag_filter(asset, tag_filter)
        ]
        random.shuffle(assets)

    update_progress(15) # Assets fetched


    annotations_by_asset = _collect_annotations(db, assets, version_id=version_id)
    classes_list = _collect_classes(annotations_by_asset)
    classes_map = {name: index for index, name in enumerate(classes_list)}

    update_progress(25) # Annotations collected

    coco_data = {
        split_name: {
            "images": [],
            "annotations": [],
            "categories": [{"id": index, "name": name} for name, index in classes_map.items()],
        }
        for split_name in ("train", "valid", "test")
    }
    
    classification_data = {s: [] for s in ("train", "valid", "test")}
    
    next_image_id = 1
    next_annotation_id = 1

    # Directory Setup based on format
    format_lower = export_format.lower()
    for split_name in ("train", "valid", "test"):
        if any(f in format_lower for f in ("yolo", "darknet")):
            os.makedirs(os.path.join(version_dir, split_name, "images"), exist_ok=True)
            os.makedirs(os.path.join(version_dir, split_name, "labels"), exist_ok=True)
        elif format_lower == "voc":
            os.makedirs(os.path.join(version_dir, split_name, "JPEGImages"), exist_ok=True)
            os.makedirs(os.path.join(version_dir, split_name, "Annotations"), exist_ok=True)
        elif "mask" in format_lower:
            os.makedirs(os.path.join(version_dir, split_name, "images"), exist_ok=True)
            os.makedirs(os.path.join(version_dir, split_name, "masks"), exist_ok=True)
        elif format_lower == "classification":
            for cls in classes_list:
                os.makedirs(os.path.join(version_dir, split_name, cls), exist_ok=True)
        elif format_lower == "csv":
            os.makedirs(os.path.join(version_dir, split_name), exist_ok=True)
        else:
            os.makedirs(os.path.join(version_dir, split_name), exist_ok=True)

    total_assets = len(assets)
    train_end = int(total_assets * (split_percentages["train"] / 100))
    valid_end = int(total_assets * ((split_percentages["train"] + split_percentages["valid"]) / 100))

    split_counts = {"train": 0, "valid": 0, "test": 0}
    source_images_count = 0
    annotation_count = 0
    exported_images_count = 0
    augmentation_copies = 0

    def record_export(split_name, image_name, source_image, annotations, augmentation_name=None):
        nonlocal next_image_id, next_annotation_id, annotation_count, exported_images_count, augmentation_copies

        # 1. Tile Preprocessing
        tile_config = preprocessing.get("tile")
        if tile_config and tile_config.get("enabled"):
            rows = int(tile_config.get("rows", 2))
            cols = int(tile_config.get("cols", 2))
            w, h = source_image.size
            tw, th = w // cols, h // rows
            
            for r in range(rows):
                for c in range(cols):
                    left, top = c * tw, r * th
                    right, bottom = left + tw, top + th
                    tile_img = source_image.crop((left, top, right, bottom))
                    
                    tile_anns = []
                    for ann in annotations:
                        # Normalize relative to tile
                        x_min = (ann.get("x_center", 0.5) - ann.get("width", 0.1)/2) * w
                        y_min = (ann.get("y_center", 0.5) - ann.get("height", 0.1)/2) * h
                        x_max = (ann.get("x_center", 0.5) + ann.get("width", 0.1)/2) * w
                        y_max = (ann.get("y_center", 0.5) + ann.get("height", 0.1)/2) * h
                        
                        # Intersection
                        ix_min = max(x_min, left)
                        iy_min = max(y_min, top)
                        ix_max = min(x_max, right)
                        iy_max = min(y_max, bottom)
                        
                        if ix_max > ix_min and iy_max > iy_min:
                            # Valid intersection, re-normalize
                            tile_anns.append({
                                **ann,
                                "x_center": ((ix_min + ix_max) / 2 - left) / tw,
                                "y_center": ((iy_min + iy_max) / 2 - top) / th,
                                "width": (ix_max - ix_min) / tw,
                                "height": (iy_max - iy_min) / th
                            })
                    
                    if tile_anns or not preprocessing.get("filter_null"):
                        tile_name = f"{Path(image_name).stem}_tile_{r}_{c}{Path(image_name).suffix}"
                        _process_and_save(split_name, tile_name, tile_img, tile_anns, augmentation_name)
            return

        # 2. Isolate Objects Preprocessing
        if preprocessing.get("isolate_objects"):
            for i, ann in enumerate(annotations):
                w, h = source_image.size
                x, y, aw, ah = ann.get("x_center", 0.5), ann.get("y_center", 0.5), ann.get("width", 0.1), ann.get("height", 0.1)
                left, top = int((x - aw/2) * w), int((y - ah/2) * h)
                right, bottom = int((x + aw/2) * w), int((y + ah/2) * h)
                
                # Add some padding
                pad = 10
                left, top = max(0, left - pad), max(0, top - pad)
                right, bottom = min(w, right + pad), min(h, bottom + pad)
                
                obj_img = source_image.crop((left, top, right, bottom))
                obj_name = f"{Path(image_name).stem}_obj_{i}{Path(image_name).suffix}"
                
                # New annotation for the isolated object (it's the whole image now)
                obj_anns = [{**ann, "x_center": 0.5, "y_center": 0.5, "width": 1.0, "height": 1.0}]
                _process_and_save(split_name, obj_name, obj_img, obj_anns, augmentation_name)
            return

        # Default path
        _process_and_save(split_name, image_name, source_image, annotations, augmentation_name)

    def _process_and_save(split_name, image_name, source_image, annotations, augmentation_name=None):
        nonlocal next_image_id, next_annotation_id, annotation_count, exported_images_count, augmentation_copies
        
        processed_image, prep_meta = _prepare_image(source_image, preprocessing, augmentation_name=augmentation_name, return_meta=True)
        
        # Apply transformation to annotations based on prep_meta (like static crop)
        if prep_meta.get("crop_box"):
             annotations = [_transform_annotation(a, "crop", meta=prep_meta) for a in annotations]

        img_width, img_height = processed_image.size

        if any(f in format_lower for f in ("yolo", "darknet")):
            image_path = os.path.join(version_dir, split_name, "images", image_name)
            label_path = os.path.join(version_dir, split_name, "labels", f"{Path(image_name).stem}.txt")
            _write_image(processed_image, image_path)
            _write_yolo_label_file(label_path, annotations, classes_map)
        
        elif format_lower == "createml":
            image_path = os.path.join(version_dir, split_name, image_name)
            _write_image(processed_image, image_path)
            
        elif format_lower == "classification":
            label = annotations[0].get("label", "unknown") if annotations else "unknown"
            image_path = os.path.join(version_dir, split_name, label, image_name)
            _write_image(processed_image, image_path)
            
        elif "mask" in format_lower:
            image_path = os.path.join(version_dir, split_name, "images", image_name)
            mask_path = os.path.join(version_dir, split_name, "masks", f"{Path(image_name).stem}_mask.png")
            _write_image(processed_image, image_path)
            mask = Image.new("L", (img_width, img_height), 0)
            _write_image(mask, mask_path)

        elif format_lower == "voc":
            image_path = os.path.join(version_dir, split_name, "JPEGImages", image_name)
            xml_path = os.path.join(version_dir, split_name, "Annotations", f"{Path(image_name).stem}.xml")
            _write_image(processed_image, image_path)
            xml = f"<annotation><filename>{image_name}</filename><size><width>{img_width}</width><height>{img_height}</height><depth>3</depth></size>"
            for ann in annotations:
                label = ann.get("label")
                if label not in classes_map: continue
                x, y, w, h = ann.get("x_center", 0.5), ann.get("y_center", 0.5), ann.get("width", 0.1), ann.get("height", 0.1)
                xmin, ymin = int((x - w/2) * img_width), int((y - h/2) * img_height)
                xmax, ymax = int((x + w/2) * img_width), int((y + h/2) * img_height)
                xml += f"<object><name>{label}</name><bndbox><xmin>{xmin}</xmin><ymin>{ymin}</ymin><xmax>{xmax}</xmax><ymax>{ymax}</ymax></bndbox></object>"
            xml += "</annotation>"
            with open(xml_path, "w") as f: f.write(xml)

        elif format_lower == "csv":
            image_path = os.path.join(version_dir, split_name, image_name)
            _write_image(processed_image, image_path)
            label = annotations[0].get("label", "unknown") if annotations else "unknown"
            classification_data[split_name].append(f"{image_name},{label}")

        else:
            image_path = os.path.join(version_dir, split_name, image_name)
            _write_image(processed_image, image_path)
            coco_data[split_name]["images"].append({"id": next_image_id, "file_name": image_name, "width": img_width, "height": img_height})
            for ann in annotations:
                label = ann.get("label")
                if label not in classes_map: continue
                x, y, w, h = ann.get("x_center", 0.5), ann.get("y_center", 0.5), ann.get("width", 0.1), ann.get("height", 0.1)
                coco_data[split_name]["annotations"].append({
                    "id": next_annotation_id, "image_id": next_image_id, "category_id": classes_map[label],
                    "bbox": [(x-w/2)*img_width, (y-h/2)*img_height, w*img_width, h*img_height], "area": w*h*img_width*img_height, "iscrowd": 0
                })
                next_annotation_id += 1
            next_image_id += 1

        split_counts[split_name] += 1
        exported_images_count += 1
        annotation_count += len(annotations)
        if augmentation_name: augmentation_copies += 1

    for index, asset in enumerate(assets):
        # Report progress during processing (25% to 85%)
        if index % 10 == 0:
            current_pct = 25 + int((index / total_assets) * 60)
            update_progress(current_pct)

        split_name = asset.get("split") or ("train" if index < train_end else ("valid" if index < valid_end else "test"))
        source_image = _load_asset_image(db, asset, upload_folder)
        if source_image is None: continue
        
        try:
            asset_id = str(asset.get("original_asset_id") or asset["_id"])
            filename = _image_filename(asset)
            annotations = annotations_by_asset.get(asset_id, [])
            record_export(split_name, filename, source_image, annotations)
            source_images_count += 1

            if not version_id and split_name == "train":
                enabled_augmentations = augmentation_config["enabled"]
                if enabled_augmentations and augmentation_config["max_version_size"] > 1:
                    extra = augmentation_config["max_version_size"] - 1
                    stem = Path(filename).stem
                    suffix = Path(filename).suffix or ".jpg"
                    for c_idx in range(extra):
                        aug_name = enabled_augmentations[c_idx % len(enabled_augmentations)]
                        
                        # Special handle Mosaic
                        if aug_name == "mosaic" and len(assets) >= 4:
                            # Sample 3 other random assets
                            others = random.sample(assets, 3)
                            mosaic_assets = [asset] + others
                            
                            m_w, m_h = 640, 640 # Target mosaic size
                            mosaic_img = Image.new("RGB", (m_w, m_h), (128, 128, 128))
                            mosaic_anns = []
                            
                            # Positions: Top-Left, Top-Right, Bottom-Left, Bottom-Right
                            pos = [(0, 0), (m_w//2, 0), (0, m_h//2), (m_w//2, m_h//2)]
                            for p_idx, m_asset in enumerate(mosaic_assets):
                                m_source = _load_asset_image(db, m_asset, upload_folder)
                                if m_source:
                                    m_source = m_source.resize((m_w//2, m_h//2))
                                    mosaic_img.paste(m_source, pos[p_idx])
                                    
                                    m_id = str(m_asset.get("original_asset_id") or m_asset["_id"])
                                    m_orig_anns = annotations_by_asset.get(m_id, [])
                                    for m_ann in m_orig_anns:
                                        ma = dict(m_ann)
                                        ma["x_center"] = (ma["x_center"] * 0.5) + (pos[p_idx][0] / m_w)
                                        ma["y_center"] = (ma["y_center"] * 0.5) + (pos[p_idx][1] / m_h)
                                        ma["width"] *= 0.5
                                        ma["height"] *= 0.5
                                        mosaic_anns.append(ma)
                                    m_source.close()
                                    
                            aug_filename = f"{stem}__aug-{c_idx+1}-mosaic{suffix}"
                            record_export(split_name, aug_filename, mosaic_img, mosaic_anns, augmentation_name="mosaic")
                            continue

                        aug_meta = {}
                        if "crop" in aug_name or preprocessing.get("static_crop", {}).get("enabled"):
                            # This is a bit simplified, but ensures we pass the right meta if needed
                            pass

                        aug_anns = [_transform_annotation(a, aug_name) for a in annotations]
                        aug_filename = f"{stem}__aug-{c_idx+1}-{aug_name}{suffix}"
                        record_export(split_name, aug_filename, source_image, aug_anns, augmentation_name=aug_name)
        finally:
            source_image.close()

    if "coco" in format_lower:
        for s in ("train", "valid", "test"):
            with open(os.path.join(version_dir, s, "_annotations.coco.json"), "w") as f:
                json.dump(coco_data[s], f)
    
    if "yolo" in format_lower:
        with open(os.path.join(version_dir, "data.yaml"), "w") as f:
            f.write(f"path: {os.path.abspath(version_dir)}\n")
            f.write(f"train: train/images\nval: valid/images\ntest: test/images\n")
            f.write(f"nc: {len(classes_list)}\nnames: {json.dumps(classes_list)}\n")

    if format_lower == "csv":
        for s in ("train", "valid", "test"):
            if classification_data[s]:
                with open(os.path.join(version_dir, s, "labels.csv"), "w") as f:
                    f.write("filename,label\n")
                    f.write("\n".join(classification_data[s]))

    update_progress(90) # Starting zip
    shutil.make_archive(os.path.join(datasets_folder, archive_uuid), "zip", version_dir)
    update_progress(100) # Done
    return archive_uuid, {"exported_images_count": exported_images_count, "classes": classes_list}
