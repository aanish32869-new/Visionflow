"""
Multi-Model Object Detection System
Combines YOLOv8, YOLO-World, and SAM for comprehensive object detection across:
- Natural objects (geological, water, flora, fauna)
- Man-made objects (furniture, electronics, kitchenware, etc.)
- Transportation & infrastructure
- Cultural & historical artifacts
- Abstract & digital concepts (when applicable to images)
"""

from ultralytics import YOLO
import os
import json
from collections import defaultdict

SERVICE_DIR = os.path.abspath(os.path.dirname(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SERVICE_DIR, "..", ".."))


def resolve_model_path(*candidates):
    """Return the first existing local model path, else the first candidate name."""
    search_roots = [SERVICE_DIR, REPO_ROOT, os.getcwd()]

    for candidate in candidates:
        if not candidate:
            continue

        if os.path.isabs(candidate) and os.path.exists(candidate):
            return candidate

        for root in search_roots:
            local_path = os.path.join(root, candidate)
            if os.path.exists(local_path):
                return local_path

    return candidates[0] if candidates else None

# COCO 80 Classes (Standard YOLO)
COCO_80_CLASSES = {
    'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 
    'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 
    'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 
    'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 
    'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 
    'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 
    'banana', 'apple', 'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 
    'donut', 'cake', 'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet', 
    'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 
    'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
}

COCO_CLASS_ALIASES = {
    "aeroplane": "airplane",
    "plane": "airplane",
    "planes": "airplane",
    "motorbike": "motorcycle",
    "motorbikes": "motorcycle",
    "bike": "bicycle",
    "bikes": "bicycle",
    "cycle": "bicycle",
    "cycles": "bicycle",
    "tv monitor": "tv",
    "television": "tv",
    "monitor": "tv",
    "screen": "tv",
    "cellphone": "cell phone",
    "cell phone": "cell phone",
    "mobile": "cell phone",
    "mobile phone": "cell phone",
    "phone": "cell phone",
    "smartphone": "cell phone",
    "smart phone": "cell phone",
    "fridge": "refrigerator",
    "fridges": "refrigerator",
    "sofa": "couch",
    "table": "dining table",
}

DEFAULT_OBJECT_SUBCLASSES = {
    'car': {
        'base': ['car', 'vehicle', 'automobile', 'sedan', 'hatchback', 'suv', 'coupe'],
        'wheels': ['wheel', 'wheels', 'tire', 'tires', 'tyre', 'rim', 'alloy wheel'],
        'mirrors': ['mirror', 'mirrors', 'side mirror', 'rear mirror', 'wing mirror'],
        'hood': ['hood', 'bonnet', 'engine hood', 'car hood'],
        'windshield': ['windshield', 'windscreen', 'front glass', 'windshield glass'],
        'lights': ['headlight', 'headlamp', 'taillight', 'brake light', 'turn signal', 'fog light'],
        'bumpers': ['bumper', 'front bumper', 'rear bumper'],
        'doors': ['door', 'doors', 'car door', 'vehicle door', 'door handle'],
        'windows': ['window', 'windows', 'car window', 'side window', 'rear window'],
        'roof': ['roof', 'car roof', 'sunroof'],
        'body': ['trunk', 'boot', 'grille', 'license plate', 'number plate'],
    },
}


def _load_object_subclasses():
    """Load the hierarchical object catalog from split JSON files or a legacy fallback."""
    base_dir = os.path.dirname(__file__)
    catalog_dir = os.path.join(base_dir, "object_subclasses_catalog")
    catalog_path = os.path.join(base_dir, "object_subclasses.json")
    loaded_sources = []

    if os.path.isdir(catalog_dir):
        merged = {}
        try:
            for filename in sorted(os.listdir(catalog_dir)):
                if not filename.lower().endswith(".json"):
                    continue

                file_path = os.path.join(catalog_dir, filename)
                with open(file_path, "r", encoding="utf-8") as catalog_file:
                    loaded = json.load(catalog_file)

                if not isinstance(loaded, dict):
                    raise ValueError(f"Catalog file {filename} must contain a JSON object")

                overlapping = set(merged).intersection(loaded)
                if overlapping:
                    raise ValueError(
                        f"Duplicate object roots across catalog files: {sorted(overlapping)}"
                    )

                merged.update(loaded)
                loaded_sources.append(filename)

            if merged:
                return merged, loaded_sources
        except Exception as exc:
            print(f"[DETECTOR] Failed to load split object catalog from {catalog_dir}: {exc}")

    try:
        with open(catalog_path, "r", encoding="utf-8") as catalog_file:
            loaded = json.load(catalog_file)
            if isinstance(loaded, dict) and loaded:
                return loaded, [os.path.basename(catalog_path)]
    except Exception as exc:
        print(f"[DETECTOR] Failed to load object catalog from {catalog_path}: {exc}")
    return DEFAULT_OBJECT_SUBCLASSES, ["DEFAULT_OBJECT_SUBCLASSES"]


