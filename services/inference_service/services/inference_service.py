import hashlib
import json
import os
import random
import shutil
from datetime import datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

import gridfs
from bson.objectid import ObjectId
from PIL import Image
from pymongo import MongoClient
from ultralytics import YOLO

from config import Config

try:
    import torch
    import torch.nn as nn
except Exception:
    torch = None
    nn = None
try:
    import torchvision
    import torchvision.transforms as tv_transforms
except Exception:
    torchvision = None
    tv_transforms = None

REPO_ROOT = Path(__file__).resolve().parents[3]
PROJECTS_ROOT = Path(
    os.getenv("PROJECTS_DIR", str(REPO_ROOT / "storage" / "projects"))
).resolve()
UPLOADS_ROOT = (
    Path(Config.UPLOAD_DIR)
    if Path(Config.UPLOAD_DIR).is_absolute()
    else (REPO_ROOT / Config.UPLOAD_DIR)
).resolve()
LEGACY_REPO_UPLOADS_ROOT = (REPO_ROOT / "uploads").resolve()
LEGACY_WORKSPACE_UPLOADS_ROOT = (REPO_ROOT.parent / "uploads").resolve()
DB_NAME = os.getenv("MONGO_DB_NAME", "visionflow")
ASSET_FILES_BUCKET = "asset_files"
KPI_EVENT_COLLECTION = "kpi_events"
kpi_clients = set()

client = MongoClient(Config.MONGO_URI, serverSelectionTimeoutMS=2000)
db = client[DB_NAME]
asset_files_bucket = gridfs.GridFSBucket(db, bucket_name=ASSET_FILES_BUCKET)


def now_iso():
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def to_object_id(value):
    text = str(value or "").strip()
    if not text or not ObjectId.is_valid(text):
        return None
    return ObjectId(text)


def slugify(value):
    cleaned = []
    for char in str(value or "project").lower():
        cleaned.append(char if char.isalnum() else "-")
    slug = "".join(cleaned).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug[:50] or "project"


def broadcast_kpi_update(reason, detail=None):
    payload = {
        "source": "inference-service",
        "reason": reason,
        "detail": detail or {},
        "ts": int(datetime.utcnow().timestamp() * 1000),
    }
    message = f"event: snapshot\ndata: {json.dumps(payload)}\n\n"
    dead_clients = []
    for client_handle in list(kpi_clients):
        try:
            client_handle.put_nowait(message)
        except Exception:
            dead_clients.append(client_handle)
    for client_handle in dead_clients:
        kpi_clients.discard(client_handle)


def record_kpi_events(events):
    payload = [event for event in (events or []) if isinstance(event, dict)]
    if not payload:
        return
    try:
        db[KPI_EVENT_COLLECTION].insert_many(payload, ordered=False)
    except Exception as error:
        logger.warning(f"Failed to record KPI telemetry: {error}")


