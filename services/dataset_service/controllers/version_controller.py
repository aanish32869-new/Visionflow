import threading
import uuid
import base64
from io import BytesIO
from flask import Blueprint, jsonify, request, send_from_directory
from bson.objectid import ObjectId

from config import Config
from models.db import db, serialize_doc
from services.asset_service import get_utc_now
from services.version_manager import VersionManager
from utils.logger import logger


version_bp = Blueprint("version_bp", __name__)


@version_bp.route("/api/projects/<project_id>/annotation-status", methods=["GET"])
def get_annotation_status(project_id):
    """Check how many assets in 'dataset' state are annotated, used by the Versions tab."""
    try:
        # Count assets that are in the dataset state (these are the ones versions care about)
        dataset_assets = list(db.assets.find(
            {"project_id": project_id, "status": "dataset"},
            {"_id": 1, "is_annotated": 1, "annotation_count": 1}
        ))

        total = len(dataset_assets)
        annotated = sum(1 for a in dataset_assets if a.get("is_annotated") or (a.get("annotation_count", 0) > 0))

        # Also check via annotations collection for any missing flags
        if total > 0 and annotated < total:
            asset_ids = [str(a["_id"]) for a in dataset_assets if not a.get("is_annotated")]
            annotated_via_db = db.annotations.distinct("asset_id", {"asset_id": {"$in": asset_ids}})
            annotated += len(set(annotated_via_db))
            annotated = min(annotated, total)

        return jsonify({
            "total_assets": total,
            "annotated_assets": annotated,
            "unannotated_assets": total - annotated,
            "all_annotated": total > 0 and annotated >= total,
            "has_dataset_assets": total > 0,
        })
    except Exception as error:
        logger.error(f"Error fetching annotation status for {project_id}: {error}")
        return jsonify({"error": str(error)}), 500



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


def _normalize_version(version, index=0, total=0):
    doc = serialize_doc(version)
    version_number = doc.get("version_number") or max(total - index, 1)
    
    # Ensure UI-friendly fields
    doc.setdefault("display_id", f"v{version_number}")
    doc.setdefault("name", f"Version {version_number}")
    doc.setdefault("status", "Ready")
    doc.setdefault("created_at", get_utc_now())
    doc.setdefault("metrics", {"mAP": None, "precision": None, "recall": None})
    
    # Analytics data
    if "analytics" in doc:
        doc["heatmap"] = doc["analytics"].get("heatmap")
        doc["class_distribution"] = doc["analytics"].get("class_distribution")
    
    # Download URL
    if doc.get("archive_id"):
        project_id = doc.get("project_id")
        version_id = doc.get("version_id")
        doc["download_url"] = f"/api/projects/{project_id}/versions/{version_id}/download"
    
    return doc


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
            
        project = _find_project(project_id)
        
        # Optional: Validate Class balance before versioning
        if data.get("validate_health", False):
            from services.analytics_service import AnalyticsService
            health = AnalyticsService.get_health_score(project_id)
            if health["score"] < 30: # Arbitrary threshold for "bad" dataset
                return jsonify({
                    "error": "Dataset health is too low for versioning.",
                    "health": health
                }), 400

        project_slug = _slugify((project or {}).get("name") or "project")
        version_number = db.versions.count_documents({"project_id": project_id}) + 1
        version_id = uuid.uuid4().hex
        
        # Build options for management
        options = {
            "name": data.get("name") or f"Version {version_number}",
            "split": data.get("split", {"train": 70, "valid": 20, "test": 10}),
            "preprocessing": data.get("preprocessing", {}),
            "augmentations": data.get("augmentations", []),
            "tag_filter": data.get("tag_filter", {}),
            "class_remap": data.get("class_remap", {}),
            "export_format": data.get("export_format", "yolov8")
        }

        # Initial Document
        new_version = {
            "project_id": project_id,
            "project_slug": project_slug,
            "version_id": version_id,
            "version_number": version_number,
            "display_id": f"v{version_number}",
            "canonical_id": f"{project_slug}/{version_number}",
            "name": options["name"],
            "created_at": get_utc_now(),
            "status": "Queued",
            "options": options,
            "images_count": 0,
            "annotations_count": 0,
            "metrics": {"mAP": None, "precision": None, "recall": None}
        }
        
        db.versions.insert_one(new_version)
        
        # Start background job
        VersionManager.start_generation(project_id, version_id, options)
        
        return jsonify(_normalize_version(new_version)), 202
    except Exception as error:
        logger.error(f"Error initiating version for {project_id}: {error}")
        return jsonify({"error": str(error)}), 500


