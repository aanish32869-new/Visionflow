import torch
import torch.nn as nn
import torch.optim as optim
import torchvision
import torchvision.transforms as transforms
import time
import json
from pathlib import Path

def _classification_eval_metrics(model, loader, device):
    model.eval()
    correct = 0
    total = 0
    tp = {}
    fp = {}
    fn = {}
    infer_total_seconds = 0.0
    infer_total_images = 0

    with torch.no_grad():
        for images, targets in loader:
            images, targets = images.to(device), targets.to(device)
            t0 = time.perf_counter()
            outputs = model(images)
            infer_total_seconds += (time.perf_counter() - t0)
            infer_total_images += int(targets.size(0))

            _, predicted = outputs.max(1)
            total += targets.size(0)
            correct += predicted.eq(targets).sum().item()

            for t, p in zip(targets.view(-1), predicted.view(-1)):
                ti = int(t.item())
                pi = int(p.item())
                if ti == pi:
                    tp[ti] = tp.get(ti, 0) + 1
                else:
                    fp[pi] = fp.get(pi, 0) + 1
                    fn[ti] = fn.get(ti, 0) + 1

    classes = set(tp.keys()) | set(fp.keys()) | set(fn.keys())
    if not classes:
        return {"accuracy": 0.0, "precision": 0.0, "recall": 0.0, "speed_ms": None}

    precisions = []
    recalls = []
    for c in classes:
        c_tp = tp.get(c, 0)
        c_fp = fp.get(c, 0)
        c_fn = fn.get(c, 0)
        precisions.append(c_tp / max(1, (c_tp + c_fp)))
        recalls.append(c_tp / max(1, (c_tp + c_fn)))

    speed_ms = None
    if infer_total_images > 0 and infer_total_seconds > 0:
        speed_ms = (infer_total_seconds / infer_total_images) * 1000.0

    return {
        "accuracy": (correct / max(1, total)),
        "precision": (sum(precisions) / len(precisions)),
        "recall": (sum(recalls) / len(recalls)),
        "speed_ms": speed_ms,
    }

