/* eslint-disable react-hooks/exhaustive-deps, no-unused-vars */
import { useNavigate, useLocation } from "react-router-dom";
import { useState, useRef, useEffect, useMemo } from "react";
import { 
  Upload, Tag, HelpCircle, HardDrive, Edit3, Database, Layers, BarChart2, Hash, 
  Cpu, Box, Eye, Rocket, Check, ArrowUp, FileImage, FileCode, Film, FileText, Code, Globe, Lock,
  Sparkles, User, Users, Building, ChevronRight, UploadCloud, Activity, List, Share2, Network, PieChart,
  Search, X, Plus, Crop, FileCheck, MoreVertical, ArrowRight, Image as ImageIcon, CheckCircle, Info, ChevronDown, Trash, Download,
  Calendar, Clock, EyeOff, ArrowLeft, Loader2
} from "lucide-react";
import AnnotationTool from "../components/AnnotationTool";
import TrainTab from "../components/TrainTab";
import DeployTab from "../components/DeployTab";
import AnalyticsTab from "../components/AnalyticsTab";
import ClassesTab from "../components/ClassesTab";
import ModelsTab from "../components/ModelsTab";
import VisualizeTab from "../components/VisualizeTab";
import AutoLabelBatchPanel from "../components/AutoLabelBatchPanel";
import DatasetTab from "../components/DatasetTab";
import VersionsTab from "../components/VersionsTab";
import GenerateVersionModal from "../components/GenerateVersionModal";
import * as tf from '@tensorflow/tfjs';
import * as mobilenet from '@tensorflow-models/mobilenet';
import logger from "../utils/logger";

function buildBatchId(label) {
  return `${(label || "uploaded-batch").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "uploaded-batch"}-${Date.now()}`;
}

