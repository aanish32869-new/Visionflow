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


def _normalize_dataset_multiplier(value):
    allowed = {1, 2, 3, 5}
    parsed = _safe_int(value, 1)
    return parsed if parsed in allowed else 1


def _find_project(project_id):
    try:
        if ObjectId.is_valid(project_id):
            project = db.projects.find_one({"_id": ObjectId(project_id)})
            if project:
                return project
    except Exception:
        pass
    return db.projects.find_one({"_id": project_id})


def _snippet_format_alias(format_id):
    fmt = str(format_id or "yolov8").strip().lower()
    mapping = {
        "coco": "coco_json",
        "voc": "pascal_voc_xml",
        "darknet": "darknet_yolo",
        "classification": "folder_classification",
    }
    return mapping.get(fmt, fmt)


def _infer_task_type(project, version):
    project_type = str((project or {}).get("project_type") or "").strip().lower()
    if "classification" in project_type:
        return "classification"
    if "detect" in project_type or "object" in project_type:
        return "object-detection"

    options = (version or {}).get("options") or {}
    version_task = str(options.get("task") or options.get("project_type") or "").strip().lower()
    if "classification" in version_task:
        return "classification"
    return "object-detection"


def _supported_formats_for_task(task_type):
    if task_type == "classification":
        return {
            "folder_classification",
            "tensorflow_classification",
            "multi_label_classification",
        }
    return {
        "yolov5",
        "yolov8",
        "yolov11",
        "coco_json",
        "pascal_voc_xml",
        "tensorflow_tfrecord",
        "createml",
        "darknet_yolo",
        "rf_detr",
        "ssd_mobilenet",
    }


SNIPPET_TEMPLATES = {
    "python": """import time
from pathlib import Path
import requests

BASE_URL = "{BASE_URL}"
PROJECT_ID = "{PROJECT_ID}"
VERSION_ID = "{VERSION}"
EXPORT_FORMAT = "{FORMAT}"
OUT_ZIP = Path("{PROJECT}-v{VERSION}-{FORMAT}.zip")

# 1) Start version export job
start_res = requests.post(
    f"{{BASE_URL}}/api/projects/{{PROJECT_ID}}/export-dataset",
    json={{
        "source": "version",
        "version_id": VERSION_ID,
        "format": EXPORT_FORMAT
    }},
    timeout=30
)
start_res.raise_for_status()
start_data = start_res.json()
export_id = start_data["export_id"]
print(f"Export queued: {{export_id}}")

# 2) Poll job status until ready
status_url = f"{{BASE_URL}}/api/projects/{{PROJECT_ID}}/dataset/exports/{{export_id}}"
while True:
    status_res = requests.get(status_url, timeout=30)
    status_res.raise_for_status()
    status_data = status_res.json()
    status = status_data.get("status")
    progress = int(status_data.get("progress", 0))
    print(f"Status: {{status}} | Progress: {{progress}}%")

    if status == "Ready":
        download_url = status_data.get("download_url")
        break
    if status == "Failed":
        raise RuntimeError(status_data.get("error") or "Export failed")
    time.sleep(2)

# 3) Download export zip
download_res = requests.get(f"{{BASE_URL}}{{download_url}}", stream=True, timeout=120)
download_res.raise_for_status()
with open(OUT_ZIP, "wb") as f:
    for chunk in download_res.iter_content(chunk_size=1024 * 128):
        if chunk:
            f.write(chunk)

print(f"Downloaded: {{OUT_ZIP.resolve()}}")
""",
    "curl": """# 1) Start export
curl -s -X POST "{BASE_URL}/api/projects/{PROJECT_ID}/export-dataset" ^
  -H "Content-Type: application/json" ^
  -d "{\"source\":\"version\",\"version_id\":\"{VERSION}\",\"format\":\"{FORMAT}\"}"

# 2) Poll status
curl -s "{BASE_URL}/api/projects/{PROJECT_ID}/dataset/exports/<EXPORT_ID>"

# 3) Download zip
curl -L "{BASE_URL}/api/projects/{PROJECT_ID}/dataset/exports/<EXPORT_ID>/download" -o "{PROJECT}-v{VERSION}-{FORMAT}.zip"
""",
    "javascript": """import fs from "fs";
import axios from "axios";

const BASE_URL = "{BASE_URL}";
const PROJECT_ID = "{PROJECT_ID}";
const VERSION_ID = "{VERSION}";
const EXPORT_FORMAT = "{FORMAT}";

const start = await axios.post(`${BASE_URL}/api/projects/${PROJECT_ID}/export-dataset`, {
  source: "version",
  version_id: VERSION_ID,
  format: EXPORT_FORMAT
});

const exportId = start.data.export_id;
let downloadUrl = null;

while (!downloadUrl) {
  const status = await axios.get(`${BASE_URL}/api/projects/${PROJECT_ID}/dataset/exports/${exportId}`);
  if (status.data.status === "Ready") {
    downloadUrl = status.data.download_url;
    break;
  }
  if (status.data.status === "Failed") {
    throw new Error(status.data.error || "Export failed");
  }
  await new Promise((r) => setTimeout(r, 2000));
}

const out = fs.createWriteStream("{PROJECT}-v{VERSION}-{FORMAT}.zip");
const response = await axios.get(`${BASE_URL}${downloadUrl}`, { responseType: "stream" });
response.data.pipe(out);
""",
}


