from flask import Blueprint, request, jsonify
from bson.objectid import ObjectId
from services.tag_service import TagService
from models.db import db, serialize_doc
from utils.logger import logger

tag_bp = Blueprint('tag_bp', __name__)

@tag_bp.route("/api/assets/<asset_id>/tags", methods=["POST"])
def add_tag(asset_id):
    data = request.json or {}
    tag = data.get("tag")
    if not tag:
        return jsonify({"error": "Tag is required"}), 400
    
    try:
        if TagService.add_tag(ObjectId(asset_id), tag):
            return jsonify({"success": True}), 200
        return jsonify({"error": "Failed to add tag"}), 500
    except Exception as e:
        logger.error(f"Error adding tag: {e}")
        return jsonify({"error": str(e)}), 500

@tag_bp.route("/api/assets/<asset_id>/tags/<tag>", methods=["DELETE"])
def remove_tag(asset_id, tag):
    try:
        if TagService.remove_tag(ObjectId(asset_id), tag):
            return jsonify({"success": True}), 200
        return jsonify({"error": "Failed to remove tag"}), 500
    except Exception as e:
        logger.error(f"Error removing tag: {e}")
        return jsonify({"error": str(e)}), 500

@tag_bp.route("/api/projects/<project_id>/tags", methods=["GET"])
def get_project_tags(project_id):
    try:
        tags = TagService.get_project_tags(project_id)
        return jsonify(tags), 200
    except Exception as e:
        logger.error(f"Error fetching tags: {e}")
        return jsonify({"error": str(e)}), 500
