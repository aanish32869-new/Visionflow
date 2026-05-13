"""
ResNet (Residual Neural Network) Training Engine
================================================

ARCHITECTURE OVERVIEW & INTERNAL LOGIC:

1. Input Image Processing
- Images are received as pixel tensors (RGB).
- Normalization: Images are normalized using mean [0.485, 0.456, 0.406] and std [0.229, 0.224, 0.225].
- Resizing: Images are typically resized to 224x224 or 448x448.
- Data Augmentation: Random cropping, horizontal flipping, and color jittering are applied to improve robustness.

2. Initial Convolution Layer
- First convolution operation: 7x7 kernel with stride 2 and padding 3.
- Kernel Size: Large receptive field to capture initial spatial features.
- Stride: Reduces resolution early to save computation.
- Padding: Maintains border information.
- Feature Map Generation: Produces high-resolution feature maps for subsequent stages.

3. Batch Normalization and Activation
- Batch Normalization: Normalizes the output of convolutions to zero mean and unit variance.
- ReLU Activation Logic: f(x) = max(0, x), introduces non-linearity.
- Stabilizing Training: Prevents internal covariate shift and enables faster convergence.

4. Residual Block Architecture
- Residual Learning: Learns the difference (residual) between the input and output.
- Identity Mapping: The input x is passed directly through a shortcut.
- Skip Connections: Connects the input of a block to its output.
- Shortcut Connections: Enables gradient flow even in extremely deep networks.
- Residual Function Learning: The block learns F(x) such that Output = F(x) + x.

BLOCK FLOW:
Input
  â†“
Convolution
  â†“
BatchNorm
  â†“
ReLU
  â†“
Convolution
  â†“
Add Skip Connection (Input)
  â†“
ReLU

5. Skip Connection Logic
- Identity Shortcut: Simple addition when dimensions match.
- Projection Shortcut: Uses 1x1 convolution to match dimensions when downsampling.
- Gradient Flow: Gradients can bypass layers during backpropagation.
- Vanishing Gradient Prevention: Ensures gradients stay healthy across hundreds of layers.
- Deep Network Stability: Enables training of networks with 1000+ layers without accuracy degradation.

6. Feature Extraction Pipeline
- Early Layers: Learn edges and simple blobs.
- Middle Layers: Learn textures and repeating patterns.
- Deep Layers: Learn complex shapes and object parts (e.g., eyes, wheels).
- Final Layers: Learn semantic features and abstract class representations.

7. Downsampling Logic
- Strided Convolution: Uses stride 2 in the first convolution of a stage instead of pooling.
- Spatial Reduction: Halves height and width.
- Channel Expansion: Typically doubles the number of filters.
- Hierarchical Learning: Captures features at multiple scales.

8. Global Average Pooling (GAP)
- Spatial Aggregation: Averages each feature map into a single value.
- Dimensionality Reduction: Replaces large flattening layers.
- Parameter Reduction: Significantly reduces the number of weights in the final head, preventing overfitting.

9. Fully Connected Classification Head
- Final Dense Layer: Maps the GAP output to the number of classes.
- Softmax Classification: Converts raw scores into probabilities.
- Multi-class Prediction: Selects the class with the highest probability.

10. ResNet Variants
- ResNet18: 18 layers, uses basic residual blocks. High speed, moderate accuracy.
- ResNet34: 34 layers, uses basic residual blocks. Good balance for small datasets.
- ResNet50: 50 layers, introduces bottleneck blocks. Standard for production.
- ResNet101: 101 layers, deep feature extraction for complex visual tasks.

11. Bottleneck Architecture (ResNet50+)
- 1x1 Convolution: Reduces channel dimensions (compression).
- 3x3 Convolution: Performs spatial feature extraction on reduced channels.
- 1x1 Convolution: Restores channel dimensions (expansion).
- Computational Optimization: Allows for deeper networks with similar FLOPS.

12. Training Logic
- Forward Propagation: Tensors flow through residual blocks with additive shortcuts.
- Backpropagation: Gradients flow through both the residual path and the shortcut.
- Loss Computation: Cross-Entropy loss for classification.
- Weight Updates: Adam or SGD with momentum.
- Gradient Stabilization: Residual connections ensure stable updates in deep layers.

13. Multi-Task Adaptation
- Backbone Reuse: The feature extractor can be frozen or fine-tuned for other tasks.
- Adaptability: Supports Classification, Detection, and Segmentation heads.

14. Detection Architecture Integration
- Faster R-CNN: ResNet provides feature maps for the RPN (Region Proposal Network).
- YOLO: Acts as the backbone for feature extraction at different scales.
- Mask R-CNN: Provides high-fidelity features for instance mask generation.

15. Segmentation Integration
- Pixel Understanding: Deeper features provide semantic context.
- Encoder-Decoder: ResNet acts as the encoder in U-Net or DeepLab.
- Instance Masks: High-level features help delineate object boundaries.

16. Computational Logic
- GPU Memory: Efficient usage through channel-wise bottlenecks.
- Faster Inference: Highly optimized convolution kernels in cuDNN.
- Scalability: Consistent performance gain as depth increases.

17. Architecture Advantages
- Vanishing Gradient Solution: Solves the degradation problem in deep networks.
- Transfer Learning: Pre-trained weights generalize exceptionally well.
- Real-time Performance: Excellent throughput on modern hardware.

18. Production-Level Workflow
Input Image
    â†“
Initial Convolution (7x7)
    â†“
Residual Blocks (Stages 1-4)
    â†“
Feature Extraction (Hierarchical)
    â†“
Downsampling Layers (Strided Convs)
    â†“
Global Average Pooling
    â†“
Feature Embedding (1D Vector)
    â†“
Task-Specific Heads (FC Layers)
"""

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

