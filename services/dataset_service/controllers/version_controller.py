from flask import Blueprint, jsonify, request
from bson.objectid import ObjectId

from config import Config
from dataset_exporter import generate_dataset_archive
from models.db import db, serialize_doc
from services.asset_service import get_utc_now
from utils.logger import logger


version_bp = Blueprint("version_bp", __name__)


def _slugify(value):
    cleaned = []
    for char in str(value or "project").lower():
        cleaned.append(char if char.isalnum() else "-")
    slug = "".join(cleaned).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "project"


def _safe_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _find_project(project_id):
    try:
        if ObjectId.is_valid(project_id):
            project = db.projects.find_one({"_id": ObjectId(project_id)})
            if project:
                return project
    except Exception:
        pass
    return db.projects.find_one({"_id": project_id})


def _annotation_status(project_id):
    assets = list(db.assets.find({"project_id": project_id}, {"_id": 1, "is_annotated": 1}))
    asset_ids = [str(asset["_id"]) for asset in assets]
    annotated_ids = {str(asset["_id"]) for asset in assets if asset.get("is_annotated")}
    if asset_ids:
        annotated_ids.update(
            str(asset_id)
            for asset_id in db.annotations.distinct("asset_id", {"asset_id": {"$in": asset_ids}})
        )
    return {
        "total_assets": len(asset_ids),
        "annotated_assets": len(annotated_ids),
        "all_annotated": bool(asset_ids) and len(annotated_ids) == len(asset_ids),
    }


def _annotation_count(project_id):
    asset_ids = [str(asset["_id"]) for asset in db.assets.find({"project_id": project_id}, {"_id": 1})]
    if not asset_ids:
        return 0
    return db.annotations.count_documents({"asset_id": {"$in": asset_ids}})


def _normalize_split_input(split):
    split = split or {}
    train = _safe_int(split.get("train", 70), 70)
    valid = _safe_int(split.get("valid", split.get("val", 20)), 20)
    test = _safe_int(split.get("test", 10), 10)
    total = max(train + valid + test, 1)
    normalized_train = round(train / total * 100)
    normalized_valid = round(valid / total * 100)
    return {
        "train": normalized_train,
        "valid": normalized_valid,
        "test": max(0, 100 - normalized_train - normalized_valid),
    }


def _normalize_resize_input(resize):
    resize = resize or {}
    return {
        "enabled": bool(resize.get("enabled")),
        "width": _safe_int(resize.get("width"), 640),
        "height": _safe_int(resize.get("height"), _safe_int(resize.get("width"), 640)),
        "mode": resize.get("mode", "stretch"),
    }


def _normalize_preprocessing_input(payload):
    payload = payload or {}
    preprocessing = payload.get("preprocessing") or {}
    resize = preprocessing.get("resize") or payload.get("resize") or {}
    return {
        "auto_orient": preprocessing.get("auto_orient", True),
        "grayscale": bool(preprocessing.get("grayscale", False)),
        "resize": _normalize_resize_input(resize),
    }


def _normalize_augmentation_input(payload):
    payload = payload or {}
    raw_augmentations = payload.get("augmentations") or []
    if isinstance(raw_augmentations, dict):
        enabled = [key for key, value in raw_augmentations.items() if value]
    else:
        enabled = [str(item).strip() for item in raw_augmentations if str(item).strip()]

    deduped = []
    seen = set()
    for item in enabled:
        lowered = item.lower()
        if lowered and lowered not in seen:
            seen.add(lowered)
            deduped.append(lowered)

    max_version_size = _safe_int(
        payload.get("max_version_size")
        or payload.get("maximum_version_size")
        or (payload.get("augmentation_config") or {}).get("max_version_size"),
        1,
    )
    return {
        "enabled": deduped,
        "max_version_size": max(1, min(max_version_size, 8)),
    }


def _normalize_tag_filter_input(payload):
    payload = payload or {}
    raw = payload.get("tag_filter") or {}

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
        "require": normalize(raw.get("require")),
        "exclude": normalize(raw.get("exclude")),
        "allow": normalize(raw.get("allow")),
    }


def _build_preprocessing_summary(preprocessing_config):
    preprocessing_config = preprocessing_config or {}
    resize = preprocessing_config.get("resize") or {}
    if resize.get("enabled"):
        resize_value = f"{resize.get('width', 640)}x{resize.get('height', resize.get('width', 640))}"
        mode = resize.get("mode", "stretch")
    else:
        resize_value = "Original"
        mode = "none"
    return {
        "resize": resize_value,
        "mode": mode,
        "auto_orient": preprocessing_config.get("auto_orient", True),
        "grayscale": preprocessing_config.get("grayscale", False),
    }


