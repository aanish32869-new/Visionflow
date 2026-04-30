import os
import math
from flask import Blueprint, request, jsonify
from bson.objectid import ObjectId

from models.db import db, serialize_doc
from services.analytics_service import AnalyticsService
from utils.logger import logger

dataset_bp = Blueprint('dataset_bp', __name__)

@dataset_bp.route("/api/projects/<project_id>/dataset/summary", methods=["GET"])
def get_dataset_summary(project_id):
    try:
        # We only consider assets in the 'dataset' state for the dataset tab
        base_query = {"project_id": project_id, "status": "dataset"}
        
        total_images = db.assets.count_documents(base_query)
        annotated_images = db.assets.count_documents({**base_query, "is_annotated": True})
        unannotated_images = total_images - annotated_images
        
        train_split = db.assets.count_documents({**base_query, "dataset_split": "train"})
        valid_split = db.assets.count_documents({**base_query, "dataset_split": "valid"})
        test_split = db.assets.count_documents({**base_query, "dataset_split": "test"})
        
        # Num classes
        project = db.projects.find_one({"_id": ObjectId(project_id)}) if ObjectId.is_valid(project_id) else None
        num_classes = len(project.get("classes", [])) if project else 0
        
        health = AnalyticsService.get_health_score(project_id)

        return jsonify({
            "total_images": total_images,
            "annotated_images": annotated_images,
            "unannotated_images": unannotated_images,
            "num_classes": num_classes,
            "splits": {
                "train": train_split,
                "valid": valid_split,
                "test": test_split
            },
            "health": health
        })
    except Exception as e:
        logger.error(f"Error fetching dataset summary: {e}")
        return jsonify({"error": str(e)}), 500

@dataset_bp.route("/api/projects/<project_id>/dataset/classes", methods=["GET"])
def get_dataset_classes(project_id):
    try:
        dist = AnalyticsService.get_class_distribution(project_id)
        
        # Calculate percentages
        total = sum(dist.values())
        result = []
        for class_name, count in dist.items():
            result.append({
                "name": class_name,
                "count": count,
                "percentage": round((count / total) * 100, 2) if total > 0 else 0
            })
            
        # Sort by count descending
        result.sort(key=lambda x: x["count"], reverse=True)
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error fetching dataset classes: {e}")
        return jsonify({"error": str(e)}), 500

@dataset_bp.route("/api/projects/<project_id>/dataset/images", methods=["GET"])
def get_dataset_images(project_id):
    try:
        page = int(request.args.get("page", 1))
        limit = int(request.args.get("limit", 24))
        split = request.args.get("split") # 'train', 'valid', 'test', 'all'
        status = request.args.get("status") # 'annotated', 'unannotated', 'all'
        sort_by = request.args.get("sort_by", "newest")
        
        search = request.args.get("search", "").strip()
        filename = request.args.get("filename", "").strip()
        classes = request.args.get("classes", "").strip()
        tags = request.args.get("tags", "").strip()
        
        query = {"project_id": project_id, "status": "dataset"}
        
        if split and split != "all":
            query["dataset_split"] = split
            
        if status == "annotated":
            query["is_annotated"] = True
        elif status == "unannotated":
            query["is_annotated"] = False
            
        if filename:
            query["filename"] = {"$regex": filename, "$options": "i"}
            
        if search:
            # Search across filename or tags
            query["$or"] = [
                {"filename": {"$regex": search, "$options": "i"}},
                {"tags": {"$in": [search.lower()]}}
            ]
            
        if classes:
            class_list = [c.strip() for c in classes.split(",") if c.strip()]
            if class_list:
                # Assuming classes are checked via annotations or a cached list on the asset.
                # Since we don't have asset.classes currently, we might need a distinct check or use a cached field.
                # Let's filter by checking if any annotation matches. This is expensive but correct for now.
                # Or if the system adds detected_classes to assets, use that. Let's use tags or assuming `detected_classes` exists.
                # For this implementation, let's look for `detected_classes` or fallback.
                query["detected_classes"] = {"$in": class_list}

        if tags:
            tag_list = [t.strip().lower() for t in tags.split(",") if t.strip()]
            if tag_list:
                query["tags"] = {"$in": tag_list}
            
        # Sorting
        sort_config = [("updated_at", -1)]
        if sort_by == "oldest":
            sort_config = [("updated_at", 1)]
        elif sort_by == "filename":
            sort_config = [("filename", 1)]
            
        total_items = db.assets.count_documents(query)
        total_pages = math.ceil(total_items / limit) if limit > 0 else 1
        
        skip = (page - 1) * limit
        assets = list(db.assets.find(query).sort(sort_config).skip(skip).limit(limit))
        
        return jsonify({
            "items": [serialize_doc(a) for a in assets],
            "total_items": total_items,
            "total_pages": total_pages,
            "current_page": page
        })
    except Exception as e:
        logger.error(f"Error fetching dataset images: {e}")
        return jsonify({"error": str(e)}), 500