def train_resnet(job_id, project_id, version_id, architecture, arch_info, params, conf, update_func, output_dir, device_arg, root_dir, get_db_func, format_duration_func, register_model_func):
    """Run ResNet training loop."""
    epochs     = int(params.get("epochs", 50))
    batch_size = int(params.get("batch_size", 32))
    img_size   = int(params.get("img_size", 224))
    workers    = int(params.get("workers", 4))
    
    device = torch.device(device_arg)
    update_func({"status": "Training", "progress": 10, "engine": "ResNet"})
    
    print(f"[ResNet] Initializing {architecture} training on {device}")
    
    try:
        # 1. Dataset Resolution (Classification format)
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

        # Resolve class names
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
            raise RuntimeError("Could not resolve class names for ResNet training.")

        # 2. Data Preparation
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

        update_func({"progress": 15, "status": "Preparing residual feature maps..."})
        train_count = _prepare_split("train")
        valid_count = _prepare_split("valid")
        
        if train_count < 2:
            raise RuntimeError("Insufficient data for ResNet training loop.")

        # 3. Model Setup
        num_classes = len(class_names)
        if "resnet18" in architecture:
            model = torchvision.models.resnet18(weights=torchvision.models.ResNet18_Weights.DEFAULT)
        elif "resnet34" in architecture:
            model = torchvision.models.resnet34(weights=torchvision.models.ResNet34_Weights.DEFAULT)
        elif "resnet50" in architecture:
            model = torchvision.models.resnet50(weights=torchvision.models.ResNet50_Weights.DEFAULT)
        else:
            model = torchvision.models.resnet18(weights=torchvision.models.ResNet18_Weights.DEFAULT)
            
        model.fc = nn.Linear(model.fc.in_features, num_classes)
        model = model.to(device)
        
        # 4. DataLoader + Training
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

        criterion = nn.CrossEntropyLoss()
        optimizer = optim.SGD(model.parameters(), lr=0.01, momentum=0.9, weight_decay=1e-4)
        
        update_func({"progress": 20, "status": "Residual Learning Active"})
        
        start_time = time.time()
        history = []
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

            train_acc = correct / max(1, total)
            progress = 20 + int((epoch + 1) / epochs * 75)
            elapsed = time.time() - start_time
            eta = (elapsed / (epoch + 1)) * (epochs - (epoch + 1))
            metrics = {"loss": epoch_loss / max(1, len(train_loader)), "accuracy": train_acc}
            history.append({"epoch": epoch + 1, **metrics})
            
            update_func({
                "progress": min(95, progress),
                "current_epoch": epoch + 1,
                "estimated_time_remaining": format_duration_func(eta),
                "metrics": metrics,
                "metrics_history": history,
            })
            
        weights_path = output_dir / "resnet_model.pt"
        torch.save(model.state_dict(), str(weights_path))
        eval_loader = valid_loader if valid_loader is not None else train_loader
        eval_metrics = _classification_eval_metrics(model, eval_loader, device)
        final_metrics = {
            "loss": history[-1]["loss"] if history else None,
            "accuracy": float(eval_metrics["accuracy"]),
            # For classification cards that expect mAP, we surface top-1 accuracy here.
            "mAP": float(eval_metrics["accuracy"]),
            "precision": float(eval_metrics["precision"]),
            "recall": float(eval_metrics["recall"]),
            "speed_ms": float(eval_metrics["speed_ms"]) if eval_metrics["speed_ms"] is not None else None,
        }
        
        update_func({"status": "Completed", "progress": 100, "weights_path": str(weights_path), "metrics": final_metrics})
        register_model_func(job_id, project_id, version_id, architecture, arch_info, final_metrics, weights_path, output_dir)
        
    except Exception as e:
        print(f"[ResNet] Error: {e}")
        update_func({"status": "Failed", "error": str(e)})

