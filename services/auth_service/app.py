import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from pymongo import MongoClient

app = Flask(__name__)
CORS(app)

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
try:
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=2000)
    client.server_info()
    print("Connected to actual local MongoDB successfully!")
except Exception:
    import mongomock
    print("Local MongoDB server not found. Reverting to MongoMock.")
    client = mongomock.MongoClient()

db = client.visionflow

@app.route('/health')
def health():
    return jsonify({"status": "ok", "service": "auth-service"})

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
        return jsonify({"success": True, "token": "visionflow-token-" + str(user["_id"])}), 200
    else:
        return jsonify({"error": "Invalid credentials, please try again."}), 401

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)