OBJECT_SUBCLASSES, OBJECT_SUBCLASS_SOURCES = _load_object_subclasses()


def _build_object_part_mappings():
    """Flatten aliases into root/group mappings plus unique/ambiguous root lookups."""
    alias_to_roots = defaultdict(set)
    alias_to_root_groups = defaultdict(set)
    for root_label, groups in OBJECT_SUBCLASSES.items():
        for group_name, aliases in groups.items():
            for alias in aliases:
                alias_to_roots[alias.lower()].add(root_label)
                alias_to_root_groups[alias.lower()].add((root_label, group_name))

    unique_mappings = {}
    ambiguous_mappings = {}
    for alias, roots in alias_to_roots.items():
        if len(roots) == 1:
            unique_mappings[alias] = next(iter(roots))
        else:
            ambiguous_mappings[alias] = sorted(roots)

    normalized_root_groups = {
        alias: sorted(root_groups)
        for alias, root_groups in alias_to_root_groups.items()
    }

    return unique_mappings, ambiguous_mappings, normalized_root_groups


OBJECT_PART_MAP, AMBIGUOUS_OBJECT_PART_MAP, OBJECT_PART_GROUP_MAP = _build_object_part_mappings()

# Extended object mappings for user queries
OBJECT_CATEGORY_MAP = {
    # Natural Objects -> COCO equivalents
    'rock': 'rock', 'mineral': 'mineral', 'mountain': 'mountain', 'sand': 'sand',
    'tree': 'potted plant', 'flower': 'flower', 'bush': 'potted plant', 'leaf': 'leaf',
    'beetle': 'insect', 'ant': 'insect', 'bird': 'bird', 'herons': 'bird', 'insect': 'insect',
    'dog': 'dog', 'cat': 'cat', 'horse': 'horse', 'cow': 'cow', 'sheep': 'sheep',
    
    # Furniture
    'bed': 'bed', 'sofa': 'couch', 'couch': 'couch', 'chair': 'chair', 'table': 'dining table',
    'desk': 'dining table', 'cabinet': 'cabinet', 'bookshelf': 'book', 'stool': 'chair',
    
    # Kitchen
    'pot': 'pot', 'pan': 'pan', 'plate': 'bowl', 'bowl': 'bowl', 'cup': 'cup', 
    'fork': 'fork', 'knife': 'knife', 'spoon': 'spoon', 'coffee maker': 'microwave',
    'refrigerator': 'refrigerator', 'oven': 'oven', 'microwave': 'microwave',
    
    # Electronics
    'computer': 'laptop', 'laptop': 'laptop', 'smartphone': 'mouse', 'tv': 'tv',
    'radio': 'radio', 'lamp': 'lamp', 'headphones': 'headphones', 'washing machine': 'washing machine',
    
    # Personal Items
    'shirt': 'clothing', 'dress': 'clothing', 'shoe': 'shoe', 'bag': 'handbag',
    'wallet': 'handbag', 'key': 'key', 'watch': 'watch', 'jewelry': 'jewelry',
    
    # Stationery
    'pen': 'pen', 'pencil': 'pencil', 'notebook': 'book', 'scissors': 'scissors',
    
    # Transportation
    'car': 'car', 'bicycle': 'bicycle', 'motorcycle': 'motorcycle', 'bus': 'bus',
    'train': 'train', 'airplane': 'airplane', 'truck': 'truck', 'boat': 'boat',
    
    # Structures
    'house': 'house', 'building': 'building', 'fence': 'fence', 'bridge': 'bridge',
}

OBJECT_CATEGORY_MAP.update(OBJECT_PART_MAP)


def _normalize_part_token(value):
    token = (value or "").strip().lower()
    if token.endswith("ies") and len(token) > 3:
        return token[:-3] + "y"
    if token.endswith("s") and not token.endswith("ss") and len(token) > 3:
        return token[:-1]
    return token


def _select_relevant_part_groups(query_lower):
    candidates = OBJECT_PART_GROUP_MAP.get(query_lower, [])
    if not candidates:
        return []

    query_token = _normalize_part_token(query_lower)
    preferred = []
    for root_label, group_name in candidates:
        group_token = _normalize_part_token(group_name.replace("_", " "))
        if (
            group_token == query_token
            or query_token in group_token
            or group_token in query_token
        ):
            preferred.append((root_label, group_name))

    return preferred or candidates


