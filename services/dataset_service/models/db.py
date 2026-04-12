from pymongo import MongoClient
from config import Config
from utils.logger import logger

try:
    client = MongoClient(Config.MONGO_URI, serverSelectionTimeoutMS=2000)
    client.server_info()
    logger.info("Connected to local MongoDB successfully!")
    db = client.visionflow
except Exception as e:
    logger.error(f"Local MongoDB connection failed: {e}. Reverting to mock.")
    import mongomock
    import mongomock.gridfs

    mongomock.gridfs.enable_gridfs_integration()
    client = mongomock.MongoClient()
    db = client.visionflow

def serialize_doc(doc):
    if doc and "_id" in doc:
        doc["id"] = str(doc.pop("_id"))
    return doc
