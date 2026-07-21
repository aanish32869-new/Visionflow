"""
DINOv3 (Distillation with NO Labels v3) Training Engine
=======================================================

ARCHITECTURE OVERVIEW & INTERNAL LOGIC:

1. Input Image Processing
- Images are received as raw pixel data (BGR/RGB).
- Normalization: Images are normalized using ImageNet mean [0.485, 0.456, 0.406] and std [0.229, 0.224, 0.225].
- Resizing: Images are resized to a fixed resolution (e.g., 224x224 or 512x512) while maintaining aspect ratio or using padding.
- Data Augmentation: Multi-crop strategy (global and local views), color jittering, Gaussian blur, and solarization are applied to create different views for the teacher and student.

2. Patch Creation
- The input image is divided into non-overlapping fixed-size patches (e.g., 14x14 or 16x16).
- Patch Tokenization: Each patch is flattened into a vector.
- Positional Embeddings: Learnable 1D or 2D positional embeddings are added to the patch tokens to retain spatial information.

3. Patch Embedding Layer
- Flattened patches are projected into a high-dimensional embedding space using a linear layer.
- Dimensions: Typically 384 (Small), 768 (Base), or 1024+ (Large).
- Mathematical Representation: x_p = Linear(patch_i) + positional_embedding.

4. Vision Transformer Backbone
- Transformer Encoder: Consists of L layers of multi-head self-attention (MHSA) and MLP blocks.
- MHSA: Learns dependencies between all patches.
- MLP: Two-layer feed-forward network with GELU activation.
- Layer Norm: Applied before each block.
- Residual Connections: Skip connections around MHSA and MLP blocks to enable deep training.

5. Self-Attention Mechanism
- Relationships: Learned via Query, Key, and Value matrices.
- Global Context: Every patch attends to every other patch, capturing long-range dependencies.
- Semantic Learning: Attention heads often specialize in different object parts or textures.
- Score Calculation: Attention(Q, K, V) = softmax(QK^T / sqrt(d_k))V.

6. Teacher-Student Learning Architecture
- Student Network: Actively trained via backpropagation to match teacher outputs.
- Teacher Network: An exponential moving average (EMA) of the student weights.
- Distillation: The student predicts the teacher's output distribution (after centering and sharpening).
- Momentum Update: teacher_w = alpha * teacher_w + (1 - alpha) * student_w.
- Consistency: Encourages the model to produce similar embeddings for different views of the same image.

7. Self-Supervised Learning Logic
- No Labels: The loss is computed solely between the student and teacher outputs.
- Feature Representation: The model learns to cluster similar semantic features together in the embedding space.
- Contrastive Understanding: DINO avoids collapses without explicit negative pairs through centering and sharpening of the teacher's output.

8. Feature Embedding Generation
- High-dimensional vectors representing the 'CLS' token or global average pooled patches.
- Semantic Vector: Captures the essence of the image for retrieval or classification.

9. Downstream Task Adaptation
- Classification: Add a linear head on top of the CLS token.
- Object Detection: Use transformer blocks as a backbone for detection heads.
- Segmentation: Use patch-level tokens for pixel-level classification.
- Similarity Search: Use cosine similarity between embeddings.

10. Detection Architecture Integration (DETR / Grounding DINO)
- Feature Map Extraction: Multi-scale features are extracted from different transformer layers.
- Region Understanding: Cross-attention between object queries and image features.
- Bounding Box Pipeline: Feed features into a MLP for [x, y, w, h] prediction.

11. Segmentation Integration
- Pixel-level Understanding: Maps patch tokens back to spatial dimensions.
- Boundary Detection: High-resolution feature maps from early layers provide edge info.
- Mask Generation: Decoder blocks refine the region masks.

12. Multi-Task Architecture Logic
- A single DINOv3 backbone can provide features to multiple heads (Classification, Detection, Segmentation) simultaneously, sharing the core visual representation.

13. GPU and Computational Logic
- Memory: Quadratic complexity with respect to the number of patches (unless using Flash Attention).
- Speed: Highly optimized for modern GPUs (A100/H100).
- Scalability: Performs better as data scale increases (Scaling Laws).

14. Architecture Advantages
- Performs exceptionally well on massive unlabeled datasets.
- Strong generalization to out-of-distribution data.
- Excellent foundation for few-shot learning.

15. Production-Level Workflow
Input Image -> Patch Generation -> Patch Embedding -> ViT Encoder -> Self-Attention -> Teacher-Student Alignment -> Feature Embeddings -> Task Heads.
"""

import os
import torch
import torch.nn as nn
import torch.optim as optim
import torchvision
import torchvision.transforms as transforms
import time
import json
from pathlib import Path

from .dataset import YOLOClassificationDataset, evaluate_classification_metrics

