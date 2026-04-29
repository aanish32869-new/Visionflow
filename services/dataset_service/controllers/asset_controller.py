import os
import uuid
from flask import Blueprint, request, jsonify
from bson.objectid import ObjectId
from services.asset_service import AssetService
from utils.logger import logger
from models.db import db, serialize_doc
from services.asset_service import get_utc_now

asset_bp = Blueprint('asset_bp', __name__)

@asset_bp.route("/api/assets", methods=["GET"])
def get_assets():
    project_id = request.args.get('project_id')
    try:
        assets = AssetService.get_assets(project_id)
        return jsonify(assets)
    except Exception as e:
        logger.error(f"Error fetching assets: {e}")
        return jsonify({"error": "Failed to fetch assets"}), 500

@asset_bp.route("/api/assets", methods=["POST"])
def upload_asset():
    if "file" not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    try:
        project_id = request.form.get("project_id")
        batch_name = (request.form.get("batch_name") or "Imported Batch").strip()
        batch_id = (request.form.get("batch_id") or uuid.uuid4().hex).strip()
        batch_tags = [] # Simplified for now, can use parse_tags later
        
        asset = AssetService.upload_asset(file, project_id, batch_name, batch_id, batch_tags)
        return jsonify(asset), 201

    except Exception as e:
        logger.error(f"Upload failed: {e}")
        return jsonify({"error": str(e)}), 400

@asset_bp.route("/api/assets/<asset_id>", methods=["DELETE"])
def delete_asset(asset_id):
    try:
        if AssetService.delete_asset(asset_id):
             return jsonify({"success": True}), 200
        return jsonify({"error": "Asset not found"}), 404
    except Exception as e:
        logger.error(f"Error deleting asset {asset_id}: {e}")
        return jsonify({"error": str(e)}), 500

@asset_bp.route("/api/assets/<asset_id>/annotations", methods=["GET"])
def get_annotations(asset_id):
    try:
        annotations = list(db.annotations.find({"asset_id": asset_id}))
        return jsonify([serialize_doc(a) for a in annotations])
    except Exception as e:
        logger.error(f"Error fetching annotations: {e}")
        return jsonify({"error": "Failed to fetch annotations"}), 500

@asset_bp.route("/api/annotations/<asset_id>", methods=["GET"])
def get_consolidated_annotations(asset_id):
    try:
        asset = db.assets.find_one({"_id": ObjectId(asset_id)}) if ObjectId.is_valid(asset_id) else None
        if not asset:
            return jsonify({"error": "Asset not found"}), 404
        
        annotations = list(db.annotations.find({"asset_id": asset_id}))
        
        project = None
        if asset.get("project_id"):
            project = db.projects.find_one({"_id": ObjectId(asset["project_id"])})
        
        classes = []
        if project and "classes" in project:
            classes = project["classes"]
            
        return jsonify({
            "asset": serialize_doc(asset),
            "annotations": [serialize_doc(a) for a in annotations],
            "classes": classes
        })
    except Exception as e:
        logger.error(f"Error fetching consolidated annotations: {e}")
        return jsonify({"error": str(e)}), 500

@asset_bp.route("/api/assets/<asset_id>/annotations", methods=["POST"])
def save_annotations(asset_id):
    data = request.json or {}
    try:
        asset = db.assets.find_one({"_id": ObjectId(asset_id)})
        project_id = asset.get("project_id") if asset else None
        annotations = data.get("annotations") or []

        # Validate annotations
        annotations = AssetService.validate_annotations(annotations, 0, 0) # Width/Height not used in basic validation yet

        db.annotations.delete_many({"asset_id": asset_id})
        if annotations:
            for ann in annotations:
                ann["asset_id"] = asset_id
                ann["project_id"] = project_id
                ann.setdefault("created_at", get_utc_now())
            db.annotations.insert_many(annotations)

            labels = sorted({ann.get("label") for ann in annotations if ann.get("label")})
            if project_id:
                db.projects.update_one(
                    {"_id": ObjectId(project_id)},
                    {
                        "$addToSet": {"detected_classes": {"$each": labels}},
                        "$set": {"updated_at": get_utc_now()},
                    },
                )

            # State transition to 'annotated'
            AssetService.update_asset_status(asset_id, "annotating")
            
            db.assets.update_one(
                {"_id": ObjectId(asset_id)},
                {"$set": {"is_annotated": True, "annotation_count": len(annotations)}},
            )
            logger.info(f"Saved {len(annotations)} annotations for asset {asset_id}")
        else:
            db.assets.update_one(
                {"_id": ObjectId(asset_id)},
                {"$set": {"is_annotated": False, "annotation_count": 0}},
            )
        return jsonify({"success": True}), 200
    except Exception as e:
        logger.error(f"Error saving annotations for {asset_id}: {e}")
        return jsonify({"error": str(e)}), 500

