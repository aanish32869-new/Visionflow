import json
import os
import queue
import time
import uuid
import configparser
from datetime import datetime, timezone
from pathlib import Path
from flask import Flask, Response, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

subscribers = set()
history = []
MAX_HISTORY = 100
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
CONF_PATH = ROOT_DIR / "visionflow.conf"

def _load_env_from_conf():
    if not CONF_PATH.exists():
        return
    parser = configparser.ConfigParser()
    parser.read(str(CONF_PATH))
    if "visionflow" in parser:
        for key, value in parser["visionflow"].items():
            os.environ.setdefault(key.upper(), value)

def notifications_enabled():
    return str(os.getenv("NOTIFICATIONS_ENABLED", "true")).strip().lower() not in {"0", "false", "no", "off"}

_load_env_from_conf()

def _utc_now():
    return datetime.now(timezone.utc).isoformat()

def _normalize_notification(payload):
    status = str(payload.get("status") or payload.get("type") or "Information").capitalize()
    if status == "Info":
        status = "Information"
    if status not in {"Success", "Warning", "Error", "Information"}:
        status = "Information"

    return {
        "id": payload.get("id") or uuid.uuid4().hex,
        "title": payload.get("title") or "VisionFlow notification",
        "description": payload.get("description") or "",
        "status": status,
        "type": payload.get("type") or status.lower(),
        "route": payload.get("route") or "/",
        "projectId": payload.get("projectId"),
        "source": payload.get("source") or "backend",
        "timestamp": payload.get("timestamp") or _utc_now(),
    }

def publish_notification(payload):
    if not notifications_enabled():
        return None

    notification = _normalize_notification(payload)
    if not any(item["id"] == notification["id"] for item in history):
        history.insert(0, notification)
        del history[MAX_HISTORY:]

    dead_subscribers = []
    for subscriber in list(subscribers):
        try:
            subscriber.put_nowait(notification)
        except Exception:
            dead_subscribers.append(subscriber)

    for subscriber in dead_subscribers:
        subscribers.discard(subscriber)

    return notification

@app.route('/health')
def health():
    return jsonify({"status": "ok", "service": "notification-service", "notifications_enabled": notifications_enabled()})

@app.route('/api/notifications/config', methods=['GET'])
def notification_config():
    return jsonify({"enabled": notifications_enabled()})

@app.route('/api/notifications', methods=['GET'])
def list_notifications():
    return jsonify(history)

@app.route('/api/notifications', methods=['POST'])
def create_notification():
    data = request.get_json(silent=True) or {}
    notification = publish_notification(data)
    if notification is None:
        return jsonify({"enabled": False, "status": "disabled"}), 202
    return jsonify(notification), 201

@app.route('/api/notifications/stream')
def notification_stream():
    if not notifications_enabled():
        return Response(": notifications disabled\n\n", mimetype="text/event-stream")

    subscriber = queue.Queue(maxsize=100)
    subscribers.add(subscriber)

    def stream():
        try:
            yield ": connected\n\n"
            while True:
                try:
                    notification = subscriber.get(timeout=20)
                    data = json.dumps(notification)
                    yield f"event: notification\ndata: {data}\n\n"
                except queue.Empty:
                    yield f": heartbeat {int(time.time())}\n\n"
        finally:
            subscribers.discard(subscriber)

    return Response(stream(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5009)
