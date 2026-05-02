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

## 13. Execution Roadmap (90 Days)

### Phase 1 (Weeks 1-3): Stabilize Core Platform

- Fix inference proxy routing and route ownership.
- Fix Docker Compose paths and service startup consistency.
- Remove test-only UI and mock-only flows from production.
- Replace forced layout overrides with responsive defaults.
- Add basic global error handling patterns for API calls.

Exit criteria:

- Upload, annotate, version, train, and infer all work end-to-end locally.
- No production screens depend on hardcoded demo data.
- All core tabs load without console errors.

### Phase 2 (Weeks 4-7): Trustworthy Dataset System

- Add immutable dataset version manifests.
- Add dataset diff view between any two versions.
- Add broken data checks and duplicate detection.
- Add dataset lineage metadata.

Exit criteria:

- Every version has a frozen manifest with hashes.
- Users can explain exactly what changed between versions.
- Dataset quality problems are visible before training starts.

### Phase 3 (Weeks 8-10): Training and Deployment Depth

- Add training presets and real-time training logs.
- Add model comparison across runs.
- Implement deployment routes and local deployment targets.
- Add deployment health checks and endpoint test UI.

Exit criteria:

- Users can compare at least two training runs by metrics and speed.
- Users can deploy at least one model locally and test predictions.
- Deployment status is accurate and actionable.

### Phase 4 (Weeks 11-13): Differentiation Features

- Add Dataset Doctor quality dashboard.
- Add model error mining loop back to annotation.
- Add experiment notebook timeline.
- Add one-click local deploy flow.

Exit criteria:

- The product has at least 2 clearly differentiated workflows versus Roboflow.
- Users can improve model quality through an integrated review loop.

## 14. Priority Levels

### P0 (Must Have)

- Inference routing fix
- Docker/service path fix
- Remove production mocks and test overlays
- Real error handling and auth basics
- Immutable dataset versions

### P1 (Should Have)

- Dataset diff and lineage
- Training logs and model comparison
- Deployments API and local targets
- Upload validation and audit logs

### P2 (Nice to Have)

- Auto-label model comparison
- Active learning loop automation
- Experiment notebook polish
- Advanced near-duplicate detection

## 15. Success Metrics

- Time from upload to first trained model.
- Annotation throughput per hour.
- Dataset version reproducibility rate.
- Training failure rate.
- Deployment success rate.
- Median local inference latency.
- Percentage of low-quality data caught before training.

## 16. Engineering Ownership Suggestion

- Frontend team:
  - annotation UX
  - versions UI
  - training and deployment dashboards

- Platform/API team:
  - routing fixes
  - service boundaries
  - shared schemas
  - auth, ownership, and audit logs

- ML team:
  - auto-labeling integrations
  - active learning loop
  - training preset quality
  - model error mining

## 17. Risks And Mitigation

- Risk: Scope grows too fast.
  - Mitigation: Enforce P0/P1/P2 priorities each sprint.

- Risk: Duplicate logic across services.
  - Mitigation: Assign single-route ownership and remove duplicates.

- Risk: Product feels unstable during migration from mock to real data.
  - Mitigation: Hide unfinished tabs behind feature flags.

- Risk: Local performance issues on CPU-only machines.
  - Mitigation: Add CPU-safe presets and lightweight model defaults.

## 18. Final Direction

The product should not chase feature parity first.

It should win on:

- trust (reproducible datasets),
- speed (local workflows),
- privacy (no cloud requirement),
- and iteration quality (error mining + active learning).

If we execute in this order, VisionFlow becomes a reliable local CV platform with a clear identity instead of a clone.

## 19. Sprint-By-Sprint Checklist (Execution Board)

### Sprint 1: Platform Stability (Week 1)

- [ ] Fix inference route mapping to inference service only.
- [ ] Fix Docker Compose folder/service path mismatches.
- [ ] Remove test-host badge and test-only app entry from production.
- [ ] Remove forced 1920x1080 class overrides and restore responsive behavior.
- [ ] Add global API error surface for upload/train/export/deploy flows.

Definition of done:

- [ ] Full local app boot works with one command.
- [ ] No production tab depends on test scaffold.
- [ ] Core navigation works on laptop resolution without layout clipping.

### Sprint 2: Real Data Flows (Week 2)

- [ ] Replace Visualize mock output with real inference calls.
- [ ] Connect Analytics tab to backend dataset stats.
- [ ] Restore real export format selection logic.
- [ ] Add loading/error/empty states for all major train and version endpoints.

Definition of done:

- [ ] Visualize predicts from selected model.
- [ ] Analytics numbers match backend records.
- [ ] Export output matches selected format.

### Sprint 3: Dataset Reproducibility (Week 3)

- [ ] Generate immutable `manifest.json` for every dataset version.
- [ ] Add version lock checks so ready versions cannot mutate.
- [ ] Add dataset diff API + UI (images, annotations, classes, splits).
- [ ] Add lineage metadata capture at generation time.

Definition of done:

- [ ] Any model links to an immutable dataset manifest.
- [ ] Version-to-version changes are inspectable in UI.

### Sprint 4: Data Quality Guardrails (Week 4)

- [ ] Add broken data checks (missing file, invalid bbox, empty labels, class mismatch).
- [ ] Add exact duplicate detection by hash.
- [ ] Add upload validation (type, size, dimensions).
- [ ] Add quality summary surface in dataset/version views.

Definition of done:

- [ ] Quality issues are visible before training can start.
- [ ] Duplicate and invalid assets are flagged with actionable messages.

### Sprint 5: Train Workspace Upgrade (Week 5)

- [ ] Add user-controlled `workers` in `MODELS > Train > Configuration`.
- [ ] Validate train hyperparameter fields (`epochs`, `batch_size`, `img_size`, `workers`).
- [ ] Show resolved runtime params (auto-calculated values) before launch.
- [ ] Improve training failure diagnostics in UI.

Definition of done:

- [ ] User can choose worker count (or auto) before training starts.
- [ ] Invalid hyperparameters are blocked client-side with clear feedback.

### Sprint 6: Deployment Basics (Week 6)

- [ ] Implement `/api/deployments` CRUD + activate routes.
- [ ] Add deployment status pipeline (Draft/Building/Running/Failed/Stopped).
- [ ] Add endpoint smoke test UI with latency and model version.
- [ ] Add Python/JS/cURL code snippets for active endpoint.

Definition of done:

- [ ] A trained model can be deployed locally and tested in-app.

### Sprint 7: Differentiation Layer (Week 7)

- [ ] Build Dataset Doctor MVP.
- [ ] Build model error mining loop to send bad samples back to annotation.
- [ ] Add experiment timeline view linking version -> job -> model -> deployment.

Definition of done:

- [ ] At least two differentiator workflows are demoable end-to-end.

### Sprint 8: Reliability and Security (Week 8)

- [ ] Implement password hashing and token auth.
- [ ] Add workspace/user ownership checks to project resources.
- [ ] Add audit log events for high-value actions.
- [ ] Add API tests and frontend smoke tests for core workflows.

Definition of done:

- [ ] Security baseline and regression suite are in place for releases.
