import os
import uuid
import shutil
import random
import json
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename
from pymongo import MongoClient
from bson.objectid import ObjectId

app = Flask(__name__)
# Enable CORS for the frontend React app
CORS(app)

# MongoDB Configuration
# User encountered 500 connection refused since local MongoDB isn't running.
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
try:
    # Try connecting to actual MongoDB server with a short timeout
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=2000)
    client.server_info()  # Forces a call to check if server is available
    print("Connected to actual local MongoDB successfully!")
except Exception:
    import mongomock

    print(
        "Local MongoDB server not found. Reverting to MongoMock (in-memory MongoDB) to prevent crashes."
    )
    client = mongomock.MongoClient()

db = client.visionflow  # Creates a database named 'visionflow'

# Upload Configuration
basedir = os.path.abspath(os.path.dirname(__name__))
UPLOAD_FOLDER = os.path.join(basedir, "uploads")
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


# Utility function to convert MongoDB ObjectIds to strings in dicts
def serialize_doc(doc):
    if doc and "_id" in doc:
        doc["id"] = str(doc.pop("_id"))
    return doc


# ---- Authentication ----
@app.route("/api/signup", methods=["POST"])
def signup():
    data = request.json
    email = data.get("email")
    password = data.get("password")
    if not email or not password:
        return jsonify({"error": "Email and password required"}), 400

    if db.users.find_one({"email": email}):
        return jsonify({"error": "User already exists"}), 400

    new_user = {
        "email": email,
        "password": password,
        "firstName": data.get("firstName", ""),
        "lastName": data.get("lastName", ""),
    }
    db.users.insert_one(new_user)
    return jsonify({"success": True, "message": "User created"}), 201


@app.route("/api/login", methods=["POST"])
def login():
    data = request.json
    email = data.get("email")
    password = data.get("password")
    user = db.users.find_one({"email": email, "password": password})
    if user:
        return (
            jsonify({"success": True, "token": "visionflow-token-" + str(user["_id"])}),
            200,
        )
    else:
        return jsonify({"error": "Invalid credentials, please try again."}), 401


# ---- Workspaces ----
@app.route("/api/workspaces", methods=["GET"])
def get_workspaces():
    workspaces = list(db.workspaces.find())
    return jsonify([serialize_doc(w) for w in workspaces])


@app.route("/api/workspaces", methods=["POST"])
def create_workspace():
    data = request.json
    new_workspace = {"name": data.get("name", "Free Workspace")}
    result = db.workspaces.insert_one(new_workspace)
    new_workspace["_id"] = result.inserted_id
    return jsonify(serialize_doc(new_workspace)), 201


# ---- Folders ----
@app.route("/api/folders", methods=["GET"])
def get_folders():
    folders = list(db.folders.find())
    return jsonify([serialize_doc(f) for f in folders])


@app.route("/api/folders", methods=["POST"])
def create_folder():
    data = request.json
    new_folder = {
        "name": data.get("name", "New Folder"),
        "workspace_id": data.get("workspace_id"),
    }
    result = db.folders.insert_one(new_folder)
    new_folder["_id"] = result.inserted_id
    return jsonify(serialize_doc(new_folder)), 201


# ---- Projects ----
@app.route("/api/projects", methods=["GET"])
def get_projects():
    projects = list(db.projects.find())
    return jsonify([serialize_doc(p) for p in projects])


@app.route("/api/projects", methods=["POST"])
def create_project():
    data = request.json
    new_project = {
        "name": data.get("name", "Untitled Project"),
        "project_type": data.get("project_type", "Object Detection"),
        "visibility": data.get("visibility", "Public"),
        "folder_id": data.get("folder_id"),
        "workspace_id": data.get("workspace_id"),
    }
    result = db.projects.insert_one(new_project)
    new_project["_id"] = result.inserted_id
    return jsonify(serialize_doc(new_project)), 201


