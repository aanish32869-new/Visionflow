import os
import tempfile
from pathlib import Path

from flask import Blueprint, jsonify, request

from services.inference_service import InferenceLogic


inference_bp = Blueprint("inference_bp", __name__)


@inference_bp.route("/api/auto-label", methods=["POST"])
def auto_label():
    data = request.json or {}
    source = data.get("url") or data.get("source")
    model = data.get("model")
    queries = data.get("queries")
    confidence = data.get("conf")

    if not source:
        return jsonify({"error": "Missing url"}), 400

    try:
        result = InferenceLogic.run_auto_label(
            source,
            queries=queries,
            model_name=model,
            confidence=confidence,
        )
        status_code = 200 if result.get("success", True) else 400
        return jsonify(result), status_code
    except Exception as error:
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
    uploaded_file = request.files.get("file")
    if not uploaded_file:
        return jsonify({"error": "No image to process"}), 400

    suffix = Path(uploaded_file.filename or "image.jpg").suffix or ".jpg"
    temp_path = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
            uploaded_file.save(handle.name)
            temp_path = handle.name

        result = InferenceLogic.run_model_inference(project_id, model_id, temp_path)
        status_code = 200 if result.get("success") else 400
        return jsonify(result), status_code
    except Exception as error:
        return jsonify({"error": str(error)}), 500
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)


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

    if not normalized_asset_ids and not asset_id and not project_id:
        return jsonify({"error": "Missing asset_id, asset_ids, or project_id"}), 400

    try:
        if normalized_asset_ids:
            result = InferenceLogic.run_assets_yolo_labeling(
                normalized_asset_ids,
                model_name=model,
                confidence=confidence,
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

        return jsonify(result), 200
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@inference_bp.route("/api/infer/health")
def health():
    return jsonify({"status": "ok", "service": "inference-service"})
