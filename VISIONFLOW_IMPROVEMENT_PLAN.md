# VisionFlow Improvement Plan

## Goal

Make VisionFlow feel like a serious local-first computer vision platform, not just a Roboflow copy.

The best direction is:

- Local-first dataset management
- Private/offline training and inference
- Transparent dataset versioning
- Faster AI-assisted labeling
- Better tools for dataset quality, review, and model improvement

## 1. Fix The Foundation First

- Fix API routing for model inference.
  - `/api/projects/:projectId/models/:modelId/infer` should go to the inference service.
  - Current proxy rules can send model inference traffic to the training service first.

- Fix Docker Compose service paths.
  - Some compose paths use dash folders like `dataset-service`.
  - The repo uses folders like `dataset_service` and `auth_service`.

- Remove testing-only UI from production.
  - `Global Test Route Active` should not appear in the real app.
  - Use the real app entry instead of mounting the test host directly.

- Remove forced 1920x1080 layout behavior.
  - Current CSS overrides `h-screen`, `w-screen`, `min-h-screen`, and `max-h-screen`.
  - This makes responsive design harder and can break smaller screens.

- Replace demo/simulated UI results with real backend states.
  - Visualize tab should call a real inference endpoint.
  - Analytics tab should use real image dimensions, class counts, and split data.

- Add consistent error handling.
  - Every fetch call should show a useful UI error.
  - Avoid silent failures in upload, train, export, and deploy flows.

## 2. Make Dataset Management Stronger

- Add dataset diffing.
  - Show what changed between version 1 and version 2.
  - Compare added images, removed images, changed annotations, class changes, and split changes.

- Add dataset lineage.
  - Show how a version was generated:
    - source images
    - preprocessing
    - augmentations
    - class remaps
    - tag filters
    - split settings

- Add version lock guarantees.
  - Once a version is ready, it should never change.
  - Store frozen image and annotation manifests.

- Add manifest export.
  - Export a `manifest.json` with every dataset archive.
  - Include image hashes, annotation counts, classes, splits, and generation options.

- Add duplicate detection.
  - Detect exact duplicates by file hash.
  - Later add near-duplicate detection with embeddings.

- Add broken data checks.
  - Missing image file
  - Empty label file
  - Invalid bounding box
  - Class not in project ontology
  - Image too small
  - Extreme aspect ratio

## 3. Improve Annotation Experience

- Add keyboard shortcuts.
  - Save
  - Next image
  - Previous image
  - Delete selected annotation
  - Switch box/polygon/drag tools

- Add review queues.
  - Needs labeling
  - Needs review
  - Rejected
  - Approved
  - Sent to dataset

- Add model-assisted review.
  - Highlight low-confidence predictions.
  - Highlight overlapping boxes.
  - Highlight missing labels based on previous model behavior.

- Add annotation history per image.
  - Who labeled it
  - When it changed
  - What changed

- Add bulk actions.
  - Apply tag to selected images
  - Move selected images to dataset
  - Delete selected images
  - Reassign selected images to review

- Add better polygon and segmentation support.
  - Polygon editing
  - Point dragging
  - Mask preview
  - Export masks properly

## 4. Make Auto-Labeling A Signature Feature

- Support prompt-based detection.
  - Let users type objects like `helmet`, `forklift`, `oil leak`, or `damaged box`.
  - Run open-vocabulary models when available.

- Add auto-label confidence review.
  - High confidence: approve quickly.
  - Medium confidence: review.
  - Low confidence: flag.

- Add active learning.
  - Train model.
  - Run model on unlabeled images.
  - Find uncertain predictions.
  - Ask the user to label only the most valuable images.

- Add auto-label comparison.
  - Compare YOLOv8, YOLO-World, custom model, and future models on the same image.
  - Let the user choose which result to keep.

- Add local batch labeling jobs.
  - Progress bar
  - ETA
  - Failed image list
  - Retry failed images

## 5. Make Training More Useful

- Make training depend only on dataset versions.
  - Do not train from live mutable data.
  - Every model should link to one exact dataset version.

- Add training presets.
  - Fast test
  - Balanced
  - High accuracy
  - CPU safe
  - GPU optimized

- Add real training logs in UI.
  - Epoch progress
  - Loss
  - mAP
  - Precision
  - Recall
  - Confusion matrix