def _normalize_version(version, index=0, total=0):
    doc = serialize_doc(version)
    version_number = doc.get("version_number") or max(total - index, 1)
    version_archive_id = doc.get("version_id") or doc.get("archive_id")
    project_slug = doc.get("project_slug") or _slugify((doc.get("canonical_id") or "project").split("/")[0])
    preprocessing_config = doc.get("preprocessing_config") or _normalize_preprocessing_input(doc)
    augmentation_config = doc.get("augmentation_config") or _normalize_augmentation_input(doc)
    tag_filter = doc.get("tag_filter") or _normalize_tag_filter_input(doc)

    doc.setdefault("display_id", f"v{version_number}")
    doc.setdefault("name", f"Version {version_number}")
    doc.setdefault("created_at", get_utc_now())
    doc.setdefault("project_slug", project_slug)
    doc.setdefault("canonical_id", f"{project_slug}/{version_number}")
    doc.setdefault("source_images_count", doc.get("images_count", 0))
    doc.setdefault("images_count", doc.get("source_images_count", 0))
    doc.setdefault(
        "generated_images_count",
        max(
            int(doc.get("images_count", 0) or 0) - int(doc.get("source_images_count", 0) or 0),
            0,
        ),
    )
    doc.setdefault("annotations_count", doc.get("annotation_count", 0))
    doc.setdefault("status", "Ready")
    doc.setdefault("export_format", "yolov8")
    doc.setdefault("download_url", f"/datasets/{version_archive_id}.zip" if version_archive_id else None)
    doc.setdefault("split", {"train": 70, "valid": 20, "test": 10})
    doc.setdefault("split_counts", {"train": doc.get("images_count", 0), "valid": 0, "test": 0})
    doc["preprocessing_config"] = preprocessing_config
    doc["preprocessing"] = doc.get("preprocessing") or _build_preprocessing_summary(preprocessing_config)
    doc["augmentation_config"] = augmentation_config
    doc["augmentations"] = doc.get("augmentations") or augmentation_config.get("enabled", [])
    doc.setdefault("max_version_size", augmentation_config.get("max_version_size", 1))
    doc["tag_filter"] = tag_filter
    doc.setdefault("metrics", {"mAP": None, "precision": None, "recall": None})
    return doc


def _touch_project(project_id, updated_at):
    try:
        result = db.projects.update_one({"_id": ObjectId(project_id)}, {"$set": {"updated_at": updated_at}})
        if result.matched_count:
            return
    except Exception:
        pass
    db.projects.update_one({"_id": project_id}, {"$set": {"updated_at": updated_at}})


@version_bp.route("/api/projects/<project_id>/annotation-status", methods=["GET"])
def get_annotation_status(project_id):
    try:
        return jsonify(_annotation_status(project_id))
    except Exception as error:
        logger.error(f"Error fetching annotation status for {project_id}: {error}")
        return jsonify({"error": "Failed to fetch annotation status"}), 500


@version_bp.route("/api/projects/<project_id>/versions", methods=["GET"])
def get_versions(project_id):
    try:
        versions = list(db.versions.find({"project_id": project_id}).sort("created_at", -1))
        total = len(versions)
        return jsonify([_normalize_version(version, index, total) for index, version in enumerate(versions)])
    except Exception as error:
        logger.error(f"Error fetching versions for {project_id}: {error}")
        return jsonify({"error": "Failed to fetch dataset versions"}), 500


@version_bp.route("/api/projects/<project_id>/versions", methods=["POST"])
def create_version(project_id):
    data = request.json or {}
    try:
        readiness = _annotation_status(project_id)
        if readiness["total_assets"] == 0:
            return jsonify({"error": "Add images before creating a dataset version."}), 400
        if not readiness["all_annotated"]:
            return jsonify({"error": "All images must be annotated before creating a dataset version."}), 400

        project = _find_project(project_id)
        project_slug = _slugify((project or {}).get("name") or "project")
        version_number = db.versions.count_documents({"project_id": project_id}) + 1
        export_format = data.get("export_format", "yolov8")
        split = _normalize_split_input(data.get("split"))
        preprocessing_config = _normalize_preprocessing_input(data)
        augmentation_config = _normalize_augmentation_input(data)
        tag_filter = _normalize_tag_filter_input(data)

        version_archive_id, archive_stats = generate_dataset_archive(
            db,
            project_id,
            export_format,
            Config.UPLOAD_DIR,
            Config.DATASET_DIR,
            {
                "split": split,
                "preprocessing": preprocessing_config,
                "augmentations": augmentation_config["enabled"],
                "max_version_size": augmentation_config["max_version_size"],
                "tag_filter": tag_filter,
            },
        )

        if not archive_stats.get("exported_images_count"):
            return jsonify({"error": "No exportable project assets matched the selected version filters."}), 400

        created_at = get_utc_now()
        canonical_id = f"{project_slug}/{version_number}"
        new_version = {
            "project_id": project_id,
            "project_slug": project_slug,
            "version_id": version_archive_id,
            "version_number": version_number,
            "display_id": f"v{version_number}",
            "canonical_id": canonical_id,
            "name": data.get("name") or f"Version {version_number}",
            "created_at": created_at,
            "images_count": archive_stats.get("exported_images_count", 0),
            "source_images_count": archive_stats.get("source_images_count", 0),
            "generated_images_count": archive_stats.get("augmentation_copies", 0),
            "annotations_count": archive_stats.get("annotations_count", _annotation_count(project_id)),
            "classes": archive_stats.get("classes", []),
            "split": archive_stats.get("split_percentages", split),
            "split_counts": archive_stats.get("split_counts", {}),
            "preprocessing": _build_preprocessing_summary(preprocessing_config),
            "preprocessing_config": preprocessing_config,
            "augmentations": augmentation_config["enabled"],
            "augmentation_config": augmentation_config,
            "max_version_size": augmentation_config["max_version_size"],
            "tag_filter": archive_stats.get("tag_filter", tag_filter),
            "export_format": export_format,
            "status": "Ready",
            "download_url": f"/datasets/{version_archive_id}.zip",
            "metrics": {"mAP": None, "precision": None, "recall": None},
        }
        result = db.versions.insert_one(new_version)
        new_version["_id"] = result.inserted_id
        _touch_project(project_id, created_at)
        return jsonify(_normalize_version(new_version, 0, version_number)), 201
    except Exception as error:
        logger.error(f"Error creating version for {project_id}: {error}")
        return jsonify({"error": str(error)}), 500
