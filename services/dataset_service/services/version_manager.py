import os
import uuid
import json
import random
import threading
import shutil
from datetime import datetime
from io import BytesIO

from pymongo import UpdateOne
from models.db import db
from utils.logger import logger
from dataset_exporter import generate_dataset_archive
from services.tag_service import TagService
from config import Config

class VersionManager:
    _active_jobs = {}

    @staticmethod
    def get_utc_now():
        return datetime.utcnow().isoformat() + "Z"

    @classmethod
    def start_generation(cls, project_id, version_id, options):
        """Starts the version generation background task."""
        thread = threading.Thread(
            target=cls._generate_task,
            args=(project_id, version_id, options)
        )
        thread.daemon = True
        thread.start()
        cls._active_jobs[version_id] = thread
        return True

    @classmethod
    def _generate_task(cls, project_id, version_id, options):
        try:
            logger.info(f"Starting version generation for version {version_id} (Project: {project_id})")
            db.versions.update_one({"version_id": version_id}, {"$set": {"status": "Processing"}})

            # 1. Snapshotting (Only include 'dataset' state assets)
            db.versions.update_one({"version_id": version_id}, {"$set": {"progress": 10}})
            snapshot_stats = cls._create_immutable_snapshot(project_id, version_id, options)
            db.versions.update_one({"version_id": version_id}, {"$set": {"progress": 40}})
            
            # 2. Analytics (Pre-computed for the version)
            analytics = cls._run_version_analytics(version_id)
            db.versions.update_one({"version_id": version_id}, {"$set": {"progress": 60}})
            
            # 3. Export Archive
            from config import Config
            archive_id, archive_stats = generate_dataset_archive(
                db, 
                project_id, 
                options.get("export_format", "yolov8"), 
                Config.UPLOAD_DIR, 
                Config.DATASET_DIR,
                {**options, "version_id": version_id} # Use versioned data
            )
            db.versions.update_one({"version_id": version_id}, {"$set": {"progress": 90}})

            # Finalize Version
            db.versions.update_one(
                {"version_id": version_id},
                {
                    "$set": {
                        "status": "Ready",
                        "progress": 100,
                        "archive_id": archive_id,
                        "images_count": snapshot_stats["total_images"],
                        "annotations_count": snapshot_stats["total_annotations"],
                        "classes": snapshot_stats["classes"],
                        "analytics": analytics,
                        "split_counts": snapshot_stats["split_counts"],
                        "download_url": f"/datasets/{archive_id}.zip",
                        "updated_at": cls.get_utc_now()
                    }
                }
            )
            logger.info(f"Version {version_id} completed. Images: {snapshot_stats['total_images']}")
        except Exception as e:
            logger.error(f"Error generating version {version_id}: {e}", exc_info=True)
            db.versions.update_one({"version_id": version_id}, {"$set": {"status": "Failed", "error": str(e)}})

    @classmethod
    def _create_immutable_snapshot(cls, project_id, version_id, options):
        """Creates a frozen copy of assets and annotations for this version."""
        tag_filter = options.get("tag_filter", {})
        require_tags = tag_filter.get("require", [])
        exclude_tags = tag_filter.get("exclude", [])
        
        # 1. Fetch live assets in 'dataset' state
        from services.tag_service import TagService
        
        # We start with the tag-filtered list
        live_assets = TagService.get_assets_by_tags(project_id, require_tags, exclude_tags)
        
        # Further filter by status 'dataset'
        live_assets = [a for a in live_assets if a.get("status") == "dataset"]
        
        if not live_assets:
            raise ValueError("No assets in 'dataset' state matched the selected filters.")

        # 2. Prepare Snapshot Containers
        snapshot_assets = []
        original_ids = []
        
        filter_null = options.get("preprocessing", {}).get("filter_null", True)
        
        for asset in live_assets:
            orig_id = str(asset["_id"])
            
            # 3. Filter Null (remove unannotated images if configured)
            if filter_null:
                ann_count = db.annotations.count_documents({"asset_id": orig_id})
                if ann_count == 0:
                    continue
            
            original_ids.append(orig_id)
            
            asset_copy = dict(asset)
            asset_copy["original_asset_id"] = orig_id
            asset_copy["version_id"] = version_id
            asset_copy["is_augmented"] = False
            if "_id" in asset_copy: del asset_copy["_id"]
            snapshot_assets.append(asset_copy)

        # 3. Fetch all annotations for these assets
        live_annotations = list(db.annotations.find({"asset_id": {"$in": original_ids}}))
        
        final_assets = []
        final_annotations = []
        classes = set()
        
        class_remap = options.get("class_remap", {})
        
        from dataset_exporter import (
            _load_asset_image, 
            _prepare_image, 
            _transform_annotation,
            _normalize_augmentation_config,
            _normalize_preprocessing
        )
        preprocessing_config = _normalize_preprocessing(options)
        augmentation_config = _normalize_augmentation_config(options)
        enabled_augmentations = augmentation_config["enabled"]
        max_version_size = augmentation_config["max_version_size"]

        # 4. Apply Preprocessing to Snapshot
        for asset_meta in snapshot_assets:
            orig_id = asset_meta["original_asset_id"]
            asset_anns = [dict(a) for a in live_annotations if str(a.get("asset_id")) == orig_id]
            
            # Apply class remapping (version-level only)
            for ann in asset_anns:
                if ann.get("label") in class_remap:
                    ann["label"] = class_remap[ann["label"]]
                classes.add(ann["label"])

            # Add Original
            final_assets.append(asset_meta)
            for ann in asset_anns:
                ann_copy = dict(ann)
                ann_copy["version_id"] = version_id
                ann_copy["asset_id"] = orig_id 
                if "_id" in ann_copy: del ann_copy["_id"]
                final_annotations.append(ann_copy)

        # 5. Split & Materialize Logic
        rebalance = options.get("rebalance", False)
        split = options.get("split", {"train": 70, "valid": 20, "test": 10})
        
        final_version_assets = []
        final_version_annotations = []
        split_counts = {"train": 0, "valid": 0, "test": 0}

        augmented_dir = os.path.join(Config.DATASET_DIR, version_id, "augmented_assets")
        if max_version_size > 1 and enabled_augmentations:
            os.makedirs(augmented_dir, exist_ok=True)

        def assign_splits(assets_to_split):
            random.shuffle(assets_to_split)
            total = len(assets_to_split)
            t_end = int(total * (split["train"] / 100))
            v_end = int(total * ((split["train"] + split["valid"]) / 100))
            
            for idx, asset in enumerate(assets_to_split):
                s_name = "train" if idx < t_end else ("valid" if idx < v_end else "test")
                asset["split"] = s_name
                split_counts[s_name] += 1
                
                final_version_assets.append(asset)
                
                # Materialize augmented copies for train split
                if s_name == "train" and max_version_size > 1 and enabled_augmentations:
                    orig_id = asset["original_asset_id"]
                    asset_anns = [a for a in final_annotations if a["asset_id"] == orig_id]
                    
                    source_image = None
                    extra = max_version_size - 1
                    for c_idx in range(extra):
                        if source_image is None:
                            source_image = _load_asset_image(db, asset, Config.UPLOAD_DIR)
                            if source_image is None:
                                break
                        
                        aug_name = enabled_augmentations[c_idx % len(enabled_augmentations)]
                        # Pass empty preprocessing so the exporter handles resize/crop uniformly later
                        processed_image, prep_meta = _prepare_image(source_image, {}, augmentation_name=aug_name, return_meta=True)
                        
                        # Save the new image
                        aug_asset_id = f"{orig_id}_aug_{c_idx}"
                        aug_filename = f"{aug_asset_id}.jpg"
                        aug_path = os.path.join(augmented_dir, aug_filename)
                        processed_image.save(aug_path)
                        
                        # Create new asset record
                        new_asset = dict(asset)
                        new_asset["original_asset_id"] = aug_asset_id
                        new_asset["parent_asset_id"] = orig_id
                        new_asset["is_augmented"] = True
                        new_asset["augmentation_type"] = aug_name
                        new_asset["path"] = aug_path
                        final_version_assets.append(new_asset)
                        split_counts[s_name] += 1
                        
                        # Transform annotations
                        for ann in asset_anns:
                            ann_copy = dict(ann)
                            if prep_meta.get("crop_box"):
                                ann_copy = _transform_annotation(ann_copy, "crop", meta=prep_meta)
                            if aug_name in ["horizontal_flip", "vertical_flip", "rotate"]:
                                ann_copy = _transform_annotation(ann_copy, aug_name)
                                
                            ann_copy["version_id"] = version_id
                            ann_copy["asset_id"] = aug_asset_id
                            if "_id" in ann_copy: del ann_copy["_id"]
                            
                            final_version_annotations.append(ann_copy)

        if rebalance:
            class_groups = {}
            for asset in snapshot_assets:
                orig_id = asset["original_asset_id"]
                asset_anns = [a for a in live_annotations if str(a.get("asset_id")) == orig_id]
                
                if asset_anns:
                    label = asset_anns[0]["label"]
                    if label not in class_groups: class_groups[label] = []
                    class_groups[label].append(asset)
                else:
                    if "unlabeled" not in class_groups: class_groups["unlabeled"] = []
                    class_groups["unlabeled"].append(asset)
            
            for label, group in class_groups.items():
                assign_splits(group)
        else:
            assign_splits(snapshot_assets)

        # Add all original annotations
        orig_ids_in_version = [a["original_asset_id"] for a in final_version_assets if not a.get("is_augmented")]
        for ann in final_annotations:
            if ann["asset_id"] in orig_ids_in_version:
                final_version_annotations.append(ann)

        # 6. Bulk Insert frozen data
        db.version_assets.insert_many(final_version_assets)
        if final_version_annotations:
            db.version_annotations.insert_many(final_version_annotations)

        return {
            "total_images": len(final_version_assets),
            "total_annotations": len(final_version_annotations),
            "classes": sorted(list(classes)),
            "split_counts": split_counts,
            "dataset_multiplier": max(1, max_version_size),
        }

    @classmethod
    def _run_version_analytics(cls, version_id):
        """Generates frozen analytics for the version."""
        annotations = list(db.version_annotations.find({"version_id": version_id}))
        
        dist = {}
        heatmap = [[0 for _ in range(20)] for _ in range(20)]
        
        for ann in annotations:
            # Distribution
            label = ann.get("label")
            dist[label] = dist.get(label, 0) + 1
            
            # Heatmap
            if "x_center" in ann and "y_center" in ann:
                x = min(int(ann["x_center"] * 20), 19)
                y = min(int(ann["y_center"] * 20), 19)
                heatmap[y][x] += 1
        
        return {
            "class_distribution": dist,
            "heatmap": heatmap,
            "generated_at": cls.get_utc_now()
        }

    @classmethod
    def rebalance_split(cls, version_id, new_split):
        """Rebalances the train/valid/test split for an existing version."""
        version = db.versions.find_one({"version_id": version_id})
        if not version:
            return False
            
        assets = list(db.version_assets.find({"version_id": version_id, "is_augmented": {"$ne": True}}))
        random.shuffle(assets)
        
        total = len(assets)
        train_end = int(total * (new_split["train"] / 100))
        valid_end = int(total * ((new_split["train"] + new_split["valid"]) / 100))
        
        split_counts = {"train": 0, "valid": 0, "test": 0}
        updates = []
        
        for i, asset in enumerate(assets):
            s_name = "train" if i < train_end else ("valid" if i < valid_end else "test")
            updates.append(UpdateOne({"_id": asset["_id"]}, {"$set": {"split": s_name}}))
            split_counts[s_name] += 1
            
            # Multiplier does not create persisted augmented rows, so no child updates.

        if updates:
            db.version_assets.bulk_write(updates)

        db.versions.update_one(
            {"version_id": version_id},
            {"$set": {"split_counts": split_counts, "options.split": new_split}}
        )
        return True

    @classmethod
    def delete_version(cls, version_id, project_id=None):
        query = {"version_id": version_id}
        if project_id is not None:
            query["project_id"] = project_id

        version_doc = db.versions.find_one(query)
        if not version_doc:
            raise ValueError("Version not found")

        archive_ids = set()
        if version_doc.get("archive_id"):
            archive_ids.add(str(version_doc["archive_id"]))

        # Also remove export jobs generated for this version.
        version_exports = list(db.exports.find({"options.version_id": version_id}))
        for export_doc in version_exports:
            if export_doc.get("archive_id"):
                archive_ids.add(str(export_doc["archive_id"]))

        # Delete zip artifacts from disk.
        for archive_id in archive_ids:
            zip_path = os.path.join(Config.DATASET_DIR, f"{archive_id}.zip")
            if os.path.exists(zip_path):
                try:
                    os.remove(zip_path)
                except Exception:
                    logger.warning(f"Failed to remove archive zip: {zip_path}")

        # Delete version-scoped data from DB.
        db.version_assets.delete_many({"version_id": version_id})
        db.version_annotations.delete_many({"version_id": version_id})
        db.exports.delete_many({"options.version_id": version_id})

        # Best-effort cleanup of training artifacts linked to this version id.
        db.models.delete_many({"version_id": version_id})
        db.training_jobs.delete_many({"version_id": version_id})

        db.versions.delete_one({"_id": version_doc["_id"]})
        return True
