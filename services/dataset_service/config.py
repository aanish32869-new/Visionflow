import os
import configparser

# Load visionflow.conf from root
config_path = os.path.join(os.path.dirname(__file__), "..", "..", "visionflow.conf")
if os.path.exists(config_path):
    parser = configparser.ConfigParser()
    parser.read(config_path)
    if 'visionflow' in parser:
        for key, value in parser['visionflow'].items():
            os.environ[key.upper()] = value

class Config:
    MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
    # Base directory is the project root (2 levels up from services/dataset_service)
    BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    UPLOAD_DIR = os.path.abspath(os.getenv("UPLOAD_DIR", os.path.join(BASE_DIR, "storage", "uploads")))
    DATASET_DIR = os.path.abspath(os.getenv("DATASET_DIR", os.path.join(BASE_DIR, "storage", "datasets")))
    PORT = int(os.getenv("PORT_DATASET_SERVICE", 5003))
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-123")
    MAX_CONTENT_LENGTH = 500 * 1024 * 1024 * 1024  # 500GB max payload for massive batches

    # Ensure directories exist
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(DATASET_DIR, exist_ok=True)
