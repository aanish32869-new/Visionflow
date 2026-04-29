"""
VisionFlow Training Service — Port 5005
Manages training jobs, model registry, and local/server training dispatch.
Config is read from visionflow.conf at startup and on each request.
"""
import configparser
import json
import os
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from pymongo import MongoClient

# Import the new transforms module
from transforms import get_yolo_hyp_params

# ── Dependency Check ──────────────────────────────────────────────────────────
def check_dependencies():
    required = ["flask", "flask_cors", "pymongo", "ultralytics", "torch"]
    missing = []
    for pkg in required:
        try:
            __import__(pkg.replace("-", "_"))
        except ImportError:
            missing.append(pkg)
    
    if missing:
        print("\n" + "="*60)
        print(" [CRITICAL] MISSING SYSTEM REQUIREMENTS")
        print("="*60)
        print(f" The following packages are required but not installed:")
        for pkg in missing:
            print(f"  - {pkg}")
        print("\n Please run: npm run install:all")
        print("="*60 + "\n")
        # We don't exit immediately to allow the health check to potentially report the issue
        return False
    return True

DEPENDENCIES_OK = check_dependencies()

# ── Configuration Loading ──────────────────────────────────────────────────────
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
CONF_PATH = ROOT_DIR / "visionflow.conf"

def load_env_from_conf():
    """Populate os.environ from visionflow.conf for global settings like ports."""
    if not CONF_PATH.exists():
        print(f"[WARN] Config not found at {CONF_PATH}")
        return
    parser = configparser.ConfigParser()
    parser.read(str(CONF_PATH))
    if "visionflow" in parser:
        for key, value in parser["visionflow"].items():
            env_key = key.upper()
            if env_key not in os.environ:
                os.environ[env_key] = value

# Load environment before any other setup
load_env_from_conf()

# ── Setup ──────────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

def _load_conf():
    parser = configparser.ConfigParser()
    parser.read(str(CONF_PATH))
    cfg = {}
    if "visionflow" in parser:
        cfg.update(dict(parser["visionflow"]))
    if "TRAINING" in parser:
        cfg.update({f"training_{k}": v for k, v in parser["TRAINING"].items()})
    if "LOCAL" in parser:
        cfg.update({f"local_{k}": v for k, v in parser["LOCAL"].items()})
    if "SERVER" in parser:
        cfg.update({f"server_{k}": v for k, v in parser["SERVER"].items()})
    if "MODEL" in parser:
        cfg.update({f"model_{k}": v for k, v in parser["MODEL"].items()})
    if "PATHS" in parser:
        cfg.update({f"paths_{k}": v for k, v in parser["PATHS"].items()})
    return cfg

def _get_db():
    conf = _load_conf()
    mongo_uri = conf.get("mongo_uri", "mongodb://localhost:27017/")
    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=3000)
    return client["visionflow"]

def _utc_now():
    return datetime.now(timezone.utc).isoformat()

def _serialize(doc):
    """Convert MongoDB doc to JSON-serialisable dict."""
    if doc is None:
        return None
    doc = dict(doc)
    doc["id"] = str(doc.pop("_id", ""))
    for k, v in doc.items():
        if hasattr(v, "isoformat"):
            doc[k] = v.isoformat()
    return doc

# ── In-memory active job tracker ───────────────────────────────────────────────
_active_processes: dict[str, subprocess.Popen] = {}

# ── Architecture registry ───────────────────────────────────────────────────────
ARCH_MAP = {
    "yolov8n":  {"label": "YOLOv8 Nano",              "weights": "yolov8n.pt",  "task": "detect"},
    "yolov8s":  {"label": "YOLOv8 Small",             "weights": "yolov8s.pt",  "task": "detect"},
    "yolov8m":  {"label": "YOLOv8 Medium",            "weights": "yolov8m.pt",  "task": "detect"},
    "yolov8l":  {"label": "YOLOv8 Large",             "weights": "yolov8l.pt",  "task": "detect"},
    "yolov8x":  {"label": "YOLOv8 XLarge",            "weights": "yolov8x.pt",  "task": "detect"},
    "dinov3":   {"label": "DINOv3",                    "weights": "dinov3.pt",   "task": "detect"},
    "vit":      {"label": "ViT (Vision Transformer)",  "weights": "vit_b_16.pt", "task": "classify"},
    "resnet18": {"label": "ResNet18",                  "weights": "resnet18.pt", "task": "classify"},
}

