import os
import uuid
from datetime import datetime

import gridfs
from bson.objectid import ObjectId
from werkzeug.utils import secure_filename

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
    def get_assets(project_id=None):
        query = {}
        if project_id:
            query["project_id"] = project_id

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
            },
        )

        size = 0
        while True:
            chunk = file.stream.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            upload_stream.write(chunk)
        upload_stream.close()

        uploaded_at = get_utc_now()
        asset_doc = {
            "_id": asset_id,
            "filename": original_filename,
            "unique_filename": unique_filename,
            "file_id": str(upload_stream._id),
            "storage_backend": "gridfs",
            "path": None,
            "url": _build_asset_url(str(asset_id), unique_filename),
            "project_id": str(project_id) if project_id else None,
            "batch_id": batch_id or uuid.uuid4().hex,
            "batch_name": batch_name or "Imported Batch",
            "batch_tags": batch_tags or [],
            "uploaded_at": uploaded_at,
            "updated_at": uploaded_at,
            "status": "unlabeled",
            "upload_state": "unannotated",
            "is_annotated": False,
            "annotation_count": 0,
            "metadata": {
                "size": size,
                "mimetype": file.mimetype,
                "ext": original_filename.rsplit(".", 1)[-1].lower() if "." in original_filename else "",
            },
        }

        db.assets.insert_one(asset_doc)
        return serialize_doc(asset_doc)

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

        filepath = asset.get("path")
        if filepath and os.path.exists(filepath):
            os.remove(filepath)
            logger.info(f"Deleted legacy file {filepath}")

        db.assets.delete_one({"_id": ObjectId(asset_id)})
        db.annotations.delete_many({"asset_id": str(asset_id)})
        db.annotation_sessions.delete_many({"asset_id": str(asset_id)})
        return True