def _canonicalize_part_query(query_lower):
    part_groups = _select_relevant_part_groups(query_lower)
    if not part_groups:
        return query_lower

    canonical_terms = []
    seen = set()
    for root_label, group_name in part_groups:
        aliases = OBJECT_SUBCLASSES.get(root_label, {}).get(group_name, [])
        if not aliases:
            continue
        canonical = aliases[0].strip().lower()
        if canonical and canonical not in seen:
            canonical_terms.append(canonical)
            seen.add(canonical)

    if len(canonical_terms) == 1:
        return canonical_terms[0]

    return query_lower


def _center_inside(inner, outer, tolerance=0.03):
    return (
        abs(inner["x_center"] - outer["x_center"]) <= (outer["width"] / 2.0) + tolerance
        and abs(inner["y_center"] - outer["y_center"]) <= (outer["height"] / 2.0) + tolerance
    )


def _area(detection):
    return max(detection.get("width", 0.0), 0.0) * max(detection.get("height", 0.0), 0.0)


PART_PARENT_ALIASES = {
    "car": {"car", "vehicle", "automobile", "sedan", "hatchback", "suv", "coupe"},
    "bus": {"bus"},
    "truck": {"truck", "cab"},
    "motorcycle": {"motorcycle", "bike"},
    "bicycle": {"bicycle", "bike"},
}


PART_SIZE_RULES = {
    "mirrors": 0.12,
    "windshield": 0.45,
    "hood": 0.5,
    "lights": 0.18,
    "wheels": 0.2,
    "doors": 0.38,
    "windows": 0.3,
    "roof": 0.28,
    "bumpers": 0.28,
    "body": 0.55,
}

