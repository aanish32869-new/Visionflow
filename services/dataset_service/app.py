import os
from io import BytesIO

import gridfs
from bson.objectid import ObjectId
from flask import Flask, Response, send_from_directory, jsonify
from flask_cors import CORS
from config import Config
from models.db import db
from utils.logger import logger
from controllers.asset_controller import asset_bp
from controllers.project_controller import project_bp
from controllers.workspace_controller import workspace_bp
from controllers.analytics_controller import analytics_bp
from controllers.class_controller import class_bp
from controllers.tag_controller import tag_bp
from controllers.dataset_controller import dataset_bp
from controllers.version_controller import version_bp

def create_app():
    app = Flask(__name__)
    CORS(app)
    asset_files_bucket = gridfs.GridFSBucket(db, bucket_name="asset_files")
    
    # Load configuration
    app.config.from_object(Config)
    
    # Register blueprints
    app.register_blueprint(asset_bp)
    app.register_blueprint(project_bp)
    app.register_blueprint(workspace_bp)
    app.register_blueprint(analytics_bp)
    app.register_blueprint(class_bp)
    app.register_blueprint(tag_bp)
    app.register_blueprint(dataset_bp)
    app.register_blueprint(version_bp)
    
    # Static file serving for uploads and datasets
    @app.route("/uploads/assets/<asset_id>/<path:filename>")
    def uploaded_asset_file(asset_id, filename):
        asset = db.assets.find_one({"_id": ObjectId(asset_id)}) if ObjectId.is_valid(asset_id) else None
        if not asset:
            return jsonify({"error": "Asset not found"}), 404

        file_ref = str(asset.get("file_id") or asset.get("current_file_id") or "").strip()
        if ObjectId.is_valid(file_ref):
            stream = BytesIO()
            try:
                asset_files_bucket.download_to_stream(ObjectId(file_ref), stream)
            except Exception:
                return jsonify({"error": "Asset file not found"}), 404

            return Response(
                stream.getvalue(),
                mimetype=(asset.get("metadata") or {}).get("mimetype") or "application/octet-stream",
                headers={"Cache-Control": "public, max-age=3600"},
            )

        legacy_path = asset.get("path")
        if legacy_path and os.path.exists(legacy_path):
            return send_from_directory(os.path.dirname(legacy_path), os.path.basename(legacy_path))

        return jsonify({"error": "Asset file not found"}), 404

    @app.route("/uploads/<path:filename>")
    def uploaded_file(filename):
        return send_from_directory(Config.UPLOAD_DIR, filename)

    @app.route("/datasets/<filename>")
    def serve_dataset(filename):
        return send_from_directory(Config.DATASET_DIR, filename, as_attachment=True)

    @app.route('/health')
    def health():
        return jsonify({"status": "ok", "service": "dataset-service", "version": "2.0.1"})

    @app.route('/api/diag/version')
    def diag_version():
        return jsonify({"version": "2.0.1", "status": "deployed"})

    logger.info("Initializing Dataset Service v2.0...")
    return app

if __name__ == '__main__':
    app = create_app()
    app.run(host='0.0.0.0', port=Config.PORT, debug=False)
