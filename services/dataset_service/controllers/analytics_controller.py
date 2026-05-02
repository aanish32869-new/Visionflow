import io
import csv
from flask import Blueprint, jsonify, Response
from services.analytics_service import AnalyticsService
from models.db import db
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

@analytics_bp.route("/api/projects/<project_id>/analytics/export", methods=["GET"])
@analytics_bp.route("/api/projects/<project_id>/dataset/analytics/export", methods=["GET"])
@analytics_bp.route("/api/projects/<project_id>/dataset/export-analytics", methods=["GET"])
@analytics_bp.route("/api/projects/<project_id>/analytics-csv", methods=["GET"])
def export_analytics_csv(project_id):
    try:
        # 1. Fetch data
        assets = list(db.assets.find({"project_id": project_id}))
        
        # 2. Aggregate stats per class
        stats = {} # { "class_name": { "total": 0, "train": 0, "valid": 0, "test": 0 } }
        
        for asset in assets:
            split = asset.get("dataset_split") or asset.get("state") or asset.get("split") or "unassigned"
            # Normalize split name
            if split == "val": split = "valid"
            
            for anno in asset.get("annotations", []):
                cls = anno.get("label") or "unlabeled"
                if cls not in stats:
                    stats[cls] = {"total": 0, "train": 0, "valid": 0, "test": 0}
                
                stats[cls]["total"] += 1
                if split in ["train", "valid", "test"]:
                    stats[cls][split] += 1
        
        # 3. Generate CSV
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Class", "Total", "Train", "Valid", "Test"])
        
        for cls_name, data in sorted(stats.items()):
            writer.writerow([
                cls_name,
                data["total"],
                data["train"],
                data["valid"],
                data["test"]
            ])
            
        csv_data = output.getvalue()
        output.close()
        
        return Response(
            csv_data,
            mimetype="text/csv",
            headers={
                "Content-Disposition": "attachment; filename=dataset_analytics.csv"
            }
        )
        
    except Exception as e:
        logger.error(f"Error exporting analytics CSV: {e}")
        return jsonify({"error": str(e)}), 500