class MultiModelDetector:
    def __init__(self):
        self.yolov8_model = None
        self.yolo_world_model = None
        self.yolov8_model_path = resolve_model_path("yolov8x.pt", "yolov8n.pt")
        self.yolo_world_model_path = resolve_model_path("yolov8x-world.pt", "yolov8s-world.pt")
        
    def load_models(self):
        """Lazy load models on first use"""
        if self.yolov8_model is None:
            print(f"[DETECTOR] Loading COCO model from: {self.yolov8_model_path}")
            self.yolov8_model = YOLO(self.yolov8_model_path)
        if self.yolo_world_model is None:
            try:
                print(f"[DETECTOR] Loading YOLO-World model from: {self.yolo_world_model_path}")
                self.yolo_world_model = YOLO(self.yolo_world_model_path)
            except Exception as exc:
                # Keep detection available even if the open-vocabulary model is unavailable.
                print(f"[DETECTOR] Failed to load YOLO-World model: {exc}")
                self.yolo_world_model = False

    def _run_coco_detection(self, image_path, queries, conf_threshold):
        detections = []
        detected_labels = set()

        print(f"[DETECTOR] Using COCO model (80 classes)")
        results = self.yolov8_model(image_path, conf=conf_threshold)

        for r in results:
            boxes = r.boxes
            for box in boxes:
                cls_id = int(box.cls[0].item())
                label = self.yolov8_model.names[cls_id]
                confidence = float(box.conf[0].item())

                if queries:
                    match = any(q.lower() in label.lower() for q in queries)
                    if not match:
                        continue

                detected_labels.add(label)
                x_c, y_c, w, h = box.xywhn[0].tolist()

                detections.append({
                    "label": label,
                    "x_center": x_c,
                    "y_center": y_c,
                    "width": w,
                    "height": h,
                    "confidence": confidence,
                    "model": "yolov8x (COCO 80 classes)"
                })

        return detections, detected_labels

    def _run_world_detection(self, image_path, queries, conf_threshold):
        detections = []
        detected_labels = set()

        print(f"[DETECTOR] Using YOLO-World (open-vocab){' with queries: ' + str(queries) if queries else ' - detect all'}")

        if hasattr(self.yolo_world_model, 'set_classes'):
            try:
                if queries:
                    self.yolo_world_model.set_classes(queries)
                else:
                    self.yolo_world_model.set_classes(None)
            except Exception:
                pass

        results = self.yolo_world_model(image_path, conf=conf_threshold)
        seen_detections = set()

        for r in results:
            boxes = r.boxes
            for box in boxes:
                cls_id = int(box.cls[0].item())
                label = self.yolo_world_model.names[cls_id]
                confidence = float(box.conf[0].item())
                x_c, y_c, w, h = box.xywhn[0].tolist()

                detection_key = f"{label}_{x_c:.3f}_{y_c:.3f}"
                if detection_key in seen_detections:
                    continue

                detected_labels.add(label)
                seen_detections.add(detection_key)
                detections.append({
                    "label": label,
                    "x_center": x_c,
                    "y_center": y_c,
                    "width": w,
                    "height": h,
                    "confidence": confidence,
                    "model": "yolov8x-world (open-vocabulary)"
                })

        return detections, detected_labels

    def _collect_parent_candidates(self, image_path, root_labels, conf_threshold):
        if not root_labels:
            return []

        if self.yolo_world_model and self.yolo_world_model is not False:
            world_queries = sorted({
                alias
                for root_label in root_labels
                for alias in PART_PARENT_ALIASES.get(root_label, {root_label})
            })
            world_detections, _ = self._run_world_detection(
                image_path,
                world_queries,
                max(conf_threshold, 0.08),
            )
        else:
            world_detections = []

        parent_candidates = [
            detection for detection in world_detections
            if any(
                alias in detection["label"].lower()
                for root_label in root_labels
                for alias in PART_PARENT_ALIASES.get(root_label, {root_label})
            )
        ]

        if "car" in root_labels and self.yolov8_model:
            coco_detections, _ = self._run_coco_detection(image_path, ["car"], max(conf_threshold, 0.08))
            parent_candidates.extend(coco_detections)

        seen = set()
        unique_candidates = []
        for item in parent_candidates:
            key = f"{item['label']}_{item['x_center']:.3f}_{item['y_center']:.3f}_{item['width']:.3f}_{item['height']:.3f}"
            if key in seen:
                continue
            seen.add(key)
            unique_candidates.append(item)

        return unique_candidates

    def _filter_part_detections(self, image_path, detections, queries, conf_threshold):
        if not queries or not detections:
            return detections

        relevant_groups = []
        for query in queries:
            relevant_groups.extend(_select_relevant_part_groups(query.strip().lower()))

        if not relevant_groups:
            return detections

        root_labels = sorted({root_label for root_label, _ in relevant_groups})
        part_groups = {group_name for _, group_name in relevant_groups}
        max_area_ratio = max(
            (PART_SIZE_RULES.get(group_name, 0.35) for group_name in part_groups),
            default=0.35,
        )

        parent_candidates = self._collect_parent_candidates(image_path, root_labels, conf_threshold)
        if not parent_candidates:
            return detections

        filtered = []
        fallback = []
        for detection in detections:
            detection_area = _area(detection)
            matching_parent = None
            for parent in parent_candidates:
                parent_area = _area(parent)
                if parent_area <= 0:
                    continue
                if not _center_inside(detection, parent):
                    continue
                area_ratio = detection_area / parent_area
                if area_ratio <= max_area_ratio:
                    matching_parent = parent
                    break
                fallback.append((detection, area_ratio, parent))

            if matching_parent:
                filtered.append(detection)

        if filtered:
            print(f"[DETECTOR] Part-aware filtering kept {len(filtered)} of {len(detections)} detections")
            return filtered

        if fallback:
            fallback.sort(key=lambda item: item[1])
            best_detection = fallback[0][0]
            print("[DETECTOR] Part-aware filtering found only oversized candidates; keeping the smallest plausible match")
            return [best_detection]

        return detections
    
    def detect_with_strategy(self, image_path, queries=None, conf_threshold=0.02, strategy='auto'):
        """
        Multi-strategy detection:
        - 'coco': Standard YOLO on COCO 80 classes
        - 'world': YOLO-World for open-vocabulary
        - 'ensemble': Combine both for best coverage
        - 'auto': Auto-select based on queries
        """
        self.load_models()
        
        detections = []
        detected_labels = set()
        
        # Strategy selection
        if strategy == 'auto':
            # Auto-select: if queries provided, use world model; otherwise use standard
            strategy = 'world' if queries else 'coco'

        if strategy in ['world', 'ensemble'] and self.yolo_world_model is False:
            print("[DETECTOR] YOLO-World unavailable, falling back to COCO detection")
            strategy = 'coco'
        
        if strategy in ['coco', 'ensemble']:
            coco_detections, coco_labels = self._run_coco_detection(image_path, queries, conf_threshold)
            detections.extend(coco_detections)
            detected_labels.update(coco_labels)

        should_retry_with_world = (
            strategy == 'coco'
            and queries
            and not detections
            and self.yolo_world_model
        )
        if should_retry_with_world:
            print("[DETECTOR] COCO returned no matches, retrying with YOLO-World")
            strategy = 'world'

        if strategy in ['world', 'ensemble'] and self.yolo_world_model:
            world_detections, world_labels = self._run_world_detection(image_path, queries, conf_threshold)
            if strategy == 'ensemble':
                existing_keys = {
                    f"{item['label']}_{item['x_center']:.3f}_{item['y_center']:.3f}"
                    for item in detections
                }
                for item in world_detections:
                    detection_key = f"{item['label']}_{item['x_center']:.3f}_{item['y_center']:.3f}"
                    if detection_key in existing_keys:
                        continue
                    detections.append(item)
                    detected_labels.add(item["label"])
            else:
                detections.extend(world_detections)
                detected_labels.update(world_labels)

        detections = self._filter_part_detections(image_path, detections, queries, conf_threshold)
        detected_labels = {item["label"] for item in detections}
        
        print(f"[DETECTOR] Found {len(detections)} objects: {detected_labels}")
        return detections, sorted(list(detected_labels))