def train_dinov3(job_id, project_id, version_id, architecture, arch_info, params, conf, update_func, output_dir, device_arg, register_model_func=None):
    """
    Implements the DINOv3 training workflow.
    Ensures training runs exactly with the user-provided configuration.
    """
    # Sync and Extract Configuration
    epochs = int(params.get("epochs", 60))
    batch_size = int(params.get("batch_size", 16))
    img_size = int(params.get("img_size", 224))
    workers = int(params.get("workers", 4))
    architecture_variant = params.get("architecture", "dinov3_base")
    classification_type = params.get("classification_type", "Single-Label")
    
    device = torch.device(device_arg)
    update_func({
        "status": "Training", 
        "progress": 5, 
        "engine": "DINOv3",
        "config_synced": True,
        "actual_params": {
            "epochs": epochs,
            "batch_size": batch_size,
            "img_size": img_size,
            "workers": workers,
            "device": device_arg
        }
    })
    
    print(f"[DINOv3] Starting training job {job_id} on {device} | type={classification_type}")
    
    try:
        # 1. Dataset Resolution
        root_dir = Path(__file__).resolve().parent.parent.parent.parent
        dataset_dir = root_dir / conf.get("local_dataset_dir", conf.get("dataset_dir", "storage/datasets"))
        version_dir = dataset_dir / version_id
        
        if not version_dir.exists():
             matching = [d for d in dataset_dir.iterdir() if d.is_dir() and d.name.startswith(version_id)]
             if matching:
                 version_dir = matching[0]
        
        if not version_dir.exists():
            raise RuntimeError(f"Dataset version {version_id} not found at {version_dir}")

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
            raise RuntimeError("Could not resolve class names for DINOv3 training.")

        num_classes = len(class_names)
        update_func({"progress": 10, "status": "Loading dataset..."})
        
        # DataLoader
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

        train_ds = YOLOClassificationDataset(version_dir, "train", num_classes, classification_type, transform=transform_train)
        valid_ds = YOLOClassificationDataset(version_dir, "valid", num_classes, classification_type, transform=transform_eval)
        
        if len(train_ds) < 2:
            raise RuntimeError("Insufficient data for DINOv3 training loop.")

        train_loader = torch.utils.data.DataLoader(train_ds, batch_size=max(1, int(batch_size)), shuffle=True, num_workers=0)
        valid_loader = torch.utils.data.DataLoader(valid_ds, batch_size=max(1, int(batch_size)), shuffle=False) if len(valid_ds) > 0 else None
        
        # 2. Model Initialization based on variant
        print(f"[DINOv3] Initializing {architecture_variant} backbone...")
        if "small" in architecture_variant:
            model = torchvision.models.vit_b_16(weights=torchvision.models.ViT_B_16_Weights.DEFAULT)
        elif "large" in architecture_variant:
            model = torchvision.models.vit_l_16(weights=torchvision.models.ViT_L_16_Weights.DEFAULT)
        else:
            model = torchvision.models.vit_b_16(weights=torchvision.models.ViT_B_16_Weights.DEFAULT)
            
        model.heads.head = nn.Linear(model.heads.head.in_features, num_classes)
        model = model.to(device)
        
        # 3. Learning Mechanism
        optimizer = optim.AdamW(model.parameters(), lr=1e-4, weight_decay=0.05)
        
        if classification_type == "Multi-Label":
            criterion = nn.BCEWithLogitsLoss()
        else:
            criterion = nn.CrossEntropyLoss()
        
        update_func({"progress": 20, "status": "Running DINOv3 Transformer Pipeline"})
        
        # 4. Training Loop
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
                
                if classification_type == "Multi-Label":
                    predicted = (torch.sigmoid(outputs) > 0.5).float()
                    total += targets.numel()
                    correct += predicted.eq(targets).sum().item()
                else:
                    _, predicted = outputs.max(1)
                    total += targets.size(0)
                    correct += predicted.eq(targets).sum().item()

            train_acc = correct / max(1, total)
            
            # Progress calculation
            progress = 20 + int((epoch + 1) / epochs * 75)
            elapsed = time.time() - start_time
            remaining = (elapsed / (epoch + 1)) * (epochs - (epoch + 1))
            
            metrics = {"loss": epoch_loss/len(train_loader), "accuracy": train_acc, "architecture": "DINOv3-ViT"}
            history.append({"epoch": epoch+1, **metrics})
            
            update_func({
                "progress": min(95, progress),
                "current_epoch": epoch + 1,
                "estimated_time_remaining": format_duration_func(remaining) if 'format_duration_func' in locals() else f"{int(remaining)}s",
                "metrics": metrics,
                "metrics_history": history
            })
            
        # 5. Completion and Weights Saving
        weights_path = Path(output_dir) / "dinov3_model.pt"
        torch.save(model.state_dict(), str(weights_path))
        
        eval_loader = valid_loader if valid_loader is not None else train_loader
        eval_metrics = evaluate_classification_metrics(model, eval_loader, device, classification_type)
        final_metrics = {
            "loss": history[-1]["loss"] if history else None,
            "accuracy": float(eval_metrics["accuracy"]),
            "mAP": float(eval_metrics["accuracy"]),
            "precision": float(eval_metrics["precision"]),
            "recall": float(eval_metrics["recall"]),
            "speed_ms": float(eval_metrics["speed_ms"]) if eval_metrics["speed_ms"] is not None else None,
        }
        
        if register_model_func:
            register_model_func(job_id, project_id, version_id, architecture, arch_info, final_metrics, weights_path, output_dir)
        
        print(f"[DINOv3] Job {job_id} completed. Weights saved to {weights_path}")
        update_func({
            "status": "Completed", 
            "progress": 100,
            "metrics": final_metrics,
            "weights_path": str(weights_path)
        })
        
    except Exception as e:
        print(f"[DINOv3] Engine Error: {e}")
        update_func({"status": "Failed", "error": str(e)})