- Add model comparison.
  - Compare models by:
    - dataset version
    - architecture
    - training time
    - mAP
    - precision
    - recall
    - inference speed

- Add training failure diagnosis.
  - Missing data.yaml
  - No labels
  - Bad class map
  - Not enough images
  - GPU unavailable

## 6. Build A Real Deployment Layer

- Implement backend routes for deployments.
  - `/api/deployments/summary`
  - `/api/deployments`
  - `/api/deployments/:id/activate`
  - `/api/deployments/:id`

- Add local deployment targets.
  - Local API server
  - Docker container
  - ONNX export
  - TensorRT export
  - OpenVINO export

- Add generated SDK snippets.
  - Python
  - JavaScript
  - cURL

- Add endpoint testing.
  - Upload image
  - Run prediction
  - Show latency
  - Show model version

- Add deployment status.
  - Draft
  - Building
  - Running
  - Failed
  - Stopped

## 7. Make It Different From Roboflow

- Position the product as local-first and privacy-first.
  - No cloud required.
  - Runs on local machine or private server.
  - User owns data, weights, and exports.

- Add "Dataset Doctor".
  - A dedicated quality dashboard that explains what is wrong and how to fix it.

- Add "Experiment Notebook".
  - Show a timeline of dataset versions, training runs, models, and deployments.

- Add "One Click Local Deploy".
  - Train a model and launch a local inference API immediately.

- Add "Model Error Mining".
  - Run a model on the dataset.
  - Find false positives, false negatives, and low-confidence samples.
  - Send those samples back to annotation review.

- Add "Reproducible Dataset Cards".
  - Every version gets a card with:
    - dataset stats
    - class distribution
    - preprocessing
    - augmentation
    - known issues
    - export formats
    - training runs using it

## 8. Improve Architecture

- Split large frontend files.
  - `ProjectUpload.jsx` is too large.
  - `RapidUpload.jsx` is too large.
  - `TrainTab.jsx` is too large.

- Create frontend API client modules.
  - `api/projects.js`
  - `api/assets.js`
  - `api/versions.js`
  - `api/training.js`
  - `api/inference.js`
  - `api/deployments.js`

- Use shared backend route ownership.
  - Project service owns projects, folders, assets, jobs.
  - Dataset service owns versions, exports, analytics.
  - Training service owns training jobs and model registry.
  - Inference service owns predictions and auto-labeling.

- Avoid duplicate route implementations.
  - Some batch routes exist in both Node project service and Python dataset service.
  - Pick one owner per route.

- Add shared schemas.
  - Asset
  - Annotation
  - DatasetVersion
  - TrainingJob
  - Model
  - Deployment

## 9. Improve Security And Production Readiness

- Hash user passwords.
  - Never store plaintext passwords.

- Use real authentication tokens.
  - JWT or session tokens.
  - Add expiration.
  - Add protected routes.

- Add workspace ownership.
  - Every project should belong to a workspace and user.

- Add upload validation.
  - File type
  - File size
  - Image dimensions
  - Duplicate detection

- Add audit logs.
  - Project created
  - Asset uploaded
  - Annotation changed
  - Version generated
  - Model trained
  - Deployment activated

## 10. Add Tests That Matter

- Add API tests for project creation.
- Add API tests for image upload.
- Add API tests for annotation save/load.
- Add API tests for moving batches to dataset.
- Add API tests for version generation.
- Add API tests for export archive contents.
- Add API tests for training job creation.
- Add frontend smoke tests for:
  - projects page
  - upload flow
  - annotation tool
  - versions tab
  - training tab

## 11. Suggested First 10 Changes

1. Fix inference proxy routing.
2. Fix Docker Compose paths.
3. Remove test-host badge from production UI.
4. Remove forced 1920x1080 Tailwind overrides.
5. Implement real `/api/deployments` backend routes or hide deploy UI until ready.
6. Replace Visualize mock inference with real model inference.
7. Make Analytics tab use backend analytics instead of hardcoded values.
8. Restore real export format selection instead of forcing YOLOv8.
9. Split `ProjectUpload.jsx` into smaller components.
10. Add a dataset version manifest and diff view.

## 12. Best Product Identity

VisionFlow should become:

> A local-first computer vision lab for building, improving, training, and deploying private datasets and models without cloud lock-in.

That identity is stronger than copying Roboflow directly.

