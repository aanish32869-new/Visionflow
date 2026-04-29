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
        from dataset_exporter import generate_dataset_archive
        from config import Config
        
        data = request.json or {}
        asset_ids = data.get("asset_ids", [])
        export_format = data.get("format", "coco")
        
        options = {
            "state": "approved" # Ensures we only export finalized dataset images
        }
        
        if asset_ids:
            options["asset_ids"] = asset_ids
            
        archive_id, stats = generate_dataset_archive(
            db, 
            project_id, 
            export_format, 
            Config.UPLOAD_DIR, 
            Config.DATASET_DIR, 
            options
        )
        
        return jsonify({
            "success": True, 
            "download_url": f"/datasets/{archive_id}.zip",
            "stats": stats
        })
    except Exception as e:
        logger.error(f"Error exporting dataset selection: {e}")
        return jsonify({"error": str(e)}), 500
