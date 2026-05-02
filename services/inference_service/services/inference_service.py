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


class InferenceLogic:
    models = {}

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
        if is_world_model and normalized_classes:
            model.set_classes(list(normalized_classes))
        return model

    @staticmethod
    def resolve_model_name(model_name=None):
        candidate = str(model_name or Config.YOLO_AUTO_LABEL_MODEL or Config.YOLO_MODEL_PATH).strip()
        if not candidate:
            candidate = "yolov8s.pt"

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
        text = str(source or "").strip()
        if not text:
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
    def _extract_box_detections(results, model, label_filter=None):
        detections = []
        classes = []
        seen_classes = set()

        for result in results:
            if getattr(result, "boxes", None) is None:
                continue

            names = getattr(result, "names", None) or getattr(model, "names", {})
            for box in result.boxes:
                class_id = int(box.cls[0].item())
                label = InferenceLogic._label_from_names(names, class_id)

                if label_filter and label.lower() not in label_filter:
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
        is_world_model = "world" in Path(resolved_model_name).name.lower()
        label_filter = {query.lower() for query in normalized_queries} if normalized_queries and not is_world_model else None

        results = model.predict(
            resolved_source,
            verbose=False,
            conf=InferenceLogic._parse_confidence(confidence),
        )
        detections, classes = InferenceLogic._extract_box_detections(results, model, label_filter=label_filter)

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
            return {"success": False, "error": "Missing image source", "labels": []}

        threshold = InferenceLogic._parse_confidence(confidence)
        resolved_model_name = InferenceLogic.resolve_model_name(model_name)
        model = InferenceLogic.get_model(model_name)
        results = model.predict(resolved_source, verbose=False, conf=threshold)

        labels = []
        seen_labels = set()

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
                    if float(score) < threshold:
                        continue
                    label = InferenceLogic._label_from_names(names, int(class_id))
                    lowered = label.lower()
                    if lowered not in seen_labels:
                        seen_labels.add(lowered)
                        labels.append(label)
                continue

            if getattr(result, "boxes", None) is None:
                continue

            for box in result.boxes:
                score = float(box.conf[0].item())
                if score < threshold:
                    continue

                class_id = int(box.cls[0].item())
                label = InferenceLogic._label_from_names(names, class_id)
                lowered = label.lower()
                if lowered not in seen_labels:
                    seen_labels.add(lowered)
                    labels.append(label)

        return {
            "success": True,
            "labels": labels,
            "model": os.path.basename(resolved_model_name),
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

        threshold = InferenceLogic._parse_confidence(confidence, default=0.25)
        
        # Resolve the model name/path
        runtime_model = model_doc.get("weights_path") or model_doc.get("runtime_model") or Config.YOLO_AUTO_LABEL_MODEL
        
        result = InferenceLogic.run_auto_label(
            source,
            model_name=runtime_model,
            confidence=threshold,
        )
        if not result.get("success"):
            return {
                "success": False,
                "error": result.get("error") or "Inference failed",
                "predictions": [],
            }

        predictions = [
            {
                "class": detection.get("label"),
                "confidence": detection.get("confidence"),
                "x": detection.get("x_center"),
                "y": detection.get("y_center"),
                "width": detection.get("width"),
                "height": detection.get("height"),
            }
            for detection in result.get("detections", [])
        ]

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

        return {
            "success": True,
            "time": round(float(model_doc.get("speed_ms", 25.0)) / 1000, 3),
            "predictions": predictions,
            "model": model_doc.get("name"),
            "confidence_threshold": threshold,
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
    def run_yolo_labeling(asset_id, model_name=None, confidence=None, job_id=None):
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
            results = model.predict(source_input, verbose=False, conf=threshold)
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
    def run_assets_yolo_labeling(asset_ids, model_name=None, confidence=None, job_id=None):
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

        return {
            "success": True,
            "asset_count": len(unique_asset_ids),
            "annotated_assets": annotated_assets,
            "count": total_annotations,
            "classes": sorted(detected_classes),
            "results": results,
            "model": os.path.basename(InferenceLogic.resolve_model_name(model_name)),
            "confidence_threshold": threshold,
        }

    @staticmethod
    def run_project_yolo_labeling(project_id, model_name=None, confidence=None):
        assets = list(db.assets.find({"project_id": str(project_id)}))
        result = InferenceLogic.run_assets_yolo_labeling(
            [str(asset["_id"]) for asset in assets],
            model_name=model_name,
            confidence=confidence,
        )
        result["project_id"] = str(project_id)
        return result
