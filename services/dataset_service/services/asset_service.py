import os
import uuid
import hashlib
from datetime import datetime

import gridfs
from bson.objectid import ObjectId
from werkzeug.utils import secure_filename
from PIL import Image

from models.db import db, serialize_doc
from utils.logger import logger


ASSET_FILES_BUCKET = "asset_files"


def get_utc_now():
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _asset_bucket():
    return gridfs.GridFSBucket(db, bucket_name=ASSET_FILES_BUCKET)


def _build_asset_url(asset_id, filename):
    return f"/uploads/assets/{asset_id}/{filename or 'asset'}"


class AssetService:
    @staticmethod
    def get_assets(project_id=None, status=None, tags=None):
        query = {}
        if project_id:
            query["project_id"] = project_id
        if status:
            query["status"] = status
        if tags:
            query["tags"] = {"$in": tags if isinstance(tags, list) else [tags]}

        assets = list(db.assets.find(query).sort("uploaded_at", -1))

        for asset in assets:
            count = db.annotations.count_documents({"asset_id": str(asset["_id"])})
            asset["annotation_count"] = count
            asset["is_annotated"] = count > 0
            asset.setdefault(
                "url",
                _build_asset_url(str(asset["_id"]), asset.get("unique_filename") or asset.get("filename")),
            )
            serialize_doc(asset)

        return assets

    @staticmethod
    def upload_asset(file, project_id, batch_name=None, batch_id=None, batch_tags=None):
        if not file:
            raise ValueError("No file provided")

        # 1. Integrity Check & Hash Generation
        try:
            file_content = file.read()
            file.seek(0) # Reset stream for GridFS
            
            # Hash for deduplication
            file_hash = hashlib.md5(file_content).hexdigest()
            
            # Validate image integrity
            try:
                with Image.open(file) as img:
                    img.verify()
                    width, height = img.size
                file.seek(0)
            except Exception as e:
                raise ValueError(f"Corrupted image file: {str(e)}")

            # 2. Deduplication check within project
            existing = db.assets.find_one({"project_id": str(project_id), "hash": file_hash})
            if existing:
                logger.info(f"Duplicate asset found for project {project_id}, hash: {file_hash}")
                return serialize_doc(existing)

        except Exception as e:
            logger.error(f"Asset validation failed: {e}")
            raise e

        original_filename = secure_filename(file.filename)
        unique_filename = f"{uuid.uuid4().hex}_{original_filename}"
        asset_id = ObjectId()
        
        upload_stream = _asset_bucket().open_upload_stream(
            unique_filename,
            content_type=file.mimetype or "application/octet-stream",
            metadata={
                "asset_id": str(asset_id),
                "project_id": str(project_id) if project_id else None,
                "filename": original_filename,
                "unique_filename": unique_filename,
                "mimetype": file.mimetype,
                "source": "upload",
                "hash": file_hash
            },
        )

        upload_stream.write(file_content)
        upload_stream.close()

        uploaded_at = get_utc_now()
        asset_doc = {
            "_id": asset_id,
            "filename": original_filename,
            "unique_filename": unique_filename,
            "file_id": str(upload_stream._id),
            "hash": file_hash,
            "storage_backend": "gridfs",
            "path": None,
            "url": _build_asset_url(str(asset_id), unique_filename),
            "project_id": str(project_id) if project_id else None,
            "batch_id": batch_id or uuid.uuid4().hex,
            "batch_name": batch_name or "Imported Batch",
            "tags": batch_tags or [],
            "uploaded_at": uploaded_at,
            "updated_at": uploaded_at,
            "status": "unassigned", # State Machine Start
            "upload_state": "unannotated",
            "is_annotated": False,
            "annotation_count": 0,
            "metadata": {
                "size": len(file_content),
                "mimetype": file.mimetype,
                "width": width,
                "height": height,
                "ext": original_filename.rsplit(".", 1)[-1].lower() if "." in original_filename else "",
            },
        }

        db.assets.insert_one(asset_doc)
        return serialize_doc(asset_doc)

    @staticmethod
    def update_asset_status(asset_id, new_status):
        """
        Enforces state machine transitions:
        unassigned -> annotating -> dataset
        """
        valid_transitions = {
            "unassigned": ["annotating"],
            "annotating": ["dataset", "unassigned"],
            "dataset": ["annotating"]
        }
        
        asset = db.assets.find_one({"_id": ObjectId(asset_id)})
        if not asset:
            return False
            
        current_status = asset.get("status", "unassigned")
        if new_status not in valid_transitions.get(current_status, []):
            logger.warning(f"Invalid transition attempted: {current_status} -> {new_status}")
            return False

        # Additional rule: Only annotated images can move to 'dataset'
        if new_status == "dataset":
            count = db.annotations.count_documents({"asset_id": str(asset_id)})
            if count == 0:
                logger.warning(f"Cannot move unannotated asset {asset_id} to dataset state")
                return False

        db.assets.update_one(
            {"_id": ObjectId(asset_id)},
            {"$set": {"status": new_status, "updated_at": get_utc_now()}}
        )
        return True

    @staticmethod
    def validate_annotations(annotations, image_width, image_height):
        """
        Validates bounding box coordinates and structure.
        """
        valid_anns = []
        for ann in annotations:
            # Check for required fields
            if not all(k in ann for k in ["label", "type"]):
                continue
                
            if ann["type"] == "box":
                # Ensure normalized coordinates are within [0, 1]
                x_center = max(0, min(1, ann.get("x_center", 0)))
                y_center = max(0, min(1, ann.get("y_center", 0)))
                width = max(0, min(1, ann.get("width", 0)))
                height = max(0, min(1, ann.get("height", 0)))
                
                ann["x_center"] = x_center
                ann["y_center"] = y_center
                ann["width"] = width
                ann["height"] = height
            
            valid_anns.append(ann)
        return valid_anns

    @staticmethod
    def delete_asset(asset_id):
        asset = db.assets.find_one({"_id": ObjectId(asset_id)})
        if not asset:
            logger.warning(f"Asset {asset_id} not found for deletion")
            return False

        file_ref = str(asset.get("file_id") or asset.get("current_file_id") or "").strip()
        if ObjectId.is_valid(file_ref):
            try:
                _asset_bucket().delete(ObjectId(file_ref))
            except Exception:
                logger.warning(f"GridFS file {file_ref} missing for asset {asset_id}")

        db.assets.delete_one({"_id": ObjectId(asset_id)})
        db.annotations.delete_many({"asset_id": str(asset_id)})
        db.annotation_sessions.delete_many({"asset_id": str(asset_id)})
        return True

    @staticmethod
    def rename_batch(batch_id, new_name):
        if not batch_id or not new_name:
            return 0
        result = db.assets.update_many(
            {"batch_id": batch_id},
            {"$set": {"batch_name": new_name, "updated_at": get_utc_now()}}
        )
        return result.modified_count

    @staticmethod
    def unassign_batch(batch_id):
        if not batch_id:
            return 0
        
        asset_ids = [str(a["_id"]) for a in db.assets.find({"batch_id": batch_id})]
        if not asset_ids:
            return 0

        db.annotations.delete_many({"asset_id": {"$in": asset_ids}})
        
        result = db.assets.update_many(
            {"batch_id": batch_id},
            {
                "$set": {
                    "status": "unassigned",
                    "upload_state": "unannotated",
                    "is_annotated": False,
                    "annotation_count": 0,
                    "state": None,
                    "updated_at": get_utc_now()
                }
            }
        )
        return result.modified_count

    @staticmethod
    def delete_batch(batch_id, project_id=None, status=None):
        query = {"batch_id": batch_id}
        if project_id:
            query["project_id"] = project_id
            
        if status == "unassigned":
            # Match frontend's definition of unassigned: status="unassigned" OR (no status AND no annotations)
            query["$or"] = [
                {"status": "unassigned"},
                {"status": {"$exists": False}},
                {"status": None}
            ]
        elif status:
            query["status"] = status
            
        logger.info(f"Attempting to delete batch {batch_id} with query: {query}")
        assets = list(db.assets.find(query))
        logger.info(f"Found {len(assets)} assets to delete for batch {batch_id}")
        
        if not assets:
            logger.info(f"No assets found for deletion in batch {batch_id} with status {status}")
            return 0
        
        count = 0
        for asset in assets:
            if AssetService.delete_asset(str(asset["_id"])):
                count += 1
        return count

    @staticmethod
    def delete_batch_annotations(batch_id, state_type="annotated"):
        """
        Clears annotations for a batch without deleting the images.
        Resets status to 'unassigned'.
        """
        query = {"batch_id": batch_id}
        if state_type == "annotated":
            query["status"] = "annotated"
        elif state_type == "approved":
            query["state"] = "approved"

        assets = list(db.assets.find(query))
        if not assets:
            return 0

        asset_ids = [str(a["_id"]) for a in assets]
        
        # Delete all annotations for these assets
        db.annotations.delete_many({"asset_id": {"$in": asset_ids}})
        
        # Reset assets to unassigned state
        now = get_utc_now()
        result = db.assets.update_many(
            {"_id": {"$in": [a["_id"] for a in assets]}},
            {
                "$set": {
                    "status": "unassigned",
                    "is_annotated": False,
                    "annotation_count": 0,
                    "state": None,
                    "updated_at": now
                }
            }
        )
        return len(asset_ids)

    @staticmethod
    def move_batch_to_annotated(batch_id):
        result = db.assets.update_many(
            {"batch_id": batch_id},
            {
                "$set": {
                    "status": "annotating",
                    "updated_at": get_utc_now()
                }
            }
        )
        return result.modified_count
