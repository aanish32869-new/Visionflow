const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { MongoClient, ObjectId, GridFSBucket } = require("mongodb");

const fsp = fs.promises;
const SERVICE_ROOT = __dirname;
const REPO_ROOT = path.resolve(SERVICE_ROOT, "..", "..");

loadVisionflowConfig(path.join(REPO_ROOT, "visionflow.conf"));

const config = {
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/",
  port: Number(process.env.PORT_PROJECT_SERVICE || 5004),
  dbName: process.env.MONGO_DB_NAME || "visionflow",
  storageRoot: path.resolve(REPO_ROOT, "storage"),
  projectRoot: path.resolve(process.env.PROJECTS_DIR || path.join(REPO_ROOT, "storage", "projects")),
  legacyUploadRoot: path.resolve(process.env.UPLOAD_DIR || path.join(REPO_ROOT, "storage", "uploads")),
};

ensureDirSync(config.storageRoot);
ensureDirSync(config.projectRoot);
ensureDirSync(config.legacyUploadRoot);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.MAX_FILE_SIZE_BYTES || 500 * 1024 * 1024),
  },
});

const allowedProjectTypes = new Set(["Object Detection", "Classification"]);
const PROJECT_LABEL_COLORS = ["#8b5cf6", "#ef4444", "#10b981", "#f59e0b", "#3b82f6", "#ec4899", "#14b8a6"];
const ASSET_FILES_BUCKET = "asset_files";

let client;
let db;
let assetFilesBucket;

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/uploads/assets/:assetId/:filename", async (req, res) => {
  try {
    const asset = await findAssetById(req.params.assetId);
    if (!asset) {
      return res.status(404).json({ error: "Asset not found" });
    }

    const fileId = toObjectId(asset.file_id || asset.current_file_id);
    if (fileId) {
      const fileDoc = await assetFilesBucket.find({ _id: fileId }).next();
      if (!fileDoc) {
        return res.status(404).json({ error: "Asset file not found" });
      }

      res.setHeader(
        "Content-Type",
        asset.metadata?.mimetype || fileDoc.contentType || fileDoc.metadata?.mimetype || "application/octet-stream"
      );
      if (typeof fileDoc.length === "number") {
        res.setHeader("Content-Length", String(fileDoc.length));
      }
      res.setHeader("Cache-Control", "public, max-age=3600");

      assetFilesBucket
        .openDownloadStream(fileId)
        .on("error", () => {
          if (!res.headersSent) {
            res.status(404).json({ error: "Asset file not found" });
          } else {
            res.end();
          }
        })
        .pipe(res);
      return;
    }

    if (asset.path && fs.existsSync(asset.path)) {
      return res.sendFile(path.resolve(asset.path));
    }

    return res.status(404).json({ error: "Asset file not found" });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch asset file" });
  }
});

app.use("/uploads/projects", express.static(config.projectRoot));
app.use("/uploads", express.static(config.legacyUploadRoot));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "project-service-node", version: "1.0.0" });
});

app.get("/api/folders", async (_req, res) => {
  try {
    const folders = await db.collection("folders").find().sort({ name: 1 }).toArray();
    res.json(folders.map(serializeFolder));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch folders" });
  }
});

app.post("/api/folders", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "Folder name cannot be empty." });
    }

    const now = nowIso();
    const doc = { name, created_at: now, updated_at: now };
    const result = await db.collection("folders").insertOne(doc);
    res.status(201).json(serializeFolder({ ...doc, _id: result.insertedId }));
  } catch (error) {
    res.status(500).json({ error: "Failed to create folder" });
  }
});

app.get("/api/workspace-overview", async (_req, res) => {
  try {
    const folders = await db.collection("folders").find().sort({ name: 1 }).toArray();
    const workspace = (await db.collection("workspaces").findOne()) || { name: "VisionFlow Workspace" };
    const projects = await getProjects();

    res.json({
      workspace: serializeWorkspace(workspace),
      folders: folders.map(serializeFolder),
      projects,
      stats: {
        projects: projects.length,
        folders: folders.length,
        images: projects.reduce((sum, project) => sum + (project.images || 0), 0),
        versions: projects.reduce((sum, project) => sum + (project.versions_count || 0), 0),
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch workspace overview" });
  }
});

app.get("/api/projects", async (_req, res) => {
  try {
    res.json(await getProjects());
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    const payload = normalizeProjectPayload(req.body || {});
    const existing = await db.collection("projects").findOne({ normalized_name: payload.normalized_name });
    if (existing) {
      return res.status(409).json({ error: "Project name already exists. Choose a different name." });
    }

    const now = nowIso();
    const projectDoc = {
      ...payload,
      created_at: now,
      updated_at: now,
      public: payload.visibility === "Public",
      detected_classes: Array.isArray(req.body?.detected_classes) ? req.body.detected_classes : [],
      classes: Array.isArray(req.body?.classes) ? req.body.classes : [],
      tags: Array.isArray(req.body?.tags) ? req.body.tags : [],
      annotation_lock_classes: Boolean(req.body?.annotation_lock_classes),
      keypoint_definition: req.body?.keypoint_definition || { points: [], edges: [] },
    };

    const insertResult = await db.collection("projects").insertOne(projectDoc);
    const projectId = insertResult.insertedId.toString();
    const folderKey = `${slugify(payload.name)}-${projectId}`;
    const directories = getProjectDirectories(folderKey);

    await ensureProjectDirectories(directories);

    await db.collection("projects").updateOne(
      { _id: insertResult.insertedId },
      {
        $set: {
          storage: {
            folder_key: folderKey,
            project_root: directories.root,
            dataset_root: directories.datasetRoot,
            annotated_dir: directories.annotatedDir,
            unannotated_dir: directories.unannotatedDir,
            sessions_dir: directories.sessionsDir,
          },
        },
      }
    );

    const created = await db.collection("projects").findOne({ _id: insertResult.insertedId });
    res.status(201).json(serializeProject(created));
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: "Project name already exists. Choose a different name." });
    }
    res.status(error.statusCode || 400).json({ error: error.message || "Failed to create project" });
  }
});

