"""
VisionFlow Training Service - Port 5005
Manages training jobs, model registry, and local/server training dispatch.
Config is read from visionflow.conf at startup and on each request.
"""
import configparser
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
import torch
import torch.nn as nn
import torch.optim as optim
import torchvision
import torchvision.transforms as transforms

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from pymongo import MongoClient
from bson import ObjectId

# Import architecture engines
from architectures.dinov3_engine import train_dinov3
from architectures.yolo_engine import train_yolo
from architectures.pytorch_engine import train_pytorch
from architectures.resnet_engine import train_resnet

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

def _emit_notification(payload):
    if str(os.getenv("NOTIFICATIONS_ENABLED", "true")).strip().lower() in {"0", "false", "no", "off"}:
        return
    try:
        port = int(os.getenv("PORT_NOTIFICATION_SERVICE", 5009))
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"http://localhost:{port}/api/notifications",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=1).read()
    except (OSError, urllib.error.URLError, ValueError):
        pass

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

def _serialize_model(doc):
    model = _serialize(doc)
    metrics = model.get("metrics") or {}
    model["metrics"] = {
        "mAP": metrics.get("mAP", model.get("mAP")),
        "precision": metrics.get("precision", model.get("precision")),
        "recall": metrics.get("recall", model.get("recall")),
        "accuracy": metrics.get("accuracy", model.get("accuracy")),
        "speed_ms": metrics.get("speed_ms", model.get("speed_ms")),
    }
    return model

def _resolve_weights_from_job(job):
    job_id = str(job.get("job_id") or "").strip()
    if not job_id:
        return None
    from_job = str(job.get("weights_path") or "").strip()
    if from_job:
        p = Path(from_job)
        if not p.is_absolute():
            p = (ROOT_DIR / p).resolve()
        if p.exists():
            return p
    candidate_best = ROOT_DIR / "storage" / "training" / job_id / "yolo_run" / "weights" / "best.pt"
    candidate_last = ROOT_DIR / "storage" / "training" / job_id / "yolo_run" / "weights" / "last.pt"
    if candidate_best.exists():
        return candidate_best
    if candidate_last.exists():
        return candidate_last
    return None

def _backfill_models_for_project(project_id: str):
    db = _get_db()
    deleted_markers = list(db.deleted_models.find({"project_id": str(project_id)}))
    deleted_job_ids = {str(item.get("source_job_id")) for item in deleted_markers if item.get("source_job_id")}
    jobs = list(db.training_jobs.find({
        "project_id": str(project_id),
        "status": "Completed",
    }).sort("created_at", -1))
    for job in jobs:
        job_id = job.get("job_id")
        if not job_id:
            continue
        if str(job_id) in deleted_job_ids:
            continue
        existing = db.models.find_one({
            "project_id": str(project_id),
            "$or": [
                {"source_job_id": job_id},
                {
                    "version_id": job.get("version_id"),
                    "architecture": job.get("architecture"),
                },
            ],
        })
        if existing:
            continue
        weights_path = _resolve_weights_from_job(job)
        if not weights_path:
            continue
        version_id = job.get("version_id")
        version = db.versions.find_one({"version_id": version_id}) or {}
        arch_label = job.get("architecture_label") or job.get("architecture") or "Model"
        model_doc = {
            "model_id": uuid.uuid4().hex,
            "name": f"{arch_label} - {version.get('display_id', str(version_id or '')[:8])}",
            "project_id": str(project_id),
            "version_id": version_id,
            "architecture": job.get("architecture"),
            "architecture_label": arch_label,
            "metrics": job.get("metrics") or {"mAP": None, "precision": None, "recall": None},
            "weights_path": str(weights_path),
            "status": "Completed",
            "deployment_status": "ready",
            "source_job_id": job_id,
            "created_at": job.get("updated_at") or job.get("created_at") or _utc_now(),
            "updated_at": _utc_now(),
        }
        db.models.insert_one(model_doc)

def _purge_deleted_models_for_project(project_id: str):
    db = _get_db()
    deleted_markers = list(db.deleted_models.find({"project_id": str(project_id)}))
    if not deleted_markers:
        return
    deleted_job_ids = {str(item.get("source_job_id")) for item in deleted_markers if item.get("source_job_id")}
    doomed_ids = []
    for model in db.models.find({"project_id": str(project_id)}):
        source_job_id = str(model.get("source_job_id") or "")
        if source_job_id in deleted_job_ids:
            doomed_ids.append(model["_id"])
    if doomed_ids:
        db.models.delete_many({"_id": {"$in": doomed_ids}})

