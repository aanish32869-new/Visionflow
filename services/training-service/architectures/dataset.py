import os
from pathlib import Path
from PIL import Image
import torch
from torch.utils.data import Dataset

class YOLOClassificationDataset(Dataset):
    """
    A generic PyTorch Dataset for Classification (Single-Label or Multi-Label)
    that reads directly from YOLO format exported datasets (images/ and labels/).
    """
    def __init__(self, version_dir, split_name, num_classes, classification_type="Single-Label", transform=None):
        self.version_dir = Path(version_dir)
        self.split_name = split_name
        self.num_classes = num_classes
        self.classification_type = classification_type
        self.transform = transform
        
        self.images_dir = self.version_dir / split_name / "images"
        self.labels_dir = self.version_dir / split_name / "labels"
        
        self.samples = []
        if self.images_dir.exists() and self.labels_dir.exists():
            for img_path in self.images_dir.iterdir():
                if not img_path.is_file():
                    continue
                label_path = self.labels_dir / f"{img_path.stem}.txt"
                if not label_path.exists():
                    continue
                
                # Parse classes from label file
                try:
                    lines = label_path.read_text(encoding="utf-8", errors="replace").splitlines()
                    class_ids = set()
                    for line in lines:
                        parts = line.strip().split()
                        if parts:
                            cls_id = int(parts[0])
                            if 0 <= cls_id < self.num_classes:
                                class_ids.add(cls_id)
                    
                    if not class_ids:
                        continue
                    
                    self.samples.append({
                        "image_path": str(img_path),
                        "class_ids": list(class_ids)
                    })
                except Exception:
                    continue

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        sample = self.samples[idx]
        image = Image.open(sample["image_path"]).convert("RGB")
        
        if self.transform:
            image = self.transform(image)
            
        class_ids = sample["class_ids"]
        
        if self.classification_type == "Multi-Label":
            # Multi-hot encoded tensor for BCEWithLogitsLoss
            target = torch.zeros(self.num_classes, dtype=torch.float32)
            target[class_ids] = 1.0
        else:
            # Scalar integer tensor for CrossEntropyLoss
            target = torch.tensor(class_ids[0] if class_ids else 0, dtype=torch.long)
            
        return image, target

def evaluate_classification_metrics(model, loader, device, classification_type="Single-Label"):
    import time
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

            if classification_type == "Multi-Label":
                predicted = (torch.sigmoid(outputs) > 0.5).float()
                total += targets.numel()
                correct += predicted.eq(targets).sum().item()
                
                for t_batch, p_batch in zip(targets, predicted):
                    for cls_id in range(targets.shape[1]):
                        ti = int(t_batch[cls_id].item())
                        pi = int(p_batch[cls_id].item())
                        if ti == 1 and pi == 1:
                            tp[cls_id] = tp.get(cls_id, 0) + 1
                        elif ti == 0 and pi == 1:
                            fp[cls_id] = fp.get(cls_id, 0) + 1
                        elif ti == 1 and pi == 0:
                            fn[cls_id] = fn.get(cls_id, 0) + 1
            else:
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