def _render_snippet(language, values):
    template = SNIPPET_TEMPLATES.get(language, SNIPPET_TEMPLATES["python"])
    return (
        template
        .replace("{API_KEY}", values["api_key"])
        .replace("{WORKSPACE}", values["workspace"])
        .replace("{PROJECT}", values["project"])
        .replace("{PROJECT_ID}", values["project_id"])
        .replace("{BASE_URL}", values["base_url"])
        .replace("{VERSION}", values["version"])
        .replace("{FORMAT}", values["format"])
    )


def _workspace_name(project):
    for key in ("workspace", "workspace_name", "workspace_slug"):
        value = str(project.get(key) or "").strip() if project else ""
        if value:
            return value
    return "YOUR_WORKSPACE"


def _project_slug(project):
    for key in ("slug", "project_slug", "name"):
        value = str(project.get(key) or "").strip() if project else ""
        if value:
            return _slugify(value)
    return "YOUR_PROJECT"


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
        split = data.get("split", {"train": 70, "valid": 20, "test": 10})
        split_total = int(split.get("train", 0)) + int(split.get("valid", 0)) + int(split.get("test", 0))
        if split_total != 100:
            return jsonify({"error": "Split ratios must add up to 100."}), 400

        dataset_assets_count = db.assets.count_documents({"project_id": project_id, "status": "dataset"})
        if dataset_assets_count == 0:
            return jsonify({"error": "No assets found in Dataset. Move annotated images to Dataset before creating a version."}), 400
            
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
            "split": split,
            "preprocessing": data.get("preprocessing", {}),
            "augmentations": data.get("augmentations", []),
            "max_version_size": _normalize_dataset_multiplier(data.get("max_version_size", 1)),
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


@version_bp.route("/api/projects/<project_id>/versions/<version_id>", methods=["DELETE"])
def delete_project_version(project_id, version_id):
    try:
        VersionManager.delete_version(version_id, project_id=project_id)
        return jsonify({"success": True})
    except Exception as error:
        logger.error(f"Error deleting version {version_id} for project {project_id}: {error}")
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


@version_bp.route("/api/projects/<project_id>/versions/<version_id>/code-snippet", methods=["GET"])
def get_version_code_snippet(project_id, version_id):
    try:
        requested_format = str(request.args.get("format", "yolov8")).strip().lower()
        language = str(request.args.get("language", "python")).strip().lower()
        framework = str(request.args.get("framework", "")).strip().lower()
        version = db.versions.find_one({"project_id": project_id, "version_id": version_id})
        if not version:
            return jsonify({"error": "Version not found"}), 404

        project = _find_project(project_id) or {}
        task_type = _infer_task_type(project, version)
        supported_formats = _supported_formats_for_task(task_type)
        if requested_format not in supported_formats:
            return jsonify({
                "error": f"Format '{requested_format}' is not supported for task '{task_type}'.",
                "task": task_type,
                "supported_formats": sorted(list(supported_formats)),
            }), 400

        workspace = _workspace_name(project)
        project_slug = _project_slug(project)
        sdk_format = _snippet_format_alias(requested_format)
        values = {
            "api_key": "YOUR_API_KEY",
            "workspace": workspace,
            "project": project_slug,
            "project_id": str(project_id),
            "base_url": "http://localhost:5000",
            "version": str(version_id),
            "format": sdk_format,
        }
        snippet = _render_snippet(language, values)

        install_lines = []
        if language == "python":
            install_lines.append("pip install requests")
            if framework == "ultralytics":
                install_lines.append("pip install ultralytics")
            elif framework == "tensorflow":
                install_lines.append("pip install tensorflow")

        return jsonify({
            "workspace": workspace,
            "project": project_slug,
            "version_id": version_id,
            "task": task_type,
            "language": language,
            "framework": framework or None,
            "requested_format": requested_format,
            "sdk_format": sdk_format,
            "supported_formats": sorted(list(supported_formats)),
            "install": install_lines,
            "snippet": snippet,
        })
    except Exception as error:
        logger.error(f"Error generating code snippet for version {version_id}: {error}")
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