app.delete("/api/projects/:projectId", async (req, res) => {
  try {
    const project = await findProjectById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectId = project._id.toString();
    const storage = getProjectStorage(project);
    const assets = await db.collection("assets").find({ project_id: projectId }).toArray();

    for (const asset of assets) {
      await deleteStoredAssetFile(asset);
      await deleteAnnotationSession(asset._id.toString(), project);
    }

    await db.collection("annotations").deleteMany({ project_id: projectId });
    await db.collection("annotation_sessions").deleteMany({ project_id: projectId });
    await db.collection("assets").deleteMany({ project_id: projectId });
    await db.collection("versions").deleteMany({ project_id: projectId });
    await db.collection("projects").deleteOne({ _id: project._id });

    if (storage.root && isPathInside(storage.root, config.projectRoot) && fs.existsSync(storage.root)) {
      await fsp.rm(storage.root, { recursive: true, force: true });
    }

    res.json({ success: true, deleted_project_id: projectId });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete project" });
  }
});

app.get("/api/projects/:projectId/classes-tags", async (req, res) => {
  try {
    const project = await findProjectById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectId = project._id.toString();
    const [classCounts, tagCounts, assets] = await Promise.all([
      collectProjectClassCounts(projectId),
      collectProjectTagCounts(projectId),
      db.collection("assets").find({ project_id: projectId }).sort({ uploaded_at: -1 }).toArray(),
    ]);

    const classes = buildProjectClasses(project, classCounts).map((item) => ({
      ...item,
      count: Number(classCounts[item.name] || 0),
    }));
    const tags = buildProjectTags(project, tagCounts).map((item) => ({
      ...item,
      count: Number(tagCounts[item.name] || 0),
    }));

    res.json({
      classes,
      tags,
      settings: {
        lock_annotation_classes: Boolean(project.annotation_lock_classes),
        keypoint_definition: project.keypoint_definition || { points: [], edges: [] },
      },
      project_type: project.project_type,
      assets: assets.map(serializeAsset),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch project classes and tags" });
  }
});

app.patch("/api/projects/:projectId/classes-settings", async (req, res) => {
  try {
    const project = await findProjectById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const update = {
      updated_at: nowIso(),
    };

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "lock_annotation_classes")) {
      update.annotation_lock_classes = Boolean(req.body.lock_annotation_classes);
    }
    if (req.body?.keypoint_definition) {
      update.keypoint_definition = normalizeKeypointDefinition(req.body.keypoint_definition);
    }

    await db.collection("projects").updateOne({ _id: project._id }, { $set: update });
    const refreshed = await findProjectById(req.params.projectId);
    res.json({
      success: true,
      settings: {
        lock_annotation_classes: Boolean(refreshed.annotation_lock_classes),
        keypoint_definition: refreshed.keypoint_definition || { points: [], edges: [] },
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to update class settings" });
  }
});

app.post("/api/projects/:projectId/classes", async (req, res) => {
  try {
    const project = await findProjectById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectId = project._id.toString();
    const classCounts = await collectProjectClassCounts(projectId);
    const currentClasses = buildProjectClasses(project, classCounts);
    const nextClass = normalizeProjectClass(req.body || {}, currentClasses.length);

    if (!nextClass) {
      return res.status(400).json({ error: "Class name cannot be empty." });
    }

    const nextClasses = dedupeNamedItems([...currentClasses, nextClass], normalizeProjectClass);
    await db.collection("projects").updateOne(
      { _id: project._id },
      {
        $set: {
          classes: nextClasses,
          detected_classes: nextClasses.map((item) => item.name),
          updated_at: nowIso(),
        },
      }
    );

    res.status(201).json({ success: true, classes: nextClasses });
  } catch (error) {
    res.status(500).json({ error: "Failed to add class" });
  }
});

app.post("/api/projects/:projectId/classes/attributes", async (req, res) => {
  try {
    const project = await findProjectById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const className = String(req.body?.class_name || "").trim();
    const attributeName = String(req.body?.attribute_name || "").trim();
    if (!className || !attributeName) {
      return res.status(400).json({ error: "class_name and attribute_name are required." });
    }

    const classCounts = await collectProjectClassCounts(project._id.toString());
    const classes = buildProjectClasses(project, classCounts);
    const nextClasses = classes.map((item) => {
      if (item.name !== className) return item;
      return {
        ...item,
        attributes: dedupeStrings([...(item.attributes || []), attributeName]),
      };
    });

    await db.collection("projects").updateOne(
      { _id: project._id },
      { $set: { classes: nextClasses, updated_at: nowIso() } }
    );

    res.json({ success: true, classes: nextClasses });
  } catch (error) {
    res.status(500).json({ error: "Failed to update class attributes" });
  }
});

app.post("/api/projects/:projectId/classes/modify", async (req, res) => {
  try {
    const project = await findProjectById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectId = project._id.toString();
    const action = String(req.body?.action || "").trim().toLowerCase();
    const sourceName = String(req.body?.source_name || "").trim();
    const targetName = String(req.body?.target_name || "").trim();
    const replacementName = String(req.body?.replacement_name || "").trim();

    if (!sourceName) {
      return res.status(400).json({ error: "source_name is required." });
    }

    const classCounts = await collectProjectClassCounts(projectId);
    const classes = buildProjectClasses(project, classCounts);
    const existing = classes.find((item) => item.name === sourceName);
    if (!existing) {
      return res.status(404).json({ error: "Class not found." });
    }

    if (action === "rename") {
      if (!replacementName) {
        return res.status(400).json({ error: "replacement_name is required for rename." });
      }
      await db.collection("annotations").updateMany(
        { project_id: projectId, label: sourceName },
        { $set: { label: replacementName, updated_at: nowIso() } }
      );
    } else if (action === "merge") {
      const mergeTarget = targetName || replacementName;
      if (!mergeTarget) {
        return res.status(400).json({ error: "target_name is required for merge." });
      }
      await db.collection("annotations").updateMany(
        { project_id: projectId, label: sourceName },
        { $set: { label: mergeTarget, updated_at: nowIso() } }
      );
    } else if (action === "delete") {
      const affectedAssetIds = await db.collection("annotations").distinct("asset_id", {
        project_id: projectId,
        label: sourceName,
      });
      await db.collection("annotations").deleteMany({ project_id: projectId, label: sourceName });
      await Promise.all(affectedAssetIds.map((assetId) => syncAssetAnnotationState(project, assetId)));
    } else {
      return res.status(400).json({ error: "Unsupported class action." });
    }

    const nextCounts = await collectProjectClassCounts(projectId);
    const desiredClasses = getNextProjectClassesAfterModify(classes, {
      action,
      sourceName,
      targetName,
      replacementName,
    });
    const nextClasses = dedupeNamedItems(
      buildProjectClasses({ ...project, classes: desiredClasses, detected_classes: desiredClasses.map((item) => item.name) }, nextCounts),
      normalizeProjectClass
    );

    await db.collection("projects").updateOne(
      { _id: project._id },
      {
        $set: {
          classes: nextClasses,
          detected_classes: nextClasses.map((item) => item.name),
          updated_at: nowIso(),
        },
      }
    );

    res.json({ success: true, classes: nextClasses });
  } catch (error) {
    res.status(500).json({ error: "Failed to modify class" });
  }
});

app.post("/api/projects/:projectId/tags", async (req, res) => {
  try {
    const project = await findProjectById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectId = project._id.toString();
    const tagCounts = await collectProjectTagCounts(projectId);
    const currentTags = buildProjectTags(project, tagCounts);
    const nextTag = normalizeProjectTag(req.body || {}, currentTags.length);
    if (!nextTag) {
      return res.status(400).json({ error: "Tag name cannot be empty." });
    }

    const nextTags = dedupeNamedItems([...currentTags, nextTag], normalizeProjectTag);
    await db.collection("projects").updateOne(
      { _id: project._id },
      { $set: { tags: nextTags, updated_at: nowIso() } }
    );

    res.status(201).json({ success: true, tags: nextTags });
  } catch (error) {
    res.status(500).json({ error: "Failed to add tag" });
  }
});

app.post("/api/projects/:projectId/tags/apply", async (req, res) => {
  try {
    const project = await findProjectById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectId = project._id.toString();
    const mode = String(req.body?.mode || "add").trim().toLowerCase();
    const assetIds = Array.isArray(req.body?.asset_ids) ? req.body.asset_ids.map((item) => String(item)) : [];
    const tagNames = dedupeStrings(parseBatchTags(req.body?.tags));

    if (!assetIds.length || !tagNames.length) {
      return res.status(400).json({ error: "asset_ids and tags are required." });
    }

    const objectIds = assetIds.map(toObjectId).filter(Boolean);
    const assets = await db.collection("assets").find({
      _id: { $in: objectIds },
      project_id: projectId,
    }).toArray();

    if (!assets.length) {
      return res.status(404).json({ error: "No matching assets found." });
    }

    const now = nowIso();
    const operations = assets.map((asset) => {
      const currentTags = getCombinedAssetTags(asset);
      const nextTags = applyTagMode(currentTags, tagNames, mode);
      return {
        updateOne: {
          filter: { _id: asset._id },
          update: {
            $set: {
              batch_tags: nextTags,
              updated_at: now,
            },
          },
        },
      };
    });

    if (operations.length) {
      await db.collection("assets").bulkWrite(operations);
    }

    const nextTagCounts = await collectProjectTagCounts(projectId);
    const nextTags = buildProjectTags(
      { ...project, tags: [...(project.tags || []), ...tagNames] },
      nextTagCounts
    );
    await db.collection("projects").updateOne(
      { _id: project._id },
      { $set: { tags: nextTags, updated_at: now } }
    );

    res.json({ success: true, updated_assets: operations.length, tags: nextTags });
  } catch (error) {
    res.status(500).json({ error: "Failed to apply tags" });
  }
});

app.post("/api/projects/:projectId/tags/modify", async (req, res) => {
  try {
    const project = await findProjectById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectId = project._id.toString();
    const action = String(req.body?.action || "").trim().toLowerCase();
    const sourceName = String(req.body?.source_name || "").trim();
    const targetName = String(req.body?.target_name || "").trim();

    if (!sourceName) {
      return res.status(400).json({ error: "source_name is required." });
    }

    const assets = await db.collection("assets").find({ project_id: projectId, batch_tags: sourceName }).toArray();
    const now = nowIso();

    const operations = assets.map((asset) => {
      let nextTags = getCombinedAssetTags(asset).filter((item) => item !== sourceName);
      if (action === "rename") {
        if (!targetName) {
          throw new Error("target_name is required for rename.");
        }
        nextTags = dedupeStrings([...nextTags, targetName]);
      } else if (action !== "delete") {
        throw new Error("Unsupported tag action.");
      }

      return {
        updateOne: {
          filter: { _id: asset._id },
          update: {
            $set: {
              batch_tags: nextTags,
              updated_at: now,
            },
          },
        },
      };
    });

    if (operations.length) {
      await db.collection("assets").bulkWrite(operations);
    }

    const tagCounts = await collectProjectTagCounts(projectId);
    const desiredTags = getNextProjectTagsAfterModify(buildProjectTags(project, tagCounts), {
      action,
      sourceName,
      targetName,
    });
    const nextTags = dedupeNamedItems(
      buildProjectTags({ ...project, tags: desiredTags }, tagCounts),
      normalizeProjectTag
    );

    await db.collection("projects").updateOne(
      { _id: project._id },
      { $set: { tags: nextTags, updated_at: now } }
    );

    res.json({ success: true, tags: nextTags });
  } catch (error) {
    res.status(error.message?.includes("target_name") ? 400 : 500).json({ error: error.message || "Failed to modify tag" });
  }
});

app.get("/api/assets", async (req, res) => {
  try {
    const query = {};
    if (req.query.project_id) {
      query.project_id = String(req.query.project_id);
    }

    const assets = await db.collection("assets").find(query).sort({ uploaded_at: -1 }).toArray();
    res.json(assets.map(serializeAsset));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch assets" });
  }
});

app.post("/api/assets", upload.single("file"), async (req, res) => {
  let storedFileId = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const projectId = String(req.body?.project_id || "").trim();
    if (!projectId) {
      return res.status(400).json({ error: "project_id is required for uploads." });
    }

    const project = await findProjectById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const originalFilename = safeFilename(req.file.originalname || "upload");
    const uniqueFilename = `${crypto.randomUUID()}_${originalFilename}`;
    const assetId = new ObjectId();
    storedFileId = await storeUploadInGridFS(req.file.buffer, uniqueFilename, {
      asset_id: assetId.toString(),
      project_id: projectId,
      filename: originalFilename,
      unique_filename: uniqueFilename,
      mimetype: req.file.mimetype,
      source: "upload",
    });
    const uploadedAt = nowIso();
    const updatedAt = uploadedAt;

    const assetDoc = {
      _id: assetId,
      project_id: projectId,
      filename: originalFilename,
      unique_filename: uniqueFilename,
      file_id: storedFileId.toString(),
      storage_backend: "gridfs",
      path: null,
      url: buildAssetUrl(assetId.toString(), uniqueFilename),
      upload_state: "unannotated",
      is_annotated: false,
      annotation_count: 0,
      batch_id: String(req.body?.batch_id || crypto.randomUUID()),
      batch_name: String(req.body?.batch_name || "Imported Batch").trim() || "Imported Batch",
      batch_tags: parseBatchTags(req.body?.batch_tags),
      uploaded_at: uploadedAt,
      updated_at: updatedAt,
      metadata: {
        size: req.file.size,
        mimetype: req.file.mimetype,
        ext: path.extname(originalFilename).replace(/^\./, "").toLowerCase(),
      },
    };

    await db.collection("assets").insertOne(assetDoc);
    await db.collection("projects").updateOne(
      { _id: project._id },
      { $set: { updated_at: nowIso() } }
    );

    res.status(201).json(serializeAsset(assetDoc));
  } catch (error) {
    if (storedFileId) {
      try {
        await assetFilesBucket.delete(storedFileId);
      } catch (_cleanupError) {
        // Best-effort cleanup for failed uploads.
      }
    }
    res.status(error.statusCode || 400).json({ error: error.message || "Upload failed" });
  }
});

app.delete("/api/assets/:assetId", async (req, res) => {
  try {
    const asset = await findAssetById(req.params.assetId);
    if (!asset) {
      return res.status(404).json({ error: "Asset not found" });
    }

    const project = asset.project_id ? await findProjectById(asset.project_id) : null;

    await deleteStoredAssetFile(asset);
    await deleteAnnotationSession(asset._id.toString(), project);
    await db.collection("annotations").deleteMany({ asset_id: asset._id.toString() });
    await db.collection("assets").deleteOne({ _id: asset._id });

    if (project) {
      await db.collection("projects").updateOne(
        { _id: project._id },
        { $set: { updated_at: nowIso() } }
      );
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete asset" });
  }
});

app.get("/api/assets/:assetId/annotations", async (req, res) => {
  try {
    const asset = await findAssetById(req.params.assetId);
    if (!asset) {
      return res.status(404).json({ error: "Asset not found" });
    }

    const assetId = asset._id.toString();
    const annotations = await db.collection("annotations").find({ asset_id: assetId }).toArray();

    if (annotations.length > 0) {
      return res.json(annotations.map(serializeAnnotation));
    }

    const project = asset.project_id ? await findProjectById(asset.project_id) : null;
    if (!project) {
      return res.json([]);
    }

    const sessionDoc = await db.collection("annotation_sessions").findOne({ asset_id: assetId });
    if (sessionDoc && Array.isArray(sessionDoc.annotations)) {
      return res.json(sessionDoc.annotations);
    }

    const sessionFile = path.join(getProjectStorage(project).sessionsDir, `${assetId}.json`);
    if (fs.existsSync(sessionFile)) {
      const session = JSON.parse(await fsp.readFile(sessionFile, "utf8"));
      return res.json(Array.isArray(session.annotations) ? session.annotations : []);
    }

    res.json([]);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch annotations" });
  }
});

app.post("/api/assets/:assetId/annotations", async (req, res) => {
  try {
    const asset = await findAssetById(req.params.assetId);
    if (!asset) {
      return res.status(404).json({ error: "Asset not found" });
    }

    const project = asset.project_id ? await findProjectById(asset.project_id) : null;
    if (!project) {
      return res.status(400).json({ error: "Asset is not linked to a project." });
    }

    const annotations = Array.isArray(req.body?.annotations) ? req.body.annotations : [];
    const assetId = asset._id.toString();
    const projectId = project._id.toString();
    const labels = [...new Set(annotations.map((item) => item?.label).filter(Boolean))];
    const classCounts = await collectProjectClassCounts(projectId);
    const projectClasses = buildProjectClasses(project, classCounts);
    const knownClassNames = new Set(projectClasses.map((item) => item.name.toLowerCase()));
    const unknownLabels = labels.filter((label) => !knownClassNames.has(String(label).toLowerCase()));

    if (project.annotation_lock_classes && unknownLabels.length > 0) {
      return res.status(400).json({
        error: `Class creation is locked for this project. Unknown classes: ${unknownLabels.join(", ")}`,
      });
    }

    await db.collection("annotations").deleteMany({ asset_id: assetId });

    if (annotations.length > 0) {
      const docs = annotations.map((item) => ({
        ...item,
        asset_id: assetId,
        project_id: projectId,
        created_at: item.created_at || nowIso(),
        updated_at: nowIso(),
      }));
      await db.collection("annotations").insertMany(docs);
    }

    const desiredState = annotations.length > 0 ? "annotated" : "unannotated";
    await writeAnnotationSession({
      assetId,
      projectId,
      annotations,
      source: "manual",
    });

    await db.collection("assets").updateOne(
      { _id: asset._id },
      {
        $set: {
          url: buildAssetUrl(assetId, asset.unique_filename || asset.filename || "asset"),
          upload_state: desiredState,
          is_annotated: annotations.length > 0,
          annotation_count: annotations.length,
          updated_at: nowIso(),
        },
      }
    );

    const projectUpdate = {
      $set: { updated_at: nowIso() },
    };
    if (labels.length > 0 && !project.annotation_lock_classes) {
      const nextClasses = dedupeNamedItems(
        buildProjectClasses(
          {
            ...project,
            classes: [...projectClasses, ...labels.map((label) => ({ name: label }))],
            detected_classes: [...(project.detected_classes || []), ...labels],
          },
          { ...classCounts, ...Object.fromEntries(labels.map((label) => [label, 1])) }
        ),
        normalizeProjectClass
      );
      projectUpdate.$set.classes = nextClasses;
      projectUpdate.$set.detected_classes = nextClasses.map((item) => item.name);
    } else if (labels.length > 0) {
      projectUpdate.$set.detected_classes = projectClasses.map((item) => item.name);
    }

    await db.collection("projects").updateOne({ _id: project._id }, projectUpdate);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to save annotations" });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.message });
  }
  return res.status(500).json({ error: "Unexpected project service error" });
});

start().catch((error) => {
  console.error("Failed to start project service", error);
  process.exit(1);
});

async function start() {
  client = new MongoClient(config.mongoUri);
  await client.connect();
  db = client.db(config.dbName);
  assetFilesBucket = new GridFSBucket(db, { bucketName: ASSET_FILES_BUCKET });
  await ensureIndexes();

  app.listen(config.port, () => {
    console.log(`VisionFlow project service listening on http://localhost:${config.port}`);
  });
}

async function ensureIndexes() {
  try {
    await db.collection("projects").createIndex({ normalized_name: 1 }, { unique: true });
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }
    console.warn("Skipping unique normalized_name index creation because existing project names are already duplicated.");
  }
  await db.collection("projects").createIndex({ updated_at: -1 });
  await db.collection("assets").createIndex({ project_id: 1, uploaded_at: -1 });
  await db.collection("annotations").createIndex({ asset_id: 1 });
  await db.collection("annotation_sessions").createIndex({ asset_id: 1 }, { unique: true });
  await db.collection("annotation_sessions").createIndex({ project_id: 1, updated_at: -1 });
  await db.collection("folders").createIndex({ name: 1 });
}

async function getProjects() {
  const projects = await db.collection("projects").find().sort({ updated_at: -1 }).toArray();
  const folderIds = projects.map((project) => project.folder_id).filter(Boolean).map(toObjectId).filter(Boolean);
  const folderDocs = folderIds.length
    ? await db.collection("folders").find({ _id: { $in: folderIds } }).toArray()
    : [];
  const folderMap = new Map(folderDocs.map((folder) => [folder._id.toString(), folder.name]));

  const results = [];
  for (const project of projects) {
    const projectId = project._id.toString();
    const images = await db.collection("assets").countDocuments({ project_id: projectId });
    const annotated = await db.collection("assets").countDocuments({ project_id: projectId, is_annotated: true });
    const versions = await db.collection("versions").countDocuments({ project_id: projectId });

    results.push(
      serializeProject({
        ...project,
        folder_name: project.folder_id ? folderMap.get(String(project.folder_id)) || null : null,
        images,
        unannotated: Math.max(images - annotated, 0),
        versions_count: versions,
        updated: project.updated_at || project.created_at,
      })
    );
  }

  return results;
}

async function collectProjectClassCounts(projectId) {
  const rows = await db.collection("annotations").aggregate([
    { $match: { project_id: String(projectId), label: { $type: "string" } } },
    { $group: { _id: "$label", count: { $sum: 1 } } },
  ]).toArray();
  return Object.fromEntries(rows.map((row) => [row._id, row.count]));
}

async function collectProjectTagCounts(projectId) {
  const assets = await db.collection("assets").find({ project_id: String(projectId) }).project({ batch_tags: 1 }).toArray();
  const counts = {};
  for (const asset of assets) {
    for (const tag of getCombinedAssetTags(asset)) {
      counts[tag] = Number(counts[tag] || 0) + 1;
    }
  }
  return counts;
}

function dedupeStrings(values) {
  const deduped = [];
  const seen = new Set();
  for (const value of values || []) {
    const text = String(value || "").trim();
    const lowered = text.toLowerCase();
    if (text && !seen.has(lowered)) {
      seen.add(lowered);
      deduped.push(text);
    }
  }
  return deduped;
}

function normalizeProjectClass(input, index = 0) {
  const source = typeof input === "string" ? { name: input } : (input || {});
  const name = String(source.name || "").trim();
  if (!name) return null;
  return {
    name,
    color: String(source.color || PROJECT_LABEL_COLORS[index % PROJECT_LABEL_COLORS.length]),
    attributes: dedupeStrings(Array.isArray(source.attributes) ? source.attributes : []),
    keypoints: Array.isArray(source.keypoints) ? source.keypoints : [],
  };
}

function normalizeProjectTag(input, index = 0) {
  const source = typeof input === "string" ? { name: input } : (input || {});
  const name = String(source.name || "").trim();
  if (!name) return null;
  return {
    name,
    color: String(source.color || PROJECT_LABEL_COLORS[index % PROJECT_LABEL_COLORS.length]),
  };
}

function dedupeNamedItems(items, normalizer) {
  const deduped = [];
  const seen = new Set();
  for (const item of items || []) {
    const normalized = normalizer(item, deduped.length);
    if (!normalized) continue;
    const lowered = normalized.name.toLowerCase();
    if (seen.has(lowered)) continue;
    seen.add(lowered);
    deduped.push(normalized);
  }
  return deduped;
}

function buildProjectClasses(project, classCounts = {}) {
  const fromProject = Array.isArray(project?.classes) ? project.classes : [];
  const fromDetected = Array.isArray(project?.detected_classes) ? project.detected_classes : [];
  const fromAnnotations = Object.keys(classCounts || {});
  return dedupeNamedItems([...fromProject, ...fromDetected, ...fromAnnotations], normalizeProjectClass);
}

function buildProjectTags(project, tagCounts = {}) {
  const fromProject = Array.isArray(project?.tags) ? project.tags : [];
  const fromAssets = Object.keys(tagCounts || {});
  return dedupeNamedItems([...fromProject, ...fromAssets], normalizeProjectTag);
}

function normalizeKeypointDefinition(definition) {
  return {
    points: Array.isArray(definition?.points) ? definition.points.map((item) => String(item || "").trim()).filter(Boolean) : [],
    edges: Array.isArray(definition?.edges) ? definition.edges.filter((item) => item && item.from && item.to) : [],
  };
}

function getCombinedAssetTags(asset) {
  return dedupeStrings([...(asset?.batch_tags || []), ...(asset?.tags || [])]);
}

function getNextProjectClassesAfterModify(classes, { action, sourceName, targetName, replacementName }) {
  if (action === "delete") {
    return classes.filter((item) => item.name !== sourceName);
  }

  if (action === "rename") {
    return classes.map((item) =>
      item.name === sourceName
        ? { ...item, name: replacementName || sourceName }
        : item
    );
  }

  if (action === "merge") {
    const mergeTarget = targetName || replacementName || sourceName;
    const sourceClass = classes.find((item) => item.name === sourceName);
    return dedupeNamedItems(
      classes
        .filter((item) => item.name !== sourceName)
        .map((item) =>
          item.name === mergeTarget
            ? {
                ...item,
                attributes: dedupeStrings([...(item.attributes || []), ...(sourceClass?.attributes || [])]),
              }
            : item
        )
        .concat(
          classes.some((item) => item.name === mergeTarget)
            ? []
            : [{ ...(sourceClass || {}), name: mergeTarget }]
        ),
      normalizeProjectClass
    );
  }

  return classes;
}

function getNextProjectTagsAfterModify(tags, { action, sourceName, targetName }) {
  if (action === "delete") {
    return tags.filter((item) => item.name !== sourceName);
  }

  if (action === "rename") {
    return dedupeNamedItems(
      tags.map((item) =>
        item.name === sourceName
          ? { ...item, name: targetName || sourceName }
          : item
      ),
      normalizeProjectTag
    );
  }

  return tags;
}

function applyTagMode(currentTags, tags, mode) {
  const normalizedCurrent = dedupeStrings(currentTags);
  const normalizedTags = dedupeStrings(tags);
  if (mode === "replace") {
    return normalizedTags;
  }
  if (mode === "remove") {
    const removeSet = new Set(normalizedTags.map((item) => item.toLowerCase()));
    return normalizedCurrent.filter((item) => !removeSet.has(item.toLowerCase()));
  }
  return dedupeStrings([...normalizedCurrent, ...normalizedTags]);
}

async function syncAssetAnnotationState(project, assetId) {
  const asset = await findAssetById(assetId);
  if (!asset) return;

  const annotationCount = await db.collection("annotations").countDocuments({ asset_id: String(assetId) });
  const desiredState = annotationCount > 0 ? "annotated" : "unannotated";

  await db.collection("assets").updateOne(
    { _id: asset._id },
    {
      $set: {
        url: buildAssetUrl(asset._id.toString(), asset.unique_filename || asset.filename || "asset"),
        upload_state: desiredState,
        is_annotated: annotationCount > 0,
        annotation_count: annotationCount,
        updated_at: nowIso(),
      },
    }
  );
}

function normalizeProjectPayload(body) {
  const name = String(body?.name || "").trim();
  if (!name) {
    const error = new Error("Project name cannot be empty.");
    error.statusCode = 400;
    throw error;
  }

  const projectType = String(body?.project_type || "Object Detection").trim();
  if (!allowedProjectTypes.has(projectType)) {
    const error = new Error("Only Object Detection and Classification projects are supported.");
    error.statusCode = 400;
    throw error;
  }

  const normalizedName = name.toLocaleLowerCase();
  return {
    name,
    normalized_name: normalizedName,
    tool: String(body?.tool || "Rapid").trim() || "Rapid",
    project_type: projectType,
    classification_type: projectType === "Classification" ? String(body?.classification_type || "Multi-Label") : null,
    annotation_group: String(body?.annotation_group || "objects").trim() || "objects",
    license: String(body?.license || "Public Domain").trim() || "Public Domain",
    visibility: String(body?.visibility || "Public").trim() === "Private" ? "Private" : "Public",
    folder_id: String(body?.folder_id || "").trim() || null,
    workspace_id: String(body?.workspace_id || "default-workspace-id").trim() || "default-workspace-id",
  };
}

function getProjectDirectories(folderKey) {
  const root = path.join(config.projectRoot, folderKey);
  const datasetRoot = path.join(root, "dataset");
  return {
    root,
    datasetRoot,
    annotatedDir: path.join(datasetRoot, "images", "annotated"),
    unannotatedDir: path.join(datasetRoot, "images", "unannotated"),
    sessionsDir: path.join(datasetRoot, "sessions"),
  };
}

function getProjectStorage(project) {
  const folderKey = project?.storage?.folder_key || `${slugify(project.name || "project")}-${project._id.toString()}`;
  return getProjectDirectories(folderKey);
}

async function ensureProjectDirectories(storage) {
  await Promise.all([
    fsp.mkdir(storage.root, { recursive: true }),
    fsp.mkdir(storage.datasetRoot, { recursive: true }),
    fsp.mkdir(storage.annotatedDir, { recursive: true }),
    fsp.mkdir(storage.unannotatedDir, { recursive: true }),
    fsp.mkdir(storage.sessionsDir, { recursive: true }),
  ]);
}

async function findProjectById(projectId) {
  const objectId = toObjectId(projectId);
  if (!objectId) return null;
  return db.collection("projects").findOne({ _id: objectId });
}

async function findAssetById(assetId) {
  const objectId = toObjectId(assetId);
  if (!objectId) return null;
  return db.collection("assets").findOne({ _id: objectId });
}

async function moveFile(sourcePath, targetPath) {
  if (!sourcePath) return;
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fsp.rename(sourcePath, targetPath);
  } catch (error) {
    if (error.code !== "EXDEV") {
      throw error;
    }
    await fsp.copyFile(sourcePath, targetPath);
    await fsp.unlink(sourcePath);
  }
}

async function safeUnlink(targetPath) {
  if (targetPath && fs.existsSync(targetPath)) {
    await fsp.unlink(targetPath);
  }
}

async function storeUploadInGridFS(source, filename, metadata = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = assetFilesBucket.openUploadStream(filename, {
      contentType: metadata.mimetype || "application/octet-stream",
      metadata,
    });
    uploadStream.on("error", reject);
    uploadStream.on("finish", () => resolve(uploadStream.id));

    if (Buffer.isBuffer(source)) {
      uploadStream.end(source);
      return;
    }

    const readStream = fs.createReadStream(source);
    readStream.on("error", reject);
    readStream.pipe(uploadStream);
  });
}