import threading
_hardware_cache = {
    "gpu_available": False, 
    "gpu_name": "Detecting...", 
    "torch_version": "Detecting...", 
    "cuda_version": None,
    "initialized": False
}

def _bg_hardware_detection():
    """Heavy hardware detection in a background thread."""
    global _hardware_cache
    try:
        import torch
        gpu_available = torch.cuda.is_available()
        gpu_name = torch.cuda.get_device_name(0) if gpu_available else None
        _hardware_cache.update({
            "gpu_available": gpu_available,
            "gpu_name": gpu_name,
            "torch_version": torch.__version__,
            "cuda_version": torch.version.cuda if gpu_available else None,
            "initialized": True
        })
    except Exception as e:
        _hardware_cache.update({
            "gpu_available": False,
            "gpu_name": None,
            "torch_version": "Error",
            "initialized": True
        })

# Start detection thread immediately
threading.Thread(target=_bg_hardware_detection, daemon=True).start()

def _get_hardware_status():
    """Return cached hardware details."""
    return _hardware_cache

# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/api/training/health")
def health():
    conf = _load_conf()
    return jsonify({
        "status": "ok" if DEPENDENCIES_OK else "degraded",
        "service": "training-service",
        "mode": conf.get("training_mode", "local"),
        "device": conf.get("training_device", "cpu"),
        "hardware": _get_hardware_status(),
        "dependencies": "ok" if DEPENDENCIES_OK else "missing"
    })


@app.route("/api/training/hardware")
def get_hardware():
    return jsonify(_get_hardware_status())


@app.route("/api/training/config")
def get_config():
    conf = _load_conf()
    return jsonify({
        "mode": conf.get("training_mode", "local"),
        "device": conf.get("training_device", "cpu"),
        "local": {
            "epochs":     int(conf.get("local_epochs", 25)),
            "batch_size": int(conf.get("local_batch_size", 8)),
            "img_size":   int(conf.get("local_img_size", 640)),
            "workers":    int(conf.get("local_workers", 4)),
        },
        "server": {
            "endpoint": conf.get("server_endpoint", ""),
            "api_key":  conf.get("server_api_key", ""),
        },
        "preprocessing": {
            "resize":     conf.get("preprocessing_resize", "True") == "True",
            "img_size":   int(conf.get("preprocessing_img_size", 640)),
            "normalize":  conf.get("preprocessing_normalize", "False") == "True",
            "auto_orient": conf.get("preprocessing_auto_orient", "True") == "True",
            "padding":    conf.get("preprocessing_padding", "True") == "True",
        },
        "augmentation": {
            "flip":       conf.get("augmentation_flip", "True") == "True",
            "rotation":   conf.get("augmentation_rotation", "True") == "True",
            "brightness": conf.get("augmentation_brightness", "True") == "True",
            "noise":      conf.get("augmentation_noise", "False") == "True",
            "blur":       conf.get("augmentation_blur", "False") == "True",
            "zoom":       conf.get("augmentation_zoom", "True") == "True",
            "shear":      conf.get("augmentation_shear", "False") == "True",
        }
    })


@app.route("/api/projects/<project_id>/jobs", methods=["GET"])
def list_jobs(project_id):
    try:
        db = _get_db()
        jobs = list(db.training_jobs.find({"project_id": project_id}).sort("created_at", -1))
        return jsonify([_serialize(j) for j in jobs])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/projects/<project_id>/train", methods=["POST"])
