import os
import uuid
import threading
import time
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from models.db import db
from utils.logger import logger
from dataset_exporter import generate_dataset_archive, validate_format_support
from config import Config

class ExportManager:
    _worker_thread = None
    _stop_event = threading.Event()

    @classmethod
    def start_worker(cls):
        if cls._worker_thread and cls._worker_thread.is_alive():
            return
        
        cls._stop_event.clear()
        cls._worker_thread = threading.Thread(target=cls._worker_loop, name="ExportWorker")
        cls._worker_thread.daemon = True
        cls._worker_thread.start()
        logger.info("Export background worker started.")

    @classmethod
    def stop_worker(cls):
        cls._stop_event.set()
        if cls._worker_thread:
            cls._worker_thread.join(timeout=5)

    @classmethod
    def enqueue_export(cls, project_id, export_format, options):
        # 1. Check for cached version exports
        version_id = options.get("version_id")
        if version_id:
            cached = db.exports.find_one({
                "project_id": project_id,
                "format": export_format,
                "options.version_id": version_id,
                "status": "Ready"
            }, sort=[("created_at", -1)])
            
            if cached:
                archive_id = cached.get("archive_id")
                # Verify file still exists on disk
                from config import Config
                if archive_id and os.path.exists(os.path.join(Config.DATASET_DIR, f"{archive_id}.zip")):
                    logger.info(f"Using cached export {cached['export_id']} for version {version_id}")
                    return cached["export_id"]

        # 2. If no cache, enqueue new job
        export_id = uuid.uuid4().hex
        expires_at = datetime.utcnow() + timedelta(hours=24)
        
        job = {
            "export_id": export_id,
            "project_id": project_id,
            "format": export_format,
            "options": options,
            "status": "Queued",
            "progress": 0,
            "created_at": datetime.utcnow().isoformat() + "Z",
            "expires_at": expires_at.isoformat() + "Z",
            "error": None,
            "download_url": None
        }
        
        db.exports.insert_one(job)
        return export_id

    @classmethod
    def _worker_loop(cls):
        while not cls._stop_event.is_set():
            try:
                # 1. Cleanup expired exports
                cls._cleanup_expired()

                # 2. Pick up next queued job
                job = db.exports.find_one_and_update(
                    {"status": "Queued"},
                    {"$set": {"status": "Processing", "started_at": datetime.utcnow().isoformat() + "Z"}},
                    sort=[("created_at", 1)]
                )

                if not job:
                    time.sleep(5)
                    continue

                cls._process_job(job)

            except Exception as e:
                logger.error(f"Error in export worker loop: {e}", exc_info=True)
                time.sleep(10)

    @classmethod
    def _process_job(cls, job):
        export_id = job["export_id"]
        project_id = job["project_id"]
        export_format = job["format"]
        options = job["options"]

        try:
            logger.info(f"Processing export {export_id} for project {project_id}")
            
            # Progress callback for the exporter
            def progress_callback(pct):
                db.exports.update_one({"export_id": export_id}, {"$set": {"progress": pct}})

            # Generate archive
            archive_id, stats = generate_dataset_archive(
                db,
                project_id,
                export_format,
                Config.UPLOAD_DIR,
                Config.DATASET_DIR,
                {**options, "export_id": export_id, "progress_callback": progress_callback}
            )

            db.exports.update_one(
                {"export_id": export_id},
                {
                    "$set": {
                        "status": "Ready",
                        "progress": 100,
                        "archive_id": archive_id,
                        "stats": stats,
                        "download_url": f"/api/projects/{project_id}/dataset/exports/{export_id}/download",
                        "completed_at": datetime.utcnow().isoformat() + "Z"
                    }
                }
            )
            logger.info(f"Export {export_id} ready.")

        except Exception as e:
            logger.error(f"Export {export_id} failed: {e}", exc_info=True)
            db.exports.update_one(
                {"export_id": export_id},
                {"$set": {"status": "Failed", "error": str(e)}}
            )

    @classmethod
    def _cleanup_expired(cls):
        now = datetime.utcnow().isoformat() + "Z"
        expired_jobs = list(db.exports.find({"expires_at": {"$lt": now}, "status": {"$ne": "Expired"}}))
        
        for job in expired_jobs:
            try:
                archive_id = job.get("archive_id")
                if archive_id:
                    zip_path = os.path.join(Config.DATASET_DIR, f"{archive_id}.zip")
                    if os.path.exists(zip_path):
                        os.remove(zip_path)
                        logger.info(f"Deleted expired archive: {zip_path}")
                
                db.exports.update_one({"export_id": job["export_id"]}, {"$set": {"status": "Expired"}})
            except Exception as e:
                logger.error(f"Failed to cleanup job {job['export_id']}: {e}")
