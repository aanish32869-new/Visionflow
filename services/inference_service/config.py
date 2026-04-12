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
    YOLO_MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "yolov8x.pt")
    YOLO_AUTO_LABEL_MODEL = os.getenv("YOLO_AUTO_LABEL_MODEL", "yolov8s.pt")
    UPLOAD_DIR = os.getenv("UPLOAD_DIR", "storage/uploads")
    PORT = int(os.getenv("PORT_INFERENCE_SERVICE", 5006))
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-123")