# Global detector instance
_detector = None

def get_detector():
    global _detector
    if _detector is None:
        _detector = MultiModelDetector()
    return _detector


def map_custom_query_to_detectable(query):
    """Map user queries to detectable object categories"""
    query_lower = query.strip().lower()

    if not query_lower:
        return query_lower

    if query_lower in COCO_CLASS_ALIASES:
        return COCO_CLASS_ALIASES[query_lower]

    # Direct COCO match
    if query_lower in COCO_80_CLASSES:
        return query_lower

    # Keep part-specific intent instead of collapsing parts like "mirror" or
    # "windshield" into the whole root object such as "car".
    if query_lower in OBJECT_PART_GROUP_MAP:
        return _canonicalize_part_query(query_lower)

    # Ambiguous part names are better passed through as-is for YOLO-World
    # instead of forcing them into one arbitrary root object.
    if query_lower in AMBIGUOUS_OBJECT_PART_MAP:
        return query_lower

    # Mapped category
    if query_lower in OBJECT_CATEGORY_MAP:
        return OBJECT_CATEGORY_MAP[query_lower]

    # Partial COCO match
    for q_lower in COCO_80_CLASSES:
        if query_lower in q_lower or q_lower in query_lower:
            return q_lower

    # Partial object map match
    for q_key, mapped in OBJECT_CATEGORY_MAP.items():
        if query_lower in q_key or q_key in query_lower:
            return mapped

    # Return as-is (YOLO-World may handle it)
    return query_lower


def expand_query_with_subclasses(query):
    """
    Expand queries using the object hierarchy without losing query intent.
    Root/base aliases stay compact, while part queries expand within their part group.
    """
    query_lower = query.strip().lower()

    if not query_lower:
        return []

    if query_lower in OBJECT_PART_GROUP_MAP:
        expanded_terms = {query_lower}
        for root_query, group_name in _select_relevant_part_groups(query_lower):
            aliases = OBJECT_SUBCLASSES.get(root_query, {}).get(group_name, [])
            expanded_terms.update(item.lower() for item in aliases)
        return sorted(expanded_terms)

    root_query = OBJECT_PART_MAP.get(query_lower, query_lower)

    if root_query in OBJECT_SUBCLASSES:
        expanded_terms = set()
        for aliases in OBJECT_SUBCLASSES[root_query].values():
            expanded_terms.update(item.lower() for item in aliases)
        return sorted(expanded_terms)

    # If no hierarchy match, return the query as-is
    return [query_lower]


def get_all_searchable_queries():
    """Return all searchable object types including hierarchical subclasses."""
    extended = set(OBJECT_CATEGORY_MAP.keys())

    for grouped_aliases in OBJECT_SUBCLASSES.values():
        for aliases in grouped_aliases.values():
            extended.update(aliases)

    return sorted(list(extended))


def get_supported_coco_classes():
    """Return list of all 80 COCO classes"""
    return sorted(list(COCO_80_CLASSES))


def get_supported_extended_objects():
    """Return comprehensive object category list"""
    return sorted(list(OBJECT_CATEGORY_MAP.keys()))


def get_ambiguous_object_aliases():
    """Return aliases that belong to multiple root object groups."""
    return {alias: roots[:] for alias, roots in sorted(AMBIGUOUS_OBJECT_PART_MAP.items())}


def get_object_catalog_sources():
    """Return the catalog source files used to build the object hierarchy."""
    return OBJECT_SUBCLASS_SOURCES[:]
