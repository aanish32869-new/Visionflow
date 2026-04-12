import json
import os
import random
import shutil
import uuid
from io import BytesIO
from pathlib import Path

import gridfs
from bson.objectid import ObjectId
from PIL import Image, ImageEnhance, ImageFilter, ImageOps


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


def _transform_annotation(annotation, transform_name):
    cloned = dict(annotation)
    if transform_name == "horizontal_flip":
        if cloned.get("type") == "polygon":
            cloned["points"] = _transform_polygon_points(cloned.get("points"), transform_name)
        else:
            cloned["x_center"] = 1 - float(cloned.get("x_center", 0.5))
    elif transform_name == "rotate":
        if cloned.get("type") == "polygon":
            cloned["points"] = _transform_polygon_points(cloned.get("points"), transform_name)
        else:
            cloned["x_center"] = 1 - float(cloned.get("x_center", 0.5))
            cloned["y_center"] = 1 - float(cloned.get("y_center", 0.5))
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
        background_color = 255 if resized.mode == "L" else (255, 255, 255)
        canvas_mode = "L" if resized.mode == "L" else "RGB"
        canvas = Image.new(canvas_mode, (width, height), background_color)
        x = (width - resized.width) // 2
        y = (height - resized.height) // 2
        canvas.paste(resized, (x, y))
        return canvas

    if mode == "crop":
        return ImageOps.fit(img, (width, height))

    return img.resize((width, height))


def _apply_augmentation(img, augmentation_name):
    if augmentation_name == "horizontal_flip":
        return ImageOps.mirror(img)
    if augmentation_name == "rotate":
        return img.rotate(180)
    if augmentation_name == "brightness":
        return ImageEnhance.Brightness(img).enhance(1.18)
    if augmentation_name == "blur":
        return img.filter(ImageFilter.GaussianBlur(radius=1.35))
    if augmentation_name == "noise":
        base = img.convert("RGB")
        noise = Image.effect_noise(base.size, 10).convert("RGB")
        return Image.blend(base, noise, 0.14)
    return img


def _prepare_image(source, preprocessing, augmentation_name=None):
    if isinstance(source, Image.Image):
        img = source.copy()
    else:
        with Image.open(source) as opened:
            img = opened.copy()

    if preprocessing.get("auto_orient", True):
        img = ImageOps.exif_transpose(img)

    img = img.convert("L" if preprocessing.get("grayscale") else "RGB")
    img = _apply_resize(img, preprocessing.get("resize") or {})
    img = _apply_augmentation(img, augmentation_name)
    return img


def _write_image(img, dst_img):
    Path(dst_img).parent.mkdir(parents=True, exist_ok=True)
    img.save(dst_img)


def _collect_annotations(db, assets):
    asset_ids = [str(asset["_id"]) for asset in assets]
    grouped = {asset_id: [] for asset_id in asset_ids}
    for annotation in db.annotations.find({"asset_id": {"$in": asset_ids}}):
        grouped.setdefault(str(annotation.get("asset_id")), []).append(annotation)
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
    return raw or f"{asset.get('_id')}.jpg"


