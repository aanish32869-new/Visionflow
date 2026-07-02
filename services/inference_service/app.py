import os
import hashlib
import time

from flask import Flask, jsonify, g, request
from flask_cors import CORS
from config import Config
from utils.logger import logger
from controllers.inference_controller import inference_bp
from services.inference_service import record_kpi_events

logger.info("Initializing Inference Service v2.0...")

def create_app():
    app = Flask(__name__)
    CORS(app)
    
    # Load configuration
    app.config.from_object(Config)
    
    # Register blueprints
    app.register_blueprint(inference_bp)

    def _identity():
        forwarded_for = str(request.headers.get("X-Forwarded-For", "")).split(",")[0].strip()
        remote_addr = forwarded_for or request.remote_addr or "unknown"
        user_agent = request.headers.get("User-Agent", "")
        fingerprint = hashlib.sha1(f"{remote_addr}|{user_agent}".encode("utf-8")).hexdigest()[:24]
        return {
            "session_id": request.headers.get("X-Visionflow-Session") or fingerprint,
            "visitor_id": request.headers.get("X-Visionflow-Visitor") or fingerprint,
        }

    @app.before_request
    def kpi_before_request():
        g.kpi_started_at = time.perf_counter()

    @app.after_request
    def kpi_after_request(response):
        path = str(request.path or "")
        if path.startswith("/api/") and not path.startswith("/api/kpi/"):
            started = getattr(g, "kpi_started_at", None)
            duration_ms = ((time.perf_counter() - started) * 1000.0) if started else None
            identity = _identity()
            ts = int(time.time() * 1000)
            route_group = "inference"
            if path.endswith("/health"):
                route_group = "health"
            elif "/inference-history" in path:
                route_group = "inference-history"
            elif "/infer" in path:
                route_group = "inference"
            elif "/models" in path:
                route_group = "models"

            docs = [
                {
                    "type": "http_response",
                    "metric": "response_time",
                    "source": "inference-service",
                    "route_group": route_group,
                    "path": path,
                    "method": request.method,
                    "status_code": response.status_code,
                    "duration_ms": round(duration_ms, 2) if duration_ms is not None else None,
                    "session_id": identity["session_id"],
                    "visitor_id": identity["visitor_id"],
                    "ts": ts,
                    "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts / 1000)),
                    "is_up": response.status_code < 500,
                }
            ]

            if request.method == "GET":
                docs.append(
                    {
                        "type": "page_hit",
                        "metric": "traffic",
                        "source": "inference-service",
                        "route_group": route_group,
                        "path": path,
                        "method": request.method,
                        "status_code": response.status_code,
                        "duration_ms": round(duration_ms, 2) if duration_ms is not None else None,
                        "session_id": identity["session_id"],
                        "visitor_id": identity["visitor_id"],
                        "ts": ts,
                        "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts / 1000)),
                        "page_count": 1,
                        "is_visit": True,
                    }
                )

            if response.status_code < 400 and request.method in {"POST", "PUT", "PATCH", "DELETE"}:
                docs.append(
                    {
                        "type": "conversion",
                        "metric": "conversion_rate",
                        "source": "inference-service",
                        "route_group": route_group,
                        "path": path,
                        "method": request.method,
                        "status_code": response.status_code,
                        "duration_ms": round(duration_ms, 2) if duration_ms is not None else None,
                        "session_id": identity["session_id"],
                        "visitor_id": identity["visitor_id"],
                        "ts": ts,
                        "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts / 1000)),
                        "is_conversion": True,
                    }
                )

            if path.endswith("/health"):
                docs.append(
                    {
                        "type": "health_check",
                        "metric": "uptime",
                        "source": "inference-service",
                        "route_group": "health",
                        "path": path,
                        "method": request.method,
                        "status_code": response.status_code,
                        "duration_ms": round(duration_ms, 2) if duration_ms is not None else None,
                        "session_id": identity["session_id"],
                        "visitor_id": identity["visitor_id"],
                        "ts": ts,
                        "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts / 1000)),
                        "is_up": response.status_code < 500,
                    }
                )

            record_kpi_events(docs)
        return response

    @app.route('/health')
    def health():
        payload = {"status": "ok", "service": "inference-service", "version": "2.0.0"}
        response = jsonify(payload)
        record_kpi_events([
            {
                "type": "health_check",
                "metric": "uptime",
                "source": "inference-service",
                "route_group": "health",
                "path": "/health",
                "method": "GET",
                "status_code": 200,
                "duration_ms": 0,
                "session_id": _identity()["session_id"],
                "visitor_id": _identity()["visitor_id"],
                "ts": int(time.time() * 1000),
                "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "is_up": True,
            }
        ])
        return response

    return app

if __name__ == '__main__':
    app = create_app()
    app.run(host='0.0.0.0', port=Config.PORT)
