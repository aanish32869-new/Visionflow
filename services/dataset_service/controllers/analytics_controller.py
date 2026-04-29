from flask import Blueprint, jsonify
from services.analytics_service import AnalyticsService
from utils.logger import logger

analytics_bp = Blueprint('analytics_bp', __name__)

@analytics_bp.route("/api/projects/<project_id>/analytics/distribution", methods=["GET"])
def get_distribution(project_id):
    try:
        dist = AnalyticsService.get_class_distribution(project_id)
        return jsonify(dist), 200
    except Exception as e:
        logger.error(f"Error fetching distribution: {e}")
        return jsonify({"error": str(e)}), 500

@analytics_bp.route("/api/projects/<project_id>/analytics/heatmap", methods=["GET"])
def get_heatmap(project_id):
    try:
        heatmap = AnalyticsService.get_spatial_heatmap(project_id)
        return jsonify(heatmap), 200
    except Exception as e:
        logger.error(f"Error fetching heatmap: {e}")
        return jsonify({"error": str(e)}), 500

@analytics_bp.route("/api/projects/<project_id>/analytics/health", methods=["GET"])
def get_health(project_id):
    try:
        health = AnalyticsService.get_health_score(project_id)
        return jsonify(health), 200
    except Exception as e:
        logger.error(f"Error fetching health score: {e}")
        return jsonify({"error": str(e)}), 500