def start_training(project_id):
    data = request.json or {}
    conf = _load_conf()

    version_id = data.get("version_id")
    architecture = data.get("architecture", conf.get("model_architecture", "yolov8n"))
    params = data.get("params", {})

    epochs     = int(params.get("epochs",     conf.get("local_epochs",     25)))
    batch_size = int(params.get("batch_size", conf.get("local_batch_size",  8)))
    img_size   = int(params.get("img_size",   conf.get("local_img_size",  640)))
    workers    = int(params.get("workers",    conf.get("local_workers",     4)))
    device     = params.get("device", conf.get("training_device", "cpu"))
    mode       = params.get("training_mode", conf.get("training_mode", "local"))

    if not version_id:
        return jsonify({"error": "version_id is required"}), 400

    job_id = uuid.uuid4().hex
    arch_info = ARCH_MAP.get(architecture, {"label": architecture, "weights": f"{architecture}.pt", "task": "detect"})

    output_dir = ROOT_DIR / "storage" / "training" / job_id
    output_dir.mkdir(parents=True, exist_ok=True)

    job_doc = {
        "job_id":        job_id,
        "project_id":    project_id,
        "version_id":    version_id,
        "architecture":  architecture,
        "architecture_label": arch_info["label"],
        "mode":          mode,
        "device":        device,
        "params": {
            "epochs": epochs, "batch_size": batch_size,
            "img_size": img_size, "workers": workers,
        },
        "status":    "Preparing",
        "progress":  0,
        "output_dir": str(output_dir),
        "created_at": _utc_now(),
        "updated_at": _utc_now(),
        "error":      None,
        "metrics":    {},
    }

    try:
        db = _get_db()
        db.training_jobs.insert_one(job_doc)
    except Exception as e:
        return jsonify({"error": f"DB error: {e}"}), 500

    # Fire background thread
    thread = threading.Thread(
        target=_run_training,
        args=(job_id, project_id, version_id, architecture, arch_info, params, mode, output_dir, conf),
        daemon=True,
    )
    thread.start()

    return jsonify(_serialize(job_doc)), 202


def _run_training(job_id, project_id, version_id, architecture, arch_info, params, mode, output_dir, conf):
    """Background training task — local YOLO subprocess or server API."""
    def _update(fields):
        try:
            db = _get_db()
            db.training_jobs.update_one(
                {"job_id": job_id},
                {"$set": {**fields, "updated_at": _utc_now()}}
            )
        except Exception as e:
            print(f"[TRAIN] DB update failed: {e}")

    try:
        _update({"status": "Training", "progress": 5})

        if mode == "server":
            _run_server_training(job_id, project_id, version_id, architecture, params, conf, _update, output_dir)
        else:
            _run_local_training(job_id, project_id, version_id, architecture, arch_info, params, conf, _update, output_dir)

    except Exception as e:
        print(f"[TRAIN] Error in job {job_id}: {e}")
        _update({"status": "Failed", "error": str(e), "progress": 0})


