from bson.objectid import ObjectId
from models.db import db, serialize_doc
from utils.logger import logger

class ProjectService:
    @staticmethod
    def get_projects(user_id=None):
        projects = list(db.projects.find().sort("updated_at", -1))
        # Enrich projects with statistics
        for project in projects:
            p_id = str(project["_id"])
            images_count = db.assets.count_documents({"project_id": p_id})
            # Find annotated assets
            annotated_asset_ids = db.annotations.distinct("asset_id", {"project_id": p_id}) # Requires project_id in annotations or map from assets
            # A more generic way: find assets for project first
            project_asset_ids = [str(a["_id"]) for a in db.assets.find({"project_id": p_id}, {"_id": 1})]
            annotated_count = len(db.annotations.distinct("asset_id", {"asset_id": {"$in": project_asset_ids}})) if project_asset_ids else 0
            
            project.update({
                "images": images_count,
                "unannotated": max(images_count - annotated_count, 0),
                "versions_count": db.versions.count_documents({"project_id": p_id}),
                "updated": project.get("updated_at") or project.get("created_at"),
            })
            serialize_doc(project)
        return projects

    @staticmethod
    def create_project(data):
        from .asset_service import get_utc_now
        now = get_utc_now()
        new_project = {
            "name": data.get("name", "Untitled Project"),
            "tool": data.get("tool", "Rapid"),
            "project_type": data.get("project_type", "Object Detection"),
            "classification_type": data.get("classification_type"),
            "annotation_group": data.get("annotation_group", "objects"),
            "license": data.get("license", "Public Domain"),
            "visibility": data.get("visibility", "Public"),
            "folder_id": data.get("folder_id"),
            "workspace_id": data.get("workspace_id", "default-workspace-id"), # Simplified check later
            "detected_classes": data.get("detected_classes", []),
            "created_at": now,
            "updated_at": now,
        }
        result = db.projects.insert_one(new_project)
        new_project["id"] = str(result.inserted_id)
        logger.info(f"Created project {new_project['name']} with ID {new_project['id']}")
        return serialize_doc(new_project)

    @staticmethod
    def delete_project(project_id):
        try:
            p_oid = ObjectId(project_id)
            # Find all assets linked to project
            assets = db.assets.find({"project_id": project_id})
            from .asset_service import AssetService
            for asset in assets:
                 AssetService.delete_asset(str(asset["_id"])) # Handles file and document cleanup

            db.projects.delete_one({"_id": p_oid})
            db.versions.delete_many({"project_id": project_id})
            logger.info(f"Deleted project {project_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete project {project_id}: {e}")
            return False