export default function ProjectUpload() {
  const navigate = useNavigate();
  const location = useLocation();
  const storedProjectId = localStorage.getItem("visionflow_active_project_id");
  const storedProjectName = localStorage.getItem("visionflow_active_project_name");
  
  const projectId = location.state?.projectId || storedProjectId || null;
  const projectName = location.state?.projectName || storedProjectName || "My First Project";
  
  const [activeTab, setActiveTab] = useState(location.state?.activeTab || "upload");
  const [assets, setAssets] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [sortBy, setSortBy] = useState("newest");
  const [autoLabelClasses, setAutoLabelClasses] = useState([{ name: "", description: "" }]);
  const [createBatchInstantly, setCreateBatchInstantly] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [isAutoLabeling, setIsAutoLabeling] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadComplete, setIsUploadComplete] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [batchName, setBatchName] = useState(`Uploaded on ${new Date().toLocaleDateString()}`);
  const [batchTagsInput, setBatchTagsInput] = useState("");
  const [similarImages, setSimilarImages] = useState([]);
  const [detectedObject, setDetectedObject] = useState('Objects365');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [projectType, setProjectType] = useState(location.state?.projectType || "Object Detection");
  const [classificationType, setClassificationType] = useState(location.state?.classificationType || null);
  const [annotateView, setAnnotateView] = useState(location.state?.annotateView || 'board'); // 'board' | 'auto-batch' | 'batch' | 'tool' | 'batch-preview'
  const [activeAnnotationBatchId, setActiveAnnotationBatchId] = useState(location.state?.activeAnnotationBatchId || null);
  const [activeAnnotationState, setActiveAnnotationState] = useState(location.state?.activeAnnotationState || null);
  const [activeImageId, setActiveImageId] = useState(null);
  const [isGenerateVersionModalOpen, setIsGenerateVersionModalOpen] = useState(false);
  const [versionCounter, setVersionCounter] = useState(0);

  const [batchImages, setBatchImages] = useState([]);
  const [batchImagesLoading, setBatchImagesLoading] = useState(false);
  const [batchImagesOffset, setBatchImagesOffset] = useState(0);
  const [batchImagesLimit] = useState(50);
  const [batchImagesTotal, setBatchImagesTotal] = useState(0);
  
  // Batch Actions State
  const [activeMenuBatchId, setActiveMenuBatchId] = useState(null);
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [batchToAction, setBatchToAction] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteActionType, setDeleteActionType] = useState("all"); // all | annotations
  const [isBatchActionLoading, setIsBatchActionLoading] = useState(false);

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const menuRef = useRef(null);

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setActiveMenuBatchId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);


  useEffect(() => {
    if (projectId) {
      localStorage.setItem("visionflow_active_project_id", projectId);
      fetchAssets();
      fetchProjectData();
      fetchJobs();
    }
    if (projectName) {
      localStorage.setItem("visionflow_active_project_name", projectName);
    }
  }, [projectId, projectName]);

  useEffect(() => {
     if (annotateView === 'batch-preview' && activeAnnotationBatchId) {
        fetchBatchImages(activeAnnotationBatchId, batchImagesOffset);
     }
  }, [annotateView, activeAnnotationBatchId, batchImagesOffset]);

  const fetchJobs = async () => {
    if (!projectId || projectId === "undefined") return;
    try {
      const res = await fetch(`/api/jobs?project_id=${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data);
      }
    } catch (err) {
      // Ignored for polling
    }
  };

  // Poll for job updates if there are active auto-labeling jobs
  useEffect(() => {
    const hasActiveAutoJobs = jobs.some(j => j.labeler_name === "Rapid AI" && j.annotated_count < j.total_images);
    let interval = null;
    
    if (hasActiveAutoJobs) {
      interval = setInterval(() => {
        fetchJobs();
      }, 3000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [jobs, projectId]);

  useEffect(() => {
    if (location.state?.activeTab) {
      setActiveTab(location.state.activeTab);
    }
    if (location.state?.annotateView) {
      setAnnotateView(location.state.annotateView);
    }
  }, [location.state]);

  useEffect(() => {
    if (detectedObject && detectedObject !== "related objects") {
      setAutoLabelClasses((prev) => {
        if (prev.some((item) => item.name.trim().toLowerCase() === detectedObject.toLowerCase())) {
          return prev;
        }
        if (prev.length === 1 && !prev[0].name.trim()) {
          return [{ name: detectedObject, description: `Detect ${detectedObject} instances in the uploaded batch.` }];
        }
        return prev;
      });
    }
  }, [detectedObject]);

  useEffect(() => {
    const handleSwitchTab = (e) => {
      if (e.detail) setActiveTab(e.detail);
    };
    const handleOpenGenerate = () => {
      setIsGenerateVersionModalOpen(true);
    };

    const handleDataChanged = (e) => {
      if (e.detail?.type === 'dataset') {
         fetchAssets();
      }
    };

    window.addEventListener('visionflow_switch_tab', handleSwitchTab);
    window.addEventListener('visionflow_open_generate_modal', handleOpenGenerate);
    window.addEventListener('visionflow_data_changed', handleDataChanged);

    return () => {
      window.removeEventListener('visionflow_switch_tab', handleSwitchTab);
      window.removeEventListener('visionflow_open_generate_modal', handleOpenGenerate);
      window.removeEventListener('visionflow_data_changed', handleDataChanged);
    };
  }, []);

  const fetchProjectData = async () => {
    logger.debug(`Fetching data for project ${projectId}...`);
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        const me = data.find(p => String(p.id) === String(projectId));
        if (me) {
           logger.info(`Project data loaded: ${me.name}`);
           if (me.project_type) setProjectType(me.project_type);
           if (me.classification_type) setClassificationType(me.classification_type);
        } else {
           logger.warn(`Project ${projectId} not found in projects list`);
        }
      } else {
        logger.error(`Failed to fetch projects: ${res.status}`);
      }
    } catch(err) {
      logger.error("Error fetching project data", err);
    }
  };

  const fetchAssets = async () => {
    logger.debug(`Fetching assets for project ${projectId}...`);
    try {
      const res = await fetch(`/api/assets?project_id=${projectId}`);
      if (res.ok) {
        const data = await res.json();
        logger.info(`Successfully fetched ${data.length} assets`);
        setAssets(data);
      } else {
        logger.error(`Failed to fetch assets: ${res.status}`);
      }
    } catch(err) {
      logger.error("Error fetching assets", err);
    }
  };

  const fetchBatchImages = async (batchId, offset = 0) => {
     if (!batchId) return;
     setBatchImagesLoading(true);
     logger.debug(`Fetching batch images for ${batchId} offset ${offset}`);
     try {
        const res = await fetch(`/api/assets?project_id=${projectId}&batch_id=${batchId}&status=annotated&limit=${batchImagesLimit}&offset=${offset}`);
        if (res.ok) {
           const data = await res.json();
           if (offset === 0) {
              setBatchImages(data);
           } else {
              setBatchImages(prev => [...prev, ...data]);
           }
           // Since our backend doesn't return total count yet in assets array, we estimate or fetch separately.
           // For now, let's assume if we get less than limit, we reached the end.
           setBatchImagesTotal(prev => offset === 0 ? data.length : prev); 
        }
     } catch (err) {
        logger.error("Error fetching batch images", err);
     } finally {
        setBatchImagesLoading(false);
     }
  };

  const handleAddToDataset = async (batch) => {
     if (!batch) return;
     const confirmed = window.confirm(`Move all labeled images in "${batch.batch_name}" to the finalized Dataset?`);
     if (!confirmed) return;

     logger.info(`Moving batch ${batch.batch_id} to dataset`);
     try {
        const res = await fetch(`/api/batches/${batch.batch_id}/dataset`, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ project_id: projectId })
        });
        if (res.ok) {
           logger.info(`Batch ${batch.batch_id} moved to dataset successfully`);
           // Refresh everything
           fetchAssets();
           setAnnotateView('board');
           setActiveAnnotationBatchId(null);
           setBatchImages([]);
        } else {
           logger.error(`Failed to move batch to dataset: ${res.status}`);
        }
     } catch (err) {
        logger.error("Error adding to dataset", err);
     }
  };

  const deleteAsset = async (assetId) => {
    try {
      const res = await fetch(`/api/assets/${assetId}`, { method: 'DELETE' });
      if (res.ok) {
        setAssets(prev => prev.filter(a => String(a.id) !== String(assetId)));
      }
    } catch(err) {
      console.error("Failed deleting asset", err);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const uploadFile = async (file, batchMeta = {}) => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => resolve(xhr.response);
      xhr.onerror = () => reject(xhr.statusText);
      xhr.open("POST", "/api/assets");
      const formData = new FormData();
      formData.append("file", file);
      if (projectId) formData.append('project_id', projectId);
      if (batchMeta.batchId) formData.append('batch_id', batchMeta.batchId);
      if (batchMeta.batchName) formData.append('batch_name', batchMeta.batchName);
      if (batchMeta.batchTags) formData.append('batch_tags', batchMeta.batchTags);
      xhr.send(formData);
    });
  };

  const processFiles = async (files) => {
    if (!files.length) return;
    setIsUploading(true);
    setSimilarImages([]);
    const normalizedBatchName = batchName.trim() || `Uploaded on ${new Date().toLocaleDateString()}`;
    const batchMeta = {
      batchId: buildBatchId(normalizedBatchName),
      batchName: normalizedBatchName,
      batchTags: batchTagsInput,
    };
    
    const filesArray = Array.from(files);
    const CHUNK_SIZE = 5; // Process in chunks to prevent crashing on 500GB massive loads
    
    // AI similarity engine
    if (filesArray[0].type.startsWith('image/')) {
        setIsAnalyzing(true);
        try {
           const imgUrl = URL.createObjectURL(filesArray[0]);
           const img = new Image();
           img.src = imgUrl;
           await new Promise(r => { img.onload = r; });
           const model = await mobilenet.load({ version: 2, alpha: 0.5 });
           const predictions = await model.classify(img);
           let label = predictions[0].className.split(',')[0].trim();
           setDetectedObject(label);
           
           const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&generator=search&gsrsearch=${encodeURIComponent(label)}&pithumbsize=300&format=json&origin=*`);
           const data = await res.json();
           const foundURLs = [];
           if (data.query && data.query.pages) {
               Object.values(data.query.pages).forEach(p => {
                  if (p.thumbnail && p.thumbnail.source) foundURLs.push(p.thumbnail.source);
               });
           }
           
           if(foundURLs.length < 3) {
               const fallback = Array.from({length: 10}).map((_, i) => `https://picsum.photos/seed/${label.replace(/\s+/g,'')}${i}/200/200`);
               setSimilarImages(fallback);
           } else {
               setSimilarImages(foundURLs);
           }
        } catch (err) {
           console.error("TFJS Analyze error", err);
           setSimilarImages(Array.from({length: 8}).map((_, i) => `https://picsum.photos/seed/visionflow${i}/200/200`));
           setDetectedObject('related objects');
        }
        setIsAnalyzing(false);
    } else {
        setSimilarImages(Array.from({length: 8}).map((_, i) => `https://picsum.photos/seed/video${i}/200/200`));
    }

    // Initialize progress map safely (cap at 50 to prevent state bloat & crashing)
    const initialProgress = {};
    for (let i = 0; i < Math.min(filesArray.length, 50); i++) {
        initialProgress[filesArray[i].name] = 0;
    }
    setUploadProgress(prev => ({...prev, ...initialProgress}));
    
    for (let i = 0; i < filesArray.length; i += CHUNK_SIZE) {
       const chunk = filesArray.slice(i, i + CHUNK_SIZE);
       const promises = chunk.map(async (file, idx) => {
           let p = 0;
           const intvl = setInterval(() => {
              p += 15;
              if (i + idx < 50) { // Only animate progress for first 50 items
                  setUploadProgress(prev => ({...prev, [file.name]: Math.min(p, 100)}));
              }
              if (p >= 100) clearInterval(intvl);
           }, 200);
           try {
              await uploadFile(file, batchMeta);
           } catch(e) {
              console.error(e);
           } finally {
              clearInterval(intvl);
              if (i + idx < 50) {
                  setUploadProgress(prev => ({...prev, [file.name]: 100}));
              }
           }
       });
       await Promise.all(promises);
    }
    
    setIsUploading(false);
    setActiveAnnotationBatchId(batchMeta.batchId);
    fetchAssets();
    setActiveTab("annotate");
    setAnnotateView("batch");
  };

  const handleFileChange = (e) => processFiles(e.target.files);

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    const items = e.dataTransfer.items;
    if (items) {
      const files = [];
      const getFileFromEntry = (entry) => {
        return new Promise((resolve) => {
          entry.file(file => resolve(file));
        });
      };
      const readDir = async (dirEntry) => {
        const dirReader = dirEntry.createReader();
        const entries = await new Promise((resolve) => {
          dirReader.readEntries(entries => resolve(entries));
        });
        for (const entry of entries) {
          if (entry.isFile) {
            const file = await getFileFromEntry(entry);
            files.push(file);
          } else if (entry.isDirectory) {
            await readDir(entry);
          }
        }
      };
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
          if (entry && entry.isDirectory) {
            await readDir(entry);
          } else {
            const file = item.getAsFile();
            if (file) files.push(file);
          }
        }
      }
      if (files.length > 0) processFiles(files);
    } else if (e.dataTransfer.files) {
      processFiles(e.dataTransfer.files);
    }
  };

  const updateAutoLabelClass = (index, field, value) => {
    setAutoLabelClasses((prev) =>
      prev.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      )
    );
  };

  const addAutoLabelClass = () => {
    setAutoLabelClasses((prev) => [...prev, { name: "", description: "" }]);
  };

  const removeAutoLabelClass = (index) => {
    setAutoLabelClasses((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const getAutoLabelQueries = () =>
    autoLabelClasses.map((item) => item.name.trim()).filter(Boolean);

  const runYoloLabeling = async (asset = null) => {
    setIsApplyingAutoLabel(true);
    setAutoLabelError("");
    setAutoLabelStatus("");
    const batchConfidenceThreshold = 0.75;
    
    try {
      const endpoint = "/api/infer/yolo-label";
      const payload = asset
        ? { asset_id: asset.id, model: "yolov8s.pt", conf: batchConfidenceThreshold }
        : activeAnnotationBatchId
          ? { project_id: projectId, batch_id: activeAnnotationBatchId, model: "yolov8s.pt", conf: batchConfidenceThreshold }
          : { project_id: projectId, model: "yolov8s.pt", conf: batchConfidenceThreshold };
      
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      if (!res.ok) throw new Error("YOLO labeling request failed.");
      
      const data = await res.json();
      const annotatedAssets = data.annotated_assets ?? (asset ? (data.success ? 1 : 0) : 0);
      const totalAnnotations = data.count || 0;
      setAutoLabelStatus(
        `Successfully labeled ${totalAnnotations} objects across ${annotatedAssets} image${annotatedAssets === 1 ? "" : "s"} using YOLOv8s at ${Math.round(batchConfidenceThreshold * 100)}% confidence or higher.`
      );
      await fetchAssets();
      setAnnotateView('tool');
    } catch (err) {
      console.error(err);
      setAutoLabelError(err.message || "Failed to run YOLO labeling.");
    } finally {
      setIsApplyingAutoLabel(false);
    }
  };

  const applyAutoLabelToBatch = () => runYoloLabeling();

  const createJob = async ({ batch, labeler, reviewer, instructions }) => {
    if (!batch || !labeler) return false;
    logger.info(`Creating job for batch ${batch.batch_id} (labeler: ${labeler})`);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          batch_id: batch.batch_id,
          labeler_name: labeler,
          reviewer_name: reviewer || (reviewMode ? assignForm.reviewer : null),
          instructionsText: instructions || "",
        }),
      });
      if (res.ok) {
        logger.info(`Job created successfully for ${batch.batch_id}`);
        await fetchJobs();
        await fetchAssets();
        return true;
      } else {
        const errText = await res.text();
        logger.error(`Failed to create job: ${res.status}`, { body: errText });
        return false;
      }
    } catch (err) {
      logger.error("Network error creating job", err);
      return false;
    }
  };

  const handleAssignBatch = async () => {
    const success = await createJob({ 
      batch: selectedBatch, 
      labeler: assignForm.labeler, 
      reviewer: assignForm.reviewer, 
      instructions: assignForm.instructions 
    });
    if (success) {
      setIsAssignModalOpen(false);
      setAssignForm({ labeler: "", reviewer: "", instructions: "" });
    }
  };

  const startManualLabeling = async (batch) => {
    logger.info(`Starting manual labeling for batch ${batch.batch_id}`);
    const success = await createJob({
      batch: batch,
      labeler: "Self (Manual)",
      instructions: "Manually started session."
    });
    if (success) {
      setActiveAnnotationBatchId(batch.batch_id);
      setActiveAnnotationState('unassigned');
      setAnnotateView('tool');
    }
  };

  const handleAnnotateBatch = async (batch) => {
    logger.info(`Initializing annotation for batch ${batch.batch_id}`);
    try {
      const res = await fetch(`/api/batches/${batch.batch_id}/annotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      if (res.ok) {
        setActiveAnnotationBatchId(batch.batch_id);
        setActiveAnnotationState('unassigned');
        setAnnotateView('tool');
      } else {
        logger.error(`Failed to initialize annotation: ${res.status}`);
      }
    } catch (err) {
      logger.error("Network error initializing annotation", err);
    }
  };

  const approveAsset = async (assetId) => {
    try {
      const res = await fetch(`/api/assets/${assetId}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      if (res.ok) await fetchAssets();
    } catch (err) {
      console.error(err);
    }
  };

  const rejectAsset = async (assetId, comment) => {
    try {
      const res = await fetch(`/api/assets/${assetId}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", comment }),
      });
      if (res.ok) await fetchAssets();
    } catch (err) {
      console.error(err);
    }
  };

  const handleBatchRename = async () => {
    if (!batchToAction || !renameValue.trim()) return;
    setIsBatchActionLoading(true);
    try {
      const res = await fetch(`/api/batches/${batchToAction.batch_id}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, new_name: renameValue.trim() })
      });
      if (res.ok) {
        await fetchAssets();
        setIsRenameModalOpen(false);
        setActiveMenuBatchId(null);
      }
    } catch (err) {
      console.error("Rename failed", err);
    } finally {
      setIsBatchActionLoading(false);
    }
  };

  const handleBatchDelete = async () => {
    if (!batchToAction) return;
    setIsBatchActionLoading(true);
    try {
      if (deleteActionType === "annotations") {
        // Find all annotated assets in this batch
        const assetsToClear = assets.filter(a => a.batch_id === batchToAction.batch_id && (a.status === 'annotated' || a.is_annotated));
        
        logger.info(`Clearing annotations for ${assetsToClear.length} assets in batch ${batchToAction.batch_id}`);
        
        // Clear each one via the Node.js API which we know works
        for (const asset of assetsToClear) {
          await fetch(`/api/assets/${asset.id}/annotations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ annotations: [] })
          });
        }
        
        // Update local state
        setAssets(prev => prev.map(a => 
          a.batch_id === batchToAction.batch_id 
            ? { ...a, status: 'unassigned', is_annotated: false, annotation_count: 0, state: null } 
            : a
        ));
      } else {
        // Find all assets to delete based on the action type
        const assetsToDelete = assets.filter(a => {
          if (a.batch_id !== batchToAction.batch_id) return false;
          if (deleteActionType === "unassigned") {
            // Match the UI's definition of unassigned
            return a.status === 'unassigned' || (!a.status && !a.is_annotated && a.state !== 'approved');
          }
          if (deleteActionType === "dataset") return a.state === 'approved';
          return true; // "all" or "forever"
        });

        logger.info(`Deleting ${assetsToDelete.length} assets in batch ${batchToAction.batch_id}`);

        // Delete each one via the Node.js API
        for (const asset of assetsToDelete) {
          await fetch(`/api/assets/${asset.id}`, { method: 'DELETE' });
        }

        // Update local state
        const idsToDelete = new Set(assetsToDelete.map(a => a.id));
        setAssets(prev => prev.filter(a => !idsToDelete.has(a.id)));
      }
      
      // Final refresh to ensure everything is in sync
      await fetchAssets();
      setIsDeleteModalOpen(false);
      setActiveMenuBatchId(null);
    } catch (err) {
      console.error("Batch action failed", err);
      logger.error("Batch action failed", err);
    } finally {
      setIsBatchActionLoading(false);
    }
  };

  const handleBatchUnassign = async (batch) => {
    setIsBatchActionLoading(true);
    try {
      const res = await fetch(`/api/batches/${batch.batch_id}/unassign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId })
      });
      if (res.ok) {
        await fetchAssets();
        setActiveMenuBatchId(null);
      }
    } catch (err) {
      console.error("Unassign failed", err);
    } finally {
      setIsBatchActionLoading(false);
    }
  };
  const handleMoveToAnnotated = async (batch) => {
    setIsBatchActionLoading(true);
    try {
      const res = await fetch(`/api/batches/${batch.batch_id}/move-to-annotated`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId })
      });
      if (res.ok) {
        await fetchAssets();
        setActiveMenuBatchId(null);
      }
    } catch (err) {
      console.error("Move to annotated failed", err);
    } finally {
      setIsBatchActionLoading(false);
    }
  };


  const handleBatchDownload = async (batch, state = null) => {
    setIsBatchActionLoading(true);
    try {
      let url = `/api/batches/${batch.batch_id}/export?project_id=${projectId}`;
      if (state) url += `&state=${state}`;
      
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.download_url) {
          // Force download
          const link = document.createElement('a');
          link.href = data.download_url;
          link.download = `${batch.batch_name.replace(/\s+/g, '_')}_coco.zip`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      }
    } catch (err) {
      console.error("Download failed", err);
    } finally {
      setIsBatchActionLoading(false);
      setActiveMenuBatchId(null);
    }
  };


  const unassignedBatches = useMemo(() => {
    const batches = {};
    assets.filter(a => a.status === 'unassigned' || (!a.status && !a.is_annotated && a.state !== 'approved')).forEach(a => {
      if (!batches[a.batch_id]) {
        batches[a.batch_id] = {
          batch_id: a.batch_id,
          batch_name: a.batch_name,
          count: 0,
          has_suggestions: false,
          uploaded_at: a.uploaded_at,
        };
      }
      batches[a.batch_id].count++;
    });
    return Object.values(batches).sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
  }, [assets]);

  const annotatedBatches = useMemo(() => {
    const batches = {};
    assets.filter(a => a.status === 'annotated' || (a.is_annotated && a.state !== 'approved')).forEach(a => {
      if (!batches[a.batch_id]) {
        batches[a.batch_id] = {
          batch_id: a.batch_id,
          batch_name: a.batch_name,
          count: 0,
          uploaded_at: a.uploaded_at,
          job: jobs.find(j => j.batch_id === a.batch_id) // Link to active job if exists
        };
      }
      batches[a.batch_id].count++;
    });
    return Object.values(batches).sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
  }, [assets, jobs]);


  const datasetBatches = useMemo(() => {
    const batchGroups = {};
    assets.forEach(a => {
      if (!batchGroups[a.batch_id]) {
        batchGroups[a.batch_id] = {
          batch_id: a.batch_id,
          batch_name: a.batch_name,
          assets: [],
          uploaded_at: a.uploaded_at
        };
      }
      batchGroups[a.batch_id].assets.push(a);
    });

    return Object.values(batchGroups).filter(group => {
      return group.assets.some(a => a.state === 'approved');
    }).map(group => {
      const approvedAssets = group.assets.filter(a => a.state === 'approved');
      return {
        batch_id: group.batch_id,
        batch_name: group.batch_name,
        count: approvedAssets.length,
        uploaded_at: group.uploaded_at,
        finalized_at: approvedAssets.reduce((latest, a) => {
          const d = new Date(a.updated_at || a.uploaded_at);
          return d > latest ? d : latest;
        }, new Date(0))
      };
    }).sort((a,b) => b.finalized_at - a.finalized_at);
  }, [assets]);

  const approvedImages = assets.filter(a => a.state === 'approved');

  const filteredJobs = useMemo(() => {
    let result = [...jobs];
    if (sortBy === "newest") result.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    if (sortBy === "oldest") result.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    // Additional sorting as needed
    return result;
  }, [jobs, sortBy]);

  const hasAssets = assets.length > 0;

  return (
    <div className="h-screen overflow-y-auto bg-white flex font-sans animate-page-enter">
      
      {/* 1. Thin Dark Edge Sidebar */}
      <div className="w-[60px] bg-[#1a1423] flex flex-col items-center py-4 justify-between shrink-0 h-screen sticky top-0">
        <div className="flex flex-col gap-6 w-full items-center">
          {/* Logo */}
          <div className="w-8 h-8 flex items-center justify-center bg-violet-600 rounded-md cursor-pointer" onClick={() => navigate('/')}>
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
               <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
               <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
               <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
             </svg>
          </div>
          <div className="w-8 h-8 rounded bg-gray-700/50 flex items-center justify-center cursor-pointer hover:bg-gray-700 transition">
             <Globe size={18} className="text-gray-400" />
          </div>
          <div className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white cursor-pointer transition">
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </div>
          <div className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white cursor-pointer transition">
             <Database size={20} />
          </div>
        </div>
        
        <div className="w-8 h-8 rounded-full bg-[#8A5A44] text-white flex items-center justify-center font-bold text-[13px] cursor-pointer shadow-sm">
          A
        </div>
      </div>

      {/* 2. Light Project Sidebar */}
      <div className="hidden md:flex w-[240px] border-r border-gray-200 flex-col shrink-0 h-screen sticky top-0 overflow-y-auto bg-gray-50/30">
        <div className="p-4">
          <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-800 text-[11px] font-bold uppercase flex items-center gap-1 tracking-wider mb-6">
            <span>←</span> AS WORKSPACE
          </button>
          
          <div className="flex gap-3 items-center mb-8">
            <div className="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center overflow-hidden">
               <FileImage className="text-gray-400" size={20} />
            </div>
            <div>
              <h2 className="font-bold text-gray-900 text-sm truncate max-w-[150px]">{projectName}</h2>
              <p className="text-[12px] text-gray-500 truncate max-w-[150px]">{projectType}</p>
            </div>
          </div>

          {/* Nav Categories */}
          <div className="mb-6">
            <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-2">Data</h3>
            <nav className="flex flex-col gap-0.5">
              <NavItem icon={<Upload size={16} />} label="Upload Data" active={activeTab === 'upload'} onClick={() => setActiveTab('upload')} />
              <NavItem icon={<Edit3 size={16} />} label="Annotate" active={activeTab === 'annotate'} onClick={() => setActiveTab('annotate')} disabled={!hasAssets} />
              <NavItem icon={<Database size={16} />} label="Dataset" active={activeTab === 'dataset'} onClick={(e) => { e.stopPropagation(); setActiveTab('dataset'); }} disabled={!hasAssets} />
              <NavItem icon={<Layers size={16} />} label="Versions" active={activeTab === 'versions'} onClick={() => setActiveTab('versions')} disabled={!hasAssets} />
              <NavItem icon={<Activity size={16} />} label="Analytics" active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} disabled={!hasAssets} />
              <NavItem icon={<List size={16} />} label="Classes & Tags" active={activeTab === 'classes'} onClick={() => setActiveTab('classes')} disabled={!hasAssets} />
            </nav>
          </div>

          <div className="mb-6">
            <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-2">Models</h3>
            <nav className="flex flex-col gap-0.5">
              <NavItem icon={<Share2 size={16} />} label="Train" active={activeTab === 'train'} onClick={() => setActiveTab('train')} disabled={!hasAssets} />
              <NavItem icon={<Network size={16} />} label="Models" active={activeTab === 'models'} onClick={() => setActiveTab('models')} disabled={!hasAssets} />
              <NavItem icon={<Eye size={16} />} label="Visualize" active={activeTab === 'visualize'} onClick={() => setActiveTab('visualize')} disabled={!hasAssets} />
            </nav>
          </div>
          
          <div className="mb-6">
            <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-2">Deploy</h3>
            <nav className="flex flex-col gap-0.5">
              <NavItem icon={<Rocket size={16} />} label="Deployments" active={activeTab === 'deployments'} onClick={() => setActiveTab('deployments')} disabled={!hasAssets} />
            </nav>
          </div>
        </div>
      </div>

      {/* 3. Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-y-auto bg-white min-w-0">
        {/* Sub Header dynamically changes based on activeTab */}
        {activeTab !== 'annotate' && (
          <header className="px-5 sm:px-10 py-6 sm:py-8 pb-4 border-b border-gray-100 flex justify-between items-center">
            <h1 className="text-[20px] sm:text-2xl font-bold flex items-center gap-3 text-gray-900 capitalize">
               {activeTab} Workspace
            </h1>
          </header>
        )}

        {/* Dynamic Inner Tab Router */}
        <div className={`flex flex-col flex-1 overflow-x-hidden relative ${activeTab === 'annotate' ? 'p-0' : 'px-5 sm:px-10 py-8'}`}>
          
          {/* UPLOAD TAB */}
          {activeTab === 'upload' && (
            <>
              {/* Left Upload Configurations */}
              <div className="flex-1 flex flex-col min-w-0">
                <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 mb-6">
                  <div className="flex-1">
                     <label className="block text-[13px] font-bold text-gray-700 mb-2">Batch Name:</label>
                     <input
                       type="text"
                       value={batchName}
                       onChange={(e) => setBatchName(e.target.value)}
                       className="w-full border border-gray-300 rounded-lg px-3 py-2 text-[14px] text-gray-800 outline-none focus:border-violet-500 shadow-sm"
                     />
                  </div>
                  <div className="flex-1 flex flex-col">
                     <label className="block text-[13px] font-bold text-gray-700 mb-2 flex items-center gap-1">Tags: <HelpCircle size={12} className="text-gray-400" /></label>
                     <input
                       type="text"
                       value={batchTagsInput}
                       onChange={(e) => setBatchTagsInput(e.target.value)}
                       placeholder="Search or add tags for images..."
                       className="w-full border border-gray-300 rounded-lg px-3 py-2 text-[14px] text-gray-800 outline-none focus:border-violet-500 shadow-sm"
                     />
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-8 cursor-pointer group justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                     <input
                       type="checkbox"
                       checked={createBatchInstantly}
                       onChange={(e) => setCreateBatchInstantly(e.target.checked)}
                       className="w-4 h-4 accent-violet-600"
                     />
                     <span className="text-[14px] text-gray-700 select-none font-medium">Create batch instantly</span>
                  </label>
                  
                  {/* Premium Quota Banner */}
                  <div className="flex items-center gap-3 bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-100 px-4 py-2 rounded-lg shadow-sm">
                     <Database className="text-violet-500" size={16} />
                     <div className="flex flex-col">
                        <span className="text-[11px] font-bold text-violet-800 uppercase tracking-widest leading-none mb-0.5">Enterprise Vault</span>
                        <span className="text-[13px] font-medium text-gray-600 leading-none">Unlimited workspace storage enabled</span>
                     </div>
                  </div>
                </div>

                 {/* Replace Dropzone with Uploading status seamlessly */}
                 {isUploading ? (
                    <div className="w-full min-h-[400px] flex flex-col items-center justify-center p-10 animate-fade-in relative">
                       <h2 className="text-[26px] font-bold text-violet-600 mb-2 tracking-tight drop-shadow-sm">Uploading files...</h2>
                       <p className="text-[12px] text-violet-500/80 mb-12 font-mono tracking-widest lowercase bg-violet-50 px-3 py-1 rounded-full border border-violet-100">
                         Uploading {Object.keys(uploadProgress).length} files. Calculating time remaining...
                       </p>
                       
                       <div className="w-40 h-48 bg-[#64748B] rounded-[4px] flex flex-col items-center justify-center relative overflow-hidden shadow-xl ring-1 ring-gray-200">
                          <Search size={28} className="text-white/20 absolute top-4 left-4" />
                          <div className="w-24 h-3 bg-[#48D1CC] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 shadow-[0_0_15px_#48D1CC]"></div>
                       </div>
                    </div>
                 ) : (
                    <div 
                      className={`w-full relative border rounded-2xl p-6 sm:p-10 flex flex-col items-center shadow-sm transition-all ${isDragging ? 'bg-violet-50 border-violet-400 border-2 border-dashed' : 'bg-gray-50/50 border-gray-200'}`}
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                    >
                       <div className="absolute top-0 bottom-0 left-0 right-0 border-2 border-dashed border-gray-300 rounded-2xl pointer-events-none opacity-50 m-2"></div>
                       
                       <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-6">
                         <ArrowUp size={24} className={isDragging ? 'text-violet-500' : 'text-gray-500'} strokeWidth={2} />
                       </div>
                       
                       <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-6 tracking-tight text-center">Drag and drop to upload, or:</h3>
                       
                       <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-8 sm:mb-12 w-full sm:w-auto z-10">
                         <button 
                           onClick={handleUploadClick}
                           disabled={isUploading}
                           className="bg-white border text-gray-700 w-full sm:w-auto px-6 py-3 sm:py-2.5 rounded-[8px] flex items-center justify-center font-bold gap-2 hover:bg-gray-50 transition shadow-sm border-gray-300 disabled:opacity-70 disabled:cursor-wait"
                         >
                            <FileImage size={18} className="text-gray-500" /> {isUploading ? "Uploading..." : "Select Files"}
                         </button>
                         <input 
                           type="file" 
                           multiple 
                           accept="image/*,video/*,.jpeg,.jpg,.png,.heic,.hevc,.mov,.mp4"
                           ref={fileInputRef} 
                           style={{ display: 'none' }} 
                           onChange={handleFileChange} 
                         />
                         <input 
                           type="file" 
                           multiple 
                           webkitdirectory="true"
                           directory="true"
                           ref={folderInputRef} 
                           style={{ display: 'none' }} 
                           onChange={handleFileChange} 
                         />
                         <button onClick={() => folderInputRef.current?.click()} className="bg-white border text-gray-700 w-full sm:w-auto px-6 py-3 sm:py-2.5 rounded-[8px] flex items-center justify-center font-bold gap-2 hover:bg-gray-50 transition shadow-sm border-gray-300">
                            <Box size={18} className="text-gray-500" /> Select Folder
                         </button>
                       </div>

                       {/* Supported Formats info box */}
                       <div className="bg-white border border-gray-200 rounded-xl p-4 w-full flex flex-wrap gap-8 items-start shadow-sm max-w-[550px]">
                          <div>
                            <h4 className="text-[13px] text-gray-800 font-bold flex items-center gap-2 mb-1"><FileImage size={14}/> Images</h4>
                            <p className="text-[12px] text-gray-400 font-mono tracking-tighter">.jpeg, .png, .heic, .hevc, .webp</p>
                            <p className="text-[10px] text-gray-400 mt-2">*Max size of 500GB and infinite pixels.</p>
                          </div>
                       </div>
                    </div>
                 )}

                 {/* Want to add similar images? OVERLAY */}
                 {isUploading && (
                    <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-[98%] max-w-[900px] bg-white rounded-xl shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.1)] border border-gray-200 overflow-hidden z-20 animate-slide-up pb-3">
                       <div className="flex justify-between items-center px-5 py-4 border-b border-gray-100">
                          <div className="flex items-center gap-2 flex-1">
                             <Search size={16} className="text-gray-900" strokeWidth={2.5}/>
                             <h4 className="text-[14px] font-bold text-gray-900 whitespace-nowrap">Want to add similar images?</h4>
                             <span className="text-[12px] text-gray-400 font-medium ml-1 truncate">
                                Powered by VisionFlow AI <span className="text-violet-500 font-bold ml-1">{isAnalyzing ? '(Analyzing uploaded image/dataset...)' : `(Detected: ${detectedObject})`}</span>
                             </span>
                          </div>
                          <div className="flex items-center gap-4 shrink-0">
                             <span className="text-[12px] text-gray-600 font-medium tracking-wide">0 selected</span>
                             <button className="px-3 py-1.5 border border-gray-200 rounded-[8px] text-[12px] font-bold text-gray-400 bg-gray-50 flex items-center gap-1 cursor-not-allowed">
                                <Plus size={14} /> Add
                             </button>
                             <button className="text-gray-400 hover:text-gray-600 ml-1 transition bg-gray-100 hover:bg-gray-200 p-1 rounded" 
                               onClick={() => {
                                 setIsUploading(false);
                                 fetchAssets();
                                 setActiveTab("dataset");
                               }}
                             >
                               <X size={16}/>
                             </button>
                          </div>
                       </div>
                       
                       <div className="flex gap-2 p-3 px-5 overflow-x-auto custom-scrollbar min-h-[140px]">
                          {isAnalyzing && similarImages.length === 0 ? (
                             <div className="flex items-center justify-center w-full h-[120px] text-gray-400 text-[13px] font-bold gap-2 animate-pulse bg-gray-50 rounded-lg border border-dashed border-gray-200">
                                <Cpu size={18} className="text-violet-500 animate-spin" /> Deep analyzing uploaded media...
                             </div>
                          ) : similarImages.map((src, idx) => (
                              <div key={idx} className="w-24 h-24 sm:w-[120px] sm:h-[120px] shrink-0 rounded-[8px] overflow-hidden cursor-pointer hover:ring-2 hover:ring-violet-500 hover:ring-offset-2 transition-all opacity-95 hover:opacity-100 bg-gray-100 flex items-center justify-center">
                                 <img src={src} className="w-full h-full object-cover pointer-events-none" />
                              </div>
                          ))}
                       </div>
                    </div>
                 )}
              </div>
            </>
          )}

          {/* DATASET TAB */}
          {activeTab === 'dataset' && (
             <div className="flex-1 w-full flex flex-col xl:flex-row gap-8 min-w-0 animate-page-enter">
                {/* Left Side: Generated Summary (Sidebar) */}
                <div className="w-full xl:w-[380px] shrink-0">
                   <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm sticky top-0">
                      <div className="flex items-center gap-3 mb-6">
                         <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center text-violet-600">
                            <ImageIcon size={20} />
                         </div>
                         <div>
                            <h3 className="font-black text-gray-900 text-[18px] leading-tight">Generated Assets</h3>
                            <p className="text-[11px] text-gray-400 font-bold uppercase tracking-wider">Project Library</p>
                         </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-8">
                         <div className="bg-violet-50/50 p-4 rounded-2xl border border-violet-100/50">
                            <span className="block text-[10px] font-bold text-violet-600 uppercase tracking-widest mb-1">Total</span>
                            <div className="flex items-baseline gap-1">
                               <span className="text-3xl font-black text-violet-900">{assets.length}</span>
                               <span className="text-[10px] font-bold text-violet-400">IMG</span>
                            </div>
                         </div>
                         <div className="bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100/50">
                            <span className="block text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-1">Labeled</span>
                            <div className="flex items-baseline gap-1">
                               <span className="text-3xl font-black text-emerald-900">{assets.filter(a => a.is_annotated).length}</span>
                               <span className="text-[10px] font-bold text-emerald-400">BOX</span>
                            </div>
                         </div>
                      </div>

                      <div className="space-y-4 mb-8">
                         <div className="flex justify-between items-center px-1">
                            <span className="text-[12px] font-bold text-gray-700">Recent Uploads</span>
                            <span className="text-[10px] font-bold text-violet-600 hover:underline cursor-pointer" onClick={() => setActiveTab('upload')}>View All</span>
                         </div>
                         <div className="flex flex-col gap-2 max-h-[360px] overflow-y-auto pr-1 custom-scrollbar">
                            {assets.length === 0 ? (
                               <div className="py-10 text-center border-2 border-dashed border-gray-100 rounded-xl">
                                  <p className="text-[11px] text-gray-400 font-medium px-4">No assets generated yet.</p>
                               </div>
                            ) : (
                               assets.slice(0, 12).map(asset => (
                                  <div key={asset.id} className="flex items-center gap-3 p-2.5 hover:bg-gray-50 rounded-xl transition-all border border-transparent hover:border-gray-100 group cursor-pointer" onClick={() => setActiveTab('annotate')}>
                                     <div className="w-11 h-11 shrink-0 rounded-lg overflow-hidden border border-gray-100 shadow-sm">
                                        <img src={asset.url} className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                                     </div>
                                     <div className="flex-1 min-w-0">
                                        <p className="text-[11px] font-bold text-gray-800 truncate" title={asset.filename}>{asset.filename}</p>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                           <div className={`w-1.5 h-1.5 rounded-full ${asset.is_annotated ? 'bg-emerald-500' : 'bg-gray-300'}`}></div>
                                           <span className={`text-[9px] font-bold uppercase tracking-tighter ${asset.is_annotated ? 'text-emerald-600' : 'text-gray-400'}`}>
                                              {asset.is_annotated ? 'Annotated' : 'Raw'}
                                           </span>
                                        </div>
                                     </div>
                                     <button 
                                        onClick={(e) => { e.stopPropagation(); deleteAsset(asset.id); }}
                                        className="p-1.5 text-gray-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                                     >
                                        <Trash size={14} />
                                     </button>
                                  </div>
                               ))
                            )}
                         </div>
                      </div>

                      <button 
                         onClick={() => setActiveTab('upload')}
                         className="w-full py-3 bg-gray-900 text-white rounded-xl text-[13px] font-bold hover:bg-violet-600 transition-all shadow-lg shadow-gray-200 flex items-center justify-center gap-2"
                      >
                         <UploadCloud size={16} /> Import More Data
                      </button>
                   </div>
                </div>

                {/* Right Side: Full Dataset Explorer (The main management view) */}
                <div className="flex-1 min-w-0 h-full">
                   <div className="bg-white border border-gray-200 rounded-3xl shadow-xl shadow-gray-100/50 h-full overflow-hidden flex flex-col">
                      <DatasetTab projectId={projectId} />
                   </div>
                </div>
             </div>
          )}



          {/* ANNOTATE TAB */}
          {activeTab === 'annotate' && (
              annotateView === 'board' ? (
                 <div className="flex-1 flex flex-col h-full bg-[#fbfcff] animate-fade-in pb-12 w-full">
                    {/* Header */}
                    <div className="flex justify-between items-center px-8 py-6 mb-2">
                        <div className="flex items-center gap-3">
                           <Crop className="text-gray-500" size={24} />
                           <h2 className="text-[22px] font-bold text-gray-900 tracking-tight">Image Lifecycle</h2>
                        </div>
                        <div className="flex items-center gap-4">
                           <div className="flex items-center gap-2 text-[13px] font-bold text-gray-700">
                              <Users size={16} className="text-gray-500" /> VisionFlow Labeling
                           </div>
                           <button 
                             onClick={() => setReviewMode(!reviewMode)}
                             className={`px-4 py-2 border rounded-[8px] text-[13px] font-bold shadow-sm flex items-center gap-2 transition ${reviewMode ? 'bg-violet-600 text-white border-violet-700' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
                           >
                              <FileCheck size={16} className={reviewMode ? 'text-white' : 'text-gray-500'} /> 
                              {reviewMode ? 'Review Mode ON' : 'Enable Review Mode'} 
                              {!reviewMode && <span className="bg-violet-100 text-violet-700 p-0.5 rounded ml-1"><Lock size={12}/></span>}
                           </button>
                           <button
                              onClick={() => setActiveTab('versions')}
                              className="px-5 py-2 bg-violet-600 text-white rounded-[8px] text-[13px] font-bold shadow-sm flex items-center gap-2 hover:bg-violet-700 transition"
                           >
                               <Plus size={16} /> New Version
                            </button>
                        </div>
                    </div>

                    <div className="px-8 pb-4">
                       <div className="flex items-center gap-2 mb-6">
                           <span className="text-[12px] font-bold text-gray-500 uppercase tracking-wide">Sort By:</span>
                           <select 
                             value={sortBy}
                             onChange={(e) => setSortBy(e.target.value)}
                             className="px-3 py-1.5 border border-gray-200 rounded-[8px] bg-white shadow-sm outline-none cursor-pointer text-[13px] font-bold text-gray-700"
                           >
                              <option value="newest">Newest</option>
                              <option value="oldest">Oldest</option>
                              <option value="unassigned">Unassigned</option>
                              <option value="progress">In Progress</option>
                           </select>
                       </div>
                    
                       {/* Kanban Columns */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full items-stretch w-full mb-12">
                           
                           {/* COLUMN 1: UNASSIGNED */}
                           <div className="bg-white border border-gray-200 rounded-[12px] shadow-sm flex flex-col p-5">
                              <div className="flex justify-between items-start mb-6 border-b border-gray-50 pb-3">
                                 <div>
                                    <h3 className="font-bold text-[16px] text-gray-900 tracking-tight flex items-center gap-2">
                                       Unassigned
                                       <span className="bg-gray-100 text-gray-500 text-[10px] font-bold px-2 py-0.5 rounded-full">{unassignedBatches.length}</span>
                                    </h3>
                                    <p className="text-[11px] text-gray-400 font-medium mt-0.5">Ready to be assigned or reviewed</p>
                                 </div>
                                 <HelpCircle size={14} className="text-gray-300 cursor-pointer hover:text-gray-400 transition" />
                              </div>

                              <div className="flex flex-col gap-4 overflow-y-auto max-h-[600px] pr-1 custom-scrollbar">
                                 {unassignedBatches.length === 0 ? (
                                    <div className="flex-1 flex flex-col items-center justify-center py-20 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
                                       <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm mb-3">
                                          <UploadCloud size={20} className="text-gray-300" />
                                       </div>
                                       <p className="text-[13px] text-gray-400 font-medium text-center px-4 mb-4">No unassigned batches.<br/>Upload more images to start.</p>
                                       <button 
                                          onClick={() => setActiveTab('upload')}
                                          className="px-4 py-2 bg-violet-600 text-white rounded-lg text-xs font-bold hover:bg-violet-700 transition shadow-sm flex items-center gap-2"
                                       >
                                          <UploadCloud size={14} /> Upload More Images
                                       </button>
                                    </div>
                                 ) : (
                                    unassignedBatches.map(batch => (
                                       <div key={batch.batch_id} className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm relative hover:border-violet-300 hover:shadow-md transition-all group overflow-hidden cursor-pointer" onClick={() => navigate(`/annotate/batch/${batch.batch_id}?project_id=${projectId}`)}>
                                          {batch.has_suggestions && (
                                             <div className="absolute top-0 right-0 py-1 px-3 bg-violet-600 text-white text-[9px] font-bold uppercase tracking-widest rounded-bl-lg shadow-sm">
                                                Suggestions Available
                                             </div>
                                          )}
                                          <div className="flex justify-between items-start mb-3">
                                             <div className="max-w-[80%]">
                                                <h4 className="text-[13px] font-bold text-gray-900 truncate mb-1">{batch.batch_name}</h4>
                                                <div className="flex items-center gap-2 text-[11px] text-gray-400 font-medium">
                                                   <Calendar size={12} />
                                                   {new Date(batch.uploaded_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                                </div>
                                             </div>
                                             <div className="relative">
                                                <button 
                                                  onClick={(e) => { e.stopPropagation(); setActiveMenuBatchId(activeMenuBatchId === "unassigned-" + batch.batch_id ? null : "unassigned-" + batch.batch_id); }}
                                                  className="p-1 hover:bg-gray-100 rounded-md text-gray-400 hover:text-gray-600 transition invisible group-hover:visible"
                                                >
                                                   <MoreVertical size={16} />
                                                </button>
                                                
                                                {activeMenuBatchId === "unassigned-" + batch.batch_id && (
                                                  <div ref={menuRef} className="absolute right-0 top-8 w-40 bg-white border border-gray-100 rounded-xl shadow-xl z-50 py-1 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                     <button 
                                                       onClick={(e) => { e.stopPropagation(); setBatchToAction(batch); setRenameValue(batch.batch_name); setIsRenameModalOpen(true); setActiveMenuBatchId(null); }}
                                                       className="w-full text-left px-4 py-2 text-[12px] font-bold text-gray-700 hover:bg-violet-50 hover:text-violet-600 transition flex items-center gap-2"
                                                     >
                                                        <Edit3 size={14} /> Rename Batch
                                                     </button>
                                                     <button 
                                                       onClick={(e) => { e.stopPropagation(); handleBatchDownload(batch); }}
                                                       disabled={isBatchActionLoading}
                                                       className="w-full text-left px-4 py-2 text-[12px] font-bold text-gray-700 hover:bg-violet-50 hover:text-violet-600 transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                                     >
                                                        {isBatchActionLoading ? (
                                                          <><Loader2 size={14} className="animate-spin" /> Exporting...</>
                                                        ) : (
                                                          <><UploadCloud size={14} /> Download (COCO)</>
                                                        )}
                                                     </button>
                                                     <div className="h-[1px] bg-gray-50 my-1"></div>
                                                     <button 
                                                       onClick={(e) => { e.stopPropagation(); setBatchToAction(batch); setDeleteActionType("unassigned"); setIsDeleteModalOpen(true); setActiveMenuBatchId(null); }}
                                                       className="w-full text-left px-4 py-2 text-[12px] font-bold text-rose-500 hover:bg-rose-50 transition flex items-center gap-2"
                                                     >
                                                        <Trash size={14} /> Delete Unassigned
                                                     </button>
                                                  </div>
                                                )}
                                             </div>
                                          </div>

                                          <div className="flex items-center gap-4 mb-6">
                                             <div className="flex flex-col">
                                                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">Images</span>
                                                <span className="text-[13px] font-mono font-bold text-gray-700">{batch.count}</span>
                                             </div>
                                             <div className="w-[1px] h-8 bg-gray-100"></div>
                                             <div className="flex flex-col">
                                                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">Status</span>
                                                <span className="text-[11px] font-bold text-amber-500 uppercase">{batch.has_suggestions ? 'Auto-Labeled' : 'Raw'}</span>
                                             </div>
                                          </div>
                                          
                                          <div className="flex gap-2">
                                             <button 
                                               onClick={(e) => { e.stopPropagation(); handleAnnotateBatch(batch); }}
                                               className="flex-1 text-white bg-violet-600 px-3 py-2.5 rounded-lg text-[13px] font-bold shadow-sm hover:bg-violet-700 transition flex items-center justify-center gap-2"
                                             >
                                                <Edit3 size={16} /> Annotate
                                             </button>
                                          </div>
                                       </div>
                                    ))
                                 )}
                              </div>

                              <div className="mt-4 pt-4 border-t border-gray-50 flex flex-col items-center">
                                 <button 
                                    onClick={() => setActiveTab('upload')}
                                    className="w-full py-2.5 bg-gray-50 border border-gray-200 text-gray-500 rounded-xl text-[12px] font-bold hover:bg-white hover:text-violet-600 hover:border-violet-200 transition flex items-center justify-center gap-2 group"
                                 >
                                    <UploadCloud size={16} className="text-gray-400 group-hover:text-violet-500 transition-colors" /> Upload More Images
                                 </button>
                                 <p className="text-[10px] text-gray-400 mt-2 font-medium">Need more data? Jump to upload.</p>
                              </div>
                           </div>

                           {/* COLUMN 2: ANNOTATIONS */}
                           <div className="bg-white border border-gray-200 rounded-[12px] shadow-sm flex flex-col p-5">
                              <div className="flex justify-between items-start mb-6 border-b border-gray-50 pb-3">
                                 <div>
                                    <h3 className="font-bold text-[16px] text-gray-900 tracking-tight flex items-center gap-2">
                                       Annotations
                                       <span className="bg-violet-100 text-violet-600 text-[10px] font-bold px-2 py-0.5 rounded-full" title="Total Batches">{annotatedBatches.length} Patches</span>
                                       <span className="bg-emerald-100 text-emerald-600 text-[10px] font-bold px-2 py-0.5 rounded-full" title="Total Annotated Images">
                                          {assets.filter(a => a.status === 'annotated').length} Labeled
                                       </span>
                                    </h3>
                                    <p className="text-[11px] text-gray-400 font-medium mt-0.5">Finalized and suggestion-ready data</p>
                                 </div>
                                 <HelpCircle size={14} className="text-gray-300 cursor-pointer" />
                              </div>
                              
                              <div className="flex flex-col gap-4 overflow-y-auto max-h-[600px] pr-1 custom-scrollbar">
                                 {annotatedBatches.length === 0 ? (
                                    <div className="flex-1 flex flex-col items-center justify-center py-20 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
                                       <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm mb-3 text-gray-300">
                                       <Edit3 size={20} />
                                       </div>
                                       <p className="text-[13px] text-gray-400 font-medium">No annotated patches found.</p>
                                    </div>
                                 ) : (
                                    annotatedBatches.map(batch => (
                                       <div 
                                           key={batch.batch_id} 
                                           className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm hover:border-violet-300 hover:shadow-md transition-all group cursor-pointer"
                                           onClick={() => {
                                              setActiveAnnotationBatchId(batch.batch_id);
                                              setActiveAnnotationState('annotated');
                                              setAnnotateView('batch-preview');
                                              setBatchImagesOffset(0);
                                           }}
                                        >
                                          <div className="flex justify-between items-start mb-3">
                                             <div className="max-w-[75%]">
                                                <h4 className="text-[13px] font-bold text-gray-900 truncate mb-1">{batch.batch_name}</h4>
                                                <div className="flex items-center gap-1.5 text-[11px] text-gray-400 font-medium">
                                                   <span className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-[10px]">#{batch.batch_id.length > 6 ? batch.batch_id.slice(-6).toUpperCase() : batch.batch_id.toUpperCase()}</span>
                                                   <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                                                   <span>{new Date(batch.uploaded_at).toLocaleDateString()}</span>
                                                </div>
                                             </div>
                                             <div className="relative">
                                                <button 
                                                  onClick={(e) => { e.stopPropagation(); setActiveMenuBatchId(activeMenuBatchId === "annotated-" + batch.batch_id ? null : "annotated-" + batch.batch_id); }}
                                                  className="p-1 hover:bg-gray-100 rounded-md text-gray-400 hover:text-gray-600 transition invisible group-hover:visible"
                                                >
                                                   <MoreVertical size={16} />
                                                </button>
                                                
                                                {activeMenuBatchId === "annotated-" + batch.batch_id && (
                                                  <div ref={menuRef} className="absolute right-0 top-8 w-[180px] bg-white border border-gray-100 rounded-xl shadow-xl z-50 py-1 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                     <button 
                                                       onClick={(e) => { e.stopPropagation(); setBatchToAction(batch); setRenameValue(batch.batch_name); setIsRenameModalOpen(true); setActiveMenuBatchId(null); }}
                                                       className="w-full text-left px-4 py-2 text-[12px] font-bold text-gray-700 hover:bg-violet-50 hover:text-violet-600 transition flex items-center gap-2"
                                                     >
                                                        <Edit3 size={14} /> Rename Job
                                                     </button>
                                                     
                                                     <button 
                                                       onClick={(e) => { e.stopPropagation(); handleBatchDownload(batch); }}
                                                       disabled={isBatchActionLoading}
                                                       className="w-full text-left px-4 py-2 text-[12px] font-bold text-gray-700 hover:bg-violet-50 hover:text-violet-600 transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                                     >
                                                        {isBatchActionLoading ? (
                                                          <><Loader2 size={14} className="animate-spin" /> Exporting...</>
                                                        ) : (
                                                          <><Download size={14} /> Download (COCO)</>
                                                        )}
                                                     </button>
                                                     <div className="h-[1px] bg-gray-50 my-1"></div>
                                                     <button 
                                                        onClick={(e) => { 
                                                           e.stopPropagation(); 
                                                           setBatchToAction(batch); 
                                                           setDeleteActionType("annotations");
                                                           setIsDeleteModalOpen(true); 
                                                           setActiveMenuBatchId(null); 
                                                        }}
                                                        className="w-full text-left px-4 py-2 text-[12px] font-bold text-gray-700 hover:bg-violet-50 hover:text-violet-600 transition flex items-center gap-2"
                                                      >
                                                         <Trash size={14} /> Clear Annotations
                                                      </button>
                                                      <div className="h-[1px] bg-gray-50 my-1"></div>
                                                      <button 
                                                        onClick={(e) => { 
                                                           e.stopPropagation(); 
                                                           setBatchToAction(batch); 
                                                           setDeleteActionType("all");
                                                           setIsDeleteModalOpen(true); 
                                                           setActiveMenuBatchId(null); 
                                                        }}
                                                        className="w-full text-left px-4 py-2 text-[12px] font-bold text-rose-500 hover:bg-rose-50 transition flex items-center gap-2"
                                                      >
                                                         <Trash size={14} /> Delete Forever
                                                      </button>
                                                  </div>
                                                )}
                                             </div>
                                          </div>                                          
                                          
                                          {batch.job && batch.job.annotated_count < batch.job.total_images && (
                                             <div className="mb-4">
                                                <div className="flex justify-between items-end mb-1.5">
                                                   <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">AI Progress</span>
                                                   <span className="text-[11px] font-bold text-gray-700 font-mono">{batch.job.annotated_count}/{batch.job.total_images}</span>
                                                </div>
                                                <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden border border-gray-50 p-0.5">
                                                   <div 
                                                     className="bg-amber-500 animate-pulse h-full rounded-full transition-all duration-700 ease-out shadow-sm"
                                                     style={{ width: `${Math.round((batch.job.annotated_count / (batch.job.total_images || 1)) * 100)}%` }}
                                                   ></div>
                                                </div>
                                             </div>
                                          )}

                                          <div className="flex justify-between items-center bg-gray-50/80 p-3 rounded-lg border border-gray-100">
                                             <div className="flex flex-col">
                                                <span className="text-[9px] text-gray-400 font-bold uppercase tracking-tighter">Annotated</span>
                                                <div className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 mt-0.5 w-fit">
                                                   <Check size={10} strokeWidth={4} /> {batch.count}
                                                </div>
                                             </div>
                                             <button 
                                                onClick={(e) => { 
                                                   e.stopPropagation();
                                                   setActiveAnnotationBatchId(batch.batch_id); 
                                                   setActiveAnnotationState('annotated'); 
                                                   setAnnotateView('tool'); 
                                                }}
                                                className="bg-white border border-gray-200 text-violet-600 px-3 py-1.5 rounded-md text-[11px] font-bold hover:bg-violet-600 hover:text-white hover:border-violet-600 transition shadow-sm"
                                             >
                                                Continue
                                             </button>
                                          </div>

                                       </div>
                                    ))
                                 )}
                              </div>
                           </div>

                           {/* COLUMN 3: DATASET */}
                           <div className="bg-white border border-gray-200 rounded-[12px] shadow-sm flex flex-col p-5">
                              <div className="flex justify-between items-start mb-6 border-b border-gray-50 pb-3">
                                 <div>
                                    <h3 className="font-bold text-[16px] text-gray-900 tracking-tight flex items-center gap-2">
                                       Dataset
                                       <span className="bg-emerald-100 text-emerald-600 text-[10px] font-bold px-2 py-0.5 rounded-full">{datasetBatches.length}</span>
                                    </h3>
                                    <p className="text-[11px] text-gray-400 font-medium mt-0.5">Finalized training-ready data</p>
                                 </div>
                                 <HelpCircle size={14} className="text-gray-300 cursor-pointer" />
                              </div>
                              
                              <div className="flex flex-col gap-4 overflow-y-auto max-h-[600px] pr-1 custom-scrollbar">
                                 {datasetBatches.length === 0 ? (
                                    <div className="flex-1 flex flex-col items-center justify-center py-20 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
                                       <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm mb-3">
                                          <Check size={20} className="text-gray-200" />
                                       </div>
                                       <p className="text-[13px] text-gray-400 font-medium text-center px-4">No finalized batches yet.<br/>Approve images to see them here.</p>
                                    </div>
                                 ) : (
                                    datasetBatches.map(batch => (
                                       <div key={batch.batch_id} className="bg-gray-50/30 border border-gray-200 rounded-[12px] p-5 shadow-sm hover:border-emerald-300 transition-all group relative overflow-hidden cursor-pointer" onClick={(e) => { e.stopPropagation(); setActiveTab('dataset'); }}>
                                          <div className="absolute top-0 right-0 p-2 bg-emerald-500 text-white rounded-bl-xl shadow-sm">
                                             <Check size={14} strokeWidth={4} />
                                          </div>
                                          <div className="mb-4 flex justify-between items-start">
                                             <div className="max-w-[75%]">
                                                <h4 className="text-[13px] font-bold text-gray-900 truncate mb-1">{batch.batch_name}</h4>
                                                <div className="flex items-center gap-2 text-[11px] text-gray-400 font-medium">
                                                   <Clock size={12} />
                                                   Finalized {new Date(batch.finalized_at).toLocaleDateString()}
                                                </div>
                                             </div>
                                             <div className="relative">
                                                <button 
                                                  onClick={(e) => { e.stopPropagation(); setActiveMenuBatchId(activeMenuBatchId === "dataset-" + batch.batch_id ? null : "dataset-" + batch.batch_id); }}
                                                  className="p-1 hover:bg-gray-100 rounded-md text-gray-400 hover:text-gray-600 transition invisible group-hover:visible"
                                                >
                                                   <MoreVertical size={16} />
                                                </button>
                                                
                                                {activeMenuBatchId === "dataset-" + batch.batch_id && (
                                                  <div ref={menuRef} className="absolute right-0 top-8 w-[180px] bg-white border border-gray-100 rounded-xl shadow-xl z-50 py-1 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                     <button 
                                                       onClick={(e) => { e.stopPropagation(); setBatchToAction(batch); setRenameValue(batch.batch_name); setIsRenameModalOpen(true); setActiveMenuBatchId(null); }}
                                                       className="w-full text-left px-4 py-2 text-[12px] font-bold text-gray-700 hover:bg-violet-50 hover:text-violet-600 transition flex items-center gap-2"
                                                     >
                                                        <Edit3 size={14} /> Rename Job
                                                     </button>
                                                     
                                                     <button 
                                                       onClick={(e) => { e.stopPropagation(); handleBatchDownload(batch, 'approved'); }}
                                                       disabled={isBatchActionLoading}
                                                       className="w-full text-left px-4 py-2 text-[12px] font-bold text-gray-700 hover:bg-violet-50 hover:text-violet-600 transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                                     >
                                                        {isBatchActionLoading ? (
                                                          <><Loader2 size={14} className="animate-spin" /> Exporting...</>
                                                        ) : (
                                                          <><Download size={14} /> Download</>
                                                        )}
                                                     </button>
                                                     <div className="h-[1px] bg-gray-50 my-1"></div>
                                                     <button 
                                                        onClick={(e) => { 
                                                           e.stopPropagation(); 
                                                           handleBatchUnassign(batch);
                                                        }}
                                                        className="w-full text-left px-4 py-2 text-[12px] font-bold text-violet-600 hover:bg-violet-50 transition flex items-center gap-2"
                                                      >
                                                         <ArrowLeft size={14} /> Unassigned
                                                      </button>
                                                  </div>
                                                )}
                                             </div>
                                          </div>
                                          
                                          <div className="mb-4">
                                             <div className="bg-white border border-gray-100 p-2 rounded-lg text-center">
                                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-tight">Total Images</p>
                                                <p className="text-[16px] font-bold text-gray-800 font-mono">{batch.count}</p>
                                             </div>
                                          </div>

                                          <button 
                                            onClick={(e) => { e.stopPropagation(); setActiveTab('dataset'); }}
                                            className="w-full text-emerald-600 bg-white border border-emerald-100 py-2 rounded-lg text-[12px] font-bold hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition flex items-center justify-center gap-2 shadow-sm"
                                          >
                                             <Eye size={14} /> View in Dataset
                                          </button>
                                       </div>
                                    ))
                                 )}
                              </div>
                           </div>

                        </div>
                     </div>
                  </div>
              ) : annotateView === 'auto-batch' ? (
                <AutoLabelBatchPanel
                  assetCount={assets.length}
                  autoLabelStrategy={autoLabelStrategy}
                  setAutoLabelStrategy={setAutoLabelStrategy}
                  autoLabelClasses={autoLabelClasses}
                  updateAutoLabelClass={updateAutoLabelClass}
                  removeAutoLabelClass={removeAutoLabelClass}
                  addAutoLabelClass={addAutoLabelClass}
                  autoLabelError={autoLabelError}
                  autoLabelStatus={autoLabelStatus}
                  applyAutoLabelToBatch={applyAutoLabelToBatch}
                  isGeneratingPreview={isGeneratingPreview}
                  isApplyingAutoLabel={isApplyingAutoLabel}
                  onCancel={() => setAnnotateView('batch')}
                />
              ) : annotateView === 'batch' ? (
                <div className="flex-1 flex flex-col h-full bg-white animate-fade-in">
                   {/* Roboflow-Style Batch Header */}
                   <div className="flex justify-between items-start px-8 py-6 border-b border-gray-200 bg-white">
                       <div className="flex items-start gap-4">
                          <button onClick={() => setAnnotateView('board')} className="mt-1 w-8 h-8 flex items-center justify-center rounded-full hover:bg-violet-50 text-violet-600 transition">
                             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                          </button>
                          <div>
                             <div className="flex items-center gap-2 text-sm font-medium text-gray-500 mb-2">
                                <span className="text-violet-600 hover:underline cursor-pointer">Annotate</span> 
                                <span className="text-gray-400">/</span> 
                                <span>Batch</span>
                             </div>
                             <h2 className="text-[22px] font-bold text-gray-900 mb-1 tracking-tight">
                               Uploaded on {new Date().toLocaleDateString(undefined, { year: '2-digit', month: '2-digit', day: '2-digit' })} at {new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                             </h2>
                             <p className="text-[13px] text-gray-500 flex items-center gap-1.5 font-medium">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                                Uploaded {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ({new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })})
                             </p>
                          </div>
                       </div>
                       <div className="flex gap-3">
                          <button onClick={() => setActiveTab('upload')} className="px-5 py-2.5 border border-gray-300 rounded-[8px] text-[13px] font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-2 transition shadow-sm bg-white">
                             <UploadCloud size={16} className="text-gray-500" /> Upload More
                          </button>
                          <button className="px-5 py-2.5 border border-gray-300 rounded-[8px] text-[13px] font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-2 transition shadow-sm bg-white">
                             <Edit3 size={16} className="text-gray-500" /> Rename
                          </button>
                       </div>
                   </div>

                   {/* Content Split */}
                   <div className="flex flex-1 overflow-hidden">
                      {/* Left Grid */}
                      <div className="flex-[2] p-8 overflow-y-auto border-r border-gray-100 bg-white">
                         <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {assets.map((a, i) => (
                               <div key={a.id} className="flex flex-col group cursor-pointer" onClick={() => { setActiveAnnotationBatchId(a.batch_id); setAnnotateView('tool'); }}>
                                  <div className="aspect-[4/3] bg-gray-100 rounded-[10px] overflow-hidden border border-gray-200 shadow-sm group-hover:border-violet-400 group-hover:shadow-md transition">
                                     <img src={a.url} className="w-full h-full object-cover" />
                                  </div>
                                  <p className="text-[11px] text-gray-500 mt-2 truncate w-full font-mono px-1">suggested-{a.id?.substring(0,10) || `img-${i}`}</p>
                               </div>
                            ))}
                         </div>
                      </div>

                      {/* Right Panel */}
                      <div className="w-[420px] p-8 bg-gray-50/50 overflow-y-auto shrink-0">
                         <h3 className="text-[16px] font-bold text-gray-900 mb-6 font-sans italic tracking-tight">How do you want to label your images?</h3>
                         
                         <div className="flex flex-col gap-4">
                            {/* Auto-Label */}
                            <div className="bg-gradient-to-br from-violet-50 to-white border-2 border-violet-200 rounded-[12px] p-5 cursor-pointer hover:border-violet-400 hover:shadow-md transition relative overflow-hidden group">
                               <div className="absolute top-0 right-0 w-32 h-32 bg-violet-100/50 rounded-full blur-[30px] -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
                               <div className="flex gap-4 relative z-10">
                                  <div className="text-violet-600 mt-0.5"><Sparkles size={24} strokeWidth={2} /></div>
                                  <div className="flex-1">
                                     <h4 className="text-[15px] font-bold text-violet-900 mb-1 flex items-start justify-between">
                                        Auto-Label Entire Batch
                                     </h4>
                                     <p className="text-[13px] text-violet-800/70 font-medium leading-[1.5] mb-4 pr-4">
                                        Use your own custom model or a zero-shot model to automatically label your entire batch.
                                     </p>
                                     <button 
                                        onClick={() => setAnnotateView('auto-batch')} 
                                        className="text-[12px] font-bold text-violet-600 flex items-center gap-1.5 hover:text-violet-800 bg-white border border-violet-100 px-3 py-1.5 rounded-full shadow-sm"
                                     >
                                        Generate test results <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                                     </button>
                                  </div>
                               </div>
                            </div>

                            {/* Label Assist */}
                            <div onClick={() => { setActiveAnnotationBatchId(selectedBatch?.batch_id || (assets.length > 0 ? assets[0].batch_id : null)); setAnnotateView('tool'); }} className="bg-white border border-gray-200 rounded-[12px] p-5 cursor-pointer hover:border-violet-300 hover:shadow-md transition group">
                               <div className="flex gap-4">
                                  <div className="text-gray-400 mt-0.5 group-hover:text-violet-500 transition-colors"><User size={24} strokeWidth={2} /></div>
                                  <div>
                                     <h4 className="text-[15px] font-bold text-gray-900 mb-1">Label Assist</h4>
                                     <p className="text-[13px] text-gray-500 font-medium leading-[1.5]">
                                        Open the annotation tool and use existing model predictions as review suggestions.
                                     </p>
                                  </div>
                               </div>
                            </div>

                            {/* Smart Polygon */}
                            <div onClick={() => { setActiveAnnotationBatchId(selectedBatch?.batch_id || (assets.length > 0 ? assets[0].batch_id : null)); setAnnotateView('tool'); }} className="bg-white border border-gray-200 rounded-[12px] p-5 cursor-pointer hover:border-violet-300 hover:shadow-md transition group">
                               <div className="flex gap-4">
                                  <div className="text-gray-400 mt-0.5 group-hover:text-violet-500 transition-colors"><Crop size={24} strokeWidth={2} /></div>
                                  <div>
                                     <h4 className="text-[15px] font-bold text-gray-900 mb-1">Smart Polygon / SAM</h4>
                                     <p className="text-[13px] text-gray-500 font-medium leading-[1.5]">
                                        Use click-based segmentation to create polygon masks faster with the smart labeling endpoint.
                                     </p>
                                  </div>
                               </div>
                            </div>

                            {/* Box Prompting */}
                            <div onClick={() => { setActiveAnnotationBatchId(selectedBatch?.batch_id || (assets.length > 0 ? assets[0].batch_id : null)); setAnnotateView('tool'); }} className="bg-white border border-gray-200 rounded-[12px] p-5 cursor-pointer hover:border-violet-300 hover:shadow-md transition group">
                               <div className="flex gap-4">
                                  <div className="text-gray-400 mt-0.5 group-hover:text-violet-500 transition-colors"><Box size={24} strokeWidth={2} /></div>
                                  <div>
                                     <h4 className="text-[15px] font-bold text-gray-900 mb-1">Box Prompting</h4>
                                     <p className="text-[13px] text-gray-500 font-medium leading-[1.5]">
                                        Draw examples in the annotation tool, then expand matching objects across similar images.
                                     </p>
                                  </div>
                               </div>
                            </div>

                            {/* Rapid Prompting */}
                            <div onClick={() => navigate('/rapid-upload')} className="bg-white border border-gray-200 rounded-[12px] p-5 cursor-pointer hover:border-violet-300 hover:shadow-md transition group">
                               <div className="flex gap-4 items-center">
                                  <div className="text-gray-400 group-hover:text-violet-500 transition-colors"><Search size={24} strokeWidth={2} /></div>
                                  <div className="flex-1">
                                     <h4 className="text-[15px] font-bold text-gray-900 mb-0.5">Rapid Prompt Labeling</h4>
                                     <p className="text-[13px] text-gray-500 font-medium leading-[1.5]">
                                        Jump into the text-prompt workflow to find common objects quickly with Rapid.
                                     </p>
                                  </div>
                                  <ChevronRight size={18} className="text-gray-300 group-hover:text-gray-500" />
                               </div>
                            </div>

                            {/* Label With Team */}
                            <div className="bg-white border border-gray-200 rounded-[12px] p-5 cursor-pointer hover:border-violet-300 hover:shadow-md transition group">
                               <div className="flex gap-4 items-center">
                                  <div className="text-gray-400 group-hover:text-violet-500 transition-colors"><Users size={24} strokeWidth={2} /></div>
                                  <div className="flex-1">
                                     <h4 className="text-[15px] font-bold text-gray-900 mb-0.5">Label With My Team</h4>
                                     <p className="text-[13px] text-gray-500 font-medium leading-[1.5]">
                                        Split up the labeling work across your team.
                                     </p>
                                  </div>
                                  <ChevronRight size={18} className="text-gray-300 group-hover:text-gray-500" />
                               </div>
                            </div>

                            {/* Outsourced */}
                            <div className="bg-white border border-gray-200 rounded-[12px] p-5 cursor-pointer hover:border-violet-300 hover:shadow-md transition group opacity-90 hover:opacity-100">
                               <div className="flex gap-4">
                                  <div className="text-gray-400 mt-0.5 group-hover:text-amber-500 transition-colors"><Building size={24} strokeWidth={2} /></div>
                                  <div className="flex-1">
                                     <h4 className="text-[15px] font-bold text-gray-900 mb-1 flex items-center justify-between">
                                        Hire Outsourced Labelers
                                        <span className="bg-gradient-to-r from-amber-400 to-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm shadow-amber-500/20 uppercase tracking-wide">Trial!</span>
                                     </h4>
                                     <p className="text-[13px] text-gray-500 font-medium leading-[1.5] pr-2">
                                        Work with an professional labeling team vetted by VisionFlow.
                                     </p>
                                  </div>
                               </div>
                            </div>
                         </div>
                      </div>
                   </div>
                </div>
              ) : annotateView === 'tool' ? (
                <div className="flex-1 w-full flex flex-col min-w-0 h-[calc(100vh-80px)] px-5 sm:px-10 py-6">
                   <div className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-500">
                       <button 
                          onClick={() => { 
                             if (activeAnnotationBatchId) {
                                setAnnotateView('batch-preview');
                             } else {
                                setAnnotateView('board'); 
                                setActiveAnnotationBatchId(null); 
                                setActiveAnnotationState(null);
                             }
                          }} 
                          className="hover:text-violet-600 flex items-center gap-1"
                       >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                          {activeAnnotationBatchId ? "Back to Batch" : "Back to Board"}
                       </button>
                   </div>
                   <AnnotationTool 
                        assets={annotateView === 'batch-preview' || (activeAnnotationBatchId && assets.some(a => a.batch_id === activeAnnotationBatchId)) ? 
                          assets.filter(a => a.batch_id === activeAnnotationBatchId) : 
                          assets.filter(a => {
                            if (activeAnnotationBatchId && a.batch_id !== activeAnnotationBatchId) return false;
                            if (activeAnnotationState && a.state !== activeAnnotationState && a.status !== activeAnnotationState) return false;
                            return true;
                          })
                        } 
                        initialAssetId={activeImageId}
                        projectId={projectId} 
                        projectType={projectType} 
                        classificationType={classificationType} 
                        updateAsset={(id, isAnnotated) => {
                           setAssets(assets.map(a => a.id === id ? { ...a, is_annotated: isAnnotated, status: isAnnotated ? 'annotated' : 'unassigned' } : a));
                        }}
                        onBatchComplete={() => {
                           fetchAssets();
                           setAnnotateView('board');
                           setActiveAnnotationBatchId(null);
                           setActiveAnnotationState(null);
                        }}
                     />
                </div>
              ) : annotateView === 'batch-preview' ? (
                <div className="flex-1 w-full flex flex-col min-w-0 h-[calc(100vh-80px)] px-5 sm:px-10 py-6 overflow-hidden">
                   <div className="flex items-center justify-between mb-8">
                       <div className="flex items-center gap-4">
                          <button 
                             onClick={() => { 
                                setAnnotateView('board'); 
                                setActiveAnnotationBatchId(null); 
                                setBatchImages([]);
                             }} 
                             className="text-gray-400 hover:text-gray-600 bg-white border border-gray-200 p-2 rounded-xl transition"
                          >
                             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                          </button>
                          <div>
                             <h2 className="text-xl font-bold text-gray-900 tracking-tight">
                                {annotatedBatches.find(b => b.batch_id === activeAnnotationBatchId)?.batch_name || "Batch Preview"}
                             </h2>
                             <p className="text-xs text-gray-400 font-medium">{batchImagesTotal} images in this patch</p>
                          </div>
                       </div>

                       <button 
                          onClick={() => {
                             const batch = annotatedBatches.find(b => b.batch_id === activeAnnotationBatchId);
                             if (batch) handleAddToDataset(batch);
                          }}
                          disabled={batchImagesTotal === 0}
                          className="flex items-center gap-2 px-6 py-3 bg-violet-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-violet-200 hover:bg-violet-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                       >
                          <Database size={18} /> Add {batchImagesTotal} Dataset
                       </button>
                   </div>

                   {batchImagesLoading && batchImages.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center">
                         <div className="w-12 h-12 border-4 border-violet-100 border-t-violet-600 rounded-full animate-spin mb-4" />
                         <p className="text-gray-400 font-bold">Loading annotated preview...</p>
                      </div>
                   ) : batchImages.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center bg-gray-50/50 rounded-3xl border-2 border-dashed border-gray-100">
                         <div className="w-16 h-16 bg-white text-gray-200 rounded-full flex items-center justify-center mb-4 shadow-sm">
                            <EyeOff size={32} />
                         </div>
                         <h3 className="text-lg font-bold text-gray-900">No images found</h3>
                         <p className="text-gray-400 text-sm mb-6 text-center max-w-xs">We couldn't find any annotated images in this batch.</p>
                         <button onClick={() => setAnnotateView('board')} className="px-6 py-2 bg-white border border-gray-200 text-gray-600 rounded-xl font-bold text-sm hover:bg-gray-50 transition">Go Back</button>
                      </div>
                   ) : (
                      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                         <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                            {batchImages.map((asset, idx) => (
                               <div 
                                 key={asset.id} 
                                 onClick={() => {
                                    setActiveImageId(asset.id);
                                    setAnnotateView('tool');
                                 }}
                                 className="group cursor-pointer flex flex-col"
                               >
                                  <div className="aspect-[4/3] bg-gray-100 rounded-2xl overflow-hidden border-2 border-transparent group-hover:border-violet-500 transition-all relative shadow-sm group-hover:shadow-xl group-hover:-translate-y-1">
                                     <img src={asset.url} className="w-full h-full object-cover transition-transform group-hover:scale-105" alt="Preview" />
                                     <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                                     <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-lg shadow-sm flex items-center gap-1.5 border border-gray-100">
                                        <Tag size={10} className="text-violet-500" fill="currentColor" />
                                        <span className="text-[10px] font-black text-gray-700">{asset.annotation_count || 0}</span>
                                     </div>
                                  </div>
                                  <div className="mt-3 px-1 truncate">
                                     <p className="text-[11px] font-bold text-gray-900 truncate" title={asset.filename}>{asset.filename}</p>
                                     <p className="text-[9px] text-gray-400 font-medium">#{asset.id.slice(-6).toUpperCase()}</p>
                                  </div>
                               </div>
                            ))}
                         </div>
                         
                         {batchImagesTotal > batchImagesLimit && (
                            <div className="mt-12 flex justify-center pb-8">
                               <button 
                                 onClick={() => setBatchImagesOffset(prev => prev + batchImagesLimit)}
                                 className="px-8 py-3 bg-white border border-gray-200 text-gray-600 rounded-2xl font-bold text-sm hover:bg-violet-50 hover:text-violet-600 hover:border-violet-200 transition shadow-sm"
                               >
                                  Load More Images
                               </button>
                            </div>
                         )}
                      </div>
                   )}
                </div>
              ) : null
          )}




          {/* TRAIN TAB */}
          {activeTab === 'train' && (
              <div className="flex-1 w-full flex flex-col min-w-0">
                 <TrainTab
                   projectId={projectId}
                   onOpenModels={() => setActiveTab('models')}
                 />
              </div>
          )}

          {/* ANALYTICS TAB */}
          {activeTab === 'analytics' && (
              <div className="flex-1 w-full flex flex-col min-w-0">
                 <AnalyticsTab 
                   projectId={projectId}
                   assets={activeAnnotationBatchId ? assets.filter(a => a.batch_id === activeAnnotationBatchId) : assets} 
                 />
              </div>
          )}

          {/* CLASSES & TAGS TAB */}
          {activeTab === 'classes' && (
              <div className="flex-1 w-full flex flex-col min-w-0">
                 <ClassesTab projectId={projectId} projectType={projectType} />
              </div>
          )}

          {/* MODELS TAB */}
          {activeTab === 'models' && (
              <div className="flex-1 w-full flex flex-col min-w-0">
                 <ModelsTab
                   projectId={projectId}
                   onTrainModel={() => setActiveTab('train')}
                 />
              </div>
          )}

          {/* VISUALIZE TAB */}
          {activeTab === 'visualize' && (
              <div className="flex-1 w-full flex flex-col min-w-0">
                 <VisualizeTab projectId={projectId} />
              </div>
          )}

          {/* DEPLOYMENTS TAB */}
          {activeTab === 'deployments' && (
              <div className="flex-1 w-full flex flex-col min-w-0">
                 <DeployTab projectId={projectId} />
              </div>
          )}

          {activeTab === 'versions' && (
            <div className="flex-1 w-full flex flex-col min-w-0">
              <VersionsTab 
                key={`versions-${versionCounter}`}
                projectId={projectId} 
                onOpenGenerate={() => setIsGenerateVersionModalOpen(true)}
                onTrainModel={(version) => {
                  localStorage.setItem("visionflow_selected_version", JSON.stringify(version));
                  setActiveTab('train');
                }}
              />
            </div>
          )}

          <GenerateVersionModal 
            projectId={projectId}
            isOpen={isGenerateVersionModalOpen}
            onClose={() => setIsGenerateVersionModalOpen(false)}
            onGenerated={() => {
              setVersionCounter(prev => prev + 1);
              setActiveTab('versions');
            }}
          />



        </div>
      </div>

      {/* RENAME BATCH MODAL */}
      {isRenameModalOpen && batchToAction && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in">
           <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-slide-up">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                 <h3 className="text-[18px] font-bold text-gray-900">Rename Batch</h3>
                 <button onClick={() => setIsRenameModalOpen(false)} className="text-gray-400 hover:text-gray-600 transition bg-white p-1.5 rounded-full border border-gray-100 shadow-sm">
                    <X size={18} />
                 </button>
              </div>
              <div className="p-6">
                 <label className="block text-[12px] font-bold text-gray-500 uppercase tracking-wider mb-2">New Batch Name</label>
                 <input 
                   type="text" 
                   value={renameValue}
                   onChange={(e) => setRenameValue(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && handleBatchRename()}
                   className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition font-medium text-gray-900"
                   placeholder="e.g. Traffic Camera North-East"
                   autoFocus
                 />
                 <p className="text-[11px] text-gray-400 mt-3 font-medium">Use descriptive names to organize your data lifecycle better.</p>
              </div>
              <div className="p-6 pt-0 flex gap-3">
                 <button 
                   onClick={() => setIsRenameModalOpen(false)}
                   className="flex-1 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition text-[13px]"
                 >
                    Cancel
                 </button>
                 <button 
                   onClick={handleBatchRename}
                   disabled={isBatchActionLoading || !renameValue.trim() || renameValue === batchToAction.batch_name}
                   className="flex-1 px-4 py-2.5 bg-violet-600 text-white font-bold rounded-xl hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition text-[13px] shadow-md flex items-center justify-center gap-2"
                 >
                    {isBatchActionLoading ? <Cpu size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                    Save Changes
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* DELETE BATCH CONFIRMATION MODAL */}
      {isDeleteModalOpen && batchToAction && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in">
           <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-slide-up">
              <div className="p-8 text-center">
                 <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Trash size={32} className="text-rose-500" />
                 </div>
                 <h3 className="text-[20px] font-bold text-gray-900 mb-2">
                    {deleteActionType === "annotations" ? "Clear Annotations?" : deleteActionType === "unassigned" ? "Delete Unassigned?" : "Delete Forever?"}
                 </h3>
                  <p className="text-[14px] text-gray-500 font-medium leading-[1.6]">
                     You are about to {deleteActionType === "annotations" ? "clear labels for" : "delete"} <strong className="text-gray-900">"{batchToAction.batch_name}"</strong>. 
                     {deleteActionType === "annotations" 
                       ? ` This will permanently remove all labels and bounding boxes from ${batchToAction.count} images and move the batch back to Unassigned.`
                       : deleteActionType === "unassigned"
                       ? ` Only Unassigned images (${batchToAction.count}) will be deleted. Annotated data will remain safe.`
                       : ` This will permanently remove all ${batchToAction.count} images and associated annotations from the database.`}
                  </p>
                 <div className="mt-6 bg-rose-50/50 border border-rose-100 p-3 rounded-lg flex items-center gap-2 text-rose-600 text-[12px] font-bold">
                    <Info size={14} /> This action cannot be undone.
                 </div>
              </div>
              <div className="p-6 bg-gray-50 flex gap-3">
                 <button 
                   onClick={() => setIsDeleteModalOpen(false)}
                   className="flex-1 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition text-[13px]"
                 >
                    Keep Batch
                 </button>
                 <button 
                   onClick={handleBatchDelete}
                   disabled={isBatchActionLoading}
                   className="flex-1 px-4 py-2.5 bg-rose-500 text-white font-bold rounded-xl hover:bg-rose-600 disabled:opacity-50 transition text-[13px] shadow-md flex items-center justify-center gap-2"
                 >
                     {isBatchActionLoading ? <Cpu size={16} className="animate-spin" /> : <Trash size={16} />}
                     {deleteActionType === "annotations" ? "Clear Annotations" : "Delete Forever"}
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}

// Subcomponents

function GlobeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 22C17.5 22 22 17.5 22 12C22 6.5 17.5 2 12 2C6.5 2 2 6.5 2 12C2 17.5 6.5 22 12 22Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2.5 12H21.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 2C14.5 2 16.5 6.5 16.5 12C16.5 17.5 14.5 22 12 22C9.5 22 7.5 17.5 7.5 12C7.5 6.5 9.5 2 12 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function NavItem({ icon, label, active, onClick, disabled }) {
  return (
    <div 
      onClick={disabled ? undefined : onClick} 
      className={`flex items-center gap-3 px-3 py-2 rounded-md transition ${disabled ? 'opacity-50 cursor-not-allowed' : active ? 'bg-violet-100/50 text-violet-700 border border-violet-200/50 shadow-sm font-semibold cursor-pointer' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 font-medium cursor-pointer'}`}
    >
       <div className={`${active && !disabled ? 'text-violet-600' : 'text-gray-400'}`}>
         {icon}
       </div>
       <span className="text-[13px] text-gray-700">{label}</span>
       {disabled && <Lock size={12} className="ml-auto text-gray-400" />}
    </div>
  );
}




