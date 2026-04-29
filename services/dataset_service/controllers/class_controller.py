from flask import Blueprint, request, jsonify
from services.class_service import ClassService
from utils.logger import logger

class_bp = Blueprint('class_bp', __name__)

@class_bp.route("/api/projects/<project_id>/classes/merge", methods=["POST"])
def merge_classes(project_id):
    data = request.json or {}
    source_classes = data.get("source_classes")
    target_class = data.get("target_class")
    
    if not source_classes or not target_class:
        return jsonify({"error": "source_classes and target_class are required"}), 400
    
    try:
        count = ClassService.merge_classes(project_id, source_classes, target_class)
        return jsonify({"success": True, "affected_annotations": count}), 200
    except Exception as e:
        logger.error(f"Error merging classes: {e}")
        return jsonify({"error": str(e)}), 500

@class_bp.route("/api/projects/<project_id>/classes/<class_name>", methods=["DELETE"])
def delete_class(project_id, class_name):
    try:
        count = ClassService.delete_class(project_id, class_name)
        return jsonify({"success": True, "removed_annotations": count}), 200
    except Exception as e:
        logger.error(f"Error deleting class: {e}")
        return jsonify({"error": str(e)}), 500

@class_bp.route("/api/projects/<project_id>/ontology/lock", methods=["PATCH"])
def lock_ontology(project_id):
    data = request.json or {}
    locked = data.get("locked", True)
    try:
        ClassService.lock_ontology(project_id, locked)
        return jsonify({"success": True, "locked": locked}), 200
    except Exception as e:
        logger.error(f"Error locking ontology: {e}")
        return jsonify({"error": str(e)}), 500