@dataset_bp.route("/api/projects/<project_id>/dataset/export", methods=["POST"])
def export_dataset_selection(project_id):
    try:
        from dataset_exporter import validate_format_support
        from services.export_manager import ExportManager
        
        data = request.json or {}
        asset_ids = data.get("asset_ids", [])
        export_format = data.get("format", "coco")
        
        # Validation
        is_supported, error_msg = validate_format_support(db, project_id, export_format, asset_ids)
        if not is_supported:
            return jsonify({"error": error_msg}), 400

        options = {
            "state": "approved",
            "asset_ids": asset_ids,
            "version_id": data.get("version_id"),
            "tag_filter": data.get("tag_filter", {}),
            "split": data.get("split")
        }
        
        export_id = ExportManager.enqueue_export(project_id, export_format, options)
        
        return jsonify({
            "success": True, 
            "export_id": export_id,
            "status": "Queued"
        })
    except Exception as e:
        logger.error(f"Error initiating dataset export: {e}")
        return jsonify({"error": str(e)}), 500

@dataset_bp.route("/api/projects/<project_id>/dataset/exports/<export_id>", methods=["GET"])
def get_export_status(project_id, export_id):
    try:
        export = db.exports.find_one({"export_id": export_id})
        if not export:
            return jsonify({"error": "Export not found"}), 404
            
        return jsonify(serialize_doc(export))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@dataset_bp.route("/api/projects/<project_id>/dataset/exports/<export_id>/download", methods=["GET"])
def download_export(project_id, export_id):
    logger.info(f"Download export requested: {export_id} for project {project_id}")
    try:
        from flask import send_from_directory
        from config import Config
        from datetime import datetime
        
        logger.info(f"Searching for export_id: {export_id} in DB...")
        export = db.exports.find_one({"export_id": export_id})
        if not export:
            logger.error(f"Export {export_id} not found in database!")
            return jsonify({"error": "Export not found"}), 404
        
        logger.info(f"Export found. Status: {export.get('status')}")
        if export["status"] != "Ready":
            return jsonify({"error": f"Export is not ready (status: {export['status']})"}), 400
            
        now = datetime.utcnow().isoformat() + "Z"
        if export.get("expires_at") and export["expires_at"] < now:
            return jsonify({"error": "Export has expired"}), 410
            
        archive_id = export.get("archive_id")
        filepath = os.path.join(Config.DATASET_DIR, f"{archive_id}.zip")
        logger.info(f"Target file: {filepath} (Exists: {os.path.exists(filepath)})")
        
        if not os.path.exists(filepath):
            logger.error(f"ZIP file missing on disk: {filepath}")
            return jsonify({"error": "Export file missing on disk"}), 404
            
        return send_from_directory(Config.DATASET_DIR, f"{archive_id}.zip", as_attachment=True, download_name=f"visionflow_export_{export_id[:8]}.zip")
    except Exception as e:
        logger.error(f"Error downloading export: {e}")
        return jsonify({"error": str(e)}), 500