def train_pytorch(job_id, project_id, version_id, architecture, arch_info, params, conf, update_func, output_dir, device_arg, root_dir, get_db_func, format_duration_func, register_model_func):
    """Run custom PyTorch training loop for Classification models (e.g. ViT)."""
    epochs     = int(params.get("epochs",     conf.get("local_epochs",     10)))
    batch_size = int(params.get("batch_size", conf.get("local_batch_size",  32)))
    img_size   = int(params.get("img_size",   conf.get("local_img_size",  640)))
    workers    = int(params.get("workers",    conf.get("local_workers",      4)))
    
    device = torch.device(device_arg)
    print(f"[TRAIN] Initializing ViT/Classification training on {device} | arch={architecture}")
    
    try:
        # 1) Build classification dataset from YOLO version folders.
        dataset_dir = root_dir / conf.get("local_dataset_dir", conf.get("dataset_dir", "storage/datasets"))
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
        except Exception: pass
        
        if not class_names:
            try:
                db = get_db_func()
                version_doc = db.versions.find_one({"version_id": version_id}) or {}
                class_names = version_doc.get("classes", []) or []
            except Exception: pass
        
        if not class_names:
            raise RuntimeError("Could not resolve class names for classification training.")

        cls_root = output_dir / "classification_data"
        for split in ["train", "valid", "test"]:
            (cls_root / split).mkdir(parents=True, exist_ok=True)

        def _prepare_split(split_name):
            images_dir = version_dir / split_name / "images"
            labels_dir = version_dir / split_name / "labels"
            if not images_dir.exists() or not labels_dir.exists(): return 0
            count = 0
            for img_path in images_dir.glob("*"):
                if not img_path.is_file(): continue
                label_path = labels_dir / f"{img_path.stem}.txt"
                if not label_path.exists(): continue
                try:
                    lines = label_path.read_text(encoding="utf-8", errors="replace").splitlines()
                    if not lines: continue
                    cls_id = int(lines[0].strip().split()[0])
                    cls_name = class_names[cls_id] if 0 <= cls_id < len(class_names) else f"class_{cls_id}"
                except Exception: continue
                out_dir = cls_root / split_name / cls_name
                out_dir.mkdir(parents=True, exist_ok=True)
                out_path = out_dir / img_path.name
                if not out_path.exists():
                    out_path.write_bytes(img_path.read_bytes())
                    count += 1
            return count

        train_count = _prepare_split("train")
        valid_count = _prepare_split("valid")
        
        if train_count < 2:
            raise RuntimeError("Not enough labeled training images for classification path.")

        update_func({"status": "Training", "progress": 15})

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
        valid_ds = torchvision.datasets.ImageFolder(str(cls_root / "valid"), transform=transform_eval) if valid_count > 0 else None

        train_loader = torch.utils.data.DataLoader(train_ds, batch_size=max(1, int(batch_size)), shuffle=True, num_workers=0)
        valid_loader = torch.utils.data.DataLoader(valid_ds, batch_size=max(1, int(batch_size)), shuffle=False) if valid_ds else None

        # 3) Model setup (ViT focused)
        num_classes = len(train_ds.classes)
        if "vit_tiny" in architecture or "vit_base" in architecture:
            model = torchvision.models.vit_b_16(weights=torchvision.models.ViT_B_16_Weights.DEFAULT)
            model.heads.head = nn.Linear(model.heads.head.in_features, num_classes)
        elif "vit_large" in architecture:
            model = torchvision.models.vit_l_16(weights=torchvision.models.ViT_L_16_Weights.DEFAULT)
            model.heads.head = nn.Linear(model.heads.head.in_features, num_classes)
        else:
            # Fallback for other classification models
            model = torchvision.models.vit_b_16(weights=torchvision.models.ViT_B_16_Weights.DEFAULT)
            model.heads.head = nn.Linear(model.heads.head.in_features, num_classes)
            
        model = model.to(device)
        criterion = nn.CrossEntropyLoss()
        optimizer = optim.Adam(model.parameters(), lr=1e-4)

        # 4) Training loop
        update_func({"status": "Training", "progress": 20})
        history = []
        start_time = time.time()

        for epoch in range(epochs):
            model.train()
            epoch_loss = 0.0
            correct = 0
            total = 0
            
            for images, targets in train_loader:
                images, targets = images.to(device), targets.to(device)
                optimizer.zero_grad()
                outputs = model(images)
                loss = criterion(outputs, targets)
                loss.backward()
                optimizer.step()
                
                epoch_loss += loss.item()
                _, predicted = outputs.max(1)
                total += targets.size(0)
                correct += predicted.eq(targets).sum().item()

            train_acc = correct / total
            
            # Progress and estimation
            progress = 20 + int((epoch + 1) / epochs * 75)
            elapsed = time.time() - start_time
            eta = (elapsed / (epoch + 1)) * (epochs - (epoch + 1))
            
            metrics = {"loss": epoch_loss/len(train_loader), "accuracy": train_acc}
            history.append({"epoch": epoch+1, **metrics})
            
            update_func({
                "progress": progress,
                "estimated_time_remaining": format_duration_func(eta),
                "metrics": metrics,
                "metrics_history": history
            })

        # 5) Save & Register
        weights_path = output_dir / "vit_model.pt"
        torch.save(model.state_dict(), str(weights_path))
        eval_loader = valid_loader if valid_loader is not None else train_loader
        eval_metrics = _classification_eval_metrics(model, eval_loader, device)
        final_metrics = {
            "loss": metrics.get("loss"),
            "accuracy": float(eval_metrics["accuracy"]),
            # For classification cards that expect mAP, we surface top-1 accuracy here.
            "mAP": float(eval_metrics["accuracy"]),
            "precision": float(eval_metrics["precision"]),
            "recall": float(eval_metrics["recall"]),
            "speed_ms": float(eval_metrics["speed_ms"]) if eval_metrics["speed_ms"] is not None else None,
        }
        register_model_func(job_id, project_id, version_id, architecture, arch_info, final_metrics, weights_path, output_dir)
        update_func({"status": "Completed", "progress": 100, "metrics": final_metrics})

    except Exception as e:
        print(f"[TRAIN] ViT loop error: {e}")
        update_func({"status": "Failed", "error": str(e)})