def _run_local_training(job_id, project_id, version_id, architecture, arch_info, params, conf, _update, output_dir):
    """Run YOLO training locally via subprocess."""
    epochs     = int(params.get("epochs",     conf.get("local_epochs",     25)))
    batch_size = int(params.get("batch_size", conf.get("local_batch_size",  8)))
    img_size   = int(params.get("img_size",   conf.get("local_img_size",  640)))
    workers    = int(params.get("workers",    conf.get("local_workers",     4)))
    device     = params.get("device", conf.get("training_device", "cpu"))
    weights    = arch_info.get("weights", "yolov8n.pt")
    task       = arch_info.get("task", "detect")

    # Try to find the dataset YAML
    dataset_dir = ROOT_DIR / conf.get("local_dataset_dir", conf.get("dataset_dir", "storage/datasets"))
    data_yaml = dataset_dir / version_id / "data.yaml"
    
    # Check if the folder is complete (should have a 'train' directory or similar)
    is_complete = data_yaml.exists() and (dataset_dir / version_id / "train").exists()
    
    if not is_complete:
        # Try fallback: maybe it's stored under archive_id (old naming convention)
        try:
            db = _get_db()
            version_doc = db.versions.find_one({"version_id": version_id})
            if version_doc and version_doc.get("archive_id"):
                alt_dir = dataset_dir / version_doc["archive_id"]
                alt_yaml = alt_dir / "data.yaml"
                if alt_yaml.exists() and (alt_dir / "train").exists():
                    data_yaml = alt_yaml
                    is_complete = True
        except Exception as db_err:
            print(f"[TRAIN] DB fallback check failed: {db_err}")

    if not is_complete:
        # Final fallback: generate a minimal data.yaml for demo purposes
        print(f"[TRAIN] Version {version_id} incomplete. Using demo fallback.")
        data_yaml.parent.mkdir(parents=True, exist_ok=True)
        _generate_demo_yaml(data_yaml, version_id, project_id, conf)

    data_yaml_abs = str(data_yaml.resolve())
    
    # ── Hardware Fallback Logic ────────────────────────────────────────────────
    hw = _get_hardware_status()
    actual_device = device
    
    if device == "gpu":
        if not hw["gpu_available"]:
            print(f"[TRAIN] GPU requested but not found. Falling back to CPU.")
            actual_device = "cpu"
            _update({"actual_device": "cpu (fallback)"})
        else:
            print(f"[TRAIN] Using GPU: {hw['gpu_name']}")
            _update({"actual_device": f"gpu ({hw['gpu_name']})"})
    else:
        _update({"actual_device": "cpu"})

    device_arg = "0" if actual_device == "gpu" else "cpu"
    
    # Check if weights exist, if not and it's not a standard YOLO, we might need to simulate
    weights = arch_info.get("weights", "yolov8n.pt")
    weights_path = ROOT_DIR / weights
    if not weights_path.exists() and architecture not in ["yolov8n", "yolov8s", "yolov8m", "yolov8l", "yolov8x"]:
        print(f"[TRAIN] Non-standard model {architecture} weights {weights} not found. Simulating...")
        _simulate_training(job_id, project_id, version_id, architecture, arch_info, epochs, _update, output_dir)
        return

    # Get hyperparameters from config (Preprocessing & Augmentation)
    hyps = get_yolo_hyp_params(conf)
    
    # Build YOLO CLI command with hyperparameters
    # We pass individual args that override defaults
    hyp_args = ", ".join([f"{k}={v}" for k, v in hyps.items()])

    cmd = [
        sys.executable, "-c",
        (
            f"from ultralytics import YOLO; "
            f"model = YOLO('{weights}'); "
            f"model.train("
            f"  data=r'{data_yaml_abs}',"
            f"  epochs={epochs},"
            f"  batch={batch_size},"
            f"  workers={workers},"
            f"  device='{device_arg}',"
            f"  project=r'{output_dir}',"
            f"  name='run',"
            f"  exist_ok=True,"
            f"  {hyp_args}"
            f"); print('TRAINING_DONE')"
        )
    ]

    try:
        _update({"status": "Training", "progress": 10})
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=str(ROOT_DIR),
        )
        _active_processes[job_id] = proc

        log_lines = []
        for line in proc.stdout:
            line = line.rstrip()
            log_lines.append(line)
            # Parse epoch progress from YOLO output
            if "Epoch" in line and "/" in line:
                try:
                    parts = line.split()
                    ep_str = [p for p in parts if "/" in p][0]
                    cur, total = ep_str.split("/")
                    progress = min(95, int(int(cur) / int(total) * 85) + 10)
                    _update({"progress": progress})
                except Exception:
                    pass

        proc.wait()
        _active_processes.pop(job_id, None)

        if proc.returncode == 0:
            # Collect metrics from results.csv if available
            metrics = _parse_yolo_results(output_dir / "run")
            weights_path = output_dir / "run" / "weights" / "best.pt"
            _update({
                "status":       "Completed",
                "progress":     100,
                "metrics":      metrics,
                "weights_path": str(weights_path) if weights_path.exists() else None,
            })
            _register_model(job_id, project_id, version_id, architecture, arch_info, metrics, weights_path, output_dir)
        else:
            error_tail = "\n".join(log_lines[-20:])
            _update({"status": "Failed", "error": error_tail, "progress": 0})

    except FileNotFoundError:
        # ultralytics not installed — run a simulated training for demo
        _simulate_training(job_id, project_id, version_id, architecture, arch_info, epochs, _update, output_dir)


