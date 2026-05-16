import time
from pathlib import Path


def train_yolo(job_id, project_id, version_id, architecture, arch_info, params, conf, update_func, output_dir, device_arg, root_dir, register_model_func=None):
    """Run YOLOv8 training using ultralytics library."""
    from ultralytics import YOLO

    epochs = int(params.get("epochs", conf.get("local_epochs", 120)))
    batch_size = int(params.get("batch_size", conf.get("local_batch_size", 16)))
    img_size = int(params.get("img_size", conf.get("local_img_size", 768)))
    workers = int(params.get("workers", conf.get("local_workers", 4)))
    weights = arch_info.get("weights", "yolov8s.pt")

    export_cfg = params.get("export", {}) if isinstance(params.get("export"), dict) else {}
    export_formats = export_cfg.get("formats", ["onnx"])
    export_half = bool(export_cfg.get("half", device_arg.startswith("cuda")))
    export_int8 = bool(export_cfg.get("int8", False))
    export_batch = int(export_cfg.get("batch", max(1, batch_size)))

    # Resolve Dataset Directory
    dataset_dir = root_dir / conf.get("local_dataset_dir", conf.get("dataset_dir", "storage/datasets"))
    actual_version_dir = dataset_dir / version_id
    if not actual_version_dir.exists():
        matching = [d for d in dataset_dir.iterdir() if d.is_dir() and d.name.startswith(version_id)]
        if matching:
            actual_version_dir = matching[0]

    data_yaml = actual_version_dir / "data.yaml"
    if not data_yaml.exists():
        raise RuntimeError(f"data.yaml not found in {actual_version_dir}")

    update_func({"status": "Training", "progress": 10, "engine": "YOLOv8"})

    print(f"[TRAIN] Loading model {weights}...")
    model = YOLO(weights)

    # Custom callback to update progress in MongoDB
    def on_train_epoch_end(trainer):
        current_epoch = trainer.epoch + 1
        progress = 10 + int((current_epoch / epochs) * 85)
        box_loss = float(trainer.loss_items[0]) if hasattr(trainer, "loss_items") else 0
        cls_loss = float(trainer.loss_items[1]) if hasattr(trainer, "loss_items") and len(trainer.loss_items) > 1 else 0
        previous_logs = []
        if isinstance(getattr(trainer, "visionflow_logs", None), list):
            previous_logs = list(trainer.visionflow_logs)
        previous_logs.append(f"[EPOCH {current_epoch}/{epochs}] box_loss={box_loss:.4f} cls_loss={cls_loss:.4f}")
        trainer.visionflow_logs = previous_logs[-200:]
        update_func(
            {
                "progress": min(95, progress),
                "current_epoch": current_epoch,
                "metrics": {
                    "box_loss": box_loss,
                    "cls_loss": cls_loss,
                },
                "terminal_logs": trainer.visionflow_logs,
            }
        )

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
        verbose=True,
    )

    yolo_metrics = {"mAP": None, "precision": None, "recall": None, "speed_ms": None}
    try:
        if hasattr(results, "results_dict") and isinstance(results.results_dict, dict):
            rd = results.results_dict
            yolo_metrics["mAP"] = rd.get("metrics/mAP50(B)")
            yolo_metrics["precision"] = rd.get("metrics/precision(B)")
            yolo_metrics["recall"] = rd.get("metrics/recall(B)")
            if hasattr(results, "speed") and isinstance(results.speed, dict):
                yolo_metrics["speed_ms"] = results.speed.get("inference")
    except Exception:
        pass

    best_weights = output_dir / "yolo_run" / "weights" / "best.pt"
    last_weights = output_dir / "yolo_run" / "weights" / "last.pt"
    weights_path = best_weights if best_weights.exists() else (last_weights if last_weights.exists() else None)

    runtime_artifacts = {"pt": str(weights_path) if weights_path else None}
    if weights_path:
        for fmt in export_formats:
            normalized = str(fmt or "").strip().lower()
            if not normalized:
                continue
            try:
                exported_path = model.export(
                    format=normalized,
                    imgsz=img_size,
                    half=export_half,
                    int8=export_int8,
                    batch=export_batch,
                    device=device_arg,
                    simplify=True,
                )
                if exported_path:
                    runtime_artifacts[normalized] = str(Path(exported_path).resolve())
            except Exception as exc:
                print(f"[TRAIN] Export '{normalized}' skipped: {exc}")

    if register_model_func and weights_path:
        register_model_func(
            job_id,
            project_id,
            version_id,
            architecture,
            arch_info,
            yolo_metrics,
            weights_path,
            output_dir,
            runtime_artifacts=runtime_artifacts,
        )

    print("[TRAIN] YOLOv8 training completed.")
    update_func(
        {
            "status": "Completed",
            "progress": 100,
            "weights_path": str(weights_path) if weights_path else None,
            "metrics": yolo_metrics,
            "runtime_artifacts": runtime_artifacts,
        }
    )
