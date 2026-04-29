import os
import tempfile
from pathlib import Path

from flask import Blueprint, jsonify, request
from utils.logger import logger

from services.inference_service import InferenceLogic


inference_bp = Blueprint("inference_bp", __name__)


@inference_bp.route("/api/auto-label", methods=["POST"])
def auto_label():
    data = request.json or {}
    source = data.get("url") or data.get("source")
    model = data.get("model")
    queries = data.get("queries")
    confidence = data.get("conf")

    logger.info(f"Auto-label request for {source} with model {model}")
    try:
        result = InferenceLogic.run_auto_label(
            source,
            queries=queries,
            model_name=model,
            confidence=confidence,
        )
        status_code = 200 if result.get("success", True) else 400
        logger.info(f"Auto-label completed with status {status_code}")
        return jsonify(result), status_code
    except Exception as error:
        logger.error(f"Auto-label failed: {error}")
        return jsonify({"error": str(error)}), 500


@inference_bp.route("/api/classify", methods=["POST"])
def classify():
    data = request.json or {}
    source = data.get("url") or data.get("source")
    model = data.get("model")
    confidence = data.get("conf")

    if not source:
        return jsonify({"error": "Missing url"}), 400

    try:
        result = InferenceLogic.classify_image(
            source,
            model_name=model,
            confidence=confidence,
        )
        status_code = 200 if result.get("success", True) else 400
        return jsonify(result), status_code
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@inference_bp.route("/api/projects/<project_id>/models", methods=["GET"])
def list_models(project_id):
    try:
        result = InferenceLogic.list_models(project_id)
        return jsonify(result.get("models", [])), 200
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@inference_bp.route("/api/projects/<project_id>/models", methods=["POST"])
def create_model(project_id):
    data = request.json or {}
    try:
        result = InferenceLogic.create_model_training_job(
            project_id,
            version_ref=data.get("version_id"),
            architecture=data.get("architecture"),
            model_size=data.get("model_size"),
            checkpoint=data.get("checkpoint"),
            checkpoint_model_id=data.get("checkpoint_model_id"),
            training_mode=data.get("training_mode") or "custom",
            name=data.get("name"),
        )
        status_code = 201 if result.get("success") else 400
        return jsonify(result.get("model") if result.get("success") else result), status_code
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@inference_bp.route("/api/projects/<project_id>/models/<model_id>/infer", methods=["POST"])
def infer_model(project_id, model_id):
    confidence = request.form.get("conf") or request.args.get("conf")
    uploaded_file = request.files.get("file")
    
    # Also support JSON source if no file
    source = None
    if not uploaded_file:
        data = request.json or {}
        source = data.get("source") or data.get("url")
    
    if not uploaded_file and not source:
        return jsonify({"error": "No image to process"}), 400

    temp_path = None
    try:
        if uploaded_file:
            suffix = Path(uploaded_file.filename or "image.jpg").suffix or ".jpg"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
                uploaded_file.save(handle.name)
                temp_path = handle.name
            source = temp_path

        result = InferenceLogic.run_model_inference(project_id, model_id, source, confidence=confidence)
        status_code = 200 if result.get("success") else 400
        return jsonify(result), status_code
    except Exception as error:
        return jsonify({"error": str(error)}), 500
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)


@inference_bp.route("/api/projects/<project_id>/compare", methods=["POST"])
def compare_models(project_id):
    data = request.json or {}
    model_ids = data.get("model_ids", [])
    source = data.get("source")
    confidence = data.get("conf")

    if not model_ids or not source:
        return jsonify({"error": "Missing models or source"}), 400

    try:
        result = InferenceLogic.compare_models(project_id, model_ids, source, confidence=confidence)
        return jsonify(result), 200
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@inference_bp.route("/api/projects/<project_id>/inference-history", methods=["GET"])
def get_inference_history(project_id):
    limit = request.args.get("limit", 20, type=int)
    try:
        result = InferenceLogic.get_inference_history(project_id, limit=limit)
        return jsonify(result), 200
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@inference_bp.route("/api/infer/yolo-label", methods=["POST"])
def yolo_label():
    data = request.json or {}
    asset_id = data.get("asset_id")
    asset_ids = data.get("asset_ids")
    project_id = data.get("project_id")
    model = data.get("model")
    confidence = data.get("conf")

    normalized_asset_ids = []
    if isinstance(asset_ids, list):
        normalized_asset_ids = [str(item).strip() for item in asset_ids if str(item).strip()]

    logger.info(f"YOLO labeling request for project {project_id} / asset {asset_id} with model {model}")
    try:
        if normalized_asset_ids:
            result = InferenceLogic.run_assets_yolo_labeling(
                normalized_asset_ids,
                model_name=model,
                confidence=confidence,
                job_id=data.get("job_id"),
            )
        elif asset_id:
            result = InferenceLogic.run_yolo_labeling(
                asset_id,
                model_name=model,
                confidence=confidence,
            )
        else:
            result = InferenceLogic.run_project_yolo_labeling(
                project_id,
                model_name=model,
                confidence=confidence,
            )

        logger.info("YOLO labeling completed successfully")
        return jsonify(result), 200
    except Exception as error:
        logger.error(f"YOLO labeling failed: {error}")
        return jsonify({"error": str(error)}), 500


@inference_bp.route("/api/infer/health")
def health():
    return jsonify({"status": "ok", "service": "inference-service"})