@version_bp.route("/api/versions/<version_id>/export", methods=["POST"])
def export_version(version_id):
    data = request.json or {}
    export_format = data.get("format", "yolov8")
    try:
        version = db.versions.find_one({"version_id": version_id})
        if not version:
            return jsonify({"error": "Version not found"}), 404
            
        from services.dataset_exporter import generate_dataset_archive
        archive_id, stats = generate_dataset_archive(
            db, 
            version["project_id"], 
            export_format, 
            Config.UPLOAD_DIR, 
            Config.DATASET_DIR,
            {**version.get("options", {}), "version_id": version_id, "export_format": export_format}
        )
        
        download_url = f"/datasets/{archive_id}.zip"
        db.versions.update_one({"version_id": version_id}, {"$set": {"download_url": download_url}})
        
        return jsonify({"download_url": download_url, "stats": stats})
    except Exception as error:
        logger.error(f"Error exporting version {version_id}: {error}")
        return jsonify({"error": str(error)}), 500


@version_bp.route("/api/versions/<version_id>/rebalance", methods=["POST"])
def rebalance_version(version_id):
    data = request.json or {}
    new_split = data.get("split")
    if not new_split:
        return jsonify({"error": "Split ratios required"}), 400
        
    try:
        success = VersionManager.rebalance_split(version_id, new_split)
        if success:
            return jsonify({"success": True})
        return jsonify({"error": "Failed to rebalance version"}), 500
    except Exception as error:
        logger.error(f"Error rebalancing version {version_id}: {error}")
        return jsonify({"error": str(error)}), 500


@version_bp.route("/api/versions/<version_id>", methods=["GET"])
def get_version_details(version_id):
    try:
        version = db.versions.find_one({"version_id": version_id})
        if not version:
            return jsonify({"error": "Version not found"}), 404
        return jsonify(_normalize_version(version))
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@version_bp.route("/api/versions/<version_id>/analytics", methods=["GET"])
def get_version_analytics(version_id):
    try:
        version = db.versions.find_one({"version_id": version_id}, {"analytics": 1, "split_counts": 1})
        if not version:
            return jsonify({"error": "Version not found"}), 404
        return jsonify(version.get("analytics" or {}))
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@version_bp.route("/api/versions/<version_id>", methods=["DELETE"])
def delete_version(version_id):
    try:
        VersionManager.delete_version(version_id)
        return jsonify({"success": True})
    except Exception as error:
        return jsonify({"error": str(error)}), 500

@version_bp.route("/api/projects/<project_id>/versions/<version_id>/download", methods=["GET"])
def download_version(project_id, version_id):
    try:
        version = db.versions.find_one({"version_id": version_id})
        if not version:
            return jsonify({"error": "Version not found"}), 404
            
        if version["status"] != "Ready":
            return jsonify({"error": f"Version is not ready (status: {version['status']})"}), 400
            
        archive_id = version.get("archive_id")
        if not archive_id:
            return jsonify({"error": "Archive file not found"}), 404
            
        return send_from_directory(Config.DATASET_DIR, f"{archive_id}.zip", as_attachment=True, download_name=f"{version.get('project_slug', 'dataset')}_v{version.get('version_number', 0)}.zip")
    except Exception as error:
        logger.error(f"Error downloading version {version_id}: {error}")
        return jsonify({"error": str(error)}), 500

@version_bp.route("/api/projects/<project_id>/augment/preview", methods=["POST"])
def preview_augmentation(project_id):
    data = request.json or {}
    asset_id = data.get("asset_id")
    augmentations = data.get("augmentations", [])
    preprocessing = data.get("preprocessing", {})
    
    from config import Config
    from dataset_exporter import _load_asset_image, _apply_resize, _apply_augmentation, _normalize_preprocessing
    from PIL import ImageOps
    
    if not asset_id:
        asset = db.assets.find_one({"project_id": project_id, "status": "dataset"})
        if not asset:
            return jsonify({"error": "No assets found in dataset"}), 404
    else:
        from bson.objectid import ObjectId
        asset = db.assets.find_one({"_id": ObjectId(asset_id)})
        
    if not asset:
        return jsonify({"error": "Asset not found"}), 404

    img = _load_asset_image(db, asset, Config.UPLOAD_DIR)
    if not img:
        return jsonify({"error": "Could not load image"}), 404

    # Apply Preprocessing
    prep_opts = _normalize_preprocessing({"preprocessing": preprocessing})
    if prep_opts.get("auto_orient", True):
        img = ImageOps.exif_transpose(img)
    if prep_opts.get("grayscale"):
        img = img.convert("L")
    if prep_opts.get("resize", {}).get("enabled"):
        img = _apply_resize(img, prep_opts["resize"])

    previews = []
    
    # Pre-calculated preview for original
    def to_b64(pil_img):
        buffered = BytesIO()
        pil_img.save(buffered, format="JPEG")
        return f"data:image/jpeg;base64,{base64.b64encode(buffered.getvalue()).decode()}"

    previews.append({
        "type": "original",
        "image": to_b64(img)
    })

    # Apply each augmentation
    for aug in augmentations:
        try:
            # We want to show what this specific augmentation does to the PREPROCESSED original
            aug_img = _apply_augmentation(img.copy(), aug)
            previews.append({
                "type": aug,
                "image": to_b64(aug_img)
            })
        except Exception as e:
            logger.error(f"Failed to preview {aug}: {e}")

    return jsonify({"previews": previews})
