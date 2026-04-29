from models.db import db
from services.asset_service import get_utc_now
from utils.logger import logger

class TagService:
    @staticmethod
    def add_tag(asset_id, tag):
        if not tag:
            return False
        tag = tag.strip().lower()
        db.assets.update_one(
            {"_id": asset_id},
            {
                "$addToSet": {"tags": tag},
                "$set": {"updated_at": get_utc_now()}
            }
        )
        return True

    @staticmethod
    def remove_tag(asset_id, tag):
        tag = tag.strip().lower()
        db.assets.update_one(
            {"_id": asset_id},
            {
                "$pull": {"tags": tag},
                "$set": {"updated_at": get_utc_now()}
            }
        )
        return True

    @staticmethod
    def get_assets_by_tags(project_id, include_tags=None, exclude_tags=None):
        query = {"project_id": project_id}
        
        if include_tags:
            query["tags"] = {"$all": [t.lower() for t in include_tags]}
        
        if exclude_tags:
            query["tags"] = {"$nin": [t.lower() for t in exclude_tags]}
            
        return list(db.assets.find(query))

    @staticmethod
    def get_project_tags(project_id):
        """Returns all unique tags used in a project."""
        tags = db.assets.distinct("tags", {"project_id": project_id})
        return sorted(list(set(tags)))