def _resolve_model_doc(model_ref: str):
    db = _get_db()
    raw = str(model_ref or "").strip()
    if not raw:
        return None
    by_oid = to_object_id(raw)
    if by_oid:
        model = db.models.find_one({"_id": by_oid})
        if model:
            return model
    return db.models.find_one({"model_id": raw})

def _delete_model_cascade(db, model_doc):
    model_ref = str(model_doc.get("model_id") or "")
    db.deleted_models.update_one(
        {"project_id": str(model_doc.get("project_id")), "model_id": model_ref},
        {"$set": {
            "project_id": str(model_doc.get("project_id")),
            "model_id": model_ref,
            "source_job_id": model_doc.get("source_job_id"),
            "version_id": model_doc.get("version_id"),
            "architecture": model_doc.get("architecture"),
            "deleted_at": _utc_now(),
        }},
        upsert=True,
    )
    db.inference_history.delete_many({"model_id": model_ref})
    db.deployments.delete_many({
        "$or": [
            {"model_id": model_ref},
            {"model_name": model_doc.get("name")},
        ]
    })
    db.models.delete_one({"_id": model_doc["_id"]})

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
    defaults = {"dinov3": "base", "vit": "base", "resnet": "resnet18", "yolov8": "small"}
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

# ── Hardware Cache ────────────────────────────────────────────────────────────
_hardware_cache = {
    "gpu_available": False, 
    "mps_available": False,
    "gpu_name": "Detecting...", 
    "torch_version": "Detecting...", 
    "cuda_version": None,
    "nvidia_gpu_detected": False,
    "nvidia_gpu_name": None,
    "gpu_detection_error": None,
    "initialized": False
}

