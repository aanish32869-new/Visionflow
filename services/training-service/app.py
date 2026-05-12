\"\"\"
VisionFlow Training Service — Port 5005
Manages training jobs, model registry, and local/server training dispatch.
Config is read from visionflow.conf at startup and on each request.
\"\"\"
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
    \"\"\"Populate os.environ from visionflow.conf for global settings like ports.\"\"\"
    if not CONF_PATH.exists():
        print(f\"[WARN] Config not found at {CONF_PATH}\")
        return
    parser = configparser.ConfigParser()
    parser.read(str(CONF_PATH))
    if \"visionflow\" in parser:
        for key, value in parser[\"visionflow\"].items():
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
    if \"visionflow\" in parser:
        cfg.update(dict(parser[\"visionflow\"]))
    if \"TRAINING\" in parser:
        cfg.update({f\"training_{k}\": v for k, v in parser[\"TRAINING\"].items()})
    if \"LOCAL\" in parser:
        cfg.update({f\"local_{k}\": v for k, v in parser[\"LOCAL\"].items()})
    if \"SERVER\" in parser:
        cfg.update({f\"server_{k}\": v for k, v in parser[\"SERVER\"].items()})
    if \"MODEL\" in parser:
        cfg.update({f\"model_{k}\": v for k, v in parser[\"MODEL\"].items()})
    if \"PATHS\" in parser:
        cfg.update({f\"paths_{k}\": v for k, v in parser[\"PATHS\"].items()})
    return cfg

def _get_db():
    conf = _load_conf()
    mongo_uri = conf.get(\"mongo_uri\", \"mongodb://localhost:27017/\")
    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=3000)
    return client[\"visionflow\"]

def _utc_now():
    return datetime.now(timezone.utc).isoformat()

def _serialize(doc):
    \"\"\"Convert MongoDB doc to JSON-serialisable dict.\"\"\"
    if doc is None:
        return None
    doc = dict(doc)
    doc[\"id\"] = str(doc.pop(\"_id\", \"\"))
    for k, v in doc.items():
        if hasattr(v, \"isoformat\"):
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
    \"dinov3_small\": {\"label\": \"DINOv3 Small\", \"weights\": \"vit_b_16.pt\", \"task\": \"classify\", \"family\": \"dinov3\", \"size\": \"small\"},
    \"dinov3_base\": {\"label\": \"DINOv3 Base\", \"weights\": \"vit_b_16.pt\", \"task\": \"classify\", \"family\": \"dinov3\", \"size\": \"base\"},
    \"dinov3_large\": {\"label\": \"DINOv3 Large\", \"weights\": \"vit_l_16.pt\", \"task\": \"classify\", \"family\": \"dinov3\", \"size\": \"large\"},
    \"vit_tiny\": {\"label\": \"ViT Tiny\", \"weights\": \"vit_b_16.pt\", \"task\": \"classify\", \"family\": \"vit\", \"size\": \"tiny\"},
    \"vit_base\": {\"label\": \"ViT Base\", \"weights\": \"vit_b_16.pt\", \"task\": \"classify\", \"family\": \"vit\", \"size\": \"base\"},
    \"vit_large\": {\"label\": \"ViT Large\", \"weights\": \"vit_l_16.pt\", \"task\": \"classify\", \"family\": \"vit\", \"size\": \"large\"},
    \"resnet_resnet18\": {\"label\": \"ResNet18\", \"weights\": \"resnet18.pt\", \"task\": \"classify\", \"family\": \"resnet\", \"size\": \"resnet18\"},
    \"resnet_resnet34\": {\"label\": \"ResNet34\", \"weights\": \"resnet34.pt\", \"task\": \"classify\", \"family\": \"resnet\", \"size\": \"resnet34\"},
    \"resnet_resnet50\": {\"label\": \"ResNet50\", \"weights\": \"resnet50.pt\", \"task\": \"classify\", \"family\": \"resnet\", \"size\": \"resnet50\"},
    \"yolov8_nano\": {\"label\": \"YOLOv8 Nano\", \"weights\": \"yolov8n.pt\", \"task\": \"detect\", \"family\": \"yolov8\", \"size\": \"nano\"},
    \"yolov8_small\": {\"label\": \"YOLOv8 Small\", \"weights\": \"yolov8s.pt\", \"task\": \"detect\", \"family\": \"yolov8\", \"size\": \"small\"},
    \"yolov8_medium\": {\"label\": \"YOLOv8 Medium\", \"weights\": \"yolov8m.pt\", \"task\": \"detect\", \"family\": \"yolov8\", \"size\": \"medium\"},
}

ARCH_TRAINING_PROFILES = {
    \"dinov3_small\": {\"family\": \"foundation\", \"speed\": \"fast\", \"memory\": \"medium\", \"default_precision\": \"fp16\"},
    \"dinov3_base\": {\"family\": \"foundation\", \"speed\": \"medium\", \"memory\": \"high\", \"default_precision\": \"fp16\"},
    \"dinov3_large\": {\"family\": \"foundation\", \"speed\": \"slow\", \"memory\": \"high\", \"default_precision\": \"fp16\"},
    \"vit_tiny\": {\"family\": \"classification\", \"speed\": \"medium\", \"memory\": \"medium\", \"default_precision\": \"fp16\"},
    \"vit_base\": {\"family\": \"classification\", \"speed\": \"slow\", \"memory\": \"high\", \"default_precision\": \"fp16\"},
    \"vit_large\": {\"family\": \"classification\", \"speed\": \"slow\", \"memory\": \"high\", \"default_precision\": \"fp16\"},
    \"resnet_resnet18\": {\"family\": \"classification\", \"speed\": \"fast\", \"memory\": \"low\", \"default_precision\": \"fp32\"},
    \"resnet_resnet34\": {\"family\": \"classification\", \"speed\": \"fast\", \"memory\": \"medium\", \"default_precision\": \"fp32\"},
    \"resnet_resnet50\": {\"family\": \"classification\", \"speed\": \"medium\", \"memory\": \"medium\", \"default_precision\": \"fp32\"},
    \"yolov8_nano\": {\"family\": \"detection\", \"speed\": \"very_fast\", \"memory\": \"low\", \"default_precision\": \"fp16\"},
    \"yolov8_small\": {\"family\": \"detection\", \"speed\": \"fast\", \"memory\": \"medium\", \"default_precision\": \"fp16\"},
    \"yolov8_medium\": {\"family\": \"detection\", \"speed\": \"medium\", \"memory\": \"high\", \"default_precision\": \"fp16\"},
}


def _resolve_architecture_variant(architecture, model_size):
    family = str(architecture or \"\").strip().lower()
    size = str(model_size or \"\").strip().lower()
    defaults = {\"dinov3\": \"base\", \"vit\": \"base\", \"resnet\": \"resnet18\", \"yolov8\": \"nano\"}
    allowed = {
        \"dinov3\": {\"small\", \"base\", \"large\"},
        \"vit\": {\"tiny\", \"base\", \"large\"},
        \"resnet\": {\"resnet18\", \"resnet34\", \"resnet50\"},
        \"yolov8\": {\"nano\", \"small\", \"medium\"},
    }
    if family not in allowed:
        raise ValueError(\"architecture must be one of: dinov3, vit, resnet, yolov8\")
    if size == \"\":
        size = defaults[family]
    if size not in allowed[family]:
        raise ValueError(f\"Invalid model_size '{size}' for architecture '{family}'\")
    variant = f\"{family}_{size}\"
    if variant not in ARCH_MAP:
        raise ValueError(f\"Unsupported architecture variant: {variant}\")
    return variant

# ── Hardware Cache ────────────────────────────────────────────────────────────
_hardware_cache = {
    \"gpu_available\": False, 
    \"mps_available\": False,
    \"gpu_name\": \"Detecting...\", 
    \"torch_version\": \"Detecting...\", 
    \"cuda_version\": None,
    \"initialized\": False
}

def _bg_hardware_detection():
    \"\"\"Heavy hardware detection in a background thread.\"\"\"
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
            \"gpu_available\": gpu_available,
            \"mps_available\": mps_available,
            \"gpu_name\": gpu_name or (\"Apple Silicon\" if mps_available else None),
            \"torch_version\": torch.__version__,
            \"cuda_version\": torch.version.cuda if gpu_available else None,
            \"initialized\": True
        })
    except Exception as e:
        _hardware_cache.update({
            \"gpu_available\": False,
            \"mps_available\": False,
            \"gpu_name\": None,
            \"torch_version\": \"Error\",
            \"initialized\": True
        })

# Start detection thread immediately
threading.Thread(target=_bg_hardware_detection, daemon=True).start()

def _get_hardware_status():
    \"\"\"Return cached hardware details.\"\"\"
    return _hardware_cache

def _resolve_version_dir(version_id: str, conf: dict):
    dataset_dir = ROOT_DIR / conf.get(\"local_dataset_dir\", conf.get(\"dataset_dir\", \"storage/datasets\"))
    version_dir = dataset_dir / version_id
    if version_dir.exists():
        return version_dir, version_id
    matching = [d for d in dataset_dir.iterdir() if d.is_dir() and d.name.startswith(version_id)] if dataset_dir.exists() else []
    if matching:
        return matching[0], matching[0].name
    return version_dir, version_id

def _collect_train_class_counts(version_dir: Path):
    counts = {}
    labels_dir = version_dir / \"train\" / \"labels\"
    if not labels_dir.exists():
        return counts
    for label_file in labels_dir.glob(\"*.txt\"):
        try:
            for line in label_file.read_text(encoding=\"utf-8\", errors=\"replace\").splitlines():
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
    project = db.projects.find_one({\"_id\": to_object_id(project_id)}) or db.projects.find_one({\"id\": project_id}) or {}
    version = db.versions.find_one({\"version_id\": version_id}) or {}

    project_type = str(project.get(\"project_type\") or \"Object Detection\")
    task = str(ARCH_MAP.get(architecture, {}).get(\"task\", \"detect\"))
    split_counts = version.get(\"split_counts\") or {}
    train_count = int(split_counts.get(\"train\", 0) or 0)
    valid_count = int(split_counts.get(\"valid\", 0) or 0)
    test_count = int(split_counts.get(\"test\", 0) or 0)
    classes = version.get(\"classes\") or []

    issues = []
    warnings = []
    minimums = {}

    if task == \"detect\" and project_type != \"Object Detection\":
        issues.append(\"Detection architectures require project type 'Object Detection'.\")
    if task == \"classify\" and project_type != \"Classification\":
        issues.append(\"Classification/foundation architectures require project type 'Classification'.\")

    if version.get(\"status\") not in [None, \"Ready\", \"Completed\"]:
        issues.append(f\"Selected version status is '{version.get('status')}'. Use a ready/completed version.\")

    if task == \"detect\":
        minimums = {\"train_images_min\": 1, \"valid_images_min\": 1}
        if train_count < 1:
            issues.append(\"Detection training requires at least 1 train image.\")
        if valid_count < 1:
            issues.append(\"Detection training requires at least 1 validation image.\")
    else:
        minimums = {\"train_images_min\": 4, \"valid_images_min\": 1, \"classes_min\": 2, \"min_labels_per_class\": 2}
        if train_count < 4:
            issues.append(\"Classification training requires at least 4 train images.\")
        if valid_count < 1:
            issues.append(\"Classification training requires at least 1 validation image.\")
        if len(classes) < 2:
            issues.append(\"Classification training requires at least 2 classes.\")

        version_dir, _ = _resolve_version_dir(version_id, conf)
        class_counts = _collect_train_class_counts(version_dir)
        if len(class_counts.keys()) < 2:
            issues.append(\"Training labels must include at least 2 classes in train split.\")
        else:
            low = [cid for cid, c in class_counts.items() if c < 2]
            if low:
                issues.append(\"Each class should have at least 2 train labels for stable classification training.\")
            if any(c < 5 for c in class_counts.values()):
                warnings.append(\"Very small per-class sample counts may produce unstable metrics.\")

    return {
        \"ok\": len(issues) == 0,
        \"project_type\": project_type,
        \"task\": task,
        \"architecture\": architecture,
        \"version_id\": version_id,
        \"split_counts\": {\"train\": train_count, \"valid\": valid_count, \"test\": test_count},
        \"classes_count\": len(classes),
        \"minimums\": minimums,
        \"issues\": issues,
        \"warnings\": warnings,
    }

def _calculate_auto_params(project_id, version_id, architecture):
    db = _get_db()
    version = db.versions.find_one({\"version_id\": version_id}) or {}
    hw = _get_hardware_status()
    
    img_count = version.get(\"images_count\", 0)
    
    if img_count < 500:
        epochs = 100
    elif img_count < 2000:
        epochs = 50
    else:
        epochs = 25
        
    if hw[\"gpu_available\"]:
        batch_size = 16
    elif hw[\"mps_available\"]:
        batch_size = 8
    else:
        batch_size = 4
        
    img_size = 640
    import multiprocessing
    cpu_cores = multiprocessing.cpu_count()
    workers = min(cpu_cores, 8)
    
    device = \"cpu\"
    if hw[\"gpu_available\"]:
        device = \"gpu\"
    elif hw[\"mps_available\"]:
        device = \"mps\"
        
    return {
        \"epochs\": epochs,
        \"batch_size\": batch_size,
        \"img_size\": img_size,
        \"workers\": workers,
        \"device\": device
    }

def _format_duration(seconds):
    seconds = max(0, int(seconds))
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    if hours > 0:
        return f\"{hours}h {minutes}m {secs}s\"
    if minutes > 0:
        return f\"{minutes}m {secs}s\"
    return f\"{secs}s\"

def _estimate_training_seconds(version_doc, architecture, epochs, batch_size, workers, device):
    img_count = max(1, int(version_doc.get(\"images_count\", 1) or 1))
    classes = max(1, len(version_doc.get(\"classes\", []) or []))

    arch_factor = {
        \"resnet_resnet18\": 0.9, \"resnet_resnet34\": 1.1, \"resnet_resnet50\": 1.35,
        \"vit_tiny\": 1.5, \"vit_base\": 1.8, \"vit_large\": 2.2,
        \"dinov3_small\": 1.6, \"dinov3_base\": 1.9, \"dinov3_large\": 2.3,
    }.get(str(architecture).lower(), 1.7)

    device_key = str(device).lower()
    if device_key == \"gpu\":
        base_ips = 32.0
    elif device_key == \"mps\":
        base_ips = 18.0
    else:
        base_ips = 8.0

    worker_boost = min(1.35, 0.8 + (max(1, int(workers)) * 0.07))
    effective_ips = max(1.0, (base_ips * worker_boost) / max(0.5, arch_factor))
    class_factor = 1.0 + min(0.35, classes / 200.0)

    total_images_processed = img_count * max(1, int(epochs))
    seconds = int((total_images_processed / max(1.0, (effective_ips * max(1, int(batch_size)) / 8.0))) * class_factor)
    return max(20, seconds)

def _resolve_requested_device(requested_device: str, hw: dict):
    req = str(requested_device or \"\").lower()
    if req in [\"auto\", \"\"]:
        if hw.get(\"gpu_available\"): return \"gpu\", None
        if hw.get(\"mps_available\"): return \"mps\", None
        return \"cpu\", None
    if req == \"gpu\" and not hw.get(\"gpu_available\"):
        return \"cpu\", \"GPU requested but not available. Falling back to CPU.\"
    if req == \"mps\" and not hw.get(\"mps_available\"):
        return \"cpu\", \"MPS requested but not available. Falling back to CPU.\"
    return req, None

def _build_training_plan(version_doc, architecture, resolved_params, hw):
    profile = ARCH_TRAINING_PROFILES.get(str(architecture).lower(), {
        \"family\": \"unknown\", \"speed\": \"medium\", \"memory\": \"medium\", \"default_precision\": \"fp32\"
    })
    device = str(resolved_params.get(\"device\", \"cpu\")).lower()
    use_amp = profile[\"default_precision\"] == \"fp16\" and device in [\"gpu\", \"mps\"]
    grad_accum_steps = 1
    if device == \"cpu\" and int(resolved_params.get(\"batch_size\", 1)) <= 2:
        grad_accum_steps = 2

    return {
        \"dataset_snapshot\": {
            \"version_id\": version_doc.get(\"version_id\"),
            \"name\": version_doc.get(\"name\"),
            \"images_count\": int(version_doc.get(\"images_count\", 0) or 0),
            \"classes_count\": len(version_doc.get(\"classes\", []) or []),
        },
        \"architecture_profile\": profile,
        \"runtime\": {
            \"execution_mode\": \"local\",
            \"device\": device,
            \"gpu_name\": hw.get(\"gpu_name\"),
        },
        \"resolved_params\": resolved_params
    }

# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route(\"/api/training/health\")
def health():
    return jsonify({\"status\": \"ok\", \"service\": \"training-service\", \"hardware\": _get_hardware_status()})

@app.route(\"/api/projects/<project_id>/jobs\", methods=[\"GET\"])
def list_jobs(project_id):
    db = _get_db()
    jobs = list(db.training_jobs.find({\"project_id\": project_id}).sort(\"created_at\", -1))
    return jsonify([_serialize(j) for j in jobs])

@app.route(\"/api/projects/<project_id>/train/precheck\", methods=[\"POST\"])
def train_precheck(project_id):
    data = request.json or {}
    version_id = data.get(\"version_id\") or data.get(\"dataset_version\")
    architecture = data.get(\"architecture\", \"resnet\")
    model_size = data.get(\"model_size\")
    conf = _load_conf()
    try:
        arch_variant = _resolve_architecture_variant(architecture, model_size)
        return jsonify(_get_training_precheck(project_id, version_id, arch_variant, conf))
    except Exception as e:
        return jsonify({\"ok\": False, \"issues\": [str(e)]}), 400

@app.route(\"/api/projects/<project_id>/train\", methods=[\"POST\"])
def start_training(project_id):
    data = request.json or {}
    return _dispatch_training(project_id, data)

def _dispatch_training(project_id, data):
    conf = _load_conf()
    version_id = data.get(\"version_id\") or data.get(\"dataset_version\")
    architecture = data.get(\"architecture\") or data.get(\"model\") or \"resnet\"
    model_size = data.get(\"model_size\")
    params = data.get(\"params\", {})
    
    try:
        architecture = _resolve_architecture_variant(architecture, model_size)
    except ValueError as e:
        return jsonify({\"error\": str(e)}), 400

    precheck = _get_training_precheck(project_id, version_id, architecture, conf)
    if not precheck.get(\"ok\"):
        return jsonify({\"error\": \"Training precheck failed\", \"precheck\": precheck}), 400

    auto_params = _calculate_auto_params(project_id, version_id, architecture)
    def _resolve(val, key):
        return auto_params[key] if (val is None or str(val).lower() == \"auto\") else val

    epochs = int(_resolve(params.get(\"epochs\"), \"epochs\"))
    batch_size = int(_resolve(params.get(\"batch_size\"), \"batch_size\"))
    img_size = int(_resolve(params.get(\"img_size\"), \"img_size\"))
    workers = int(_resolve(params.get(\"workers\"), \"workers\"))
    hw = _get_hardware_status()
    device, device_warning = _resolve_requested_device(_resolve(params.get(\"device\"), \"device\"), hw)

    job_id = uuid.uuid4().hex
    arch_info = ARCH_MAP.get(architecture, {\"label\": architecture, \"weights\": f\"{architecture}.pt\", \"task\": \"detect\"})
    output_dir = ROOT_DIR / \"storage\" / \"training\" / job_id
    output_dir.mkdir(parents=True, exist_ok=True)

    job_doc = {
        \"job_id\": job_id, \"project_id\": project_id, \"version_id\": version_id,
        \"architecture\": architecture, \"architecture_label\": arch_info[\"label\"],
        \"mode\": \"local\", \"device\": device,
        \"params\": {\"epochs\": epochs, \"batch_size\": batch_size, \"img_size\": img_size, \"workers\": workers},
        \"status\": \"Preparing\", \"progress\": 0, \"created_at\": _utc_now(), \"updated_at\": _utc_now(),
    }

    db = _get_db()
    version = db.versions.find_one({\"version_id\": version_id}) or {}
    job_doc[\"estimated_total_seconds\"] = _estimate_training_seconds(version, architecture, epochs, batch_size, workers, device)
    db.training_jobs.insert_one(job_doc)

    thread = threading.Thread(
        target=_run_training,
        args=(job_id, project_id, version_id, architecture, arch_info, job_doc[\"params\"], output_dir, conf),
        daemon=True
    )
    thread.start()
    return jsonify(_serialize(job_doc)), 202

def _run_training(job_id, project_id, version_id, architecture, arch_info, params, output_dir, conf):
    def _update(fields):
        db = _get_db()
        db.training_jobs.update_one({\"job_id\": job_id}, {\"$set\": {**fields, \"updated_at\": _utc_now()}})

    try:
        hw = _get_hardware_status()
        device_arg = \"cuda:0\" if (params.get(\"device\") == \"gpu\" and hw[\"gpu_available\"]) else (\"mps\" if hw[\"mps_available\"] else \"cpu\")
        
        if arch_info.get(\"family\") == \"dinov3\":
            train_dinov3(job_id, project_id, version_id, params, conf, _update, output_dir, device_arg)
        elif arch_info.get(\"family\") == \"resnet\":
            train_resnet(job_id, project_id, version_id, architecture, arch_info, params, conf, _update, output_dir, device_arg, ROOT_DIR, _get_db, _format_duration, _register_model)
        elif arch_info.get(\"task\") == \"classify\":
            train_pytorch(job_id, project_id, version_id, architecture, arch_info, params, conf, _update, output_dir, device_arg, ROOT_DIR, _get_db, _format_duration, _register_model)
        elif arch_info.get(\"family\") == \"yolov8\":
            train_yolo(job_id, project_id, version_id, architecture, arch_info, params, conf, _update, output_dir, device_arg, ROOT_DIR)
        else:
            raise RuntimeError(f\"Unsupported architecture family: {arch_info.get('family')}\")

    except Exception as e:
        _update({\"status\": \"Failed\", \"error\": str(e)})

def _register_model(job_id, project_id, version_id, architecture, arch_info, metrics, weights_path, output_dir):
    try:
        db = _get_db()
        version = db.versions.find_one({\"version_id\": version_id}) or {}
        model_doc = {
            \"model_id\": uuid.uuid4().hex, \"name\": f\"{arch_info['label']} — {version.get('display_id', version_id[:8])}\",
            \"project_id\": project_id, \"version_id\": version_id, \"architecture\": architecture,
            \"architecture_label\": arch_info[\"label\"], \"metrics\": metrics, \"weights_path\": str(weights_path),
            \"created_at\": _utc_now(),
        }
        db.models.insert_one(model_doc)
    except Exception as e:
        print(f\"[TRAIN] Model registration failed: {e}\")

@app.route(\"/api/projects/<project_id>/jobs/<job_id>\", methods=[\"GET\"])
def get_job(project_id, job_id):
    db = _get_db()
    job = db.training_jobs.find_one({\"job_id\": job_id, \"project_id\": project_id})
    return jsonify(_serialize(job)) if job else (jsonify({\"error\": \"Job not found\"}), 404)

if __name__ == \"__main__\":
    port = int(os.getenv(\"PORT_TRAINING_SERVICE\", 5005))
    app.run(host=\"0.0.0.0\", port=port, threaded=True)