async function deleteStoredAssetFile(asset) {
  const fileId = toObjectId(asset?.file_id || asset?.current_file_id);
  if (fileId) {
    try {
      await assetFilesBucket.delete(fileId);
    } catch (_error) {
      // Missing GridFS files should not block record cleanup.
    }
  }

  if (asset?.path && fs.existsSync(asset.path)) {
    await safeUnlink(asset.path);
  }
}

async function writeAnnotationSession({ assetId, projectId, annotations, source = null, model = null }) {
  const now = nowIso();
  const sessionDoc = {
    asset_id: assetId,
    project_id: projectId,
    saved_at: now,
    updated_at: now,
    annotations: Array.isArray(annotations) ? annotations : [],
  };

  if (source) {
    sessionDoc.source = source;
  }
  if (model) {
    sessionDoc.model = model;
  }

  await db.collection("annotation_sessions").updateOne(
    { asset_id: assetId },
    { $set: sessionDoc },
    { upsert: true }
  );
}

async function deleteAnnotationSession(assetId, project = null) {
  await db.collection("annotation_sessions").deleteOne({ asset_id: assetId });

  if (project?.storage?.folder_key) {
    const legacySessionPath = path.join(getProjectStorage(project).sessionsDir, `${assetId}.json`);
    await safeUnlink(legacySessionPath);
  }
}

