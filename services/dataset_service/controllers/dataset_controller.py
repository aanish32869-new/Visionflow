import os
import math
from flask import Blueprint, request, jsonify
from bson.objectid import ObjectId

from models.db import db, serialize_doc
from services.analytics_service import AnalyticsService
from utils.logger import logger

import random
from datetime import datetime
from pymongo import UpdateOne

dataset_bp = Blueprint('dataset_bp', __name__)

@dataset_bp.route("/api/projects/<project_id>/dataset/rebalance", methods=["POST"])
def rebalance_dataset(project_id):
    try:
        data = request.json
        train_ratio = data.get("train", 0.7)
        valid_ratio = data.get("valid", 0.2)
        test_ratio = data.get("test", 0.1)
        confirm = data.get("confirm", False)
        
        if not confirm:
            return jsonify({"error": "Confirmation required"}), 400
            
        if abs((train_ratio + valid_ratio + test_ratio) - 1.0) > 0.01:
            return jsonify({"error": "Ratios must sum to 100%"}), 400
            
        # 1. Fetch all assets
        assets = list(db.assets.find({"project_id": project_id}))
        if not assets:
            return jsonify({"error": "No images found in dataset"}), 404
            
        # 2. Group assets by their primary class (for balance)
        # If an image has multiple classes, we use the first one found.
        class_groups = {}
        unlabeled_assets = []
        
        for asset in assets:
            # Check for annotations
            annotations = asset.get("annotations", [])
            if annotations:
                primary_class = annotations[0].get("label") or "unlabeled"
                if primary_class not in class_groups:
                    class_groups[primary_class] = []
                class_groups[primary_class].append(asset)
            else:
                unlabeled_assets.append(asset)
                
        # 3. Redistribute each group
        asset_updates = []
        
        def redistribute(group_assets, t_rat, v_rat):
            random.shuffle(group_assets)
            g_total = len(group_assets)
            g_train_end = int(g_total * t_rat)
            g_valid_end = g_train_end + int(g_total * v_rat)
            
            for idx, g_asset in enumerate(group_assets):
                s = "train" if idx < g_train_end else ("valid" if idx < g_valid_end else "test")
                    
                asset_updates.append(
                    UpdateOne(
                        {"_id": g_asset["_id"]},
                        {"$set": {
                            "state": s,
                            "split": s,
                            "dataset_split": s,
                            "updated_at": datetime.utcnow().isoformat() + "Z"
                        }}
                    )
                )
            return g_train_end, (g_valid_end - g_train_end), (g_total - g_valid_end)

        final_counts = {"train": 0, "valid": 0, "test": 0}
        
        # Process labeled groups
        for c_name, c_assets in class_groups.items():
            tr, va, te = redistribute(c_assets, train_ratio, valid_ratio)
            final_counts["train"] += tr
            final_counts["valid"] += va
            final_counts["test"] += te
            
        # Process unlabeled assets
        if unlabeled_assets:
            tr, va, te = redistribute(unlabeled_assets, train_ratio, valid_ratio)
            final_counts["train"] += tr
            final_counts["valid"] += va
            final_counts["test"] += te
            
        # Perform Bulk Update for Assets
        if asset_updates:
            db.assets.bulk_write(asset_updates)
            
        # 4. Update Project Configuration (Default Split)
        db.projects.update_one(
            {"_id": ObjectId(project_id)} if ObjectId.is_valid(project_id) else {"id": project_id},
            {"$set": {
                "default_split": {
                    "train": train_ratio,
                    "valid": valid_ratio,
                    "test": test_ratio
                }
            }}
        )

        # 5. Update All Existing Versions
        version_asset_updates = []
        versions = list(db.versions.find({"project_id": project_id}))
        for version in versions:
            v_id = version.get("version_id")
            v_assets = list(db.version_assets.find({"version_id": v_id}))
            random.shuffle(v_assets)
            
            v_total = len(v_assets)
            v_train_end = int(v_total * train_ratio)
            v_valid_end = v_train_end + int(v_total * valid_ratio)
            
            v_v_counts = {"train": 0, "valid": 0, "test": 0}
            for idx, v_asset in enumerate(v_assets):
                v_split = "train" if idx < v_train_end else ("valid" if idx < v_valid_end else "test")
                v_v_counts[v_split] += 1
                version_asset_updates.append(
                    UpdateOne(
                        {"_id": v_asset["_id"]},
                        {"$set": {
                            "state": v_split,
                            "split": v_split,
                            "dataset_split": v_split
                        }}
                    )
                )
            
            # Update version metadata counts
            db.versions.update_one(
                {"version_id": v_id},
                {"$set": {"split_counts": v_v_counts}}
            )

        # Perform Bulk Update for Version Assets
        if version_asset_updates:
            db.version_assets.bulk_write(version_asset_updates)

        return jsonify({
            "success": True,
            "message": f"Successfully rebalanced {len(assets)} images across live dataset and {len(versions)} versions.",
            "counts": final_counts
        })
        
    except Exception as e:
        logger.error(f"Error rebalancing dataset: {e}")
        return jsonify({"error": str(e)}), 500

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
            
        from flask import send_file
        response = send_file(
            filepath,
            mimetype='application/zip',
            as_attachment=True,
            download_name=f"visionflow_v{export.get('options', {}).get('version_id', 'export')}.zip"
        )
        # Explicitly set the Content-Disposition header to be sure
        response.headers["Content-Disposition"] = f"attachment; filename=visionflow_v{export.get('options', {}).get('version_id', 'export')}.zip"
        return response
    except Exception as e:
        logger.error(f"Error downloading export: {e}")
        return jsonify({"error": str(e)}), 500
