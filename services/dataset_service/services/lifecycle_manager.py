import os
import time
import threading
from datetime import datetime, timedelta
from config import Config
from models.db import db
from utils.logger import logger

class LifecycleManager:
    _cleanup_thread = None
    
    @classmethod
    def start_cleanup_task(cls):
        if cls._cleanup_thread is None or not cls._cleanup_thread.is_alive():
            cls._cleanup_thread = threading.Thread(target=cls._cleanup_loop, daemon=True)
            cls._cleanup_thread.start()
            logger.info("Lifecycle Cleanup Task started.")

    @classmethod
    def _cleanup_loop(cls):
        while True:
            try:
                cls.purge_expired_exports()
            except Exception as e:
                logger.error(f"Error in lifecycle cleanup loop: {e}")
            
            # Run every hour
            time.sleep(3600)

    @classmethod
    def purge_expired_exports(cls):
        """Delete ZIP files and DB records for exports older than 24 hours."""
        logger.info("Running expired exports purge...")
        
        now = datetime.utcnow()
        expiry_limit = now - timedelta(hours=24)
        
        # Find expired exports
        expired_exports = list(db.exports.find({
            "created_at": {"$lt": expiry_limit.isoformat() + "Z"}
        }))
        
        count = 0
        for export in expired_exports:
            archive_id = export.get("archive_id")
            if archive_id:
                file_path = os.path.join(Config.DATASET_DIR, f"{archive_id}.zip")
                if os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                        logger.info(f"Deleted expired export file: {file_path}")
                    except Exception as e:
                        logger.error(f"Failed to delete file {file_path}: {e}")
            
            # Remove from DB
            db.exports.delete_one({"_id": export["_id"]})
            count += 1
            
        if count > 0:
            logger.info(f"Purged {count} expired exports.")