@app.route("/api/projects/<project_id>", methods=["DELETE"])
def delete_project(project_id):
    try:
        db.projects.delete_one({"_id": ObjectId(project_id)})
        return jsonify({"success": True, "message": "Project deleted successfully"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


# ---- Assets ----
@app.route("/api/assets", methods=["GET"])
def get_assets():
    assets = list(db.assets.find())
    return jsonify([serialize_doc(a) for a in assets])


@app.route("/api/assets", methods=["POST"])
def upload_asset():
    if "file" not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    if file:
        original_filename = secure_filename(file.filename)
        unique_filename = f"{uuid.uuid4().hex}_{original_filename}"
        filepath = os.path.join(app.config["UPLOAD_FOLDER"], unique_filename)
        file.save(filepath)

        img_url = f"http://localhost:5000/uploads/{unique_filename}"

        project_id = request.form.get("project_id")

        new_asset = {
            "filename": original_filename,
            "url": img_url,
            "project_id": project_id,
        }
        result = db.assets.insert_one(new_asset)
        new_asset["_id"] = result.inserted_id
        return jsonify(serialize_doc(new_asset)), 201


# ---- Serve Static Uploads ----
@app.route("/uploads/<filename>")
def uploaded_file(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


# ---- Annotations ----
@app.route("/api/assets/<asset_id>/annotations", methods=["GET"])
def get_annotations(asset_id):
    annotations = list(db.annotations.find({"asset_id": asset_id}))
    return jsonify([serialize_doc(a) for a in annotations])


@app.route("/api/assets/<asset_id>/annotations", methods=["POST"])
def save_annotations(asset_id):
    data = request.json
    db.annotations.delete_many({"asset_id": asset_id})
    if "annotations" in data and data["annotations"]:
        for ann in data["annotations"]:
            ann["asset_id"] = asset_id
        db.annotations.insert_many(data["annotations"])
    return jsonify({"success": True}), 200


# ---- Versions and Dataset Generation ----

app.config["DATASETS_FOLDER"] = os.path.join(basedir, "datasets")
os.makedirs(app.config["DATASETS_FOLDER"], exist_ok=True)


@app.route("/api/projects/<project_id>/versions", methods=["GET"])
def get_versions(project_id):
    versions = list(db.versions.find({"project_id": project_id}))
    return jsonify([serialize_doc(v) for v in versions])


@app.route("/api/projects/<project_id>/versions", methods=["POST"])
def generate_version(project_id):
    version_id = uuid.uuid4().hex
    version_dir = os.path.join(app.config["DATASETS_FOLDER"], version_id)

    # Create YOLO structure
    for split in ["train", "valid", "test"]:
        os.makedirs(os.path.join(version_dir, split, "images"), exist_ok=True)
        os.makedirs(os.path.join(version_dir, split, "labels"), exist_ok=True)

    assets = list(db.assets.find({"project_id": project_id}))
    random.shuffle(assets)

    total = len(assets)
    train_end = int(total * 0.7)
    valid_end = int(total * 0.9)

    classes_set = set()
    for a in db.annotations.find(
        {"asset_id": {"$in": [str(a["_id"]) for a in assets]}}
    ):
        if "label" in a:
            classes_set.add(a["label"])

    classes_list = list(classes_set)
    classes_map = dict({name: i for i, name in enumerate(classes_list)})

    for i, asset in enumerate(assets):
        if i < train_end:
            split = "train"
        elif i < valid_end:
            split = "valid"
        else:
            split = "test"

        # Copy image
        src_image = os.path.join(
            app.config["UPLOAD_FOLDER"], asset["url"].split("/")[-1]
        )

        if os.path.exists(src_image):
            shutil.copy(
                src_image,
                os.path.join(version_dir, split, "images", asset["url"].split("/")[-1]),
            )

        # Create YOLO label file
        annotations = list(db.annotations.find({"asset_id": str(asset["_id"])}))
        label_file = os.path.join(
            version_dir,
            split,
            "labels",
            os.path.splitext(asset["url"].split("/")[-1])[0] + ".txt",
        )
        with open(label_file, "w") as f:
            for ann in annotations:
                if "label" in ann and ann["label"] in classes_map:
                    cid = classes_map.get(ann["label"])
                    if ann.get("type") == "polygon" and "points" in ann:
                        pts_str = " ".join(
                            [f"{p.get('x',0)} {p.get('y',0)}" for p in ann["points"]]
                        )
                        f.write(f"{cid} {pts_str}\n")
                    else:
                        f.write(
                            f"{cid} {ann.get('x_center', 0.5)} {ann.get('y_center', 0.5)} {ann.get('width', 0.1)} {ann.get('height', 0.1)}\n"
                        )

    # write data.yaml
    with open(os.path.join(version_dir, "data.yaml"), "w") as f:
        f.write("train: ../train/images\n")
        f.write("val: ../valid/images\n")
        f.write("test: ../test/images\n\n")
        f.write(f"nc: {len(classes_list)}\n")
        f.write(f"names: {json.dumps(classes_list)}\n")

    # Write standard dataset README mimicking Roboflow
    with open(os.path.join(version_dir, "README.dataset.txt"), "w") as f:
        f.write(
            f"Dataset auto-generated by VisionFlow Core\nFormat: YOLO\nClasses: {', '.join(classes_list)}\n"
        )

    # Zip it
    shutil.make_archive(
        os.path.join(app.config["DATASETS_FOLDER"], version_id), "zip", version_dir
    )

    # Create version record
    new_version = {
        "project_id": project_id,
        "version_id": version_id,
        "name": f"Version {db.versions.count_documents({'project_id': project_id}) + 1}",
        "images_count": total,
        "download_url": f"http://localhost:5000/datasets/{version_id}.zip",
    }
    result = db.versions.insert_one(new_version)
    new_version["_id"] = result.inserted_id

    return jsonify(serialize_doc(new_version)), 201


# ---- Serve Static Datasets ----
@app.route("/datasets/<filename>")
def serve_dataset(filename):
    return send_from_directory(app.config["DATASETS_FOLDER"], filename)


# ---- Models and Training ----
@app.route("/api/projects/<project_id>/models", methods=["GET"])
def get_models(project_id):
    models = list(db.models.find({"project_id": project_id}))
    return jsonify([serialize_doc(m) for m in models])


@app.route("/api/projects/<project_id>/models", methods=["POST"])
def train_model(project_id):
    data = request.json or {}
    version_id = data.get("version_id")
    # Mocking standard train logic
    new_model = {
        "project_id": project_id,
        "version_id": version_id,
        "name": f"VisionFlow Model (v{db.models.count_documents({'project_id': project_id}) + 1})",
        "accuracy": f"{random.uniform(85, 96):.1f}%",
        "mAP": f"{random.uniform(0.65, 0.92):.2f}",
        "status": "Ready",
    }
    result = db.models.insert_one(new_model)
    new_model["_id"] = result.inserted_id
    return jsonify(serialize_doc(new_model)), 201


@app.route("/api/projects/<project_id>/models/<model_id>/infer", methods=["POST"])
def infer(project_id, model_id):
    if "file" not in request.files:
        return jsonify({"error": "No image to process"}), 400

    # Mock finding classes from project annotations
    assets = list(db.assets.find({"project_id": project_id}))
    classes_set = set()
    for a in db.annotations.find(
        {"asset_id": {"$in": [str(x["_id"]) for x in assets]}}
    ):
        if "label" in a:
            classes_set.add(a["label"])

    classes_list = list(classes_set)
    if not classes_list:
        classes_list = ["Target Object"]

    predictions = []
    for _ in range(random.randint(1, 4)):
        w = float(f"{random.uniform(0.1, 0.4):.3f}")
        h = float(f"{random.uniform(0.1, 0.4):.3f}")
        predictions.append(
            {
                "class": random.choice(classes_list),
                "confidence": float(f"{random.uniform(0.6, 0.99):.3f}"),
                "x": float(f"{random.uniform(w/2, 1-w/2):.3f}"),
                "y": float(f"{random.uniform(h/2, 1-h/2):.3f}"),
                "width": w,
                "height": h,
            }
        )

    return (
        jsonify(
            {
                "time": float(f"{random.uniform(0.015, 0.045):.3f}"),
                "predictions": predictions,
            }
        ),
        200,
    )


if __name__ == "__main__":
    # Running without authentication/limits for public free usage
    app.run(debug=True, host="0.0.0.0", port=5000)
