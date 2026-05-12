import time
from pathlib import Path

def train_yolo(job_id, project_id, version_id, architecture, arch_info, params, conf, update_func, output_dir, device_arg, root_dir):
    \"\"\"Run YOLOv8 training using ultralytics library.\"\"\"
    from ultralytics import YOLO
    
    epochs     = int(params.get(\"epochs\",     conf.get(\"local_epochs\",     25)))
    batch_size = int(params.get(\"batch_size\", conf.get(\"local_batch_size\",  8)))
    img_size   = int(params.get(\"img_size\",   conf.get(\"local_img_size\",  640)))
    workers    = int(params.get(\"workers\",    conf.get(\"local_workers\",     4)))
    weights    = arch_info.get(\"weights\", \"yolov8n.pt\")
    
    # Resolve Dataset Directory
    dataset_dir = root_dir / conf.get(\"local_dataset_dir\", conf.get(\"dataset_dir\", \"storage/datasets\"))
    actual_version_dir = dataset_dir / version_id
    if not actual_version_dir.exists():
        matching = [d for d in dataset_dir.iterdir() if d.is_dir() and d.name.startswith(version_id)]
        if matching:
            actual_version_dir = matching[0]
    
    data_yaml = actual_version_dir / \"data.yaml\"
    if not data_yaml.exists():
        raise RuntimeError(f\"data.yaml not found in {actual_version_dir}\")

    update_func({\"status\": \"Training\", \"progress\": 10, \"engine\": \"YOLOv8\"})
    
    print(f\"[TRAIN] Loading model {weights}...\")
    model = YOLO(weights)
    
    # Custom callback to update progress in MongoDB
    def on_train_epoch_end(trainer):
        current_epoch = trainer.epoch + 1
        progress = 10 + int((current_epoch / epochs) * 85)
        update_func({
            \"progress\": min(95, progress),
            \"current_epoch\": current_epoch,
            \"metrics\": {
                \"box_loss\": float(trainer.loss_items[0]) if hasattr(trainer, 'loss_items') else 0,
                \"cls_loss\": float(trainer.loss_items[1]) if hasattr(trainer, 'loss_items') and len(trainer.loss_items) > 1 else 0
            }
        })

    model.add_callback(\"on_train_epoch_end\", on_train_epoch_end)

    print(f\"[TRAIN] Starting YOLOv8 training on {device_arg}...\")
    model.train(
        data=str(data_yaml.resolve()),
        epochs=epochs,
        imgsz=img_size,
        batch=batch_size,
        workers=workers,
        device=device_arg,
        project=str(output_dir.resolve()),
        name=\"yolo_run\",
        exist_ok=True,
        verbose=True
    )
    
    print(f\"[TRAIN] YOLOv8 training completed.\")
    update_func({\"status\": \"Completed\", \"progress\": 100})
