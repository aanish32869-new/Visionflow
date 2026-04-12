import requests
import time

# 1. Create a workspace
print("Creating a test workspace...")
ws_res = requests.post("http://localhost:5000/api/workspaces", json={"name": "Roboflow Imports Workspace"})
ws_data = ws_res.json()
workspace_id = ws_data.get("id")

# 2. Create a folder
print("Creating a folder...")
f_res = requests.post("http://localhost:5000/api/folders", json={"name": "Imported Projects", "workspace_id": workspace_id})
folder_id = f_res.json().get("id")

# 3. Create a project
print("Creating an empty project...")
p_res = requests.post("http://localhost:5000/api/projects", json={
    "name": "Roboflow Integration Project",
    "project_type": "Object Detection",
    "visibility": "Private",
    "workspace_id": workspace_id,
    "folder_id": folder_id
})
project_id = p_res.json().get("id")

print(f"Created project {project_id} successfully.")

# Instructions for the user
print("\n--- VISIONFLOW IMPORT TEST INSTRUCTIONS ---")
print("To test the robust Visionflow import, ensure all Docker containers are running (docker-compose up).")
print("Then, execute the following POST request or utilize your frontend:")
print(f"""
curl -X POST http://localhost:5000/api/projects/{project_id}/import/roboflow \\
     -H "Content-Type: application/json" \\
     -d '{{
           "api_key": "YOUR_ROBOFLOW_API_KEY",
           "workspace": "YOUR_ROBOFLOW_WORKSPACE_NAME",
           "project": "YOUR_ROBOFLOW_PROJECT_NAME",
           "version": 1
         }}'
""")
print("This will trigger the backend to use the official PyPI roboflow SDK to download the dataset in YOLOv8 format, parse the schema, move all images to your local /uploads folder, and insert bounding boxes and polygons into your local MongoDB.")
print("Enjoy your new workable backend!")
