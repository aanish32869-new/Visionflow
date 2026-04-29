import logging
import os
import json
import traceback
from datetime import datetime
from logging.handlers import RotatingFileHandler

# Single centralized log file path relative to repo root
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOG_FILE = os.path.join(REPO_ROOT, "logs", "visionflow.log")

def get_logger(service_name, module_name="MAIN"):
    # Ensure log directory exists
    log_dir = os.path.dirname(LOG_FILE)
    os.makedirs(log_dir, exist_ok=True)

    logger = logging.getLogger(f"{service_name}.{module_name}")
    
    # Avoid duplicate handlers if already initialized
    if logger.handlers:
        return logger
        
    logger.setLevel(logging.DEBUG)

    # Standard format: 2026-04-19 12:00:00 | LEVEL | SERVICE | MODULE | MESSAGE
    formatter = logging.Formatter('%(asctime)s | %(levelname)-8s | %(service)-8s | %(module_name)-15s | %(message)s')

    # Console Handler
    console = logging.StreamHandler()
    console.setFormatter(formatter)
    logger.addHandler(console)

    # Shared File Handler
    # On Windows, we open with 'a' mode which is generally safe for atomic appends
    # but we avoid RotatingFileHandler from multiple processes on the SAME file.
    # We will let the Node.js service handle rotation.
    file_handler = logging.FileHandler(LOG_FILE, encoding='utf-8', delay=True)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    # Add contextual info to the logger
    logger = logging.LoggerAdapter(logger, {'service': service_name, 'module_name': module_name})
    
    return logger
