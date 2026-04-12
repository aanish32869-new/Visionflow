import os
from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route('/health')
def health():
    return jsonify({"status": "ok", "service": "training-service"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5005)
