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
import torch
import torch.nn as nn
import torch.optim as optim
import torchvision
import torchvision.transforms as transforms

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from pymongo import MongoClient
from bson import ObjectId

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

def to_object_id(value):
    try:
        if value and ObjectId.is_valid(str(value)):
            return ObjectId(str(value))
    except Exception:
        pass
    return None

# ── In-memory active job tracker ───────────────────────────────────────────────
_active_processes: dict[str, subprocess.Popen] = {}

# ── Architecture registry ───────────────────────────────────────────────────────
ARCH_MAP = {
    "dinov3_small": {"label": "DINOv3 Small", "weights": "vit_b_16.pt", "task": "classify", "family": "dinov3", "size": "small"},
    "dinov3_base": {"label": "DINOv3 Base", "weights": "vit_b_16.pt", "task": "classify", "family": "dinov3", "size": "base"},
    "dinov3_large": {"label": "DINOv3 Large", "weights": "vit_l_16.pt", "task": "classify", "family": "dinov3", "size": "large"},
    "vit_tiny": {"label": "ViT Tiny", "weights": "vit_b_16.pt", "task": "classify", "family": "vit", "size": "tiny"},
    "vit_base": {"label": "ViT Base", "weights": "vit_b_16.pt", "task": "classify", "family": "vit", "size": "base"},
    "vit_large": {"label": "ViT Large", "weights": "vit_l_16.pt", "task": "classify", "family": "vit", "size": "large"},
    "resnet_resnet18": {"label": "ResNet18", "weights": "resnet18.pt", "task": "classify", "family": "resnet", "size": "resnet18"},
    "resnet_resnet34": {"label": "ResNet34", "weights": "resnet34.pt", "task": "classify", "family": "resnet", "size": "resnet34"},
    "resnet_resnet50": {"label": "ResNet50", "weights": "resnet50.pt", "task": "classify", "family": "resnet", "size": "resnet50"},
    "yolov8_nano": {"label": "YOLOv8 Nano", "weights": "yolov8n.pt", "task": "detect", "family": "yolov8", "size": "nano"},
    "yolov8_small": {"label": "YOLOv8 Small", "weights": "yolov8s.pt", "task": "detect", "family": "yolov8", "size": "small"},
    "yolov8_medium": {"label": "YOLOv8 Medium", "weights": "yolov8m.pt", "task": "detect", "family": "yolov8", "size": "medium"},
}

ARCH_TRAINING_PROFILES = {
    "dinov3_small": {"family": "foundation", "speed": "fast", "memory": "medium", "default_precision": "fp16"},
    "dinov3_base": {"family": "foundation", "speed": "medium", "memory": "high", "default_precision": "fp16"},
    "dinov3_large": {"family": "foundation", "speed": "slow", "memory": "high", "default_precision": "fp16"},
    "vit_tiny": {"family": "classification", "speed": "medium", "memory": "medium", "default_precision": "fp16"},
    "vit_base": {"family": "classification", "speed": "slow", "memory": "high", "default_precision": "fp16"},
    "vit_large": {"family": "classification", "speed": "slow", "memory": "high", "default_precision": "fp16"},
    "resnet_resnet18": {"family": "classification", "speed": "fast", "memory": "low", "default_precision": "fp32"},
    "resnet_resnet34": {"family": "classification", "speed": "fast", "memory": "medium", "default_precision": "fp32"},
    "resnet_resnet50": {"family": "classification", "speed": "medium", "memory": "medium", "default_precision": "fp32"},
    "yolov8_nano": {"family": "detection", "speed": "very_fast", "memory": "low", "default_precision": "fp16"},
    "yolov8_small": {"family": "detection", "speed": "fast", "memory": "medium", "default_precision": "fp16"},
    "yolov8_medium": {"family": "detection", "speed": "medium", "memory": "high", "default_precision": "fp16"},
}


def _resolve_architecture_variant(architecture, model_size):
    family = str(architecture or "").strip().lower()
    size = str(model_size or "").strip().lower()
    defaults = {"dinov3": "base", "vit": "base", "resnet": "resnet18", "yolov8": "nano"}
    allowed = {
        "dinov3": {"small", "base", "large"},
        "vit": {"tiny", "base", "large"},
        "resnet": {"resnet18", "resnet34", "resnet50"},
        "yolov8": {"nano", "small", "medium"},
    }
    if family not in allowed:
        raise ValueError("architecture must be one of: dinov3, vit, resnet, yolov8")
    if size == "":
        size = defaults[family]
    if size not in allowed[family]:
        raise ValueError(f"Invalid model_size '{size}' for architecture '{family}'")
    variant = f"{family}_{size}"
    if variant not in ARCH_MAP:
        raise ValueError(f"Unsupported architecture variant: {variant}")
    return variant

