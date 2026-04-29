from bson.objectid import ObjectId
from models.db import db
from services.asset_service import get_utc_now
from utils.logger import logger

class ClassService:
    @staticmethod
    def merge_classes(project_id, source_classes, target_class):
        """
        Merges multiple source classes into a single target class.
        Updates all annotations in the live dataset.
        """
        if not source_classes or not target_class:
            return 0
        
        target_class = target_class.strip()
        source_classes = [c.strip() for c in source_classes]
        
        result = db.annotations.update_many(
            {"project_id": project_id, "label": {"$in": source_classes}},
            {"$set": {"label": target_class, "updated_at": get_utc_now()}}
        )
        
        # Update project's detected classes list - Split into two operations to avoid conflicts
        db.projects.update_one(
            {"_id": ObjectId(project_id)},
            {
                "$pull": {"detected_classes": {"$in": source_classes}},
                "$set": {"updated_at": get_utc_now()}
            }
        )
        db.projects.update_one(
            {"_id": ObjectId(project_id)},
            {
                "$addToSet": {"detected_classes": target_class},
                "$set": {"updated_at": get_utc_now()}
            }
        )
        
        logger.info(f"Merged {source_classes} into {target_class} for project {project_id}. Affected {result.modified_count} annotations.")
        return result.modified_count

    @staticmethod
    def delete_class(project_id, class_name):
        """
        Permanently removes a class and its annotations.
        """
        class_name = class_name.strip()
        
        # Delete annotations
        result = db.annotations.delete_many(
            {"project_id": project_id, "label": class_name}
        )
        
        # Remove from project ontology
        db.projects.update_one(
            {"_id": ObjectId(project_id)},
            {
                "$pull": {"detected_classes": class_name, "classes": {"name": class_name}},
                "$set": {"updated_at": get_utc_now()}
            }
        )
        
        logger.info(f"Deleted class {class_name} from project {project_id}. Removed {result.deleted_count} annotations.")
        return result.deleted_count

    @staticmethod
    def lock_ontology(project_id, locked=True):
        """
        Locks the ontology to prevent new classes from being created during annotation.
        """
        db.projects.update_one(
            {"_id": ObjectId(project_id)},
            {"$set": {"ontology_locked": locked, "updated_at": get_utc_now()}}
        )
        return True
