import os
import sys
# Add service root and repository root to path
service_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
repo_root = os.path.abspath(os.path.join(service_root, "..", ".."))

if service_root not in sys.path:
    sys.path.insert(0, service_root)
if repo_root not in sys.path:
    sys.path.append(repo_root)

from services.common.logger_py import get_logger

logger = get_logger("INFERENCE")