function serializeProject(project) {
  return {
    id: project._id.toString(),
    name: project.name,
    tool: project.tool,
    project_type: project.project_type,
    classification_type: project.classification_type || null,
    annotation_group: project.annotation_group,
    annotation: project.annotation_group,
    license: project.license,
    visibility: project.visibility || "Public",
    public: project.public ?? (project.visibility || "Public") === "Public",
    folder_id: project.folder_id || null,
    folder_name: project.folder_name || null,
    workspace_id: project.workspace_id || "default-workspace-id",
    detected_classes: Array.isArray(project.detected_classes) ? project.detected_classes : [],
    classes: buildProjectClasses(project),
    tags: buildProjectTags(project),
    annotation_lock_classes: Boolean(project.annotation_lock_classes),
    keypoint_definition: project.keypoint_definition || { points: [], edges: [] },
    images: project.images || 0,
    unannotated: project.unannotated || 0,
    versions_count: project.versions_count || 0,
    updated: project.updated || project.updated_at || project.created_at || null,
    created_at: project.created_at || null,
    updated_at: project.updated_at || null,
    storage: project.storage || null,
  };
}

function serializeAsset(asset) {
  return {
    id: asset._id.toString(),
    project_id: asset.project_id || null,
    filename: asset.filename,
    unique_filename: asset.unique_filename,
    url: asset.url || buildAssetUrl(asset._id.toString(), asset.unique_filename || asset.filename || "asset"),
    upload_state: asset.upload_state || "unannotated",
    is_annotated: Boolean(asset.is_annotated),
    annotation_count: Number(asset.annotation_count || 0),
    batch_id: asset.batch_id || null,
    batch_name: asset.batch_name || "Imported Batch",
    batch_tags: Array.isArray(asset.batch_tags) ? asset.batch_tags : [],
    uploaded_at: asset.uploaded_at || null,
    updated_at: asset.updated_at || null,
    metadata: asset.metadata || {},
  };
}