def _detect_nvidia_gpu():
    """Best-effort NVIDIA GPU detection independent of PyTorch CUDA runtime."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
        if result.returncode != 0:
            return False, None, None
        lines = [line.strip() for line in (result.stdout or "").splitlines() if line.strip()]
        if not lines:
            return False, None, None
        return True, lines[0], None
    except Exception as e:
        return False, None, str(e)

def _bg_hardware_detection():
    """Heavy hardware detection in a background thread."""
    global _hardware_cache
    try:
        import torch
        nvidia_gpu_detected, nvidia_gpu_name, gpu_detection_error = _detect_nvidia_gpu()
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
            "nvidia_gpu_detected": nvidia_gpu_detected,
            "nvidia_gpu_name": nvidia_gpu_name,
            "gpu_detection_error": gpu_detection_error,
            "initialized": True
        })
    except Exception as e:
        _hardware_cache.update({
            "gpu_available": False,
            "mps_available": False,
            "gpu_name": None,
            "torch_version": "Error",
            "nvidia_gpu_detected": False,
            "nvidia_gpu_name": None,
            "gpu_detection_error": str(e),
            "initialized": True
        })

# Start detection thread immediately
threading.Thread(target=_bg_hardware_detection, daemon=True).start()

def _get_hardware_status():
    """Return cached hardware details."""
    return _hardware_cache

def _ensure_hardware_status_ready():
    """
    Ensure hardware detection is populated before device decisions.
    Prevents false GPU negatives immediately after service startup.
    """
    if not _hardware_cache.get("initialized"):
        _bg_hardware_detection()
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


def _normalize_dataset_multiplier(value):
    try:
        parsed = int(value)
    except Exception:
        parsed = 1
    return parsed if parsed in {1, 2, 3, 5} else 1


def _extract_dataset_multiplier(version_doc):
    options = (version_doc or {}).get("options") or {}
    return _normalize_dataset_multiplier(options.get("max_version_size", 1))

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

def _collect_full_frame_box_ratio(version_dir: Path):
    labels_dir = version_dir / "train" / "labels"
    if not labels_dir.exists():
        return 0.0
    total = 0
    full_frame = 0
    for label_file in labels_dir.glob("*.txt"):
        try:
            for line in label_file.read_text(encoding="utf-8", errors="replace").splitlines():
                parts = line.strip().split()
                if len(parts) < 5:
                    continue
                try:
                    x = float(parts[1]); y = float(parts[2]); w = float(parts[3]); h = float(parts[4])
                except Exception:
                    continue
                total += 1
                if abs(x - 0.5) <= 1e-6 and abs(y - 0.5) <= 1e-6 and w >= 0.99 and h >= 0.99:
                    full_frame += 1
        except Exception:
            continue
    if total == 0:
        return 0.0
    return float(full_frame) / float(total)

def _get_training_precheck(project_id: str, version_id: str, architecture: str, conf: dict):
    db = _get_db()
    project = db.projects.find_one({"_id": to_object_id(project_id)}) or db.projects.find_one({"id": project_id}) or {}
    version = db.versions.find_one({"version_id": version_id}) or {}

    project_type = str(project.get("project_type") or "Object Detection")
    task = str(ARCH_MAP.get(architecture, {}).get("task", "detect"))
    split_counts = version.get("split_counts") or {}
    dataset_multiplier = _extract_dataset_multiplier(version)
    train_count = int(split_counts.get("train", 0) or 0)
    valid_count = int(split_counts.get("valid", 0) or 0)
    test_count = int(split_counts.get("test", 0) or 0)
    classes = version.get("classes") or []

    issues = []
    warnings = []
    minimums = {}

    # Allow all architectures for both project types (user-selected workflow).
    # Dataset/data readiness checks below still protect from invalid training inputs.

    if version.get("status") not in [None, "Ready", "Completed"]:
        issues.append(f"Selected version status is '{version.get('status')}'. Use a ready/completed version.")

    if task == "detect":
        minimums = {"train_images_min": 1, "valid_images_min": 1}
        if train_count < 1:
            issues.append("Detection training requires at least 1 train image.")
        if valid_count < 1:
            issues.append("Detection training requires at least 1 validation image.")
        version_dir, _ = _resolve_version_dir(version_id, conf)
        full_frame_ratio = _collect_full_frame_box_ratio(version_dir)
        if full_frame_ratio >= 0.7:
            issues.append(
                "Detection labels appear to be full-image boxes for most samples. "
                "Please annotate real object bounding boxes before training detection."
            )
        elif full_frame_ratio >= 0.3:
            warnings.append(
                "Many labels are near full-image boxes. Detection quality may be poor unless boxes are tightened."
            )
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
        "dataset_multiplier": dataset_multiplier,
        "split_counts": {"train": train_count, "valid": valid_count, "test": test_count},
        "classes_count": len(classes),
        "minimums": minimums,
        "issues": issues,
        "warnings": warnings,
    }

def _calculate_auto_params(project_id, version_id, architecture):
    db = _get_db()
    version = db.versions.find_one({"version_id": version_id}) or {}
    hw = _ensure_hardware_status_ready()
    
    img_count = version.get("images_count", 0)
    dataset_multiplier = _extract_dataset_multiplier(version)
    
    if str(architecture).lower().startswith("yolov8"):
        if img_count < 500:
            epochs = 180
        elif img_count < 2000:
            epochs = 140
        else:
            epochs = 100
    else:
        if img_count < 500:
            epochs = 100
        elif img_count < 2000:
            epochs = 50
        else:
            epochs = 25
        
    if hw["gpu_available"]:
        batch_size = 16
    elif hw["mps_available"]:
        batch_size = 8
    else:
        batch_size = 4
        
    img_size = 768 if str(architecture).lower().startswith("yolov8") else 640
    import multiprocessing
    cpu_cores = multiprocessing.cpu_count()
    workers = min(cpu_cores, 8)
    
    device = "cpu"
    if hw["gpu_available"]:
        device = "gpu"
    elif hw["mps_available"]:
        device = "mps"
        
    return {
        "epochs": epochs,
        "dataset_multiplier": dataset_multiplier,
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
    img_count = max(1, int(version_doc.get("images_count", 1) or 1))
    classes = max(1, len(version_doc.get("classes", []) or []))

    arch_factor = {
        "resnet_resnet18": 0.9, "resnet_resnet34": 1.1, "resnet_resnet50": 1.35,
        "vit_tiny": 1.5, "vit_base": 1.8, "vit_large": 2.2,
        "dinov3_small": 1.6, "dinov3_base": 1.9, "dinov3_large": 2.3,
    }.get(str(architecture).lower(), 1.7)

    device_key = str(device).lower()
    if device_key == "gpu":
        base_ips = 32.0
    elif device_key == "mps":
        base_ips = 18.0
    else:
        base_ips = 8.0

    worker_boost = min(1.35, 0.8 + (max(1, int(workers)) * 0.07))
    effective_ips = max(1.0, (base_ips * worker_boost) / max(0.5, arch_factor))
    class_factor = 1.0 + min(0.35, classes / 200.0)

    total_images_processed = img_count * max(1, int(epochs))
    seconds = int((total_images_processed / max(1.0, (effective_ips * max(1, int(batch_size)) / 8.0))) * class_factor)
    return max(20, seconds)

def _estimate_historical_training_seconds(project_id, version_id, architecture, params):
    """
    Estimate total training time from past completed jobs with same model/version profile.
    Falls back to None when there is not enough history.
    """
    try:
        db = _get_db()
        completed = list(db.training_jobs.find({
            "project_id": str(project_id),
            "version_id": str(version_id),
            "architecture": str(architecture),
            "status": "Completed",
        }).sort("updated_at", -1).limit(20))
        if not completed:
            return None

        durations = []
        target_epochs = int((params or {}).get("epochs", 0) or 0)
        for job in completed:
            created = job.get("created_at")
            updated = job.get("updated_at")
            if not created or not updated:
                continue
            try:
                start_ts = datetime.fromisoformat(str(created).replace("Z", "+00:00")).timestamp()
                end_ts = datetime.fromisoformat(str(updated).replace("Z", "+00:00")).timestamp()
            except Exception:
                continue
            duration = int(max(1, end_ts - start_ts))
            if duration <= 0:
                continue

            # Normalize by epochs to improve cross-run comparability.
            run_epochs = int(((job.get("params") or {}).get("epochs", target_epochs)) or target_epochs or 1)
            if run_epochs <= 0:
                run_epochs = 1
            if target_epochs > 0 and run_epochs != target_epochs:
                duration = int(duration * (target_epochs / run_epochs))
            durations.append(duration)

        if not durations:
            return None
        durations.sort()
        return int(durations[len(durations) // 2])  # median
    except Exception:
        return None

def _build_progress_visual(percent: int, width: int = 24):
    p = max(1, min(100, int(percent)))
    filled = int(round((p / 100.0) * width))
    bar = f"[{'=' * filled}{'.' * max(0, width - filled)}]"
    return f"{bar} {p}%"

def _compute_progress_update(job_doc, incoming_fields):
    """
    Normalize each engine update so frontend can render a consistent loading line,
    1-100 processing state, and continuously improving ETA.
    """
    fields = dict(incoming_fields or {})
    status = str(fields.get("status") or job_doc.get("status") or "Training")

    raw_progress = fields.get("progress", job_doc.get("progress", 0))
    try:
        progress = int(raw_progress)
    except Exception:
        progress = 0
    progress = max(1 if status not in ["Preparing", "Failed"] else 0, min(100, progress))

    created_at = job_doc.get("created_at")
    elapsed_seconds = 0
    if created_at:
        try:
            created_ts = datetime.fromisoformat(str(created_at).replace("Z", "+00:00")).timestamp()
            elapsed_seconds = max(0, int(time.time() - created_ts))
        except Exception:
            elapsed_seconds = 0

    baseline_total = int(job_doc.get("historical_estimated_total_seconds") or job_doc.get("estimated_total_seconds") or 0)
    dynamic_total = 0
    if progress > 0 and elapsed_seconds > 3:
        dynamic_total = int((elapsed_seconds * 100) / max(1, progress))

    if baseline_total > 0 and dynamic_total > 0:
        # Weighted blend: starts with baseline, converges toward observed runtime.
        confidence = min(0.8, max(0.15, progress / 100.0))
        total_estimate = int((baseline_total * (1 - confidence)) + (dynamic_total * confidence))
    else:
        total_estimate = max(baseline_total, dynamic_total, 0)

    remaining_seconds = max(0, total_estimate - elapsed_seconds) if total_estimate > 0 else 0
    eta_hms = _format_duration(remaining_seconds)

    arch_label = str(job_doc.get("architecture_label") or job_doc.get("architecture") or "Model")
    version_label = str(job_doc.get("version_display_id") or job_doc.get("version_id") or "version")
    model_version_label = f"{arch_label} ({version_label})"

    fields["progress"] = progress
    fields["processing_percent"] = progress
    fields["progress_line"] = _build_progress_visual(progress)
    fields["estimated_time_remaining_seconds"] = remaining_seconds
    fields["estimated_time_remaining"] = eta_hms
    fields["eta_line"] = f"ETA: {eta_hms}"
    fields["model_version_label"] = model_version_label
    return fields

def _resolve_requested_device(requested_device: str, hw: dict):
    req = str(requested_device or "").lower()
    if req in ["auto", ""]:
        if hw.get("gpu_available"): return "gpu", None
        if hw.get("mps_available"): return "mps", None
        return "cpu", None
    if req == "gpu" and not hw.get("gpu_available"):
        if hw.get("nvidia_gpu_detected"):
            return "cpu", (
                "Couldn't use GPU for training because PyTorch CUDA is not available in this environment. "
                "Install a CUDA-enabled PyTorch build and ensure NVIDIA drivers are working."
            )
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
            "images_count": int(version_doc.get("images_count", 0) or 0),
            "dataset_multiplier": _extract_dataset_multiplier(version_doc),
            "effective_images_per_epoch": int(version_doc.get("images_count", 0) or 0) * _extract_dataset_multiplier(version_doc),
            "classes_count": len(version_doc.get("classes", []) or []),
        },
        "architecture_profile": profile,
        "runtime": {
            "execution_mode": "local",
            "device": device,
            "gpu_name": hw.get("gpu_name"),
        },
        "resolved_params": resolved_params
    }

# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/api/training/health")
def health():
    return jsonify({"status": "ok", "service": "training-service", "hardware": _get_hardware_status()})

@app.route("/api/projects/<project_id>/jobs", methods=["GET"])
def list_jobs(project_id):
    db = _get_db()
    jobs = list(db.training_jobs.find({"project_id": project_id}).sort("created_at", -1))
    return jsonify([_serialize(j) for j in jobs])

@app.route("/api/projects/<project_id>/models", methods=["GET"])
def list_models(project_id):
    _purge_deleted_models_for_project(project_id)
    _backfill_models_for_project(project_id)
    db = _get_db()
    models = list(db.models.find({"project_id": str(project_id)}).sort("created_at", -1))

    version_ids = [m.get("version_id") for m in models if m.get("version_id")]
    versions = {}
    if version_ids:
        for v in db.versions.find({"version_id": {"$in": list(set(version_ids))}}):
            versions[v.get("version_id")] = v

    serialized = []
    for model_doc in models:
        model = _serialize_model(model_doc)
        model.setdefault("status", "Completed")
        model.setdefault("deployment_status", "ready")
        version = versions.get(model.get("version_id")) or {}
        model.setdefault("version_display_id", version.get("display_id"))
        model.setdefault("version_canonical_id", version.get("canonical_id"))
        serialized.append(model)
    return jsonify(serialized)

@app.route("/api/models/<model_id>", methods=["DELETE"])
def delete_model(model_id):
    db = _get_db()
    model = _resolve_model_doc(model_id)
    if not model:
        return jsonify({"error": "Model not found"}), 404

    _delete_model_cascade(db, model)
    return jsonify({"ok": True, "deleted_model_id": str(model.get("model_id") or model_id)})

@app.route("/api/models/<model_id>", methods=["PATCH"])
def update_model(model_id):
    db = _get_db()
    model = _resolve_model_doc(model_id)
    if not model:
        return jsonify({"error": "Model not found"}), 404

    data = request.json or {}
    allowed = {"deployment_status", "status", "deployment_id", "api_key", "success_score"}
    update_fields = {k: data.get(k) for k in allowed if k in data}
    if not update_fields:
        return jsonify({"error": "No valid fields to update"}), 400
    update_fields["updated_at"] = _utc_now()
    db.models.update_one({"_id": model["_id"]}, {"$set": update_fields})
    updated = db.models.find_one({"_id": model["_id"]})
    return jsonify(_serialize_model(updated))

@app.route("/api/models/<model_id>/weights", methods=["GET"])
def download_model_weights(model_id):
    model = _resolve_model_doc(model_id)
    if not model:
        return jsonify({"error": "Model not found"}), 404

    candidate = str(model.get("weights_path") or model.get("runtime_model") or "").strip()
    if not candidate:
        return jsonify({"error": "Weights path is not available for this model"}), 404

    weights_path = Path(candidate)
    if not weights_path.is_absolute():
        weights_path = (ROOT_DIR / weights_path).resolve()
    if not weights_path.exists():
        return jsonify({"error": "Weights file not found"}), 404

    filename = f"{str(model.get('name') or model.get('model_id') or 'model').replace(' ', '_')}{weights_path.suffix or '.pt'}"
    return send_file(str(weights_path), as_attachment=True, download_name=filename)

@app.route("/api/projects/<project_id>/train/precheck", methods=["POST"])
def train_precheck(project_id):
    data = request.json or {}
    version_id = data.get("version_id") or data.get("dataset_version")
    architecture = data.get("architecture", "resnet")
    model_size = data.get("model_size")
    conf = _load_conf()
    try:
        arch_variant = _resolve_architecture_variant(architecture, model_size)
        return jsonify(_get_training_precheck(project_id, version_id, arch_variant, conf))
    except Exception as e:
        return jsonify({"ok": False, "issues": [str(e)]}), 400

@app.route("/api/projects/<project_id>/train", methods=["POST"])
def start_training(project_id):
    data = request.json or {}
    return _dispatch_training(project_id, data)

def _dispatch_training(project_id, data):
    conf = _load_conf()
    version_id = data.get("version_id") or data.get("dataset_version")
    architecture = data.get("architecture") or data.get("model") or "resnet"
    model_size = data.get("model_size")
    params = data.get("params", {})
    
    try:
        architecture = _resolve_architecture_variant(architecture, model_size)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    precheck = _get_training_precheck(project_id, version_id, architecture, conf)
    if not precheck.get("ok"):
        return jsonify({"error": "Training precheck failed", "precheck": precheck}), 400

    db = _get_db()
    version = db.versions.find_one({"version_id": version_id}) or {}
    dataset_multiplier = _extract_dataset_multiplier(version)
    auto_params = _calculate_auto_params(project_id, version_id, architecture)
    def _resolve(val, key):
        return auto_params[key] if (val is None or str(val).lower() == "auto") else val

    base_epochs = int(_resolve(params.get("epochs"), "epochs"))
    epochs = max(1, base_epochs) * dataset_multiplier
    batch_size = int(_resolve(params.get("batch_size"), "batch_size"))
    img_size = int(_resolve(params.get("img_size"), "img_size"))
    workers = int(_resolve(params.get("workers"), "workers"))
    hw = _ensure_hardware_status_ready()
    requested_device = _resolve(params.get("device"), "device")
    device, device_warning = _resolve_requested_device(requested_device, hw)
    if str(requested_device or "").lower() == "gpu" and device != "gpu":
        if hw.get("nvidia_gpu_detected"):
            return jsonify({
                "error": "NVIDIA GPU detected, but CUDA is not available to PyTorch.",
                "details": {
                    "nvidia_gpu_name": hw.get("nvidia_gpu_name"),
                    "torch_version": hw.get("torch_version"),
                    "cuda_version": hw.get("cuda_version"),
                },
                "fix": "Install a CUDA-enabled PyTorch build compatible with your CUDA driver/runtime.",
            }), 400
        return jsonify({"error": "Couldn't find GPU on the system."}), 400

    job_id = uuid.uuid4().hex
    arch_info = ARCH_MAP.get(architecture, {"label": architecture, "weights": f"{architecture}.pt", "task": "detect"})
    output_dir = ROOT_DIR / "storage" / "training" / job_id
    output_dir.mkdir(parents=True, exist_ok=True)

    export_formats = params.get("export_formats")
    # Do not auto-request ONNX/TensorRT exports by default.
    # Those formats may trigger privileged package installs on Windows
    # (e.g., into C:\Python314), which can fail with access denied.
    # Exports will run only when explicitly requested by caller.
    if not isinstance(export_formats, list):
        export_formats = []
    export_cfg = {
        "formats": [str(item).strip().lower() for item in export_formats if str(item).strip()],
        "half": bool(params.get("export_fp16", device == "gpu")),
        "int8": bool(params.get("export_int8", False)),
        "batch": int(params.get("inference_batch", max(1, batch_size))),
    }

    job_doc = {
        "job_id": job_id, "project_id": project_id, "version_id": version_id,
        "architecture": architecture, "architecture_label": arch_info["label"],
        "mode": "local", "device": device,
        "output_dir": str(output_dir),
        "params": {
            "base_epochs": max(1, base_epochs),
            "epochs": epochs,
            "dataset_multiplier": dataset_multiplier,
            "batch_size": batch_size,
            "img_size": img_size,
            "workers": workers,
            "device": device,
            "export": export_cfg,
        },
        "status": "Preparing", "progress": 0, "created_at": _utc_now(), "updated_at": _utc_now(),
        "terminal_logs": ["[INFO] Training job queued."],
    }

    job_doc["version_display_id"] = version.get("display_id")
    job_doc["dataset_multiplier"] = dataset_multiplier
    job_doc["base_epochs"] = max(1, base_epochs)
    job_doc["effective_images_per_epoch"] = int(version.get("images_count", 0) or 0) * dataset_multiplier
    job_doc["estimated_total_seconds"] = _estimate_training_seconds(version, architecture, epochs, batch_size, workers, device)
    historical = _estimate_historical_training_seconds(project_id, version_id, architecture, job_doc["params"])
    if historical:
        job_doc["historical_estimated_total_seconds"] = int(historical)
    # Provide UI-ready loading representation from the start.
    job_doc.update(_compute_progress_update(job_doc, {"status": "Preparing", "progress": 1}))
    db.training_jobs.insert_one(job_doc)
    _emit_notification({
        "id": f"training-started-{job_id}",
        "status": "Information",
        "title": "Model training started",
        "description": f"{arch_info.get('label', architecture)} training has started.",
        "route": "/upload",
        "projectId": project_id,
        "source": "training-service",
    })

    thread = threading.Thread(
        target=_run_training,
        args=(job_id, project_id, version_id, architecture, arch_info, job_doc["params"], output_dir, conf),
        daemon=True
    )
    thread.start()
    return jsonify(_serialize(job_doc)), 202

def _run_training(job_id, project_id, version_id, architecture, arch_info, params, output_dir, conf):
    db = _get_db()
    job_doc = db.training_jobs.find_one({"job_id": job_id, "project_id": project_id}) or {
        "job_id": job_id, "project_id": project_id, "version_id": version_id,
        "architecture": architecture, "architecture_label": arch_info.get("label", architecture),
        "params": params, "created_at": _utc_now(), "progress": 0, "status": "Preparing",
    }

    def _update(fields):
        nonlocal job_doc
        previous_status = job_doc.get("status")
        enriched = _compute_progress_update(job_doc, fields)
        db.training_jobs.update_one({"job_id": job_id}, {"$set": {**enriched, "updated_at": _utc_now()}})
        job_doc = {**job_doc, **enriched}
        next_status = job_doc.get("status")
        if previous_status != next_status:
            label = job_doc.get("model_version_label") or job_doc.get("architecture_label") or architecture
            if next_status == "Completed":
                _emit_notification({
                    "id": f"training-completed-{job_id}",
                    "status": "Success",
                    "title": "Model training completed",
                    "description": f"{label} finished successfully.",
                    "route": "/upload",
                    "projectId": project_id,
                    "source": "training-service",
                })
            elif next_status == "Failed":
                _emit_notification({
                    "id": f"training-failed-{job_id}",
                    "status": "Error",
                    "title": "Model training failed",
                    "description": job_doc.get("error") or f"{label} failed.",
                    "route": "/upload",
                    "projectId": project_id,
                    "source": "training-service",
                })
            elif next_status == "Cancelled":
                _emit_notification({
                    "id": f"training-cancelled-{job_id}",
                    "status": "Warning",
                    "title": "Model training cancelled",
                    "description": f"{label} was cancelled.",
                    "route": "/upload",
                    "projectId": project_id,
                    "source": "training-service",
                })

    def _append_log(line):
        text = str(line or "").strip()
        if not text:
            return
        logs = list(job_doc.get("terminal_logs") or [])
        logs.append(text)
        logs = logs[-200:]
        _update({"terminal_logs": logs})

    try:
        _append_log(f"[INFO] Starting training for {architecture} on requested device={params.get('device')}.")
        hw = _ensure_hardware_status_ready()
        selected_device = str(params.get("device") or "cpu").lower()
        if selected_device == "gpu":
            if not hw.get("gpu_available"):
                raise RuntimeError("Couldn't find GPU on the system.")
            device_arg = "cuda:0"
        elif selected_device == "mps":
            device_arg = "mps" if hw.get("mps_available") else "cpu"
        else:
            device_arg = "cpu"
        _append_log(f"[INFO] Resolved runtime device: {device_arg}")
        
        if arch_info.get("family") == "dinov3":
            _append_log("[INFO] Launching DINOv3 training engine.")
            train_dinov3(
                job_id, project_id, version_id, architecture, arch_info, params, conf,
                _update, output_dir, device_arg, _register_model
            )
        elif arch_info.get("family") == "resnet":
            _append_log("[INFO] Launching ResNet training engine.")
            train_resnet(job_id, project_id, version_id, architecture, arch_info, params, conf, _update, output_dir, device_arg, ROOT_DIR, _get_db, _format_duration, _register_model)
        elif arch_info.get("task") == "classify":
            _append_log("[INFO] Launching Classification training engine.")
            train_pytorch(job_id, project_id, version_id, architecture, arch_info, params, conf, _update, output_dir, device_arg, ROOT_DIR, _get_db, _format_duration, _register_model)
        elif arch_info.get("family") == "yolov8":
            _append_log("[INFO] Launching YOLOv8 training engine.")
            train_yolo(
                job_id, project_id, version_id, architecture, arch_info, params, conf,
                _update, output_dir, device_arg, ROOT_DIR, _register_model
            )
        else:
            raise RuntimeError(f"Unsupported architecture family: {arch_info.get('family')}")
        _append_log("[INFO] Training finished.")

    except Exception as e:
        _append_log(f"[ERROR] {e}")
        _update({"status": "Failed", "error": str(e)})

def _register_model(job_id, project_id, version_id, architecture, arch_info, metrics, weights_path, output_dir, runtime_artifacts=None):
    try:
        db = _get_db()
        version = db.versions.find_one({"version_id": version_id}) or {}
        model_doc = {
            "model_id": uuid.uuid4().hex, "name": f"{arch_info['label']} - {version.get('display_id', version_id[:8])}",
            "project_id": project_id, "version_id": version_id, "architecture": architecture,
            "architecture_label": arch_info["label"], "metrics": metrics, "weights_path": str(weights_path),
            "runtime_artifacts": runtime_artifacts or {"pt": str(weights_path)},
            "source_job_id": job_id, "status": "Completed", "deployment_status": "ready",
            "created_at": _utc_now(),
        }
        db.models.insert_one(model_doc)
    except Exception as e:
        print(f"[TRAIN] Model registration failed: {e}")

@app.route("/api/projects/<project_id>/jobs/<job_id>", methods=["GET"])
def get_job(project_id, job_id):
    db = _get_db()
    job = db.training_jobs.find_one({"job_id": job_id, "project_id": project_id})
    return jsonify(_serialize(job)) if job else (jsonify({"error": "Job not found"}), 404)

@app.route("/api/projects/<project_id>/jobs/<job_id>", methods=["DELETE"])
def delete_job(project_id, job_id):
    db = _get_db()
    job = db.training_jobs.find_one({"job_id": job_id, "project_id": project_id})
    if not job:
        return jsonify({"error": "Job not found"}), 404

    linked_models = list(db.models.find({"project_id": str(project_id), "source_job_id": job_id}))
    deleted_model_ids = []
    for model_doc in linked_models:
        deleted_model_ids.append(str(model_doc.get("model_id")))
        _delete_model_cascade(db, model_doc)

    output_dir = str(job.get("output_dir") or "").strip()
    if not output_dir:
        output_dir = str((ROOT_DIR / "storage" / "training" / job_id).resolve())
    run_dir = Path(output_dir)
    if run_dir.exists() and run_dir.is_dir():
        shutil.rmtree(run_dir, ignore_errors=True)

    db.training_jobs.delete_one({"_id": job["_id"]})
    return jsonify({"ok": True, "deleted_job_id": job_id, "deleted_models": deleted_model_ids})

@app.route("/api/projects/<project_id>/jobs/<job_id>/download-run", methods=["GET"])
def download_training_run(project_id, job_id):
    db = _get_db()
    job = db.training_jobs.find_one({"job_id": job_id, "project_id": project_id})
    if not job:
        return jsonify({"error": "Job not found"}), 404

    output_dir = str(job.get("output_dir") or "").strip()
    if not output_dir:
        output_dir = str((ROOT_DIR / "storage" / "training" / job_id).resolve())
    run_dir = Path(output_dir)
    if not run_dir.exists() or not run_dir.is_dir():
        return jsonify({"error": "Training run folder not found"}), 404

    tmp_root = tempfile.mkdtemp(prefix=f"vf_run_{job_id[:8]}_")
    archive_base = Path(tmp_root) / f"visionflow_train_run_{job_id[:8]}"
    archive_file = shutil.make_archive(str(archive_base), "zip", root_dir=str(run_dir))
    return send_file(archive_file, as_attachment=True, download_name=f"visionflow_train_run_{job_id[:8]}.zip")

@app.route("/api/projects/<project_id>/jobs/<job_id>/graphs/<graph_name>", methods=["GET"])
def get_training_graph(project_id, job_id, graph_name):
    db = _get_db()
    job = db.training_jobs.find_one({"job_id": job_id, "project_id": project_id})
    if not job:
        return jsonify({"error": "Job not found"}), 404

    output_dir = str(job.get("output_dir") or "").strip()
    if not output_dir:
        output_dir = str((ROOT_DIR / "storage" / "training" / job_id).resolve())
    run_dir = Path(output_dir)
    safe_name = Path(str(graph_name)).name
    if safe_name != graph_name:
        return jsonify({"error": "Invalid graph name"}), 400

    candidates = [
        run_dir / "yolo_run" / safe_name,
        run_dir / safe_name,
    ]
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return send_file(str(candidate))
    return jsonify({"error": "Graph not found"}), 404

if __name__ == "__main__":
    port = int(os.getenv("PORT_TRAINING_SERVICE", 5005))
    app.run(host="0.0.0.0", port=port, threaded=True)

