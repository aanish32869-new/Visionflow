# VisionFlow

============================================================
              VisionFlow Installation Guide
============================================================

VisionFlow is a computer vision platform for project setup, dataset management, annotation, training, inference, and export.

It is built as a modular local platform with:

- A web app for working with projects and datasets
- Backend services for projects, datasets, training, inference, and export
- Background workers for longer-running jobs
- MongoDB for metadata and project state
- Storage for uploads, datasets, and training artifacts

============================
        WHAT VISIONFLOW DOES
============================

VisionFlow supports the full computer vision workflow:

1. Create a project
2. Upload images or datasets
3. Annotate and review assets
4. Generate dataset versions
5. Train a model
6. Run inference on new images
7. Export results or model artifacts

============================
        WORKING FLOW
============================

1. Sign in or start a project workflow
   - Use the web app to access the platform.
   - If authentication is enabled, sign in or create an account first.

2. Create a project
   - Choose the project type, such as Object Detection or Classification.
   - Add project metadata, labels, visibility, and workspace details.

3. Upload assets
   - Add images or datasets to the project.
   - Uploaded files are stored and tracked as project assets.

4. Annotate data
   - Open the annotation tool and label objects or classes.
   - Save annotations for each asset.
   - Review and approval states can be applied before versioning.

5. Generate a dataset version
   - Once annotations are ready, create a dataset version.
   - The dataset version becomes the training-ready snapshot of the project.

6. Train a model
   - Select a dataset version and choose an architecture.
   - Training jobs run asynchronously and track progress, logs, and metrics.
   - When training completes, the model is registered in the model registry.

7. Run inference
   - Use a trained model to predict on new images or batches.
   - Inference results can be used for review, auto-labeling, or downstream export.

8. Export or deploy
   - Export datasets, predictions, or training artifacts when needed.
   - Use deployment-oriented outputs for serving or sharing model results.

============================
        LOCAL SETUP
============================

This repository can run locally without Docker.

Prerequisites:

- Node.js
- Python 3.10 or newer
- MongoDB running on `mongodb://localhost:27017/`

Install dependencies from the project root:

```powershell
npm install
npm run install:all
```

Start VisionFlow:

1. Make sure MongoDB is running locally.
2. Start the services and frontend:

```powershell
npm start
```

Optional auth service:

```powershell
python services/auth_service/app.py
```

============================
          SERVICES
============================

- Web app: `http://localhost:5173`
- API gateway: `http://localhost:5000`
- Auth service: `http://localhost:5001`
- Dataset service: `http://localhost:5003`
- Project service: `http://localhost:5004`
- Training service: `http://localhost:5005`
- Inference service: `http://localhost:5006`

============================
        REPOSITORY LAYOUT
============================

- `apps/web` - frontend application
- `api-gateway` - local Python proxy for routing API requests
- `services` - backend microservices
- `workers` - background workers for dataset, training, inference, and export jobs
- `ml-platform` - model, pipeline, and training code
- `datasets` - sample dataset assets and metadata
- `visionflow.conf` - local configuration for ports, storage, and defaults

============================
      KEY CONFIGURATION
============================

The main local configuration lives in `visionflow.conf`. It includes:

- MongoDB connection settings
- Service ports
- Storage paths
- Training defaults
- Model defaults
- Theme and UI settings

============================
        SIMPLE SUMMARY
============================

VisionFlow flow in one line:

Upload data -> annotate -> version dataset -> train model -> run inference -> export results