# ── PyTorch Custom Models ───────────────────────────────────────────────────
class SimpleCNN(nn.Module):
    def __init__(self, num_classes=10):
        super(SimpleCNN, self).__init__()
        self.conv1 = nn.Conv2d(3, 32, 3, padding=1)
        self.pool = nn.MaxPool2d(2, 2)
        self.conv2 = nn.Conv2d(32, 64, 3, padding=1)
        # Assuming 64x64 input (standard in our config)
        # 64 -> 32 -> 16 after two pools
        self.fc1 = nn.Linear(64 * 16 * 16, 128)
        self.fc2 = nn.Linear(128, num_classes)

    def forward(self, x):
        x = self.pool(torch.relu(self.conv1(x)))
        x = self.pool(torch.relu(self.conv2(x)))
        x = x.view(x.size(0), -1)
        x = torch.relu(self.fc1(x))
        x = self.fc2(x)
        return x

import threading
_hardware_cache = {
    "gpu_available": False, 
    "mps_available": False,
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
        
        mps_available = False
        try:
            if hasattr(torch.backends, 'mps'):
                mps_available = torch.backends.mps.is_available()
        except:
            pass

        _hardware_cache.update({
            "gpu_available": gpu_available,
            "mps_available": mps_available,
            "gpu_name": gpu_name or ("Apple Silicon" if mps_available else None),
            "torch_version": torch.__version__,
            "cuda_version": torch.version.cuda if gpu_available else None,
            "initialized": True
        })
    except Exception as e:
        _hardware_cache.update({
            "gpu_available": False,
            "mps_available": False,
            "gpu_name": None,
            "torch_version": "Error",
            "initialized": True
        })

# Start detection thread immediately
threading.Thread(target=_bg_hardware_detection, daemon=True).start()

def _get_hardware_status():
    """Return cached hardware details."""
    return _hardware_cache

def _resolve_version_dir(version_id: str, conf: dict):
    dataset_dir = ROOT_DIR / conf.get("local_dataset_dir", conf.get("dataset_dir", "storage/datasets"))
    version_dir = dataset_dir / version_id
    if version_dir.exists():
        return version_dir, version_id
    matching = [d for d in dataset_dir.iterdir() if d.is_dir() and d.name.startswith(version_id)] if dataset_dir.exists() else []
    if matching:
        return matching[0], matching[0].name
    return version_dir, version_id

def _collect_train_class_counts(version_dir: Path):
    counts = {}
    labels_dir = version_dir / "train" / "labels"
    if not labels_dir.exists():
        return counts
    for label_file in labels_dir.glob("*.txt"):
        try:
            for line in label_file.read_text(encoding="utf-8", errors="replace").splitlines():
                line = line.strip()
                if not line:
                    continue
                cls_id = int(line.split()[0])
                counts[cls_id] = int(counts.get(cls_id, 0)) + 1
        except Exception:
            continue
    return counts

def _get_training_precheck(project_id: str, version_id: str, architecture: str, conf: dict):
    db = _get_db()
    project = db.projects.find_one({"_id": to_object_id(project_id)}) or db.projects.find_one({"id": project_id}) or {}
    version = db.versions.find_one({"version_id": version_id}) or {}

    project_type = str(project.get("project_type") or "Object Detection")
    task = str(ARCH_MAP.get(architecture, {}).get("task", "detect"))
    split_counts = version.get("split_counts") or {}
    train_count = int(split_counts.get("train", 0) or 0)
    valid_count = int(split_counts.get("valid", 0) or 0)
    test_count = int(split_counts.get("test", 0) or 0)
    classes = version.get("classes") or []

    issues = []
    warnings = []
    minimums = {}

    if task == "detect" and project_type != "Object Detection":
        issues.append("Detection architectures require project type 'Object Detection'.")
    if task == "classify" and project_type != "Classification":
        issues.append("Classification/foundation architectures require project type 'Classification'.")

    if version.get("status") not in [None, "Ready", "Completed"]:
        issues.append(f"Selected version status is '{version.get('status')}'. Use a ready/completed version.")

    if task == "detect":
        minimums = {"train_images_min": 1, "valid_images_min": 1}
        if train_count < 1:
            issues.append("Detection training requires at least 1 train image.")
        if valid_count < 1:
            issues.append("Detection training requires at least 1 validation image.")
    else:
        minimums = {"train_images_min": 4, "valid_images_min": 1, "classes_min": 2, "min_labels_per_class": 2}
        if train_count < 4:
            issues.append("Classification training requires at least 4 train images.")
        if valid_count < 1:
            issues.append("Classification training requires at least 1 validation image.")
        if len(classes) < 2:
            issues.append("Classification training requires at least 2 classes.")

        version_dir, _ = _resolve_version_dir(version_id, conf)
        class_counts = _collect_train_class_counts(version_dir)
        if len(class_counts.keys()) < 2:
            issues.append("Training labels must include at least 2 classes in train split.")
        else:
            low = [cid for cid, c in class_counts.items() if c < 2]
            if low:
                issues.append("Each class should have at least 2 train labels for stable classification training.")
            if any(c < 5 for c in class_counts.values()):
                warnings.append("Very small per-class sample counts may produce unstable metrics.")

    return {
        "ok": len(issues) == 0,
        "project_type": project_type,
        "task": task,
        "architecture": architecture,
        "version_id": version_id,
        "split_counts": {"train": train_count, "valid": valid_count, "test": test_count},
        "classes_count": len(classes),
        "minimums": minimums,
        "issues": issues,
        "warnings": warnings,
    }

def _calculate_auto_params(project_id, version_id, architecture):
    """
    Intelligent Auto Hyperparameter Engine.
    Determines optimal values based on dataset size, class count, image resolution, and hardware.
    """
    db = _get_db()
    version = db.versions.find_one({"version_id": version_id}) or {}
    hw = _get_hardware_status()
    
    img_count = version.get("images_count", 0)
    class_count = len(version.get("classes", []))
    
    # 1. Epochs Logic
    # Small (<500): 100-200, Medium (500-2000): 50-100, Large (>2000): 25-50
    if img_count < 500:
        epochs = 100
    elif img_count < 2000:
        epochs = 50
    else:
        epochs = 25
        
    # 2. Batch Size Logic
    # Based on available VRAM/RAM.
    if hw["gpu_available"]:
        # Simple heuristic: YOLOv8 on 8GB GPU can handle ~16-32 batch size at 640
        batch_size = 16
    elif hw["mps_available"]:
        batch_size = 8
    else:
        batch_size = 4 # CPU is slow, keep batch small to manage memory
        
    # 3. Image Size Logic
    # Use median or standard resolution
    img_size = 640 # Default for YOLOv8
    
    # 4. Workers Logic
    # Based on CPU cores
    import multiprocessing
    cpu_cores = multiprocessing.cpu_count()
    workers = min(cpu_cores, 8)
    
    # 5. Device Logic (MANDATORY fallback)
    device = "cpu"
    if hw["gpu_available"]:
        device = "gpu"
    elif hw["mps_available"]:
        device = "mps"
        
    return {
        "epochs": epochs,
        "batch_size": batch_size,
        "img_size": img_size,
        "workers": workers,
        "device": device
    }

def _format_duration(seconds):
    seconds = max(0, int(seconds))
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    if hours > 0:
        return f"{hours}h {minutes}m {secs}s"
    if minutes > 0:
        return f"{minutes}m {secs}s"
    return f"{secs}s"

def _estimate_training_seconds(version_doc, architecture, epochs, batch_size, workers, device):
    """
    Estimate local training duration in seconds using dataset size + model + hardware heuristics.
    This is an estimate and is continuously refined while training runs.
    """
    img_count = max(1, int(version_doc.get("images_count", 1) or 1))
    classes = max(1, len(version_doc.get("classes", []) or []))

    # Relative architecture factors (YOLOv8n baseline)
    arch_factor = {
        "resnet_resnet18": 0.9,
        "resnet_resnet34": 1.1,
        "resnet_resnet50": 1.35,
        "vit_tiny": 1.5,
        "vit_base": 1.8,
        "vit_large": 2.2,
        "dinov3_small": 1.6,
        "dinov3_base": 1.9,
        "dinov3_large": 2.3,
    }.get(str(architecture).lower(), 1.7)

    # Base image throughput per second by device (rough local baseline)
    device_key = str(device).lower()
    if device_key == "gpu":
        base_ips = 32.0
    elif device_key == "mps":
        base_ips = 18.0
    else:
        base_ips = 8.0

    # More workers usually helps data loading up to a point
    worker_boost = min(1.35, 0.8 + (max(1, int(workers)) * 0.07))
    effective_ips = max(1.0, (base_ips * worker_boost) / max(0.5, arch_factor))

    # Classes mildly increases training complexity.
    class_factor = 1.0 + min(0.35, classes / 200.0)

    total_images_processed = img_count * max(1, int(epochs))
    seconds = int((total_images_processed / max(1.0, (effective_ips * max(1, int(batch_size)) / 8.0))) * class_factor)
    return max(20, seconds)

def _resolve_requested_device(requested_device: str, hw: dict):
    req = str(requested_device or "").lower()
    if req in ["auto", ""]:
        if hw.get("gpu_available"):
            return "gpu", None
        if hw.get("mps_available"):
            return "mps", None
        return "cpu", None
    if req == "gpu" and not hw.get("gpu_available"):
        return "cpu", "GPU requested but not available. Falling back to CPU."
    if req == "mps" and not hw.get("mps_available"):
        return "cpu", "MPS requested but not available. Falling back to CPU."
    return req, None

def _build_training_plan(version_doc, architecture, resolved_params, hw):
    profile = ARCH_TRAINING_PROFILES.get(str(architecture).lower(), {
        "family": "unknown", "speed": "medium", "memory": "medium", "default_precision": "fp32"
    })
    device = str(resolved_params.get("device", "cpu")).lower()
    use_amp = profile["default_precision"] == "fp16" and device in ["gpu", "mps"]
    grad_accum_steps = 1
    if device == "cpu" and int(resolved_params.get("batch_size", 1)) <= 2:
        grad_accum_steps = 2

    return {
        "dataset_snapshot": {
            "version_id": version_doc.get("version_id"),
            "name": version_doc.get("name"),
            "display_id": version_doc.get("display_id"),
            "canonical_id": version_doc.get("canonical_id"),
            "images_count": int(version_doc.get("images_count", 0) or 0),
            "annotations_count": int(version_doc.get("annotations_count", 0) or 0),
            "classes_count": len(version_doc.get("classes", []) or []),
            "lineage": version_doc.get("lineage") or {},
            "options": version_doc.get("options") or {},
        },
        "architecture_profile": profile,
        "runtime": {
            "execution_mode": "local",
            "device": device,
            "gpu_available": bool(hw.get("gpu_available")),
            "mps_available": bool(hw.get("mps_available")),
            "gpu_name": hw.get("gpu_name"),
            "torch_version": hw.get("torch_version"),
        },
        "optimization": {
            "mixed_precision": bool(use_amp),
            "gradient_accumulation_steps": int(grad_accum_steps),
            "checkpointing": True,
            "resume_supported": True,
        },
        "resolved_params": {
            "epochs": int(resolved_params["epochs"]),
            "batch_size": int(resolved_params["batch_size"]),
            "img_size": int(resolved_params["img_size"]),
            "workers": int(resolved_params["workers"]),
            "device": device,
        }
    }

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
        "mode": "local",
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

@app.route("/api/training/estimate", methods=["POST"])
def estimate_training():
    """
    Return a local-only ETA estimate before job creation.
    """
    data = request.json or {}
    project_id = data.get("project_id")
    version_id = data.get("version_id")
    architecture = data.get("architecture", "yolov8n")
    params = data.get("params", {})

    if not project_id or not version_id:
        return jsonify({"error": "project_id and version_id are required"}), 400

    auto_params = _calculate_auto_params(project_id, version_id, architecture)
    def _resolve(val, key):
        if val is None or str(val).lower() == "auto":
            return auto_params[key]
        return val

    try:
        epochs = int(_resolve(params.get("epochs"), "epochs"))
        batch_size = int(_resolve(params.get("batch_size"), "batch_size"))
        workers = int(_resolve(params.get("workers"), "workers"))
        device = str(_resolve(params.get("device"), "device")).lower()
    except Exception as e:
        return jsonify({"error": f"Invalid params: {e}"}), 400

    db = _get_db()
    version = db.versions.find_one({"version_id": version_id}) or {}
    plan = _build_training_plan(version, architecture, {
        "epochs": epochs,
        "batch_size": batch_size,
        "img_size": int(_resolve(params.get("img_size"), "img_size")),
        "workers": workers,
        "device": device,
    }, _get_hardware_status())
    estimated_seconds = _estimate_training_seconds(version, architecture, epochs, batch_size, workers, device)
    return jsonify({
        "mode": "local",
        "estimated_seconds": estimated_seconds,
        "estimated_time": _format_duration(estimated_seconds),
        "training_plan": plan,
        "resolved_params": {
            "epochs": epochs,
            "batch_size": batch_size,
            "workers": workers,
            "device": device,
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

@app.route("/api/projects/<project_id>/train/precheck", methods=["POST"])
def train_precheck(project_id):
    data = request.json or {}
    version_id = data.get("version_id") or data.get("dataset_version")
    architecture = data.get("architecture", "resnet")
    model_size = data.get("model_size")
    if not version_id:
        return jsonify({"ok": False, "issues": ["version_id is required"]}), 400
    conf = _load_conf()
    try:
        arch_variant = _resolve_architecture_variant(architecture, model_size)
    except ValueError as e:
        return jsonify({"ok": False, "issues": [str(e)], "warnings": []}), 400
    return jsonify(_get_training_precheck(project_id, version_id, arch_variant, conf))


@app.route("/api/projects/<project_id>/train", methods=["POST"])
def start_training(project_id):
    data = request.json or {}
    return _dispatch_training(project_id, data)

@app.route("/api/train", methods=["POST"])
def start_training_alias():
    """Alias for /api/train as per requested API structure."""
    data = request.json or {}
    project_id = data.get("project_id") or data.get("projectId")
    if not project_id:
        # Try to find a project if none provided (demo fallback)
        try:
            db = _get_db()
            p = db.projects.find_one()
            if p: project_id = str(p["_id"])
        except: pass
    return _dispatch_training(project_id, data)

def _dispatch_training(project_id, data):
    conf = _load_conf()
    version_id = data.get("version_id") or data.get("dataset_version")
    architecture = data.get("architecture") or data.get("model") or "resnet"
    model_size = data.get("model_size")
    params = data.get("params", {})
    
    # If using the direct /api/train payload format
    if "epochs" in data and "params" not in data:
        params = {
            "epochs": data.get("epochs"),
            "batch_size": data.get("batch_size"),
            "img_size": data.get("img_size") or data.get("image_size"),
            "workers": data.get("workers"),
            "device": data.get("device")
        }

    if not version_id:
        return jsonify({"error": "version_id is required"}), 400
    if not project_id:
        return jsonify({"error": "project_id is required"}), 400
    try:
        architecture = _resolve_architecture_variant(architecture, model_size)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    precheck = _get_training_precheck(project_id, version_id, architecture, conf)
    if not precheck.get("ok"):
        return jsonify({
            "error": "Training precheck failed",
            "precheck": precheck
        }), 400

    # Handle "auto" parameters
    auto_params = _calculate_auto_params(project_id, version_id, architecture)
    
    def _resolve(val, key):
        if val is None or str(val).lower() == "auto":
            return auto_params[key]
        return val

    epochs     = int(_resolve(params.get("epochs"), "epochs"))
    batch_size = int(_resolve(params.get("batch_size"), "batch_size"))
    img_size   = int(_resolve(params.get("img_size"), "img_size"))
    workers    = int(_resolve(params.get("workers"), "workers"))
    hw = _get_hardware_status()
    device, device_warning = _resolve_requested_device(_resolve(params.get("device"), "device"), hw)
    # Local-only enforcement: training always runs on the user's current machine.
    mode       = "local"

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
        "model_size": arch_info.get("size"),
        "mode":          mode,
        "device":        device,
        "params": {
            "epochs": epochs, "batch_size": batch_size,
            "img_size": img_size, "workers": workers,
        },
        "training_plan": {},
        "warnings": [],
        "status":    "Preparing",
        "progress":  0,
        "estimated_time_remaining": "Calculating...",
        "output_dir": str(output_dir),
        "created_at": _utc_now(),
        "updated_at": _utc_now(),
        "error":      None,
        "metrics":    {},
    }

    try:
        db = _get_db()
        version = db.versions.find_one({"version_id": version_id}) or {}
        job_doc["training_plan"] = _build_training_plan(version, architecture, {
            "epochs": epochs,
            "batch_size": batch_size,
            "img_size": img_size,
            "workers": workers,
            "device": device,
        }, hw)
        if device_warning:
            job_doc["warnings"] = [device_warning]

        estimated_total_seconds = _estimate_training_seconds(
            version, architecture, epochs, batch_size, workers, device
        )
        job_doc["estimated_total_seconds"] = estimated_total_seconds
        job_doc["estimated_total_time"] = _format_duration(estimated_total_seconds)
        job_doc["estimated_time_remaining"] = _format_duration(estimated_total_seconds)
        db.training_jobs.insert_one(job_doc)
    except Exception as e:
        return jsonify({"error": f"DB error: {e}"}), 500

    # Fire background thread
    thread = threading.Thread(
        target=_run_training,
        args=(job_id, project_id, version_id, architecture, arch_info, job_doc["params"], mode, output_dir, conf),
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

        # Enforced local execution path.
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

    # ── Resolve Dataset Directory ─────────────────────────────────────────────
    dataset_dir = ROOT_DIR / conf.get("local_dataset_dir", conf.get("dataset_dir", "storage/datasets"))
    actual_version_dir = dataset_dir / version_id
    
    # If not found directly, try to find by prefix (handle truncated IDs)
    if not actual_version_dir.exists():
        matching = [d for d in dataset_dir.iterdir() if d.is_dir() and d.name.startswith(version_id)]
        if matching:
            actual_version_dir = matching[0]
            print(f"[TRAIN] Resolved truncated version {version_id} -> {actual_version_dir.name}")
            # Update version_id for consistency
            version_id = actual_version_dir.name

    data_yaml = actual_version_dir / "data.yaml"
    is_complete = data_yaml.exists() and (actual_version_dir / "train").exists()
    
    if not is_complete:
        # Try fallback: maybe it's stored under archive_id (old naming convention)
        try:
            db = _get_db()
            version_doc = db.versions.find_one({"version_id": version_id})
            if not version_doc:
                # Try prefix search in DB
                version_doc = db.versions.find_one({"version_id": {"$regex": f"^{version_id}"}})
                
            if version_doc and version_doc.get("archive_id"):
                alt_dir = dataset_dir / version_doc["archive_id"]
                alt_yaml = alt_dir / "data.yaml"
                if alt_yaml.exists() and (alt_dir / "train").exists():
                    data_yaml = alt_yaml
                    actual_version_dir = alt_dir
                    is_complete = True
        except Exception as db_err:
            print(f"[TRAIN] DB fallback check failed: {db_err}")

    if not is_complete:
        msg = f"Dataset version {version_id} is incomplete or missing. Ensure you have generated the version and exported it to YOLO format."
        print(f"[TRAIN] {msg}")
        raise ValueError(msg)

    data_yaml_abs = str(data_yaml.resolve())
    
    # ── Hardware Decision Logic ───────────────────────────────────────────────
    hw = _get_hardware_status()
    actual_device = "cpu"
    
    if device == "gpu":
        if hw["gpu_available"]:
            print(f"[TRAIN] Using NVIDIA GPU: {hw['gpu_name']}")
            actual_device = "cuda:0"
            _update({"actual_device": f"GPU ({hw['gpu_name']})"})
        elif hw["mps_available"]:
            print(f"[TRAIN] Using Apple MPS (Metal Performance Shaders)")
            actual_device = "mps"
            _update({"actual_device": "Apple MPS"})
        else:
            print(f"[TRAIN] GPU requested but no accelerator found. Falling back to CPU.")
            actual_device = "cpu"
            _update({"actual_device": "CPU (Fallback)"})
    else:
        actual_device = "cpu"
        _update({"actual_device": "CPU"})

    device_arg = actual_device
    
    # ── Dispatch to appropriate training engine ───────────────────────────────
    if arch_info.get("task") == "classify":
        _run_pytorch_training(job_id, project_id, version_id, architecture, arch_info, params, conf, _update, output_dir, device_arg)
        return
    elif arch_info.get("task") == "detect" and arch_info.get("family") == "yolov8":
        _run_yolo_training(job_id, project_id, version_id, architecture, arch_info, params, conf, _update, output_dir, device_arg)
        return
    raise RuntimeError(f"Unsupported architecture '{architecture}' for task '{task}'.")


def _run_yolo_training(job_id, project_id, version_id, architecture, arch_info, params, conf, _update, output_dir, device_arg):
    """Run YOLOv8 training using ultralytics library."""
    from ultralytics import YOLO
    
    epochs     = int(params.get("epochs",     conf.get("local_epochs",     25)))
    batch_size = int(params.get("batch_size", conf.get("local_batch_size",  8)))
    img_size   = int(params.get("img_size",   conf.get("local_img_size",  640)))
    workers    = int(params.get("workers",    conf.get("local_workers",     4)))
    weights    = arch_info.get("weights", "yolov8n.pt")
    
    # Resolve Dataset Directory (handled already in _run_local_training, but we need the data.yaml path)
    dataset_dir = ROOT_DIR / conf.get("local_dataset_dir", conf.get("dataset_dir", "storage/datasets"))
    actual_version_dir = dataset_dir / version_id
    if not actual_version_dir.exists():
        matching = [d for d in dataset_dir.iterdir() if d.is_dir() and d.name.startswith(version_id)]
        if matching:
            actual_version_dir = matching[0]
    
    data_yaml = actual_version_dir / "data.yaml"
    if not data_yaml.exists():
        raise RuntimeError(f"data.yaml not found in {actual_version_dir}")

    _update({"status": "Training", "progress": 10})
    
    print(f"[TRAIN] Loading model {weights}...")
    model = YOLO(weights)
    
    # Custom callback to update progress in MongoDB
    def on_train_epoch_end(trainer):
        # trainer.epoch is 0-indexed in some versions, 1-indexed in others. 
        # Usually it's the current epoch index.
        current_epoch = trainer.epoch + 1
        progress = 10 + int((current_epoch / epochs) * 85)
        _update({
            "progress": min(95, progress),
            "current_epoch": current_epoch,
            "metrics": {
                "box_loss": float(trainer.loss_items[0]) if hasattr(trainer, 'loss_items') else 0,
                "cls_loss": float(trainer.loss_items[1]) if hasattr(trainer, 'loss_items') and len(trainer.loss_items) > 1 else 0
            }
        })

    model.add_callback("on_train_epoch_end", on_train_epoch_end)

    print(f"[TRAIN] Starting YOLOv8 training on {device_arg}...")
    results = model.train(
        data=str(data_yaml.resolve()),
        epochs=epochs,
        imgsz=img_size,
        batch=batch_size,
        workers=workers,
        device=device_arg,
        project=str(output_dir.resolve()),
        name="yolo_run",
        exist_ok=True,
        verbose=True
    )
    
    print(f"[TRAIN] YOLOv8 training completed.")
    _update({"status": "Completed", "progress": 100})


def _run_pytorch_training(job_id, project_id, version_id, architecture, arch_info, params, conf, _update, output_dir, device_arg):
    """Run custom PyTorch training loop as per requested logic."""
    epochs     = int(params.get("epochs",     conf.get("local_epochs",     10)))
    batch_size = int(params.get("batch_size", conf.get("local_batch_size",  32)))
    img_size   = int(params.get("img_size",   conf.get("local_img_size",  640)))
    workers    = int(params.get("workers",    conf.get("local_workers",      4)))
    
    device = torch.device(device_arg)
    print(f"[TRAIN] Initializing PyTorch training on {device} | arch={architecture}")
    
    try:
        # 1) Build classification dataset from YOLO version folders.
        dataset_dir = ROOT_DIR / conf.get("local_dataset_dir", conf.get("dataset_dir", "storage/datasets"))
        version_dir = dataset_dir / version_id
        if not version_dir.exists():
            matching = [d for d in dataset_dir.iterdir() if d.is_dir() and d.name.startswith(version_id)]
            if matching:
                version_dir = matching[0]
                version_id = version_dir.name

        data_yaml = version_dir / "data.yaml"
        if not data_yaml.exists():
            raise RuntimeError(f"Dataset YAML not found for version '{version_id}'.")

        class_names = []
        try:
            for line in data_yaml.read_text(encoding="utf-8", errors="replace").splitlines():
                if line.strip().startswith("names:"):
                    rhs = line.split(":", 1)[1].strip()
                    class_names = json.loads(rhs) if rhs.startswith("[") else []
                    break
        except Exception:
            class_names = []
        if not class_names:
            try:
                db = _get_db()
                version_doc = db.versions.find_one({"version_id": version_id}) or {}
                class_names = version_doc.get("classes", []) or []
            except Exception:
                class_names = []
        if not class_names:
            raise RuntimeError("Could not resolve class names for classification training.")

        cls_root = output_dir / "classification_data"
        for split in ["train", "valid", "test"]:
            (cls_root / split).mkdir(parents=True, exist_ok=True)

        def _prepare_split(split_name):
            images_dir = version_dir / split_name / "images"
            labels_dir = version_dir / split_name / "labels"
            if not images_dir.exists() or not labels_dir.exists():
                return 0
            count = 0
            for img_path in images_dir.glob("*"):
                if not img_path.is_file():
                    continue
                label_path = labels_dir / f"{img_path.stem}.txt"
                if not label_path.exists():
                    continue
                try:
                    first = label_path.read_text(encoding="utf-8", errors="replace").splitlines()[0].strip()
                    cls_id = int(first.split()[0])
                    cls_name = class_names[cls_id] if 0 <= cls_id < len(class_names) else f"class_{cls_id}"
                except Exception:
                    continue
                out_dir = cls_root / split_name / cls_name
                out_dir.mkdir(parents=True, exist_ok=True)
                out_path = out_dir / img_path.name
                if not out_path.exists():
                    try:
                        out_path.write_bytes(img_path.read_bytes())
                        count += 1
                    except Exception:
                        continue
            return count

        train_count = _prepare_split("train")
        valid_count = _prepare_split("valid")
        test_count = _prepare_split("test")
        print(f"[TRAIN] Classification data prepared | train={train_count} valid={valid_count} test={test_count}")
        if train_count < 2:
            raise RuntimeError("Not enough labeled training images for classification path.")

        _update({"status": "Training", "progress": 15})

        # 2) DataLoader
        input_size = max(64, int(img_size))
        transform_train = transforms.Compose([
            transforms.Resize((input_size, input_size)),
            transforms.RandomHorizontalFlip(p=0.5),
            transforms.ToTensor(),
        ])
        transform_eval = transforms.Compose([
            transforms.Resize((input_size, input_size)),
            transforms.ToTensor(),
        ])

        train_ds = torchvision.datasets.ImageFolder(str(cls_root / "train"), transform=transform_train)
        if len(train_ds.classes) < 2:
            raise RuntimeError("Classification requires at least 2 classes in training split.")
        valid_ds = torchvision.datasets.ImageFolder(str(cls_root / "valid"), transform=transform_eval) if valid_count > 0 else None

        safe_workers = max(0, min(int(workers), 8))
        train_loader = torch.utils.data.DataLoader(
            train_ds,
            batch_size=max(1, int(batch_size)),
            shuffle=True,
            num_workers=safe_workers,
            pin_memory=(device.type == "cuda"),
        )
        valid_loader = None
        if valid_ds and len(valid_ds) > 0:
            valid_loader = torch.utils.data.DataLoader(
                valid_ds,
                batch_size=max(1, int(batch_size)),
                shuffle=False,
                num_workers=safe_workers,
                pin_memory=(device.type == "cuda"),
            )

        # 3) Model setup
        num_classes = len(train_ds.classes)
        if architecture == "resnet_resnet18":
            model = torchvision.models.resnet18(weights=torchvision.models.ResNet18_Weights.DEFAULT)
            model.fc = nn.Linear(model.fc.in_features, num_classes)
        elif architecture == "resnet_resnet34":
            model = torchvision.models.resnet34(weights=torchvision.models.ResNet34_Weights.DEFAULT)
            model.fc = nn.Linear(model.fc.in_features, num_classes)
        elif architecture == "resnet_resnet50":
            model = torchvision.models.resnet50(weights=torchvision.models.ResNet50_Weights.DEFAULT)
            model.fc = nn.Linear(model.fc.in_features, num_classes)
        elif architecture in ["vit_tiny", "vit_base", "dinov3_small", "dinov3_base"]:
            model = torchvision.models.vit_b_16(weights=torchvision.models.ViT_B_16_Weights.DEFAULT)
            model.heads.head = nn.Linear(model.heads.head.in_features, num_classes)
        elif architecture in ["vit_large", "dinov3_large"]:
            model = torchvision.models.vit_l_16(weights=torchvision.models.ViT_L_16_Weights.DEFAULT)
            model.heads.head = nn.Linear(model.heads.head.in_features, num_classes)
        else:
            raise RuntimeError(f"Unsupported classification architecture '{architecture}'.")
        model = model.to(device)

        criterion = nn.CrossEntropyLoss()
        optimizer = optim.Adam(model.parameters(), lr=1e-3)

        # 4) Real training loop
        _update({"status": "Training", "progress": 20})
        history = []
        train_start = time.time()

        for epoch in range(epochs):
            model.train()
            epoch_loss = 0.0
            correct = 0
            total = 0
            epoch_start = time.time()

            for images, targets in train_loader:
                images = images.to(device, non_blocking=True)
                targets = targets.to(device, non_blocking=True)

                optimizer.zero_grad()
                logits = model(images)
                loss = criterion(logits, targets)
                loss.backward()
                optimizer.step()

                epoch_loss += loss.item() * images.size(0)
                preds = torch.argmax(logits, dim=1)
                correct += (preds == targets).sum().item()
                total += targets.size(0)

            train_loss = epoch_loss / max(1, total)
            train_acc = correct / max(1, total)

            val_acc = None
            if valid_loader is not None:
                model.eval()
                v_correct, v_total = 0, 0
                with torch.no_grad():
                    for images, targets in valid_loader:
                        images = images.to(device, non_blocking=True)
                        targets = targets.to(device, non_blocking=True)
                        logits = model(images)
                        preds = torch.argmax(logits, dim=1)
                        v_correct += (preds == targets).sum().item()
                        v_total += targets.size(0)
                val_acc = v_correct / max(1, v_total)

            elapsed_epoch = time.time() - epoch_start
            remaining_epochs = max(0, epochs - (epoch + 1))
            eta_seconds = int(elapsed_epoch * remaining_epochs)
            progress = int(((epoch + 1) / max(1, epochs)) * 75) + 20

            metrics = {
                "loss": float(train_loss),
                "accuracy": float(train_acc),
                "val_accuracy": float(val_acc) if val_acc is not None else None,
            }
            history.append({
                "epoch": epoch + 1,
                "loss": float(train_loss),
                "accuracy": float(train_acc),
                "val_accuracy": float(val_acc) if val_acc is not None else None,
            })
            print(f"[TRAIN][{architecture}] epoch {epoch+1}/{epochs} loss={train_loss:.4f} acc={train_acc:.4f} val_acc={(val_acc if val_acc is not None else -1):.4f}")
            _update({
                "progress": progress,
                "estimated_time_remaining": _format_duration(eta_seconds),
                "metrics": metrics,
                "metrics_history": history,
            })

        # 4. Save & Register
        weights_path = output_dir / "model.pt"
        torch.save(model.state_dict() if hasattr(model, 'state_dict') else {}, str(weights_path))
        
        total_elapsed = int(time.time() - train_start)
        final = history[-1] if history else {"loss": 0.0, "accuracy": 0.0, "val_accuracy": 0.0}
        metrics = {
            "loss": float(final.get("loss", 0.0)),
            "accuracy": float(final.get("accuracy", 0.0)),
            "val_accuracy": float(final.get("val_accuracy", 0.0)) if final.get("val_accuracy") is not None else None,
            "training_time_seconds": total_elapsed,
        }
        _update({
            "status": "Completed",
            "progress": 100,
            "estimated_time_remaining": "0s",
            "metrics": metrics,
            "metrics_history": history,
            "weights_path": str(weights_path)
        })
        _register_model(job_id, project_id, version_id, architecture, arch_info, metrics, weights_path, output_dir)

    except Exception as e:
        print(f"[TRAIN] PyTorch loop error: {e}")
        _update({"status": "Failed", "error": str(e)})


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
        remaining = max(0, min(epochs, 10) - epoch)
        _update({
            "status": "Training",
            "progress": progress,
            "estimated_time_remaining": _format_duration(int(remaining * 0.8))
        })

    metrics = {
        "mAP":       round(0.55 + (hash(architecture) % 30) / 100, 3),
        "precision": round(0.60 + (hash(architecture) % 25) / 100, 3),
        "recall":    round(0.50 + (hash(architecture) % 28) / 100, 3),
        "speed_ms":  round(2.0  + (hash(architecture) % 10) / 10, 1),
    }
    weights_path = output_dir / "run" / "weights" / "best.pt"
    weights_path.parent.mkdir(parents=True, exist_ok=True)
    weights_path.write_bytes(b"# simulated weights")

    # Simulate Metrics History for the UI Chart
    history = []
    for i in range(1, 11):
        history.append({
            "epoch": i,
            "loss": 0.5 - (i * 0.04),
            "mAP": 0.3 + (i * 0.06) if i < 10 else metrics["mAP"]
        })

    _update({
        "status": "Completed", 
        "progress": 100, 
        "estimated_time_remaining": "0s",
        "metrics": metrics,
        "metrics_history": history,
        "weights_path": str(weights_path)
    })
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
        
        # Determine Automatic Optimization targets
        hw = _get_hardware_status()
        optimization = "ONNX / OpenVINO"
        if hw["gpu_available"]:
            optimization = "CUDA / TensorRT"
        elif hw["mps_available"]:
            optimization = "CoreML / MPS"

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
            "optimization":         optimization,
            "created_at":           _utc_now(),
        }
        db.models.insert_one(model_doc)
        print(f"[TRAIN] Model registered: {model_doc['name']} with {optimization} optimization")
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


@app.route("/api/projects/<project_id>/jobs/<job_id>/weights", methods=["GET"])
def download_job_weights(project_id, job_id):
    try:
        db = _get_db()
        job = db.training_jobs.find_one({"job_id": job_id, "project_id": project_id})
        if not job or not job.get("weights_path"):
            return jsonify({"error": "Weights not found or job in progress"}), 404
        
        path = Path(job["weights_path"])
        if not path.exists():
            return jsonify({"error": "Weight file does not exist on disk"}), 404
            
        from flask import send_file
        return send_file(str(path.resolve()), as_attachment=True)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


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
    requested_arch = data.get("architecture", "resnet")
    requested_size = data.get("model_size")
    try:
        arch = _resolve_architecture_variant(requested_arch, requested_size)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
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
def download_model_weights(model_id):
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