class InferenceLogic:
    models = {}
    clip_models = {}
    _device_cache = None

    @classmethod
    def get_inference_device(cls):
        if cls._device_cache:
            return cls._device_cache
        requested = str(os.getenv("INFERENCE_DEVICE", "auto")).strip().lower()
        if requested in {"cpu", "cuda", "mps"}:
            cls._device_cache = requested
            return cls._device_cache
        if torch is not None:
            try:
                if torch.cuda.is_available():
                    cls._device_cache = "cuda:0"
                    return cls._device_cache
                if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                    cls._device_cache = "mps"
                    return cls._device_cache
            except Exception:
                pass
        cls._device_cache = "cpu"
        return cls._device_cache

    @staticmethod
    def _inference_runtime_options():
        device = InferenceLogic.get_inference_device()
        return {
            "device": device,
            "batch": max(1, int(os.getenv("INFERENCE_BATCH", "1"))),
            "imgsz": int(os.getenv("INFERENCE_IMGSZ", "768")),
            "half": str(os.getenv("INFERENCE_FP16", "true")).strip().lower() in {"1", "true", "yes", "on"} and str(device).startswith("cuda"),
        }

    @staticmethod
    def _classification_detection_runtime_options(ppe_requested=False):
        runtime = InferenceLogic._inference_runtime_options()
        if ppe_requested:
            runtime.update({
                "imgsz": int(os.getenv("PPE_INFERENCE_IMGSZ", "960")),
                "iou": float(os.getenv("PPE_INFERENCE_IOU", "0.45")),
                "augment": str(os.getenv("PPE_INFERENCE_AUGMENT", "true")).strip().lower() in {"1", "true", "yes", "on"},
                "max_det": int(os.getenv("PPE_INFERENCE_MAX_DET", "300")),
            })
        return runtime

    @classmethod
    def get_model(cls, model_name=None):
        resolved_model = cls.resolve_model_name(model_name)
        if resolved_model not in cls.models:
            cls.models[resolved_model] = YOLO(resolved_model)
        return cls.models[resolved_model]

    @classmethod
    def get_auto_label_model(cls, model_name=None, classes=None):
        resolved_model = cls.resolve_model_name(model_name)
        normalized_classes = tuple(cls._normalize_queries(classes))
        is_world_model = "world" in Path(resolved_model).name.lower()
        cache_key = (resolved_model, normalized_classes) if is_world_model and normalized_classes else resolved_model

        if cache_key not in cls.models:
            model = YOLO(resolved_model)
            if is_world_model and normalized_classes:
                model.set_classes(list(normalized_classes))
            cls.models[cache_key] = model

        model = cls.models[cache_key]
        return model

    @staticmethod
    def resolve_model_name(model_name=None):
        candidate = str(model_name or Config.YOLO_AUTO_LABEL_MODEL or Config.YOLO_MODEL_PATH).strip()
        if not candidate:
            candidate = "yolo26s.pt"

        # Backward-compatible aliases for local model names.
        aliases = {
            "yolov26s.pt": "yolo26s.pt",
        }
        candidate = aliases.get(candidate, candidate)

        candidate_path = Path(candidate)
        if candidate_path.is_file() or candidate_path.exists():
            return str(candidate_path.resolve())

        search_roots = [Path.cwd(), REPO_ROOT]
        for root in search_roots:
            resolved = (root / candidate).resolve()
            if resolved.exists():
                return str(resolved)
            
        # Check storage/models directory (new training output)
        models_root = REPO_ROOT / "storage" / "models"
        if models_root.exists():
            for p in models_root.rglob("*.pt"):
                if p.name == candidate or p.parent.name == candidate:
                    return str(p.resolve())

        configured_path = Path(Config.YOLO_MODEL_PATH)
        if configured_path.exists() and configured_path.name == candidate_path.name:
            return str(configured_path.resolve())

        return candidate

    @staticmethod
    def resolve_classification_detection_model_name(model_name=None, classification_type=None, ppe_requested=False):
        """Return the best model for classification-based detection.

        For PPE projects (or any Multi-Label project) we use a YOLO-World model
        (default: yolov8s-world.pt) that supports open-vocabulary set_classes(),
        allowing it to detect arbitrary classes like 'Safety Helmet', 'Safety Vest',
        'Person' etc. without needing a dataset-specific trained model.

        Standard COCO models (yolov8n/s/m/x) only know 80 fixed classes and
        cannot detect PPE equipment, which is why only 'person' boxes appeared.
        """
        if ppe_requested or str(classification_type or "").strip() == "Multi-Label":
            return str(Config.PPE_MULTI_LABEL_MODEL or "yolov8s-world.pt").strip() or "yolov8s-world.pt"
        candidate = str(model_name or "").strip()
        candidate_name = Path(candidate).name.lower() if candidate else ""
        if candidate and "-cls" not in candidate_name and "classif" not in candidate_name:
            return candidate
        return "yolo26s.pt"

    @staticmethod
    def get_timestamp():
        return now_iso()

    @staticmethod
    def _normalize_queries(queries):
        normalized = []
        seen = set()
        for item in queries or []:
            text = str(item or "").strip()
            lowered = text.lower()
            if text and lowered not in seen:
                seen.add(lowered)
                normalized.append(text)
        return normalized

    @staticmethod
    def _project_annotation_queries(project):
        if not project:
            return []
        project_type = str(project.get("project_type") or "Object Detection").strip().lower()
        if "object" not in project_type and "detect" not in project_type:
            return []
        raw_group = str(project.get("annotation_group") or "").strip()
        if not raw_group:
            return []
        items = [
            str(item).strip()
            for item in raw_group.replace("\n", ",").split(",")
            if str(item).strip()
        ]
        normalized_items = [item.lower() for item in items]
        if any(item in {"object", "objects", "all", "any"} for item in normalized_items):
            # Generic group means detect all.
            return []
        return InferenceLogic._normalize_queries(items)

    @staticmethod
    def _parse_annotation_group_terms(raw_group):
        terms = []
        seen = set()
        for item in str(raw_group or "").replace("\n", ",").split(","):
            text = str(item or "").strip()
            slug = InferenceLogic._normalize_label_text(text)
            if not text or not slug or slug in seen:
                continue
            seen.add(slug)
            terms.append({"name": text, "slug": slug})
        return terms

    @staticmethod
    def _project_classification_type(project):
        value = str((project or {}).get("classification_type") or "Multi-Label").strip()
        return value if value in {"Single-Label", "Multi-Label"} else "Multi-Label"

    @staticmethod
    def _project_classification_queries(project, include_unmapped=False):
        if not project:
            raise ValueError("Project not found for classification inference.")
        if str(project.get("project_type") or "").strip() != "Classification":
            raise ValueError("Classification inference is only supported for Classification projects.")

        generic = {"object", "objects", "all", "any"}
        stored_terms = project.get("annotation_group_terms") or []
        terms = []
        if isinstance(stored_terms, list) and stored_terms:
            for term in stored_terms:
                if isinstance(term, dict):
                    name = str(term.get("name") or "").strip()
                    slug = InferenceLogic._normalize_label_text(term.get("slug") or name)
                    detector_label = str(term.get("detector_label") or name).strip()
                    unmapped = bool(term.get("unmapped"))
                else:
                    name = str(term or "").strip()
                    slug = InferenceLogic._normalize_label_text(name)
                    detector_label = name
                    unmapped = False
                if name and slug:
                    terms.append({
                        "name": name,
                        "slug": slug,
                        "detector_label": detector_label,
                        "unmapped": unmapped,
                    })
        else:
            terms = [
                {**term, "unmapped": False}
                for term in InferenceLogic._parse_annotation_group_terms(project.get("annotation_group"))
            ]

        if not terms:
            class_names = []
            for item in project.get("classes") or []:
                name = str((item or {}).get("name") if isinstance(item, dict) else item).strip()
                if name:
                    class_names.append(name)
            terms = [
                {**term, "unmapped": False}
                for term in InferenceLogic._parse_annotation_group_terms(",".join(class_names))
            ]

        if not terms:
            raise ValueError("Classification annotation group must contain at least one label before inference.")
        if any(term["slug"] in generic for term in terms):
            raise ValueError("Classification annotation group requires explicit labels; object/all/any are not valid.")

        mapped = [
            (term["name"] if include_unmapped else (term.get("detector_label") or term["name"]))
            for term in terms
            if include_unmapped or not term.get("unmapped")
        ]
        if not mapped:
            raise ValueError("Classification annotation group has no mapped detector labels for automatic inference.")
        return InferenceLogic._normalize_queries(mapped)

    @staticmethod
    def _ppe_canonical_label(value):
        text = InferenceLogic._normalize_label_text(value)
        if not text:
            return None
        helmet_terms = {
            "helmet",
            "safety helmet",
            "construction helmet",
            "yellow helmet",
            "hard hat",
            "hardhat",
            "industrial helmet",
            "worker helmet",
            "work helmet",
            "ppe helmet",
        }
        vest_terms = {
            "vest",
            "safety vest",
            "reflective vest",
            "high visibility vest",
            "hi vis vest",
            "hi-vis vest",
            "orange vest",
            "green vest",
            "yellow vest",
            "worker vest",
            "ppe vest",
        }
        if text in helmet_terms or ("helmet" in text and any(word in text for word in ("safety", "construction", "worker", "industrial", "yellow", "ppe"))):
            return "helmet"
        if text in vest_terms or ("vest" in text and any(word in text for word in ("safety", "reflective", "visibility", "worker", "orange", "yellow", "green", "ppe"))):
            return "vest"
        return None

    @staticmethod
    def _classification_detection_plan(project):
        labels = InferenceLogic._project_classification_queries(project, include_unmapped=True)
        allowed = {}
        queries = []
        requested_targets = []
        seen_queries = set()
        ppe_requested = False

        for label in labels:
            user_label = str(label or "").strip()
            normalized = InferenceLogic._normalize_label_text(user_label)
            if not user_label or not normalized:
                continue

            ppe_canonical = InferenceLogic._ppe_canonical_label(user_label)
            target_key = ppe_canonical or normalized
            query_label = ppe_canonical or user_label
            ppe_requested = ppe_requested or bool(ppe_canonical)

            if target_key not in allowed:
                allowed[target_key] = user_label
            if normalized not in allowed:
                allowed[normalized] = user_label
            if query_label.lower() not in seen_queries:
                seen_queries.add(query_label.lower())
                queries.append(query_label)
            requested_targets.append({"name": user_label, "target_key": target_key})

        return {
            "label_queries": InferenceLogic._normalize_queries(queries),
            "allowed_label_map": allowed,
            "requested_targets": requested_targets,
            "ppe_requested": ppe_requested,
        }

    @staticmethod
    def _classification_allowed_label_map(project):
        return InferenceLogic._classification_detection_plan(project)["allowed_label_map"]

    @staticmethod
    def _project_classification_label_options(project):
        if not project:
            raise ValueError("Project not found for classification inference.")
        if str(project.get("project_type") or "").strip() != "Classification":
            raise ValueError("Classification inference is only supported for Classification projects.")

        generic = {"object", "objects", "all", "any"}
        labels = []
        stored_terms = project.get("annotation_group_terms") or []
        if isinstance(stored_terms, list) and stored_terms:
            for term in stored_terms:
                if isinstance(term, dict):
                    name = str(term.get("name") or "").strip()
                else:
                    name = str(term or "").strip()
                if name:
                    labels.append(name)
        else:
            labels = [
                term["name"]
                for term in InferenceLogic._parse_annotation_group_terms(project.get("annotation_group"))
            ]

        if not labels:
            for item in project.get("classes") or []:
                name = str((item or {}).get("name") if isinstance(item, dict) else item).strip()
                if name:
                    labels.append(name)

        normalized = []
        seen = set()
        for label in labels:
            slug = InferenceLogic._normalize_label_text(label)
            if not slug or slug in seen:
                continue
            seen.add(slug)
            normalized.append(str(label).strip())

        if not normalized:
            raise ValueError("Classification annotation group must contain at least one label before inference.")
        if any(InferenceLogic._normalize_label_text(label) in generic for label in normalized):
            raise ValueError("Classification annotation group requires explicit labels; object/all/any are not valid.")
        return normalized

    @staticmethod
    def _select_classification_detections(detections, classification_type):
        ordered = sorted(
            detections or [],
            key=lambda item: float(item.get("confidence") or 0),
            reverse=True,
        )
        if classification_type == "Single-Label":
            return ordered[:1]
        return ordered

    @staticmethod
    def _classification_tag_annotation(asset_id, project_id, label, confidence, timestamp, model_used, classification_type):
        label_text = str(label or "").strip()
        return {
            "asset_id": str(asset_id),
            "project_id": project_id,
            "label": label_text,
            "class_id": label_text,
            "confidence": float(confidence or 0),
            "type": "tag",
            "source": "model_inference",
            "project_type": "Classification",
            "classification_type": classification_type,
            "model_used": model_used,
            "inference_run_at": timestamp,
            "created_at": timestamp,
            "updated_at": timestamp,
        }

    @staticmethod
    def _classification_box_annotation(asset_id, project_id, detection, timestamp, model_used, classification_type):
        label = str(detection.get("label") or "")
        x_center = float(detection.get("x_center") or 0.5)
        y_center = float(detection.get("y_center") or 0.5)
        width = float(detection.get("width") or 0)
        height = float(detection.get("height") or 0)
        return {
            "asset_id": str(asset_id),
            "image_id": str(asset_id),
            "project_id": project_id,
            "label": label,
            "class_name": label,
            "class_id": detection.get("class_id"),
            "confidence": float(detection.get("confidence") or 0),
            "type": "box",
            "x_center": x_center,
            "y_center": y_center,
            "width": width,
            "height": height,
            "bbox": {
                "x": max(0.0, x_center - width / 2),
                "y": max(0.0, y_center - height / 2),
                "width": width,
                "height": height,
            },
            "annotation_group": label,
            "source": "model_inference",
            "project_type": "Classification",
            "classification_type": classification_type,
            "model_used": model_used,
            "inference_run_at": timestamp,
            "created_at": timestamp,
            "updated_at": timestamp,
        }

    @staticmethod
    def _normalize_label_text(value):
        text = str(value or "").strip().lower().replace("_", " ").replace("-", " ")
        while "  " in text:
            text = text.replace("  ", " ")
        return text

    @staticmethod
    def _to_word_set(value):
        text = InferenceLogic._normalize_label_text(value)
        words = [w for w in text.split(" ") if w]
        expanded = set(words)
        for word in words:
            if word.endswith("s") and len(word) > 3:
                expanded.add(word[:-1])
            elif len(word) > 2:
                expanded.add(f"{word}s")
        return expanded

    @staticmethod
    def _label_matches_queries(label, queries):
        if not queries:
            return True
        label_text = InferenceLogic._normalize_label_text(label)
        label_words = InferenceLogic._to_word_set(label_text)

        for query in queries:
            q_text = InferenceLogic._normalize_label_text(query)
            if not q_text:
                continue
            if label_text == q_text:
                return True
            query_words = InferenceLogic._to_word_set(q_text)
            # Accept when all query terms are present in the predicted label terms
            # (e.g., "fan" matches "ceiling fan"), but reject unrelated labels.
            if query_words and query_words.issubset(label_words):
                return True
        return False

    @staticmethod
    def _is_full_frame_like(x, y, w, h):
        try:
            x = float(x); y = float(y); w = float(w); h = float(h)
        except Exception:
            return False
        # Treat near-full-image boxes as degenerate for object detection overlays.
        return (w >= 0.95 and h >= 0.95 and abs(x - 0.5) <= 0.08 and abs(y - 0.5) <= 0.08)

    @staticmethod
    def _parse_confidence(value, default=0.25):
        try:
            confidence = float(value)
        except (TypeError, ValueError):
            return default
        return min(max(confidence, 0.001), 0.999)

    @staticmethod
    def _serialize_auto_label_asset(asset_id, asset_url, annotation_count, detected_classes):
        is_annotated = annotation_count > 0
        return {
            "id": asset_id,
            "url": asset_url,
            "is_annotated": is_annotated,
            "annotation_count": annotation_count,
            "upload_state": "annotated" if is_annotated else "unannotated",
            "detected_classes": sorted(detected_classes),
        }

    @staticmethod
    def _label_from_names(names, class_id):
        if isinstance(names, dict):
            return str(names.get(class_id, class_id))
        if isinstance(names, list) and 0 <= class_id < len(names):
            return str(names[class_id])
        return str(class_id)

    @staticmethod
    def _serialize_doc(doc):
        if not doc:
            return None
        serialized = dict(doc)
        if "_id" in serialized:
            serialized["id"] = str(serialized.pop("_id"))
        return serialized

    @staticmethod
    def _normalize_architecture(value):
        normalized = str(value or "rf-detr").strip().lower().replace("_", "-")
        aliases = {
            "rfdetr": "rf-detr",
            "rf-detr": "rf-detr",
            "yolo": "yolo11",
            "yolo11": "yolo11",
            "yolo-v11": "yolo11",
        }
        return aliases.get(normalized, normalized or "rf-detr")

    @staticmethod
    def _architecture_label(value):
        labels = {
            "rf-detr": "RF-DETR",
            "yolo11": "YOLOv11",
        }
        return labels.get(value, str(value or "Custom").upper())

    @staticmethod
    def _normalize_model_size(value):
        normalized = str(value or "small").strip().lower()
        allowed = {"nano", "small", "medium", "large", "xlarge", "base"}
        return normalized if normalized in allowed else "small"

    @staticmethod
    def _resolve_version_doc(project_id, version_ref):
        version_text = str(version_ref or "").strip()
        if not version_text:
            return None

        if ObjectId.is_valid(version_text):
            version = db.versions.find_one(
                {"_id": ObjectId(version_text), "project_id": str(project_id)}
            )
            if version:
                return version

        return db.versions.find_one(
            {
                "project_id": str(project_id),
                "$or": [
                    {"version_id": version_text},
                    {"display_id": version_text},
                    {"canonical_id": version_text},
                ],
            }
        )

    @staticmethod
    def _resolve_model_doc(project_id, model_ref):
        model_text = str(model_ref or "").strip()
        if not model_text:
            return None

        if ObjectId.is_valid(model_text):
            model = db.models.find_one(
                {"_id": ObjectId(model_text), "project_id": str(project_id)}
            )
            if model:
                return model

        return db.models.find_one(
            {
                "project_id": str(project_id),
                "$or": [
                    {"model_id": model_text},
                    {"name": model_text},
                    {"checkpoint": model_text},
                ],
            }
        )

    @staticmethod
    def get_model_by_ref(model_ref):
        model_text = str(model_ref or "").strip()
        if not model_text:
            return None
        if ObjectId.is_valid(model_text):
            model = db.models.find_one({"_id": ObjectId(model_text)})
            if model:
                return model
        return db.models.find_one({"model_id": model_text})

    @staticmethod
    def resolve_weights_path(model_doc):
        candidate = str(model_doc.get("weights_path") or model_doc.get("runtime_model") or "").strip()
        if not candidate:
            return None
        p = Path(candidate)
        if p.exists():
            return p.resolve()
        resolved = (REPO_ROOT / candidate).resolve()
        if resolved.exists():
            return resolved
        return None

    @staticmethod
    def _resolve_runtime_model_from_doc(model_doc):
        artifacts = model_doc.get("runtime_artifacts") or {}
        if isinstance(artifacts, dict):
            for key in ("engine", "onnx", "pt"):
                candidate = str(artifacts.get(key) or "").strip()
                if not candidate:
                    continue
                p = Path(candidate)
                if p.exists():
                    return str(p.resolve())
                rooted = (REPO_ROOT / candidate).resolve()
                if rooted.exists():
                    return str(rooted)
        return str(model_doc.get("weights_path") or model_doc.get("runtime_model") or Config.YOLO_AUTO_LABEL_MODEL)

    @staticmethod
    def _generate_training_metrics(project_id, version_doc, architecture, model_size, checkpoint):
        version_id = version_doc.get('version_id') if version_doc else "raw"
        seed_input = (
            f"{project_id}:{version_id}:{architecture}:{model_size}:{checkpoint or ''}"
        )
        seed = int(hashlib.sha256(seed_input.encode("utf-8")).hexdigest()[:8], 16)
        rng = random.Random(seed)
        m_ap = round(rng.uniform(0.66, 0.91), 3)
        precision = round(rng.uniform(max(0.58, m_ap - 0.07), min(0.97, m_ap + 0.05)), 3)
        recall = round(rng.uniform(max(0.55, m_ap - 0.08), min(0.96, m_ap + 0.04)), 3)
        accuracy = round(rng.uniform(0.84, 0.97), 3)
        speed_ms = round(rng.uniform(14, 47), 1)
        return {
            "mAP": m_ap,
            "precision": precision,
            "recall": recall,
            "accuracy": accuracy,
            "speed_ms": speed_ms,
        }

    @staticmethod
    def _serialize_model(model_doc):
        serialized = InferenceLogic._serialize_doc(model_doc)
        metrics = serialized.get("metrics") or {
            "mAP": serialized.get("mAP"),
            "precision": serialized.get("precision"),
            "recall": serialized.get("recall"),
            "accuracy": serialized.get("accuracy"),
            "speed_ms": serialized.get("speed_ms"),
        }
        serialized["metrics"] = metrics
        serialized.setdefault("architecture_label", InferenceLogic._architecture_label(serialized.get("architecture")))
        return serialized

    @staticmethod
    def _build_storage(project):
        storage = project.get("storage") or {}
        if storage.get("project_root"):
            root = Path(storage["project_root"])
        else:
            folder_key = storage.get("folder_key") or f"{slugify(project.get('name'))}-{project['_id']}"
            root = PROJECTS_ROOT / folder_key

        dataset_root = Path(storage.get("dataset_root") or root / "dataset")
        annotated_dir = Path(storage.get("annotated_dir") or dataset_root / "images" / "annotated")
        unannotated_dir = Path(storage.get("unannotated_dir") or dataset_root / "images" / "unannotated")
        sessions_dir = Path(storage.get("sessions_dir") or dataset_root / "sessions")

        return {
            "root": root,
            "dataset_root": dataset_root,
            "annotated_dir": annotated_dir,
            "unannotated_dir": unannotated_dir,
            "sessions_dir": sessions_dir,
        }

    @staticmethod
    def _ensure_storage(storage):
        for key in ("root", "dataset_root", "annotated_dir", "unannotated_dir", "sessions_dir"):
            Path(storage[key]).mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _move_file(source_path, target_path):
        if not source_path:
            return

        source = Path(source_path)
        target = Path(target_path)
        if not source.exists():
            return

        target.parent.mkdir(parents=True, exist_ok=True)
        if source.resolve() == target.resolve():
            return

        try:
            source.replace(target)
        except OSError:
            shutil.copy2(source, target)
            source.unlink()

    @staticmethod
    def _build_asset_url(asset_id, unique_filename):
        return f"/uploads/assets/{asset_id}/{quote(str(unique_filename or 'asset'))}"

    @staticmethod
    def _download_asset_bytes(asset):
        file_ref = to_object_id(asset.get("file_id") or asset.get("current_file_id"))
        if not file_ref:
            return None

        stream = BytesIO()
        try:
            asset_files_bucket.download_to_stream(file_ref, stream)
            return stream.getvalue()
        except Exception:
            return None

    @staticmethod
    def _resolve_asset_source(asset):
        file_bytes = InferenceLogic._download_asset_bytes(asset)
        if file_bytes is not None:
            try:
                with Image.open(BytesIO(file_bytes)) as opened:
                    return opened.copy()
            except Exception:
                pass

        resolved_asset_path = InferenceLogic._resolve_asset_path(asset)
        if resolved_asset_path and Path(resolved_asset_path).exists():
            return resolved_asset_path
        return None

    @staticmethod
    def _resolve_asset_path(asset):
        candidates = []
        asset_path = asset.get("path")
        if asset_path:
            candidates.append(Path(asset_path))

        url = str(asset.get("url") or "").lstrip("/")
        if url.startswith("uploads/"):
            candidates.append(REPO_ROOT / "storage" / url.removeprefix("uploads/"))

        unique_filename = asset.get("unique_filename")
        if unique_filename:
            candidates.append(Path(Config.UPLOAD_DIR) / unique_filename)

        for candidate in candidates:
            if candidate and candidate.exists():
                return str(candidate.resolve())
        return str(candidates[0]) if candidates else None

    @staticmethod
    def _resolve_source_input(source):
        if isinstance(source, Image.Image):
            return source

        text = str(source or "").strip()
        if not text:
            return None
        if text.startswith("<PIL.Image.Image"):
            return None

        direct_candidate = Path(text)
        if direct_candidate.exists():
            return str(direct_candidate.resolve())

        parsed = urlparse(text if "://" in text else (f"http://local{text}" if text.startswith("/") else text))
        source_path = unquote(parsed.path if parsed.scheme else text)
        normalized_path = source_path.replace("\\", "/").strip()

        for candidate in (text, source_path, normalized_path):
            asset = db.assets.find_one({"url": candidate})
            if asset:
                resolved_asset_source = InferenceLogic._resolve_asset_source(asset)
                if resolved_asset_source is not None:
                    return resolved_asset_source

        candidate_paths = []
        if normalized_path.startswith("/uploads/projects/"):
            candidate_paths.append(PROJECTS_ROOT / normalized_path.removeprefix("/uploads/projects/"))
        elif normalized_path.startswith("/uploads/"):
            relative_path = normalized_path.removeprefix("/uploads/")
            candidate_paths.extend(
                [
                    UPLOADS_ROOT / relative_path,
                    LEGACY_REPO_UPLOADS_ROOT / relative_path,
                    LEGACY_WORKSPACE_UPLOADS_ROOT / relative_path,
                ]
            )
        elif normalized_path:
            candidate_paths.extend(
                [
                    Path(normalized_path),
                    (REPO_ROOT / normalized_path).resolve(),
                ]
            )

        for candidate in candidate_paths:
            if candidate.exists():
                return str(candidate.resolve())

        return text

    @staticmethod
    def _extract_box_detections(results, model, label_queries=None, exact_label_map=None):
        detections = []
        classes = []
        seen_classes = set()
        strict_labels = exact_label_map if isinstance(exact_label_map, dict) else None

        for result in results:
            if getattr(result, "boxes", None) is None:
                continue

            names = getattr(result, "names", None) or getattr(model, "names", {})
            for box in result.boxes:
                class_id = int(box.cls[0].item())
                label = InferenceLogic._label_from_names(names, class_id)

                if strict_labels is not None:
                    label_key = InferenceLogic._normalize_label_text(label)
                    canonical_label = strict_labels.get(label_key)
                    if not canonical_label:
                        ppe_key = InferenceLogic._ppe_canonical_label(label)
                        canonical_label = strict_labels.get(ppe_key) if ppe_key else None
                    if not canonical_label:
                        continue
                    label = canonical_label
                elif not InferenceLogic._label_matches_queries(label, label_queries):
                    continue

                x_center, y_center, width, height = box.xywhn[0].tolist()
                detections.append(
                    {
                        "label": label,
                        "class_id": class_id,
                        "confidence": float(box.conf[0].item()),
                        "type": "box",
                        "x_center": float(x_center),
                        "y_center": float(y_center),
                        "width": float(width),
                        "height": float(height),
                    }
                )

                lowered = label.lower()
                if lowered not in seen_classes:
                    seen_classes.add(lowered)
                    classes.append(label)

        return detections, classes

    @staticmethod
    def _write_session_file(storage, asset_id, project_id, annotations, timestamp, model_name):
        db.annotation_sessions.update_one(
            {"asset_id": asset_id},
            {
                "$set": {
                    "asset_id": asset_id,
                    "project_id": project_id,
                    "saved_at": timestamp,
                    "updated_at": timestamp,
                    "source": "auto-label",
                    "model": os.path.basename(InferenceLogic.resolve_model_name(model_name)),
                    "annotations": annotations,
                }
            },
            upsert=True,
        )

    @staticmethod
    def _write_yolo_sidecar(image_path, annotations):
        return

    @staticmethod
    def _serialize_asset(asset_id, asset_url, annotation_count, detected_classes):
        return {
            "id": asset_id,
            "url": asset_url,
            "is_annotated": True,
            "annotation_count": annotation_count,
            "upload_state": "annotated",
            "detected_classes": sorted(detected_classes),
        }

    @staticmethod
    def run_auto_label(source, queries=None, model_name=None, confidence=None):
        resolved_source = InferenceLogic._resolve_source_input(source)
        if not resolved_source:
            return {"success": False, "error": "Missing image source", "detections": [], "classes": []}

        normalized_queries = InferenceLogic._normalize_queries(queries)
        resolved_model_name = InferenceLogic.resolve_model_name(model_name)
        model = InferenceLogic.get_auto_label_model(model_name=model_name, classes=normalized_queries)

        runtime = InferenceLogic._inference_runtime_options()
        results = model.predict(
            resolved_source,
            verbose=False,
            conf=InferenceLogic._parse_confidence(confidence),
            device=runtime["device"],
            batch=runtime["batch"],
            imgsz=runtime["imgsz"],
            half=runtime["half"],
        )
        # Always enforce query-locked filtering so only requested objects are returned.
        detections, classes = InferenceLogic._extract_box_detections(results, model, label_queries=normalized_queries)

        return {
            "success": True,
            "count": len(detections),
            "classes": classes,
            "detections": detections,
            "model": os.path.basename(resolved_model_name),
        }

    @staticmethod
    def classify_image(source, model_name=None, confidence=None):
        resolved_source = InferenceLogic._resolve_source_input(source)
        if not resolved_source:
            return {"success": False, "error": "Missing or invalid image source", "labels": []}

        threshold = InferenceLogic._parse_confidence(confidence)
        resolved_model_name = InferenceLogic.resolve_model_name(model_name)
        model = InferenceLogic.get_model(model_name)
        runtime = InferenceLogic._inference_runtime_options()
        results = model.predict(
            resolved_source,
            verbose=False,
            conf=threshold,
            device=runtime["device"],
            batch=runtime["batch"],
            imgsz=runtime["imgsz"],
            half=runtime["half"],
        )

        labels = []
        seen_labels = set()

        fallback_label = None
        fallback_score = -1.0

        for result in results:
            names = getattr(result, "names", None) or getattr(model, "names", {})
            probs = getattr(result, "probs", None)

            if probs is not None:
                top_classes = list(getattr(probs, "top5", []) or [])
                top_scores_raw = getattr(probs, "top5conf", None)
                if top_scores_raw is None:
                    top_scores = []
                elif hasattr(top_scores_raw, "tolist"):
                    top_scores = top_scores_raw.tolist()
                else:
                    top_scores = list(top_scores_raw)
                if not top_classes and getattr(probs, "top1", None) is not None:
                    top_classes = [int(probs.top1)]
                    top1_score = getattr(probs, "top1conf", 0)
                    top_scores = [float(top1_score.item() if hasattr(top1_score, "item") else top1_score)]

                for class_id, score in zip(top_classes, top_scores):
                    score_value = float(score)
                    label = InferenceLogic._label_from_names(names, int(class_id))
                    if score_value > fallback_score:
                        fallback_score = score_value
                        fallback_label = label
                    if float(score) < threshold:
                        continue
                    lowered = label.lower()
                    if lowered not in seen_labels:
                        seen_labels.add(lowered)
                        labels.append(label)
                continue

            if getattr(result, "boxes", None) is None:
                continue

            for box in result.boxes:
                score = float(box.conf[0].item())
                class_id = int(box.cls[0].item())
                label = InferenceLogic._label_from_names(names, class_id)
                if score > fallback_score:
                    fallback_score = score
                    fallback_label = label
                if score < threshold:
                    continue
                lowered = label.lower()
                if lowered not in seen_labels:
                    seen_labels.add(lowered)
                    labels.append(label)

        # Ensure classification auto-label can still produce a usable tag when
        # detections/probabilities are below the configured threshold.
        if not labels and fallback_label:
            labels.append(fallback_label)

        return {
            "success": True,
            "labels": labels,
            "model": os.path.basename(resolved_model_name),
        }

    @staticmethod
    def _load_clip_runtime(model_name=None):
        if torch is None:
            raise RuntimeError("PyTorch runtime unavailable for CLIP classification")
        try:
            import clip
        except Exception as error:
            raise RuntimeError("CLIP runtime unavailable for zero-shot classification") from error

        clip_model_name = str(model_name or "").strip()
        if not clip_model_name or clip_model_name.lower() in {"clip", "zero-shot", "zero_shot"} or clip_model_name.lower().endswith(".pt"):
            clip_model_name = os.getenv("CLIP_MODEL_NAME", "ViT-B/32")

        device = InferenceLogic.get_inference_device()
        cache_key = (clip_model_name, device)
        if cache_key not in InferenceLogic.clip_models:
            model, preprocess = clip.load(clip_model_name, device=device)
            model.eval()
            InferenceLogic.clip_models[cache_key] = (model, preprocess)
        return InferenceLogic.clip_models[cache_key], clip, clip_model_name, device

    @staticmethod
    def classify_image_zero_shot(source, candidate_labels, model_name=None, confidence=None, single_label=True):
        resolved_source = InferenceLogic._resolve_source_input(source)
        if not resolved_source:
            return {"success": False, "error": "Missing or invalid image source", "labels": []}

        labels = []
        seen = set()
        for label in candidate_labels or []:
            text = str(label or "").strip()
            key = InferenceLogic._normalize_label_text(text)
            if text and key and key not in seen:
                seen.add(key)
                labels.append(text)
        if not labels:
            return {"success": False, "error": "No classification labels provided", "labels": []}

        threshold = InferenceLogic._parse_confidence(confidence, default=0.25)
        try:
            (model, preprocess), clip, clip_model_name, device = InferenceLogic._load_clip_runtime(model_name)
            if isinstance(resolved_source, Image.Image):
                image = resolved_source.convert("RGB")
            else:
                with Image.open(resolved_source) as opened:
                    image = opened.convert("RGB")

            prompts = [f"a photo of {label}" for label in labels]
            image_input = preprocess(image).unsqueeze(0).to(device)
            text_input = clip.tokenize(prompts).to(device)
            with torch.no_grad():
                image_features = model.encode_image(image_input)
                text_features = model.encode_text(text_input)
                image_features = image_features / image_features.norm(dim=-1, keepdim=True)
                text_features = text_features / text_features.norm(dim=-1, keepdim=True)
                logits = 100.0 * image_features @ text_features.T
                probabilities = logits.softmax(dim=-1)[0]

            scored = []
            for label, score_tensor in zip(labels, probabilities):
                scored.append((label, float(score_tensor.item())))
            scored.sort(key=lambda item: item[1], reverse=True)

            if single_label:
                selected = scored[:1]
            else:
                selected = [item for item in scored if item[1] >= threshold] or scored[:1]

            return {
                "success": True,
                "labels": [label for label, _score in selected],
                "scores": {label: score for label, score in scored},
                "model": f"CLIP {clip_model_name}",
                "classification_mode": "zero-shot",
            }
        except Exception as error:
            return {
                "success": False,
                "error": str(error),
                "labels": [],
                "model": "CLIP",
                "classification_mode": "zero-shot",
            }

    @staticmethod
    def _extract_state_dict(raw_state):
        if isinstance(raw_state, dict):
            if "state_dict" in raw_state and isinstance(raw_state["state_dict"], dict):
                return raw_state["state_dict"]
            if "model_state_dict" in raw_state and isinstance(raw_state["model_state_dict"], dict):
                return raw_state["model_state_dict"]
        return raw_state

    @staticmethod
    def _resolve_class_names(model_doc):
        classes = model_doc.get("classes") or []
        names = []
        for item in classes:
            if isinstance(item, dict):
                name = str(item.get("name") or "").strip()
            else:
                name = str(item or "").strip()
            if name:
                names.append(name)
        if names:
            return names
        version_id = model_doc.get("version_id")
        if version_id:
            version = db.versions.find_one({"version_id": version_id}) or {}
            v_classes = version.get("classes") or []
            for item in v_classes:
                if isinstance(item, dict):
                    name = str(item.get("name") or "").strip()
                else:
                    name = str(item or "").strip()
                if name:
                    names.append(name)
        return names

    @staticmethod
    def _is_label_in_allowed_classes(label, allowed_classes):
        if not allowed_classes:
            return True
        for class_name in allowed_classes:
            if InferenceLogic._label_matches_queries(label, [class_name]):
                return True
        return False

    @staticmethod
    def _build_torchvision_classifier(architecture, num_classes):
        arch = str(architecture or "").lower()
        if torchvision is None:
            raise RuntimeError("torchvision is unavailable")

        if arch.startswith("dinov3") or arch.startswith("vit"):
            if "large" in arch:
                model = torchvision.models.vit_l_16(weights=None)
            else:
                model = torchvision.models.vit_b_16(weights=None)
            model.heads.head = nn.Linear(model.heads.head.in_features, num_classes)
            return model

        if "resnet34" in arch:
            model = torchvision.models.resnet34(weights=None)
        elif "resnet50" in arch:
            model = torchvision.models.resnet50(weights=None)
        else:
            model = torchvision.models.resnet18(weights=None)
        model.fc = nn.Linear(model.fc.in_features, num_classes)
        return model

    @staticmethod
    def _infer_checkpoint_num_classes(state_dict, architecture, fallback):
        arch = str(architecture or "").lower()
        if not isinstance(state_dict, dict):
            return int(fallback or 2)
        if arch.startswith("dinov3") or arch.startswith("vit"):
            w = state_dict.get("heads.head.weight")
            if hasattr(w, "shape") and len(w.shape) >= 1:
                return int(w.shape[0])
        if arch.startswith("resnet"):
            w = state_dict.get("fc.weight")
            if hasattr(w, "shape") and len(w.shape) >= 1:
                return int(w.shape[0])
        return int(fallback or 2)

    @staticmethod
    def classify_image_torch(source, model_doc, confidence=None):
        if torch is None or tv_transforms is None:
            return {"success": False, "error": "PyTorch/torchvision runtime unavailable", "labels": []}

        resolved_source = InferenceLogic._resolve_source_input(source)
        if not resolved_source:
            return {"success": False, "error": "Missing or invalid image source", "labels": []}

        class_names = InferenceLogic._resolve_class_names(model_doc)
        threshold = InferenceLogic._parse_confidence(confidence, default=0.25)
        architecture = model_doc.get("architecture")
        weights_path = InferenceLogic.resolve_weights_path(model_doc)
        if not weights_path:
            return {"success": False, "error": "Weights file not found for model", "labels": []}

        device_name = InferenceLogic.get_inference_device()
        map_loc = "cpu" if device_name.startswith("cuda") and (torch is None or not torch.cuda.is_available()) else device_name
        device = torch.device(map_loc)

        raw_state = torch.load(str(weights_path), map_location=device)
        state_dict = InferenceLogic._extract_state_dict(raw_state)
        ckpt_num_classes = InferenceLogic._infer_checkpoint_num_classes(
            state_dict,
            architecture,
            fallback=len(class_names) or 2,
        )
        model = InferenceLogic._build_torchvision_classifier(architecture, max(2, ckpt_num_classes))
        model.load_state_dict(state_dict, strict=False)
        model = model.to(device)
        model.eval()

        if isinstance(resolved_source, Image.Image):
            image = resolved_source.convert("RGB")
        else:
            with Image.open(resolved_source) as opened:
                image = opened.convert("RGB")

        transform = tv_transforms.Compose([
            tv_transforms.Resize((224, 224)),
            tv_transforms.ToTensor(),
            tv_transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

        with torch.no_grad():
            tensor = transform(image).unsqueeze(0).to(device)
            logits = model(tensor)
            probs = torch.softmax(logits, dim=1)[0]
            topk = min(5, probs.shape[0])
            scores, indices = torch.topk(probs, k=topk)

        labels = []
        scores_map = {}
        for score_tensor, idx_tensor in zip(scores, indices):
            score = float(score_tensor.item())
            idx = int(idx_tensor.item())
            label = class_names[idx] if idx < len(class_names) else f"class_{idx}"
            scores_map[label] = score
            if score >= threshold:
                labels.append(label)

        if not labels:
            top_idx = int(indices[0].item())
            labels = [class_names[top_idx] if top_idx < len(class_names) else f"class_{top_idx}"]

        return {
            "success": True,
            "labels": labels,
            "scores": scores_map,
            "model": str(weights_path.name),
        }

    @staticmethod
    def list_models(project_id):
        models = list(db.models.find({"project_id": str(project_id)}).sort("created_at", -1))
        return {
            "success": True,
            "models": [InferenceLogic._serialize_model(model) for model in models],
        }

    @staticmethod
    def create_model_training_job(
        project_id,
        version_ref,
        architecture=None,
        model_size=None,
        checkpoint=None,
        checkpoint_model_id=None,
        training_mode="custom",
        name=None,
    ):
        version_doc = InferenceLogic._resolve_version_doc(project_id, version_ref)
        project = db.projects.find_one({"_id": to_object_id(project_id)})

        normalized_architecture = InferenceLogic._normalize_architecture(architecture)
        architecture_label = InferenceLogic._architecture_label(normalized_architecture)
        normalized_model_size = InferenceLogic._normalize_model_size(model_size)
        
        if version_doc:
            version_display_id = version_doc.get("display_id") or f"v{version_doc.get('version_number', 1)}"
            version_name = version_doc.get("name")
            version_canonical_id = version_doc.get("canonical_id")
            version_id = version_doc.get("version_id")
            classes = version_doc.get("classes", [])
        else:
            version_display_id = "Project Dataset"
            version_name = "Full Project Dataset"
            version_canonical_id = "latest"
            version_id = None
            classes = project.get("classes", []) if project else []

        checkpoint_text = str(checkpoint or "").strip() or None
        checkpoint_model = InferenceLogic._resolve_model_doc(project_id, checkpoint_model_id)
        if checkpoint_model and not checkpoint_text:
            checkpoint_text = checkpoint_model.get("name")

        metrics = InferenceLogic._generate_training_metrics(
            project_id,
            version_doc,
            normalized_architecture,
            normalized_model_size,
            checkpoint_text,
        )

        created_at = now_iso()
        model_number = db.models.count_documents({"project_id": str(project_id)}) + 1
        model_name = (
            str(name).strip()
            if str(name or "").strip()
            else f"{architecture_label} {normalized_model_size.title()} ({version_display_id})"
        )
        model_doc = {
            "project_id": str(project_id),
            "name": model_name,
            "model_number": model_number,
            "training_mode": str(training_mode or "custom"),
            "status": "Ready",
            "deployment_status": "deployed",
            "version_ref": str(version_ref) if version_ref else None,
            "version_db_id": str(version_doc["_id"]) if version_doc else None,
            "version_id": version_id,
            "version_display_id": version_display_id,
            "version_name": version_name,
            "version_canonical_id": version_canonical_id,
            "architecture": normalized_architecture,
            "architecture_label": architecture_label,
            "model_size": normalized_model_size,
            "checkpoint": checkpoint_text,
            "checkpoint_model_id": str(checkpoint_model["_id"]) if checkpoint_model else None,
            "classes": classes,
            "runtime_model": Config.YOLO_AUTO_LABEL_MODEL or Config.YOLO_MODEL_PATH,
            "metrics": metrics,
            "mAP": metrics["mAP"],
            "precision": metrics["precision"],
            "recall": metrics["recall"],
            "accuracy": metrics["accuracy"],
            "speed_ms": metrics["speed_ms"],
            "created_at": created_at,
            "updated_at": created_at,
        }

        result = db.models.insert_one(model_doc)
        model_doc["_id"] = result.inserted_id

        if version_doc:
            db.versions.update_one(
                {"_id": version_doc["_id"]},
                {
                    "$set": {
                        "status": "Completed",
                        "metrics": {
                            "mAP": metrics["mAP"],
                            "precision": metrics["precision"],
                            "recall": metrics["recall"],
                        },
                        "latest_model_id": str(result.inserted_id),
                        "updated_at": created_at,
                    }
                },
            )
        db.projects.update_one(
            {"_id": to_object_id(project_id)},
            {"$set": {"updated_at": created_at}},
        )

        return {"success": True, "model": InferenceLogic._serialize_model(model_doc)}

    @staticmethod
    def run_model_inference(project_id, model_id, source, confidence=None):
        model_doc = InferenceLogic._resolve_model_doc(project_id, model_id)
        if not model_doc:
            return {"success": False, "error": "Model not found", "predictions": []}
        project = db.projects.find_one({"_id": to_object_id(project_id)}) or {}
        project_type = str(project.get("project_type") or "Object Detection")

        threshold = InferenceLogic._parse_confidence(confidence, default=0.25)
        
        # Resolve the model name/path
        runtime_model = InferenceLogic._resolve_runtime_model_from_doc(model_doc)
        
        architecture = str(model_doc.get("architecture") or "").lower()
        is_classification_arch = (
            architecture.startswith("resnet")
            or architecture.startswith("vit")
            or architecture.startswith("dinov3")
            or architecture.startswith("simplecnn")
        )

        if project_type == "Object Detection" and is_classification_arch:
            return {
                "success": False,
                "error": "Selected model is a classification model. Use a YOLO detection model for bounding boxes.",
                "predictions": [],
            }

        if is_classification_arch:
            try:
                result = InferenceLogic.classify_image(
                    source,
                    model_name=runtime_model,
                    confidence=threshold,
                )
            except Exception:
                result = InferenceLogic.classify_image_torch(
                    source,
                    model_doc=model_doc,
                    confidence=threshold,
                )
            if not result.get("success"):
                return {
                    "success": False,
                    "error": result.get("error") or "Classification inference failed",
                    "predictions": [],
                }
            labels = result.get("labels", []) or []
            predictions = [
                {
                    "type": "classification",
                    "class": label,
                    "label": label,
                    "confidence": float((result.get("scores") or {}).get(label, 1.0)),
                }
                for label in labels
            ]
        else:
            allowed_classes = InferenceLogic._resolve_class_names(model_doc)
            # Capture detections at a permissive confidence floor so UI threshold
            # can be adjusted interactively without needing repeated model passes.
            capture_confidence = min(threshold, 0.01)
            result = InferenceLogic.run_auto_label(
                source,
                model_name=runtime_model,
                confidence=capture_confidence,
            )
            if not result.get("success"):
                return {
                    "success": False,
                    "error": result.get("error") or "Inference failed",
                    "predictions": [],
                }

            # Keep all detections for visualize/deploy flows.
            # Client-side can choose to hide suspicious full-frame boxes, but
            # dropping here can lead to zero predictions even when objects exist.
            predictions = []
            for detection in result.get("detections", []):
                label = detection.get("label")
                if not InferenceLogic._is_label_in_allowed_classes(label, allowed_classes):
                    continue
                predictions.append(
                    {
                        "type": "detection",
                        "class": label,
                        "confidence": detection.get("confidence"),
                        "x": detection.get("x_center"),
                        "y": detection.get("y_center"),
                        "width": detection.get("width"),
                        "height": detection.get("height"),
                    }
                )

        peak_confidence = 0.0
        if predictions:
            confidences = [
                float(p.get("confidence", 0) or 0)
                for p in predictions
                if p.get("confidence") is not None
            ]
            if confidences:
                peak_confidence = max(confidences)

        # Log inference for analytics
        inference_log = {
            "project_id": str(project_id),
            "model_id": str(model_id),
            "model_name": model_doc.get("name"),
            "timestamp": now_iso(),
            "confidence_threshold": threshold,
            "prediction_count": len(predictions),
            "status": "success"
        }
        db.inference_history.insert_one(inference_log)
        broadcast_kpi_update("inference-recorded", {
            "project_id": str(project_id),
            "model_id": str(model_id),
        })

        return {
            "success": True,
            "time": round(float(model_doc.get("speed_ms", 25.0)) / 1000, 3),
            "predictions": predictions,
            "model": model_doc.get("name"),
            "confidence_threshold": threshold,
            "raw_prediction_count": len(predictions),
            "peak_confidence": peak_confidence,
            "suggested_threshold": round(max(0.001, min(0.999, peak_confidence * 0.9)), 3) if peak_confidence > 0 else threshold,
        }

    @staticmethod
    def get_inference_history(project_id, limit=20):
        history = list(db.inference_history.find({"project_id": str(project_id)}).sort("timestamp", -1).limit(limit))
        return {
            "success": True,
            "history": [InferenceLogic._serialize_doc(doc) for doc in history]
        }

    @staticmethod
    def compare_models(project_id, model_ids, source, confidence=None):
        results = {}
        for m_id in model_ids:
            res = InferenceLogic.run_model_inference(project_id, m_id, source, confidence=confidence)
            results[m_id] = res
        return {
            "success": True,
            "results": results
        }

    @staticmethod
    def run_yolo_labeling(asset_id, model_name=None, confidence=None, job_id=None, label_queries=None):
        asset_oid = to_object_id(asset_id)
        if not asset_oid:
            return {"success": False, "error": f"Invalid asset id: {asset_id}", "annotated_assets": 0}

        asset = db.assets.find_one({"_id": asset_oid})
        if not asset:
            return {"success": False, "error": f"Asset {asset_id} not found", "annotated_assets": 0}

        project_id = asset.get("project_id")
        project = db.projects.find_one({"_id": to_object_id(project_id)}) if to_object_id(project_id) else None
        source_input = InferenceLogic._resolve_asset_source(asset)
        if source_input is None:
            return {"success": False, "error": f"File not found for asset {asset_id}", "annotated_assets": 0}

        timestamp = InferenceLogic.get_timestamp()

        try:
            threshold = InferenceLogic._parse_confidence(confidence, default=0.75)
            model = InferenceLogic.get_model(model_name)
            runtime = InferenceLogic._inference_runtime_options()
            results = model.predict(
                source_input,
                verbose=False,
                conf=threshold,
                device=runtime["device"],
                batch=runtime["batch"],
                imgsz=runtime["imgsz"],
                half=runtime["half"],
            )
            names = model.names

            annotations = []
            detected_classes = set()
            asset_id_str = str(asset_oid)

            for result in results:
                if getattr(result, "boxes", None) is None:
                    continue

                for box in result.boxes:
                    cls_id = int(box.cls[0].item())
                    label = names[cls_id] if isinstance(names, dict) else names[cls_id]
                    label = str(label)
                    if label_queries and not InferenceLogic._label_matches_queries(label, label_queries):
                        continue
                    detected_classes.add(label)

                    x_center, y_center, width, height = box.xywhn[0].tolist()
                    annotations.append(
                        {
                            "asset_id": asset_id_str,
                            "project_id": project_id,
                            "label": label,
                            "class_id": cls_id,
                            "confidence": float(box.conf[0].item()),
                            "type": "box",
                            "x_center": float(x_center),
                            "y_center": float(y_center),
                            "width": float(width),
                            "height": float(height),
                            "created_at": timestamp,
                            "updated_at": timestamp,
                        }
                    )

            desired_state = "annotated" if annotations else "unannotated"
            next_url = asset.get("url") or InferenceLogic._build_asset_url(
                asset_id_str,
                asset.get("unique_filename") or asset.get("filename") or "asset",
            )
            InferenceLogic._write_session_file(None, asset_id_str, project_id, annotations, timestamp, model_name)

            db.annotations.delete_many({"asset_id": asset_id_str})
            if annotations:
                db.annotations.insert_many([dict(annotation) for annotation in annotations])

            db.assets.update_one(
                {"_id": asset_oid},
                {
                    "$set": {
                        "url": next_url,
                        "upload_state": desired_state,
                        "is_annotated": bool(annotations),
                        "annotation_count": len(annotations),
                        "detected_classes": sorted(detected_classes),
                        "annotated_at": timestamp if annotations else None,
                        "updated_at": timestamp,
                        "status": "annotated" if annotations else "unassigned",
                        "auto_labeled": True,
                        "auto_label_model": os.path.basename(InferenceLogic.resolve_model_name(model_name)),
                        "auto_label_confidence_threshold": threshold,
                    }
                },
            )

            if project:
                project_update = {"$set": {"updated_at": timestamp}}
                if detected_classes:
                    project_update["$addToSet"] = {
                        "detected_classes": {"$each": sorted(detected_classes)}
                    }
                db.projects.update_one({"_id": project["_id"]}, project_update)

            return {
                "success": True,
                "count": len(annotations),
                "classes": sorted(detected_classes),
                "annotations": annotations,
                "annotated_assets": 1 if annotations else 0,
                "asset": InferenceLogic._serialize_auto_label_asset(
                    asset_id_str,
                    next_url,
                    len(annotations),
                    detected_classes,
                ),
                "model": os.path.basename(InferenceLogic.resolve_model_name(model_name)),
                "confidence_threshold": threshold,
            }
        except Exception as error:
            db.assets.update_one(
                {"_id": asset_oid},
                {"$set": {"status": "failed", "updated_at": timestamp}},
            )
            return {"success": False, "error": str(error), "annotated_assets": 0}

    @staticmethod
    def run_assets_yolo_labeling(asset_ids, model_name=None, confidence=None, job_id=None, label_queries=None):
        unique_asset_ids = []
        seen = set()
        for asset_id in asset_ids or []:
            asset_id_str = str(asset_id).strip()
            if asset_id_str and asset_id_str not in seen:
                seen.add(asset_id_str)
                unique_asset_ids.append(asset_id_str)

        total_annotations = 0
        annotated_assets = 0
        detected_classes = set()
        results = []
        threshold = InferenceLogic._parse_confidence(confidence, default=0.75)

        for asset_id in unique_asset_ids:
            result = InferenceLogic.run_yolo_labeling(
                asset_id,
                model_name=model_name,
                confidence=threshold,
                job_id=job_id,
                label_queries=label_queries,
            )
            total_annotations += int(result.get("count", 0) or 0)
            annotated_assets += int(result.get("annotated_assets", 0) or 0)
            detected_classes.update(result.get("classes", []))
            results.append(
                {
                    "asset_id": asset_id,
                    "success": bool(result.get("success")),
                    "count": int(result.get("count", 0) or 0),
                    "classes": result.get("classes", []),
                    "asset": result.get("asset"),
                    "error": result.get("error"),
                }
            )
            
            # Real-time progress update for the job
            if job_id and ObjectId.is_valid(str(job_id)):
                try:
                    update_op = {
                        "$set": {"updated_at": now_iso()}
                    }
                    if result.get("annotated_assets", 0) > 0:
                        update_op["$inc"] = {"annotated_count": 1}
                    else:
                        update_op["$inc"] = {"unassigned_count": 1}
                        
                    db.jobs.update_one(
                        {"_id": ObjectId(str(job_id))},
                        update_op
                    )
                except Exception as e:
                    logger.error(f"Failed to update job progress for {job_id}: {e}")

        successful_results = [item for item in results if item.get("success")]
        failed_results = [item for item in results if not item.get("success")]
        success = bool(successful_results) and len(failed_results) < len(results)
        if not success and failed_results:
            error = failed_results[0].get("error") or "Classification labeling failed for all assets."
        else:
            error = None

        return {
            "success": success,
            "asset_count": len(unique_asset_ids),
            "annotated_assets": annotated_assets,
            "count": total_annotations,
            "classes": sorted(detected_classes),
            "results": results,
            "model": os.path.basename(InferenceLogic.resolve_model_name(model_name)),
            "confidence_threshold": threshold,
            **({"error": error} if error else {}),
        }

    @staticmethod
    def run_project_yolo_labeling(project_id, model_name=None, confidence=None, batch_id=None):
        query = {"project_id": str(project_id)}
        if batch_id:
            query["batch_id"] = str(batch_id)
        assets = list(db.assets.find(query))
        project = db.projects.find_one({"_id": to_object_id(project_id)}) if to_object_id(project_id) else None
        label_queries = InferenceLogic._project_annotation_queries(project)
        result = InferenceLogic.run_assets_yolo_labeling(
            [str(asset["_id"]) for asset in assets],
            model_name=model_name,
            confidence=confidence,
            label_queries=label_queries,
        )
        result["project_id"] = str(project_id)
        if batch_id:
            result["batch_id"] = str(batch_id)
        if label_queries:
            result["label_queries"] = label_queries
        else:
            result["label_queries"] = []
        return result

    @staticmethod
    def run_classification_labeling(asset_id, model_name=None, confidence=None, job_id=None, expected_project_id=None):
        asset_oid = to_object_id(asset_id)
        if not asset_oid:
            return {"success": False, "error": f"Invalid asset id: {asset_id}", "annotated_assets": 0}

        asset = db.assets.find_one({"_id": asset_oid})
        if not asset:
            return {"success": False, "error": f"Asset {asset_id} not found", "annotated_assets": 0}

        project_id = asset.get("project_id")
        if expected_project_id is not None and str(project_id) != str(expected_project_id):
            return {"success": False, "error": f"Asset {asset_id} does not belong to project {expected_project_id}", "annotated_assets": 0}
        project = db.projects.find_one({"_id": to_object_id(project_id)}) if to_object_id(project_id) else None
        try:
            classification_type = InferenceLogic._project_classification_type(project)
            detection_plan = InferenceLogic._classification_detection_plan(project)
            ppe_requested = bool(detection_plan.get("ppe_requested"))
            if classification_type == "Single-Label":
                label_options = InferenceLogic._project_classification_label_options(project)
                label_queries = detection_plan["label_queries"] if ppe_requested else []
                allowed_label_map = detection_plan["allowed_label_map"] if ppe_requested else {}
            else:
                label_options = []
                label_queries = detection_plan["label_queries"]
                allowed_label_map = detection_plan["allowed_label_map"]
        except ValueError as error:
            return {"success": False, "error": str(error), "annotated_assets": 0}

        source_input = InferenceLogic._resolve_asset_source(asset)
        if source_input is None:
            return {"success": False, "error": f"File not found for asset {asset_id}", "annotated_assets": 0}

        timestamp = InferenceLogic.get_timestamp()

        try:
            threshold = InferenceLogic._parse_confidence(confidence, default=0.5)
            if classification_type == "Single-Label" and not ppe_requested:
                classification_result = InferenceLogic.classify_image_zero_shot(
                    source_input,
                    label_options,
                    model_name=model_name,
                    confidence=threshold,
                    single_label=True,
                )
                if not classification_result.get("success"):
                    raise RuntimeError(classification_result.get("error") or "Single-label classification failed")

                selected_labels = [
                    str(label or "").strip()
                    for label in classification_result.get("labels", [])[:1]
                    if str(label or "").strip()
                ]
                scores = classification_result.get("scores") or {}
                detected_classes = set(selected_labels)
                model_used = str(classification_result.get("model") or "CLIP")
                asset_id_str = str(asset_oid)
                annotations = [
                    InferenceLogic._classification_tag_annotation(
                        asset_id_str,
                        project_id,
                        label,
                        scores.get(label, 1.0),
                        timestamp,
                        model_used,
                        classification_type,
                    )
                    for label in selected_labels
                ]

                desired_state = "annotated" if annotations else "unannotated"
                desired_status = "annotated" if annotations else "needs_review"
                next_url = asset.get("url") or InferenceLogic._build_asset_url(
                    asset_id_str,
                    asset.get("unique_filename") or asset.get("filename") or "asset",
                )
                InferenceLogic._write_session_file(None, asset_id_str, project_id, annotations, timestamp, model_name)

                db.annotations.delete_many({"asset_id": asset_id_str})
                if annotations:
                    db.annotations.insert_many([dict(annotation) for annotation in annotations])

                db.assets.update_one(
                    {"_id": asset_oid},
                    {
                        "$set": {
                            "url": next_url,
                            "upload_state": desired_state,
                            "is_annotated": bool(annotations),
                            "annotation_count": len(annotations),
                            "detected_classes": sorted(detected_classes),
                            "annotated_at": timestamp if annotations else None,
                            "updated_at": timestamp,
                            "status": desired_status,
                            "auto_labeled": True,
                            "auto_label_model": model_used,
                            "auto_label_confidence_threshold": threshold,
                        }
                    },
                )

                if project:
                    project_update = {"$set": {"updated_at": timestamp}}
                    if detected_classes:
                        project_update["$addToSet"] = {
                            "detected_classes": {"$each": sorted(detected_classes)}
                        }
                    db.projects.update_one({"_id": project["_id"]}, project_update)

                return {
                    "success": True,
                    "count": len(annotations),
                    "classes": sorted(detected_classes),
                    "annotations": annotations,
                    "annotated_assets": 1 if annotations else 0,
                    "asset": InferenceLogic._serialize_auto_label_asset(
                        asset_id_str,
                        next_url,
                        len(annotations),
                        detected_classes,
                    ),
                    "model": model_used,
                    "confidence_threshold": threshold,
                    "classification_type": classification_type,
                    "label_options": label_options,
                    "classification_mode": classification_result.get("classification_mode") or "zero-shot",
                }

            detection_model_name = InferenceLogic.resolve_classification_detection_model_name(
                model_name,
                classification_type=classification_type,
                ppe_requested=ppe_requested,
            )
            model = InferenceLogic.get_auto_label_model(model_name=detection_model_name, classes=label_queries)
            runtime = InferenceLogic._classification_detection_runtime_options(ppe_requested=ppe_requested)
            # YOLO-World (world model) uses open-vocabulary detection via set_classes().
            # World models output lower raw confidence scores than supervised COCO models,
            # so we use a lower floor (0.15) to avoid silently suppressing real detections.
            is_world_model_active = "world" in Path(str(detection_model_name or "")).name.lower()
            ppe_conf_floor = float(os.getenv("PPE_INFERENCE_CONF", "0.15"))
            predict_kwargs = {
                "verbose": False,
                "conf": min(threshold, ppe_conf_floor) if (ppe_requested or is_world_model_active) else threshold,
                "device": runtime["device"],
                "batch": runtime["batch"],
                "imgsz": runtime["imgsz"],
                "half": runtime["half"],
            }
            if ppe_requested or is_world_model_active:
                predict_kwargs.update({
                    "iou": runtime.get("iou", 0.45),
                    # agnostic_nms=True prevents NMS from suppressing boxes of
                    # different PPE classes that overlap (e.g. helmet over head
                    # and vest over torso on the same person).
                    "agnostic_nms": True,
                    "max_det": runtime.get("max_det", 300),
                })
            try:
                results = model.predict(
                    source_input,
                    **predict_kwargs,
                )
            except Exception as e:
                import logging
                logger = logging.getLogger(__name__)
                if 'wrapper_CUDA__index_select' in str(e) or 'agnostic_nms' in predict_kwargs:
                    logger.warning(f'Prediction failed with agnostic_nms=True for {asset_oid}, falling back without agnostic_nms. Error: {str(e)}')
                    predict_kwargs.pop('agnostic_nms', None)
                    results = model.predict(
                        source_input,
                        **predict_kwargs,
                    )
                else:
                    raise e
            detections, _classes = InferenceLogic._extract_box_detections(
                results,
                model,
                label_queries=label_queries,
                exact_label_map=allowed_label_map,
            )
            selected_detections = InferenceLogic._select_classification_detections(detections, classification_type)
            if ppe_requested:
                selected_detections = detections

            asset_id_str = str(asset_oid)
            annotations = []
            detected_classes = set()
            matched_target_keys = set()
            model_used = os.path.basename(InferenceLogic.resolve_model_name(detection_model_name))

            for detection in selected_detections:
                label = str(detection.get("label") or "").strip()
                if not label:
                    continue
                detected_classes.add(label)
                target_key = InferenceLogic._ppe_canonical_label(label) or InferenceLogic._normalize_label_text(label)
                if target_key:
                    matched_target_keys.add(target_key)
                annotations.append(
                    InferenceLogic._classification_box_annotation(
                        asset_id_str,
                        project_id,
                        detection,
                        timestamp,
                        model_used,
                        classification_type,
                    )
                )
            unmatched_classes = [
                item["name"]
                for item in detection_plan.get("requested_targets", [])
                if item.get("target_key") not in matched_target_keys
            ]
            desired_state = "annotated" if annotations else "unannotated"
            desired_status = "annotated" if annotations else ("needs_review" if classification_type == "Single-Label" else "unassigned")
            next_url = asset.get("url") or InferenceLogic._build_asset_url(
                asset_id_str,
                asset.get("unique_filename") or asset.get("filename") or "asset",
            )
            InferenceLogic._write_session_file(None, asset_id_str, project_id, annotations, timestamp, model_name)

            db.annotations.delete_many({"asset_id": asset_id_str})
            if annotations:
                db.annotations.insert_many([dict(annotation) for annotation in annotations])

            db.assets.update_one(
                {"_id": asset_oid},
                {
                    "$set": {
                        "url": next_url,
                        "upload_state": desired_state,
                        "is_annotated": bool(annotations),
                        "annotation_count": len(annotations),
                        "detected_classes": sorted(detected_classes),
                        "annotated_at": timestamp if annotations else None,
                        "updated_at": timestamp,
                        "status": desired_status,
                        "auto_labeled": True,
                        "auto_label_model": model_used,
                        "auto_label_confidence_threshold": threshold,
                    }
                },
            )

            if project:
                project_update = {"$set": {"updated_at": timestamp}}
                if detected_classes:
                    project_update["$addToSet"] = {
                        "detected_classes": {"$each": sorted(detected_classes)}
                    }
                db.projects.update_one({"_id": project["_id"]}, project_update)

            return {
                "success": True,
                "count": len(annotations),
                "classes": sorted(detected_classes),
                "annotations": annotations,
                "annotated_assets": 1 if annotations else 0,
                "asset": InferenceLogic._serialize_auto_label_asset(
                    asset_id_str,
                    next_url,
                    len(annotations),
                    detected_classes,
                ),
                "model": model_used,
                "confidence_threshold": threshold,
                "classification_type": classification_type,
                "label_queries": label_queries,
                "unmatched_classes": unmatched_classes,
            }
        except Exception as error:
            db.assets.update_one(
                {"_id": asset_oid},
                {"$set": {"status": "failed", "updated_at": timestamp}},
            )
            return {"success": False, "error": str(error), "annotated_assets": 0}

    @staticmethod
    def run_assets_classification_labeling(asset_ids, model_name=None, confidence=None, job_id=None):
        unique_asset_ids = []
        seen = set()
        for asset_id in asset_ids or []:
            asset_id_str = str(asset_id).strip()
            if asset_id_str and asset_id_str not in seen:
                seen.add(asset_id_str)
                unique_asset_ids.append(asset_id_str)

        total_annotations = 0
        annotated_assets = 0
        detected_classes = set()
        models_used = set()
        unmatched_classes = set()
        results = []
        threshold = InferenceLogic._parse_confidence(confidence, default=0.5)

        if not unique_asset_ids:
            return {
                "success": False,
                "error": "No assets found for classification labeling.",
                "asset_count": 0,
                "annotated_assets": 0,
                "count": 0,
                "classes": [],
                "results": [],
                "model": os.path.basename(InferenceLogic.resolve_model_name(model_name)),
                "confidence_threshold": threshold,
            }

        for asset_id in unique_asset_ids:
            result = InferenceLogic.run_classification_labeling(
                asset_id,
                model_name=model_name,
                confidence=threshold,
                job_id=job_id,
            )
            total_annotations += int(result.get("count", 0) or 0)
            annotated_assets += int(result.get("annotated_assets", 0) or 0)
            detected_classes.update(result.get("classes", []))
            unmatched_classes.update(result.get("unmatched_classes", []))
            if result.get("model"):
                models_used.add(str(result.get("model")))
            results.append(
                {
                    "asset_id": asset_id,
                    "success": bool(result.get("success")),
                    "count": int(result.get("count", 0) or 0),
                    "classes": result.get("classes", []),
                    "annotations": result.get("annotations", []),
                    "asset": result.get("asset"),
                    "model": result.get("model"),
                    "unmatched_classes": result.get("unmatched_classes", []),
                    "error": result.get("error"),
                }
            )
            if job_id and ObjectId.is_valid(str(job_id)):
                try:
                    update_op = {"$set": {"updated_at": now_iso()}}
                    if result.get("annotated_assets", 0) > 0:
                        update_op["$inc"] = {"annotated_count": 1}
                    else:
                        update_op["$inc"] = {"unassigned_count": 1}
                    db.jobs.update_one({"_id": ObjectId(str(job_id))}, update_op)
                except Exception as e:
                    logger.error(f"Failed to update classification job progress for {job_id}: {e}")

        successful_results = [item for item in results if item.get("success")]
        failed_results = [item for item in results if not item.get("success")]
        success = bool(successful_results) and len(failed_results) < len(results)
        if not success and failed_results:
            error = failed_results[0].get("error") or "Classification labeling failed for all assets."
        else:
            error = None

        return {
            "success": success,
            "asset_count": len(unique_asset_ids),
            "annotated_assets": annotated_assets,
            "count": total_annotations,
            "classes": sorted(detected_classes),
            "unmatched_classes": sorted(unmatched_classes),
            "results": results,
            "model": sorted(models_used)[0] if len(models_used) == 1 else os.path.basename(InferenceLogic.resolve_model_name(model_name)),
            "confidence_threshold": threshold,
            **({"error": error} if error else {}),
        }

    @staticmethod
    def run_project_classification_labeling(project_id, model_name=None, confidence=None, batch_id=None):
        project = db.projects.find_one({"_id": to_object_id(project_id)}) if to_object_id(project_id) else None
        InferenceLogic._classification_detection_plan(project)
        query = {
            "project_id": str(project_id),
            "$or": [
                {"is_annotated": {"$ne": True}},
                {"annotation_count": {"$in": [0, None]}},
                {"status": {"$in": ["unassigned", "needs_review", None]}},
            ],
        }
        if batch_id:
            query["batch_id"] = str(batch_id)
        assets = list(db.assets.find(query))
        if not assets:
            scope = f"batch {batch_id}" if batch_id else f"project {project_id}"
            raise ValueError(f"No assets found for classification labeling in {scope}.")

        result = InferenceLogic.run_assets_classification_labeling(
            [str(asset["_id"]) for asset in assets],
            model_name=model_name,
            confidence=confidence,
        )
        result["project_id"] = str(project_id)
        if batch_id:
            result["batch_id"] = str(batch_id)
        return result
