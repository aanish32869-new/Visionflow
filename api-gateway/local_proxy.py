import os
import sys
import configparser
import requests
from flask import Flask, request, Response
from flask_cors import CORS

# Add repository root to path so we can import services.common
repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if repo_root not in sys.path:
    sys.path.append(repo_root)

from services.common.logger_py import get_logger

logger = get_logger("GATEWAY", "PROXY")

app = Flask(__name__)
CORS(app)

logger.info("Starting local development proxy on port 5000...")

config_path = os.path.join(os.path.dirname(__file__), "..", "visionflow.conf")
if os.path.exists(config_path):
    parser = configparser.ConfigParser()
    parser.read(config_path)
    if "visionflow" in parser:
        for key, value in parser["visionflow"].items():
            os.environ[key.upper()] = value

AUTH_PORT     = int(os.getenv("PORT_AUTH_SERVICE",     5001))
DATASET_PORT  = int(os.getenv("PORT_DATASET_SERVICE",  5003))
PROJECT_PORT  = int(os.getenv("PORT_PROJECT_SERVICE",  5004))
TRAINING_PORT = int(os.getenv("PORT_TRAINING_SERVICE", 5005))
INFERENCE_PORT= int(os.getenv("PORT_INFERENCE_SERVICE",5006))

def get_target_port(path):
    # Auth
    if path.startswith('api/signup') or path.startswith('api/login'):
        return AUTH_PORT

    # Inference routes must be checked before generic project model routes.
    if path.startswith('api/projects') and '/models/' in path and path.endswith('/infer'):
        return INFERENCE_PORT
    if path.startswith('api/auto-label') or path.startswith('api/classify') or path.startswith('api/infer'):
        return INFERENCE_PORT
    # Training service — dedicated routes
    if path.startswith('api/training/'):
        return TRAINING_PORT
    if path.startswith('api/models/'):
        return TRAINING_PORT
    if path.startswith('api/projects') and '/train' in path:
        return TRAINING_PORT
    if path.startswith('api/projects') and '/jobs' in path:
        return TRAINING_PORT
    # Projects endpoint with /models → inference (model registry query from inference)
    if path.startswith('api/projects') and '/models' in path:
        return TRAINING_PORT
    # Dataset service
    if path.startswith('api/projects') and ('/versions' in path or '/annotation-status' in path or '/dataset' in path or '/analytics' in path):
        return DATASET_PORT
    if path.startswith('api/batches') and path.endswith('/export'):
        return DATASET_PORT
    # Project service (Node)
    if (
        path.startswith('api/projects')
        or path.startswith('api/assets')
        or path.startswith('api/folders')
        or path.startswith('api/workspace-overview')
        or path.startswith('api/jobs')
        or path.startswith('api/batches')
        or path.startswith('api/logs')
        or path.startswith('api/deployments')
        or path.startswith('api/workflows')
        or path.startswith('uploads/')
    ):
        return PROJECT_PORT
    return DATASET_PORT

@app.route('/', defaults={'path': ''}, methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])
@app.route('/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])
def proxy(path):
    if request.method == 'OPTIONS':
        return Response('', status=200, headers={
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
        })
        
    target_port = get_target_port(path)
    url = f"http://localhost:{target_port}/{path}"
    
    logger.debug(f"Proxying {request.method} {path} to port {target_port}")
    
    headers = {key: value for (key, value) in request.headers if key.lower() != 'host'}
    
    try:
        resp = requests.request(
            method=request.method,
            url=url,
            headers=headers,
            data=request.get_data(),
            params=request.args,
            cookies=request.cookies,
            allow_redirects=False
        )
        
        logger.info(f"Proxied {request.method} {path} -> {resp.status_code}")
        
        excluded_headers = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'access-control-allow-origin']
        resp_headers = [(name, value) for (name, value) in resp.raw.headers.items()
                        if name.lower() not in excluded_headers]
        
        # Add a single CORS header back to the proxied response
        resp_headers.append(('Access-Control-Allow-Origin', '*'))
        
        return Response(resp.content, resp.status_code, resp_headers)
    except requests.exceptions.ConnectionError:
        logger.error(f"Target service on port {target_port} is down for path {path}")
        return Response(f"Service on port {target_port} is down or booting up.", status=502)

if __name__ == '__main__':
    print("Starting local development proxy on port 5000...")
    app.run(host='0.0.0.0', port=5000, threaded=True)