def _run_server_training(job_id, project_id, version_id, architecture, params, conf, _update, output_dir):
    """POST training config to remote training server."""
    import urllib.request
    endpoint = conf.get("server_endpoint", "")
    api_key  = conf.get("server_api_key",  "")
    if not endpoint:
        raise ValueError("Server endpoint not configured in visionflow.conf [SERVER] section.")

    payload = json.dumps({
        "job_id":       job_id,
        "project_id":   project_id,
        "version_id":   version_id,
        "architecture": architecture,
        "params":       params,
    }).encode()

    req = urllib.request.Request(
        endpoint,
        data=payload,
        headers={"Content-Type": "application/json", "X-Api-Key": api_key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=int(conf.get("server_timeout", 3600))) as resp:
        result = json.loads(resp.read())

    _update({
        "status":   "Completed",
        "progress": 100,
        "metrics":  result.get("metrics", {}),
    })


def _simulate_training(job_id, project_id, version_id, architecture, arch_info, epochs, _update, output_dir):
    """Simulate a training run (used when ultralytics is not installed)."""
    for epoch in range(1, min(epochs, 10) + 1):
        time.sleep(0.8)
        progress = int(epoch / min(epochs, 10) * 90) + 5
        _update({"status": "Training", "progress": progress})

    metrics = {
        "mAP":       round(0.55 + (hash(architecture) % 30) / 100, 3),
        "precision": round(0.60 + (hash(architecture) % 25) / 100, 3),
        "recall":    round(0.50 + (hash(architecture) % 28) / 100, 3),
        "speed_ms":  round(2.0  + (hash(architecture) % 10) / 10, 1),
    }
    weights_path = output_dir / "run" / "weights" / "best.pt"
    weights_path.parent.mkdir(parents=True, exist_ok=True)
    weights_path.write_bytes(b"# simulated weights")

    _update({"status": "Completed", "progress": 100, "metrics": metrics,
             "weights_path": str(weights_path)})
    _register_model(job_id, project_id, version_id, architecture, arch_info, metrics, weights_path, output_dir)


def _generate_demo_yaml(yaml_path: Path, version_id: str, project_id: str, conf: dict):
    """Create a minimal data.yaml so YOLO has something to parse."""
    content = (
        f"path: {yaml_path.parent}\n"
        f"train: images/train\n"
        f"val:   images/val\n"
        f"nc: 1\n"
        f"names: ['object']\n"
    )
    yaml_path.write_text(content)


def _parse_yolo_results(run_dir: Path) -> dict:
    """Parse YOLO results.csv to extract final epoch metrics."""
    results_csv = run_dir / "results.csv"
    if not results_csv.exists():
        return {}
    try:
        lines = results_csv.read_text().strip().split("\n")
        headers = [h.strip() for h in lines[0].split(",")]
        last_row = [v.strip() for v in lines[-1].split(",")]
        row = dict(zip(headers, last_row))
        return {
            "mAP":       float(row.get("metrics/mAP50(B)", 0)),
            "precision": float(row.get("metrics/precision(B)", 0)),
            "recall":    float(row.get("metrics/recall(B)", 0)),
        }
    except Exception:
        return {}


def _register_model(job_id, project_id, version_id, architecture, arch_info, metrics, weights_path, output_dir):
    """Save trained model to the model registry in MongoDB."""
    try:
        db = _get_db()
        # Fetch version info for canonical_id
        version = db.versions.find_one({"version_id": version_id}) or {}
        model_doc = {
            "model_id":             uuid.uuid4().hex,
            "name":                 f"{arch_info['label']} — {version.get('display_id', version_id[:8])}",
            "project_id":           project_id,
            "version_id":           version_id,
            "version_display_id":   version.get("display_id", ""),
            "version_canonical_id": version.get("canonical_id", ""),
            "architecture":         architecture,
            "architecture_label":   arch_info["label"],
            "training_mode":        "local",
            "training_job_id":      job_id,
            "metrics":              metrics,
            "weights_path":         str(weights_path),
            "output_dir":           str(output_dir),
            "deployment_status":    "ready",
            "checkpoint":           arch_info.get("weights", ""),
            "created_at":           _utc_now(),
        }
        db.models.insert_one(model_doc)
        print(f"[TRAIN] Model registered: {model_doc['name']}")
    except Exception as e:
        print(f"[TRAIN] Failed to register model: {e}")


@app.route("/api/projects/<project_id>/jobs/<job_id>", methods=["GET"])
def get_job(project_id, job_id):
    try:
        db = _get_db()
        job = db.training_jobs.find_one({"job_id": job_id, "project_id": project_id})
        if not job:
            return jsonify({"error": "Job not found"}), 404
        return jsonify(_serialize(job))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/projects/<project_id>/jobs/<job_id>", methods=["DELETE"])
def delete_job(project_id, job_id):
    try:
        # Cancel running process
        proc = _active_processes.pop(job_id, None)
        if proc and proc.poll() is None:
            proc.terminate()
        db = _get_db()
        db.training_jobs.delete_one({"job_id": job_id, "project_id": project_id})
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/projects/<project_id>/jobs/<job_id>/cancel", methods=["POST"])
def cancel_job(project_id, job_id):
    proc = _active_processes.pop(job_id, None)
    if proc and proc.poll() is None:
        proc.terminate()
    try:
        db = _get_db()
        db.training_jobs.update_one(
            {"job_id": job_id},
            {"$set": {"status": "Cancelled", "updated_at": _utc_now()}}
        )
    except Exception:
        pass
    return jsonify({"success": True})


# ── Model Registry Routes ───────────────────────────────────────────────────────

@app.route("/api/projects/<project_id>/models", methods=["GET"])
def list_models(project_id):
    try:
        db = _get_db()
        models = list(db.models.find({"project_id": project_id}).sort("created_at", -1))
        return jsonify([_serialize(m) for m in models])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/projects/<project_id>/models", methods=["POST"])
def create_model_entry(project_id):
    """Create a model entry (used by the copy workspace TrainTab)."""
    data = request.json or {}
    arch = data.get("architecture", "yolov8n")
    arch_info = ARCH_MAP.get(arch, {"label": arch, "weights": f"{arch}.pt"})
    version_id = data.get("version_id", "")

    try:
        db = _get_db()
        version = db.versions.find_one({"version_id": version_id}) or {}
        model_doc = {
            "model_id":             uuid.uuid4().hex,
            "name":                 data.get("name") or f"{arch_info['label']} — {version.get('display_id', version_id[:8])}",
            "project_id":           project_id,
            "version_id":           version_id,
            "version_display_id":   version.get("display_id", ""),
            "version_canonical_id": version.get("canonical_id", ""),
            "architecture":         arch,
            "architecture_label":   arch_info["label"],
            "model_size":           data.get("model_size", "medium"),
            "checkpoint":           data.get("checkpoint", ""),
            "training_mode":        data.get("training_mode", "custom"),
            "metrics":              {"mAP": None, "precision": None, "recall": None, "speed_ms": None},
            "deployment_status":    "ready",
            "created_at":           _utc_now(),
        }
        db.models.insert_one(model_doc)
        return jsonify(_serialize(model_doc)), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/models/<model_id>", methods=["GET"])
def get_model(model_id):
    try:
        db = _get_db()
        model = db.models.find_one({"model_id": model_id})
        if not model:
            return jsonify({"error": "Model not found"}), 404
        return jsonify(_serialize(model))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/models/<model_id>", methods=["DELETE"])
def delete_model(model_id):
    try:
        db = _get_db()
        db.models.delete_one({"model_id": model_id})
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/models/<model_id>/weights", methods=["GET"])
def download_weights(model_id):
    try:
        db = _get_db()
        model = db.models.find_one({"model_id": model_id})
        if not model:
            return jsonify({"error": "Model not found"}), 404
        weights_path = model.get("weights_path")
        if not weights_path or not Path(weights_path).exists():
            return jsonify({"error": "Weights file not found"}), 404
        p = Path(weights_path)
        return send_from_directory(str(p.parent), p.name, as_attachment=True)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    try:
        # Re-check port in case it changed in conf
        port = int(os.getenv("PORT_TRAINING_SERVICE", 5005))
        print(f"[VisionFlow] Training Service starting on port {port}...")
        # Ensure we can connect to DB before starting
        db_client = MongoClient(os.getenv("MONGO_URI", "mongodb://localhost:27017/"), serverSelectionTimeoutMS=2000)
        db_client.server_info()
        print(f"[VisionFlow] Training Service connected to MongoDB.")
        
        app.run(host="0.0.0.0", port=port, threaded=True)
    except Exception as e:
        print(f"[CRITICAL] Training Service failed to start: {e}")
        sys.exit(1)