def generate_dataset_archive(db, project_id, export_format, upload_folder, datasets_folder, options=None):
    options = options or {}
    split_percentages = _normalize_split(options.get("split"))
    preprocessing = _normalize_preprocessing(options)
    augmentation_config = _normalize_augmentation_config(options)
    tag_filter = _normalize_tag_filter(options)

    version_id = uuid.uuid4().hex
    version_dir = os.path.join(datasets_folder, version_id)
    os.makedirs(version_dir, exist_ok=True)

    assets = [
        asset
        for asset in db.assets.find({"project_id": project_id})
        if _asset_matches_tag_filter(asset, tag_filter)
    ]
    random.shuffle(assets)
    annotations_by_asset = _collect_annotations(db, assets)
    classes_list = _collect_classes(annotations_by_asset)
    classes_map = {name: index for index, name in enumerate(classes_list)}

    coco_data = {
        split_name: {
            "images": [],
            "annotations": [],
            "categories": [{"id": index, "name": name} for name, index in classes_map.items()],
        }
        for split_name in ("train", "valid", "test")
    }
    next_image_id = 1
    next_annotation_id = 1

    if export_format in ("yolov8", "yolo"):
        for split_name in ("train", "valid", "test"):
            os.makedirs(os.path.join(version_dir, split_name, "images"), exist_ok=True)
            os.makedirs(os.path.join(version_dir, split_name, "labels"), exist_ok=True)
    elif export_format == "coco":
        for split_name in ("train", "valid", "test"):
            os.makedirs(os.path.join(version_dir, split_name), exist_ok=True)
    elif export_format == "voc":
        for split_name in ("train", "valid", "test"):
            os.makedirs(os.path.join(version_dir, split_name, "JPEGImages"), exist_ok=True)
            os.makedirs(os.path.join(version_dir, split_name, "Annotations"), exist_ok=True)
    elif export_format == "tfrecord":
        for split_name in ("train", "valid", "test"):
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

        processed_image = _prepare_image(source_image, preprocessing, augmentation_name=augmentation_name)
        img_width, img_height = processed_image.size

        if export_format in ("yolov8", "yolo"):
            image_path = os.path.join(version_dir, split_name, "images", image_name)
            label_path = os.path.join(version_dir, split_name, "labels", f"{Path(image_name).stem}.txt")
            _write_image(processed_image, image_path)
            _write_yolo_label_file(label_path, annotations, classes_map)
        elif export_format == "voc":
            image_path = os.path.join(version_dir, split_name, "JPEGImages", image_name)
            xml_path = os.path.join(version_dir, split_name, "Annotations", f"{Path(image_name).stem}.xml")
            _write_image(processed_image, image_path)
            xml = (
                f"<annotation><folder>{split_name}</folder><filename>{image_name}</filename>"
                f"<size><width>{img_width}</width><height>{img_height}</height><depth>3</depth></size>"
            )
            for annotation in annotations:
                label = annotation.get("label")
                if label not in classes_map or annotation.get("type") == "polygon":
                    continue
                x_center = float(annotation.get("x_center", 0.5))
                y_center = float(annotation.get("y_center", 0.5))
                width = float(annotation.get("width", 0.1))
                height = float(annotation.get("height", 0.1))
                xmin = int((x_center - width / 2) * img_width)
                ymin = int((y_center - height / 2) * img_height)
                xmax = int((x_center + width / 2) * img_width)
                ymax = int((y_center + height / 2) * img_height)
                xml += (
                    f"<object><name>{label}</name><bndbox>"
                    f"<xmin>{xmin}</xmin><ymin>{ymin}</ymin><xmax>{xmax}</xmax><ymax>{ymax}</ymax>"
                    f"</bndbox></object>"
                )
            xml += "</annotation>"
            with open(xml_path, "w", encoding="utf-8") as handle:
                handle.write(xml)
        elif export_format == "tfrecord":
            image_path = os.path.join(version_dir, split_name, image_name)
            csv_path = os.path.join(version_dir, split_name, "_annotations.csv")
            _write_image(processed_image, image_path)
            with open(csv_path, "a", encoding="utf-8") as handle:
                for annotation in annotations:
                    label = annotation.get("label")
                    if label not in classes_map or annotation.get("type") == "polygon":
                        continue
                    x_center = float(annotation.get("x_center", 0.5))
                    y_center = float(annotation.get("y_center", 0.5))
                    width = float(annotation.get("width", 0.1))
                    height = float(annotation.get("height", 0.1))
                    xmin = int((x_center - width / 2) * img_width)
                    ymin = int((y_center - height / 2) * img_height)
                    xmax = int((x_center + width / 2) * img_width)
                    ymax = int((y_center + height / 2) * img_height)
                    handle.write(
                        f"{image_name},{img_width},{img_height},{label},{xmin},{ymin},{xmax},{ymax}\n"
                    )
        else:
            image_path = os.path.join(version_dir, split_name, image_name)
            _write_image(processed_image, image_path)
            coco_data[split_name]["images"].append(
                {
                    "id": next_image_id,
                    "file_name": image_name,
                    "width": img_width,
                    "height": img_height,
                }
            )
            for annotation in annotations:
                label = annotation.get("label")
                if label not in classes_map or annotation.get("type") == "polygon":
                    continue
                x_center = float(annotation.get("x_center", 0.5))
                y_center = float(annotation.get("y_center", 0.5))
                width = float(annotation.get("width", 0.1))
                height = float(annotation.get("height", 0.1))
                box_width = width * img_width
                box_height = height * img_height
                box_x = (x_center - width / 2) * img_width
                box_y = (y_center - height / 2) * img_height
                coco_data[split_name]["annotations"].append(
                    {
                        "id": next_annotation_id,
                        "image_id": next_image_id,
                        "category_id": classes_map[label],
                        "bbox": [box_x, box_y, box_width, box_height],
                        "area": box_width * box_height,
                        "iscrowd": 0,
                    }
                )
                next_annotation_id += 1
            next_image_id += 1

        split_counts[split_name] += 1
        exported_images_count += 1
        annotation_count += len(annotations)
        if augmentation_name:
            augmentation_copies += 1

    for index, asset in enumerate(assets):
        split_name = "train" if index < train_end else ("valid" if index < valid_end else "test")
        source_image = _load_asset_image(db, asset, upload_folder)
        if source_image is None:
            continue
        try:
            asset_id = str(asset["_id"])
            filename = _image_filename(asset)
            annotations = annotations_by_asset.get(asset_id, [])
            record_export(split_name, filename, source_image, annotations)
            source_images_count += 1

            if split_name != "train":
                continue

            enabled_augmentations = augmentation_config["enabled"]
            if not enabled_augmentations or augmentation_config["max_version_size"] <= 1:
                continue

            extra_copies = augmentation_config["max_version_size"] - 1
            stem = Path(filename).stem
            suffix = Path(filename).suffix or ".jpg"

            for copy_index in range(extra_copies):
                augmentation_name = enabled_augmentations[copy_index % len(enabled_augmentations)]
                augmented_annotations = [
                    _transform_annotation(annotation, augmentation_name) for annotation in annotations
                ]
                augmented_name = f"{stem}__aug-{copy_index + 1}-{augmentation_name}{suffix}"
                record_export(
                    split_name,
                    augmented_name,
                    source_image,
                    augmented_annotations,
                    augmentation_name=augmentation_name,
                )
        finally:
            source_image.close()

    if export_format == "coco":
        for split_name in ("train", "valid", "test"):
            with open(
                os.path.join(version_dir, split_name, "_annotations.coco.json"),
                "w",
                encoding="utf-8",
            ) as handle:
                json.dump(coco_data[split_name], handle)

    if export_format in ("yolov8", "yolo"):
        with open(os.path.join(version_dir, "data.yaml"), "w", encoding="utf-8") as handle:
            handle.write("train: ../train/images\nval: ../valid/images\ntest: ../test/images\n\n")
            handle.write(f"nc: {len(classes_list)}\nnames: {json.dumps(classes_list)}\n")

    with open(os.path.join(version_dir, "README.dataset.txt"), "w", encoding="utf-8") as handle:
        handle.write(
            "Dataset auto-generated by VisionFlow Core\n"
            f"Format: {export_format.upper()}\n"
            f"Split: {split_percentages['train']}/{split_percentages['valid']}/{split_percentages['test']}\n"
            f"Preprocessing: {json.dumps(preprocessing)}\n"
            f"Augmentations: {augmentation_config['enabled'] or 'None'}\n"
            f"Maximum Version Size: {augmentation_config['max_version_size']}x\n"
            f"Tag Filter: {json.dumps(tag_filter)}\n"
            f"Classes: {', '.join(classes_list)}\n"
        )

    shutil.make_archive(os.path.join(datasets_folder, version_id), "zip", version_dir)
    return version_id, {
        "annotations_count": annotation_count,
        "classes": classes_list,
        "split_counts": split_counts,
        "split_percentages": split_percentages,
        "source_images_count": source_images_count,
        "exported_images_count": exported_images_count,
        "augmentation_copies": augmentation_copies,
        "preprocessing": preprocessing,
        "augmentation_config": augmentation_config,
        "tag_filter": tag_filter,
    }
