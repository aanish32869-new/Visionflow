import os
import uuid
import json
import random
import threading
from datetime import datetime
from io import BytesIO

from models.db import db
from utils.logger import logger
from dataset_exporter import generate_dataset_archive, _transform_annotation
from services.tag_service import TagService

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
        augmentation_config = options.get("augmentations", [])
        max_version_size = int(options.get("max_version_size", 1))

        # 4. Apply Preprocessing & Augmentations to Snapshot
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

            # Add Augmented Copies (Only for Training - will be decided in next step)
            # We store the augmented candidates here, but only add them to train split later
            if augmentation_config and max_version_size > 1:
                asset_meta["augmentation_candidates"] = []
                for i in range(max_version_size - 1):
                    aug_name = augmentation_config[i % len(augmentation_config)]
                    aug_id = f"{orig_id}_aug_{i+1}"
                    
                    aug_asset = dict(asset_meta)
                    aug_asset["original_asset_id"] = aug_id
                    aug_asset["is_augmented"] = True
                    aug_asset["augmentation_type"] = aug_name
                    if "augmentation_candidates" in aug_asset: del aug_asset["augmentation_candidates"]
                    
                    aug_anns = []
                    for ann in asset_anns:
                        ann_copy = _transform_annotation(ann, aug_name)
                        ann_copy["version_id"] = version_id
                        ann_copy["asset_id"] = aug_id
                        if "_id" in ann_copy: del ann_copy["_id"]
                        aug_anns.append(ann_copy)
                    
                    asset_meta["augmentation_candidates"].append({
                        "asset": aug_asset,
                        "annotations": aug_anns
                    })

        # 5. Split Logic (Apply to Originals)
        rebalance = options.get("rebalance", False)
        split = options.get("split", {"train": 70, "valid": 20, "test": 10})
        
        final_version_assets = []
        final_version_annotations = []
        split_counts = {"train": 0, "valid": 0, "test": 0}

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
                
                # Add augmented copies ONLY for TRAIN split
                if s_name == "train" and "augmentation_candidates" in asset:
                    for cand in asset["augmentation_candidates"]:
                        aug_asset = cand["asset"]
                        aug_asset["split"] = "train"
                        final_version_assets.append(aug_asset)
                        final_version_annotations.extend(cand["annotations"])
                        split_counts["train"] += 1
                
                if "augmentation_candidates" in asset: del asset["augmentation_candidates"]

        if rebalance:
            # Group by class (using the first annotation as the anchor)
            class_groups = {}
            for asset in snapshot_assets:
                orig_id = asset["original_asset_id"]
                # Find annotations for this specific original asset
                # We can use the live_annotations we already have
                asset_anns = [a for a in live_annotations if str(a.get("asset_id")) == orig_id]
                
                if asset_anns:
                    label = asset_anns[0]["label"]
                    if label not in class_groups: class_groups[label] = []
                    class_groups[label].append(asset)
                else:
                    if "unlabeled" not in class_groups: class_groups["unlabeled"] = []
                    class_groups["unlabeled"].append(asset)
            
            # Split each group independently
            for label, group in class_groups.items():
                assign_splits(group)
        else:
            # Standard shuffle split
            assign_splits(snapshot_assets)

        # We need to filter final_annotations to only include those for assets in final_version_assets
        # but actually we can just re-collect them or use the ones we already added
        
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
            "split_counts": split_counts
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
            
        assets = list(db.version_assets.find({"version_id": version_id, "is_augmented": False}))
        random.shuffle(assets)
        
        total = len(assets)
        train_end = int(total * (new_split["train"] / 100))
        valid_end = int(total * ((new_split["train"] + new_split["valid"]) / 100))
        
        split_counts = {"train": 0, "valid": 0, "test": 0}
        
        for i, asset in enumerate(assets):
            s_name = "train" if i < train_end else ("valid" if i < valid_end else "test")
            orig_id = str(asset["_id"])
            db.version_assets.update_one({"_id": asset["_id"]}, {"$set": {"split": s_name}})
            split_counts[s_name] += 1
            
            # Update augmented copies
            if s_name == "train":
                parent_id = asset["original_asset_id"]
                res = db.version_assets.update_many(
                    {"version_id": version_id, "is_augmented": True, "original_asset_id": {"$regex": f"^{parent_id}_aug_"}},
                    {"$set": {"split": "train"}}
                )
                split_counts["train"] += res.modified_count
            else:
                # If moving out of train, delete augmented copies or move them too?
                # Requirement says augmentations ONLY on train set.
                parent_id = asset["original_asset_id"]
                db.version_assets.delete_many(
                    {"version_id": version_id, "is_augmented": True, "original_asset_id": {"$regex": f"^{parent_id}_aug_"}}
                )
                db.version_annotations.delete_many(
                    {"version_id": version_id, "asset_id": {"$regex": f"^{parent_id}_aug_"}}
                )

        db.versions.update_one(
            {"version_id": version_id},
            {"$set": {"split_counts": split_counts, "options.split": new_split}}
        )
        return True

    @classmethod
    def delete_version(cls, version_id):
        db.versions.delete_one({"version_id": version_id})
        db.version_assets.delete_many({"version_id": version_id})
        db.version_annotations.delete_many({"version_id": version_id})
        return True