@asset_bp.route("/api/batches/<batch_id>/export", methods=["GET"])
def export_batch(batch_id):
    project_id = request.args.get("project_id")
    if not project_id:
        return jsonify({"error": "project_id is required"}), 400
    
    try:
        from dataset_exporter import generate_dataset_archive
        from config import Config
        
        options = {"batch_id": batch_id}
        state = request.args.get("state")
        if state:
            options["state"] = state
            
        archive_id, stats = generate_dataset_archive(
            db, 
            project_id, 
            "coco", 
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
        logger.error(f"Error exporting batch {batch_id}: {e}")
        return jsonify({"error": str(e)}), 500

@asset_bp.route("/api/batches/<batch_id>/rename", methods=["PATCH"])
def rename_batch(batch_id):
    data = request.json or {}
    new_name = data.get("new_name")
    if not new_name:
        return jsonify({"error": "new_name is required"}), 400
    
    try:
        count = AssetService.rename_batch(batch_id, new_name)
        return jsonify({"success": True, "affected": count}), 200
    except Exception as e:
        logger.error(f"Rename failed for batch {batch_id}: {e}")
        return jsonify({"error": str(e)}), 500

@asset_bp.route("/api/batches/<batch_id>/unassign", methods=["PATCH"])
def unassign_batch(batch_id):
    try:
        count = AssetService.unassign_batch(batch_id)
        return jsonify({"success": True, "affected": count}), 200
    except Exception as e:
        logger.error(f"Unassign failed for batch {batch_id}: {e}")
        return jsonify({"error": str(e)}), 500

@asset_bp.route("/api/batches/<batch_id>", methods=["DELETE"])
def delete_batch(batch_id):
    try:
        project_id = request.args.get("project_id")
        status = request.args.get("status")
        count = AssetService.delete_batch(batch_id, project_id, status)
        return jsonify({"success": True, "deleted_count": count}), 200
    except Exception as e:
        logger.error(f"Delete failed for batch {batch_id}: {e}")
        return jsonify({"error": str(e)}), 500

@asset_bp.route("/api/batches/<batch_id>/annotations", methods=["DELETE"])
def delete_batch_annotations(batch_id):
    project_id = request.args.get("project_id")
    state_type = request.args.get("type", "annotated")
    try:
        count = AssetService.delete_batch_annotations(batch_id, state_type)
        return jsonify({"success": True, "affected": count}), 200
    except Exception as e:
        logger.error(f"Annotation delete failed for batch {batch_id}: {e}")
        return jsonify({"error": str(e)}), 500
@asset_bp.route("/api/batches/<batch_id>/move-to-annotated", methods=["PATCH"])
def move_batch_to_annotated(batch_id):
    try:
        count = AssetService.move_batch_to_annotated(batch_id)
        return jsonify({"success": True, "affected": count}), 200
    except Exception as e:
        logger.error(f"Batch move to annotated failed for batch {batch_id}: {e}")
        return jsonify({"error": str(e)}), 500
@asset_bp.route("/api/assets/<asset_id>/status", methods=["PATCH"])
def update_asset_status(asset_id):
    data = request.json or {}
    new_status = data.get("status")
    if not new_status:
        return jsonify({"error": "status is required"}), 400
    
    try:
        if AssetService.update_asset_status(asset_id, new_status):
            return jsonify({"success": True}), 200
        return jsonify({"error": "Invalid state transition or requirements not met"}), 400
    except Exception as e:
        logger.error(f"Error updating status for asset {asset_id}: {e}")
        return jsonify({"error": str(e)}), 500

@asset_bp.route("/api/batches/<batch_id>/assets", methods=["GET"])
def get_batch_assets(batch_id):
    project_id = request.args.get("project_id")
    status = request.args.get("status")
    if not project_id:
        return jsonify({"error": "project_id is required"}), 400
    
    query = {"project_id": project_id, "batch_id": batch_id}
    if status:
        query["status"] = status
        
    try:
        assets = list(db.assets.find(query))
        
        images_with_annotations = []
        for asset in assets:
            annotations = list(db.annotations.find({"asset_id": str(asset["_id"])}))
            asset_dict = serialize_doc(asset)
            asset_dict["annotations"] = [serialize_doc(a) for a in annotations]
            images_with_annotations.append(asset_dict)

        total_count = db.assets.count_documents({"project_id": project_id, "batch_id": batch_id})
        annotated_count = db.assets.count_documents({"project_id": project_id, "batch_id": batch_id, "status": "annotated"})

        return jsonify({
            "batch_id": batch_id,
            "total_images": total_count,
            "annotated_count": annotated_count,
            "images": images_with_annotations
        })
    except Exception as e:
        logger.error(f"Failed to fetch assets for batch {batch_id}: {e}")
        return jsonify({"error": "Internal server error"}), 500

@asset_bp.route("/api/batches/<batch_id>/dataset", methods=["POST"])
def move_batch_to_dataset(batch_id):
    data = request.json or {}
    project_id = data.get("project_id")
    ratios = data.get("ratios", {"train": 80, "valid": 10, "test": 10})

    if not project_id:
        return jsonify({"error": "project_id is required"}), 400

    try:
        assets = list(db.assets.find({
            "project_id": str(project_id),
            "batch_id": str(batch_id),
            "state": {"$ne": "approved"},
            "$or": [
                {"status": "annotated"},
                {"is_annotated": True}
            ]
        }))

        if not assets:
            return jsonify({"error": "No annotated images found in this batch to move to Dataset."}), 400

        import random
        random.shuffle(assets)
        
        total = len(assets)
        train_count = int(total * (ratios.get("train", 80) / 100))
        valid_count = int(total * (ratios.get("valid", 10) / 100))
        
        now = get_utc_now()

        for index, asset in enumerate(assets):
            split = "test"
            if index < train_count:
                split = "train"
            elif index < train_count + valid_count:
                split = "valid"
                
            db.assets.update_one(
                {"_id": asset["_id"]},
                {"$set": {
                    "state": "approved",
                    "status": "dataset",
                    "dataset_split": split,
                    "updated_at": now
                }}
            )

        return jsonify({
            "success": True,
            "count": total,
            "message": f"Successfully moved {total} images to Dataset.",
            "splits": {
                "train": train_count,
                "valid": valid_count,
                "test": total - train_count - valid_count
            }
        })
    except Exception as e:
        logger.error(f"Failed to move batch {batch_id} to dataset: {e}")
        return jsonify({"error": "Internal server error"}), 500

@asset_bp.route("/api/batches/<batch_id>/annotate", methods=["POST"])
def initialize_batch_annotation(batch_id):
    data = request.json or {}
    project_id = data.get("project_id")

    if not project_id:
        return jsonify({"error": "project_id is required"}), 400

    try:
        now = get_utc_now()
        db.assets.update_many(
            {"project_id": str(project_id), "batch_id": str(batch_id), "status": {"$ne": "annotated"}},
            {"$set": {"status": "in-progress", "updated_at": now}}
        )

        return jsonify({"success": True, "message": "Batch status updated to in-progress"})
    except Exception as e:
        logger.error(f"Failed to initialize annotation for batch {batch_id}: {e}")
        return jsonify({"error": "Internal server error"}), 500
