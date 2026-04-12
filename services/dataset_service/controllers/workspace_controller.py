from flask import Blueprint, jsonify
from models.db import db, serialize_doc
from services.project_service import ProjectService
from utils.logger import logger

workspace_bp = Blueprint('workspace_bp', __name__)

@workspace_bp.route("/api/workspace-overview", methods=["GET"])
def get_workspace_overview():
    try:
        # Find folders and workspace
        folders = [serialize_doc(folder) for folder in db.folders.find().sort("name", 1)]
        workspace = db.workspaces.find_one() or {"name": "VisionFlow Workspace"}
        if "_id" in workspace: serialize_doc(workspace)
        
        # Get enriched projects
        projects = ProjectService.get_projects()
        
        # Stats
        stats = {
            "projects": len(projects),
            "folders": len(folders),
            "images": sum(p.get("images", 0) for p in projects),
            "versions": sum(p.get("versions_count", 0) for p in projects),
        }
        
        return jsonify({
            "workspace": workspace,
            "folders": folders,
            "projects": projects,
            "stats": stats
        })
    except Exception as e:
        logger.error(f"Error fetching workspace overview: {e}")
        return jsonify({"error": "Failed to fetch workspace overview"}), 500
