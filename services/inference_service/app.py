import os
from flask import Flask, jsonify
from flask_cors import CORS
from config import Config
from utils.logger import logger
from controllers.inference_controller import inference_bp

logger.info("Initializing Inference Service v2.0...")

def create_app():
    app = Flask(__name__)
    CORS(app)
    
    # Load configuration
    app.config.from_object(Config)
    
    # Register blueprints
    app.register_blueprint(inference_bp)
    
    @app.route('/health')
    def health():
        return jsonify({"status": "ok", "service": "inference-service", "version": "2.0.0"})

    return app

if __name__ == '__main__':
    app = create_app()
    app.run(host='0.0.0.0', port=Config.PORT)
