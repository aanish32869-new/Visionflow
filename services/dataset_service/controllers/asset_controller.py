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

@asset_bp.route("/api/assets/<asset_id>/annotations", methods=["POST"])
def save_annotations(asset_id):
    data = request.json or {}
    try:
        asset = db.assets.find_one({"_id": ObjectId(asset_id)})
        project_id = asset.get("project_id") if asset else None
        annotations = data.get("annotations") or []

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

            db.assets.update_one(
                {"_id": ObjectId(asset_id)},
                {"$set": {"is_annotated": True}},
            )
            logger.info(f"Saved {len(annotations)} annotations for asset {asset_id}")
        else:
            db.assets.update_one(
                {"_id": ObjectId(asset_id)},
                {"$set": {"is_annotated": False}},
            )
        return jsonify({"success": True}), 200
    except Exception as e:
        logger.error(f"Error saving annotations for {asset_id}: {e}")
        return jsonify({"error": str(e)}), 500