function serializeAnnotation(annotation) {
  const { _id, ...rest } = annotation;
  return { ...rest, id: _id.toString() };
}

function serializeFolder(folder) {
  return {
    id: folder._id.toString(),
    name: folder.name,
    created_at: folder.created_at || null,
    updated_at: folder.updated_at || null,
  };
}

function serializeWorkspace(workspace) {
  if (workspace._id) {
    const { _id, ...rest } = workspace;
    return { ...rest, id: _id.toString() };
  }
  return workspace;
}

function buildAssetUrl(assetId, filename) {
  return `/uploads/assets/${assetId}/${encodeURIComponent(String(filename || "asset"))}`;
}

function parseBatchTags(rawValue) {
  if (!rawValue) return [];
  if (Array.isArray(rawValue)) return rawValue.map((value) => String(value).trim()).filter(Boolean);
  return String(rawValue)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function safeFilename(filename) {
  return String(filename || "upload")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, "_");
}

function slugify(value) {
  return String(value || "project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "project";
}

function nowIso() {
  return new Date().toISOString();
}

function toObjectId(value) {
  if (!value || !ObjectId.isValid(String(value))) return null;
  return new ObjectId(String(value));
}

function ensureDirSync(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function isPathInside(candidatePath, parentPath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function loadVisionflowConfig(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  let inVisionflowSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inVisionflowSection = trimmed.toLowerCase() === "[visionflow]";
      continue;
    }
    if (!inVisionflowSection) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim().toUpperCase();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
