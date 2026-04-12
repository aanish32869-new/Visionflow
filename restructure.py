import os
import shutil
from pathlib import Path

base_dir = r"c:\Users\Anish\Desktop\Vision flow\Datasetlab"
os.chdir(base_dir)

directories = [
    "apps/web",
    "apps/marketing",
    "apps/docs",
    "services/auth-service",
    "services/user-service",
    "services/dataset-service",
    "services/annotation-service",
    "services/training-service",
    "services/inference-service",
    "services/export-service",
    "services/billing-service",
    "services/notification-service",
    "ml-platform/pipelines/data_ingestion",
    "ml-platform/pipelines/preprocessing",
    "ml-platform/pipelines/augmentation",
    "ml-platform/pipelines/training",
    "ml-platform/pipelines/evaluation",
    "ml-platform/models/detection",
    "ml-platform/models/classification",
    "ml-platform/models/segmentation",
    "ml-platform/experiment_tracking",
    "ml-platform/feature_store",
    "workers/dataset_worker",
    "workers/training_worker",
    "workers/inference_worker",
    "workers/export_worker",
    "libs/common",
    "libs/db",
    "libs/logging",
    "libs/auth",
    "libs/storage",
    "storage/s3",
    "storage/gcs",
    "storage/local",
    "api-gateway",
    "infra/docker",
    "infra/kubernetes",
    "infra/terraform",
    "infra/ci-cd",
    "monitoring/prometheus",
    "monitoring/grafana",
    "monitoring/sentry",
    "tests/unit",
    "tests/integration",
    "tests/e2e",
    "scripts/migrations",
    "scripts/seed",
    "scripts/maintenance"
]

for d in directories:
    os.makedirs(d, exist_ok=True)

docker_compose = '''version: '3.8'

services:
  api-gateway:
    build: ./api-gateway
    ports:
      - "80:80"
    depends_on:
      - auth-service
      - dataset-service
      - inference-service
  auth-service:
    build: ./services/auth-service
    environment:
      - MONGO_URI=mongodb://mongo:27017/
  dataset-service:
    build: ./services/dataset-service
    environment:
      - MONGO_URI=mongodb://mongo:27017/
  inference-service:
    build: ./services/inference-service
    environment:
      - MONGO_URI=mongodb://mongo:27017/
  web:
    build: ./apps/web
    ports:
      - "3000:3000"
  mongo:
    image: mongo:latest
    ports:
      - "27017:27017"
'''
with open("docker-compose.yml", "w") as f:
    f.write(docker_compose)

with open(".env", "w") as f:
    f.write("MONGO_URI=mongodb://localhost:27017/\nSECRET_KEY=dev-secret-key-123\n")

with open("README.md", "w") as f:
    f.write("# DatasetLab Vision Platform\n\nMicroservices architecture for computer vision dataset labeling and ML training.")

if os.path.exists("frontend") and not os.path.exists("apps/web/package.json"):
    try:
        for item in os.listdir("frontend"):
            shutil.move(os.path.join("frontend", item), "apps/web")
        shutil.rmtree("frontend")
    except Exception as e:
        print(f"Error moving frontend: {e}")

for app in ["marketing", "docs"]:
    with open(f"apps/{app}/README.md", "w") as f:
        f.write(f"# {app.capitalize()} App\n\nNext.js {app} portal.")

def create_service(name, port, description):
    with open(f"services/{name}/Dockerfile", "w") as f:
        f.write("FROM python:3.9-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install -r requirements.txt\nCOPY . .\nCMD [\"python\", \"app.py\"]")
    with open(f"services/{name}/requirements.txt", "w") as f:
        f.write("Flask\nFlask-CORS\npymongo\nmongomock\n")
    
    app_py_content = f'''import os
from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route('/health')
def health():
    return jsonify({{"status": "ok", "service": "{name}"}})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port={port})
'''
    with open(f"services/{name}/app.py", "w") as f:
        f.write(app_py_content)

create_service("auth-service", 5001, "Authentication and User Management")
create_service("user-service", 5002, "User Profiles")
create_service("dataset-service", 5003, "Dataset & Workspace Management")
create_service("annotation-service", 5004, "Labeling API")
create_service("training-service", 5005, "Training Orchestration")
create_service("inference-service", 5006, "Inference API")
create_service("export-service", 5007, "Format Conversion")
create_service("billing-service", 5008, "Billing & Payments")
create_service("notification-service", 5009, "Emails & Alerts")

gateway_conf = '''
server {
    listen 80;
    location /api/auth { proxy_pass http://auth-service:5001; }
    location /api/datasets { proxy_pass http://dataset-service:5003; }
    location /api/infer { proxy_pass http://inference-service:5006; }
    location / { proxy_pass http://web:3000; }
}
'''
with open("api-gateway/nginx.conf", "w") as f:
    f.write(gateway_conf)

with open("api-gateway/Dockerfile", "w") as f:
    f.write("FROM nginx:alpine\nCOPY nginx.conf /etc/nginx/conf.d/default.conf\n")

os.makedirs("services/dataset-service/legacy", exist_ok=True)
if os.path.exists("backend/app.py"):
    shutil.copy("backend/app.py", "services/dataset-service/legacy/app.py")

with open("ml-platform/README.md", "w") as f: f.write("# ML Platform\nCore ML pipelines, models, and tracking.")
with open("ml-platform/pipelines/training/train.py", "w") as f: f.write("def train_model():\n    pass")
with open("ml-platform/models/detection/yolo.py", "w") as f: f.write("class YOLODetector:\n    pass")

for w in ["dataset_worker", "training_worker", "inference_worker", "export_worker"]:
    with open(f"workers/{w}/worker.py", "w") as f: f.write("import time\ndef run():\n    pass")

with open("libs/db/connection.py", "w") as f: f.write("def get_db():\n    pass")
with open("libs/common/utils.py", "w") as f: f.write("def sanitize_name(name):\n    return name.strip()")

print("Restructure complete!")
