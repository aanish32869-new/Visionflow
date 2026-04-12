from flask import Blueprint, request, jsonify
from services.project_service import ProjectService
from utils.logger import logger

project_bp = Blueprint('project_bp', __name__)

@project_bp.route("/api/projects", methods=["GET"])
def get_projects():
    try:
        projects = ProjectService.get_projects()
        return jsonify(projects)
    except Exception as e:
        logger.error(f"Error fetching projects: {e}")
        return jsonify({"error": "Failed to fetch projects"}), 500

@project_bp.route("/api/projects", methods=["POST"])
def create_project():
    data = request.json or {}
    try:
        project = ProjectService.create_project(data)
        return jsonify(project), 201
    except Exception as e:
        logger.error(f"Error creating project: {e}")
        return jsonify({"error": str(e)}), 400

@project_bp.route("/api/projects/<project_id>", methods=["DELETE"])
def delete_project(project_id):
    try:
        if ProjectService.delete_project(project_id):
            return jsonify({"success": True}), 200
        return jsonify({"error": "Project not found or failure"}), 404
    except Exception as e:
        logger.error(f"Error deleting project {project_id}: {e}")
        return jsonify({"error": str(e)}), 500
