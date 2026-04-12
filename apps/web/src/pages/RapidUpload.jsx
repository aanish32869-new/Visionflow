/* eslint-disable no-unused-vars */
import { useNavigate, useLocation } from "react-router-dom";
import { Globe, Lock, Bell, HelpCircle, ArrowUp, Minus, Plus, RotateCcw, Eye, Search, ThumbsUp, ThumbsDown, SlidersHorizontal, ArrowRight, Zap, Sparkles, Image as ImageIcon, Trash, Rocket, List, Crop, X } from "lucide-react";
import { useRef, useState, useEffect } from "react";

export default function RapidUpload() {
  const navigate = useNavigate();
  const location = useLocation();
  const storedProjectId = localStorage.getItem("visionflow_active_project_id");
  const storedProjectName = localStorage.getItem("visionflow_active_project_name");
  const visibility = location.state?.visibility || "Public";
  const [projectId, setProjectId] = useState(location.state?.projectId || storedProjectId || null);
  const projectName = location.state?.projectName || storedProjectName || "My First Project";

  // Flow State: 'upload' -> 'build' -> 'review'
  const [step, setStep] = useState('upload');
  
  // Upload State
  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedAssets, setUploadedAssets] = useState([]);
  const [activeAssetIndex, setActiveAssetIndex] = useState(0); // selected image in carousel
  const [uploadError, setUploadError] = useState(null);

  // Build State
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isProcessingAllImages, setIsProcessingAllImages] = useState(false);
  const [processingImageIndex, setProcessingImageIndex] = useState(0);
  const [searchFailed, setSearchFailed] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [showTips, setShowTips] = useState(false);
  const [lastQuery, setLastQuery] = useState("");
  const [foundObjectsByAsset, setFoundObjectsByAsset] = useState({});
  const [sliderValues, setSliderValues] = useState({});
  const [selectedModel, setSelectedModel] = useState("yolov8s-world.pt");
  const [isAutoLabeling, setIsAutoLabeling] = useState(false);
  const [labelActionError, setLabelActionError] = useState(null);
  const [labelActionStatus, setLabelActionStatus] = useState(null);

  const TARGET_IMAGE_SIZE = 640;
  const AUTO_LABEL_SCORE_THRESHOLD = 0.75;
  const MOCK_COLORS = ['#f97316', '#3b82f6', '#ec4899', '#10b981', '#8b5cf6'];
  const getPreviewUrl = (asset) => asset?.previewUrl || asset?.url || "";
  const getDetectionUrl = (asset) => asset?.remoteUrl || asset?.url || "";
  const activeAsset = uploadedAssets[activeAssetIndex];
  const activeAssetId = activeAsset ? String(activeAsset.id) : "";
  const activeFilename = activeAsset?.name || activeAsset?.filename || "Untitled file";
  const activePreviewUrl = getPreviewUrl(activeAsset);
  const activeDetectionUrl = getDetectionUrl(activeAsset);
  const activeFoundObjects = activeAssetId ? (foundObjectsByAsset[activeAssetId] || []) : [];
  const uploadedImageAssets = uploadedAssets.filter((asset) => asset?.uploadStatus === "uploaded");
  const processingImageAssets = uploadedAssets.filter((asset) => asset?.uploadStatus === "processing");
  const canStartLabeling = uploadedImageAssets.length > 0 && processingImageAssets.length === 0 && !isUploading;

  useEffect(() => {
    if (projectId) {
      localStorage.setItem("visionflow_active_project_id", projectId);
    }
    if (projectName) {
      localStorage.setItem("visionflow_active_project_name", projectName);
    }
  }, [projectId, projectName]);

  useEffect(() => {
    setSearchFailed(false);
    setApiError(null);
    setShowTips(false);
  }, [activeAssetId]);

  const updateUploadedAsset = (assetId, patch) => {
    setUploadedAssets((prev) =>
      prev.map((asset) =>
        String(asset.id) === String(assetId)
          ? { ...asset, ...patch }
          : asset
      )
    );
  };

  const addFoundObjectForAsset = (assetId, newObject) => {
    if (!assetId) return;

    setFoundObjectsByAsset((prev) => {
      const currentObjects = prev[assetId] || [];
      return {
        ...prev,
        [assetId]: [newObject, ...currentObjects],
      };
    });
    setSliderValues((prev) => ({ ...prev, [newObject.id]: 50 }));
  };

  const removeFoundObjectForAsset = (assetId, objectId) => {
    if (!assetId) return;

    setFoundObjectsByAsset((prev) => ({
      ...prev,
      [assetId]: (prev[assetId] || []).filter((item) => item.id !== objectId),
    }));
  };

  const loadImageFromFile = (file) =>
    new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(`Failed to load ${file.name} for resizing.`));
      };
      image.src = objectUrl;
    });

  const resizeImageToSquare = async (file) => {
    if (!file.type?.startsWith("image/")) {
      return { file, previewUrl: URL.createObjectURL(file) };
    }

    const image = await loadImageFromFile(file);
    const canvas = document.createElement("canvas");
    canvas.width = TARGET_IMAGE_SIZE;
    canvas.height = TARGET_IMAGE_SIZE;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not prepare the image canvas.");
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, TARGET_IMAGE_SIZE, TARGET_IMAGE_SIZE);
    context.drawImage(image, 0, 0, TARGET_IMAGE_SIZE, TARGET_IMAGE_SIZE);

    const outputType = file.type && file.type.startsWith("image/") ? file.type : "image/jpeg";
    const resizedBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
            return;
          }
          reject(new Error(`Failed to resize ${file.name} to ${TARGET_IMAGE_SIZE}x${TARGET_IMAGE_SIZE}.`));
        },
        outputType,
        0.92
      );
    });

    const resizedFile = new File([resizedBlob], file.name, {
      type: outputType,
      lastModified: Date.now(),
    });

    return {
      file: resizedFile,
      previewUrl: URL.createObjectURL(resizedFile),
    };
  };

  const processFiles = async (files) => {
    if (!files.length) return;
    if (!projectId) {
      setUploadError("Project context is missing. Please create or reopen a project before uploading.");
      return;
    }
    setIsUploading(true);
    setUploadError(null);
    setLabelActionError(null);
    setLabelActionStatus(null);
    const filesArray = Array.from(files);
    const pendingAssets = filesArray.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      previewUrl: URL.createObjectURL(file),
      remoteUrl: null,
      uploadStatus: "processing",
      statusMessage: file.type?.startsWith("image/")
        ? `Resizing to ${TARGET_IMAGE_SIZE}x${TARGET_IMAGE_SIZE}...`
        : "Uploading...",
    }));
    const failedFiles = [];

    setUploadedAssets((prev) => {
      const merged = [...prev, ...pendingAssets];
      if (pendingAssets.length > 0) {
        setActiveAssetIndex(prev.length);
      }
      return merged;
    });
    setStep('prompt_gather');

    for (let i = 0; i < filesArray.length; i++) {
      const file = filesArray[i];
      const pendingAsset = pendingAssets[i];

      const formData = new FormData();

      try {
        const resizedPayload = await resizeImageToSquare(file);
        updateUploadedAsset(pendingAsset.id, {
          previewUrl: resizedPayload.previewUrl,
          statusMessage: "Uploading optimized image...",
        });

        formData.append('file', resizedPayload.file);
        if (projectId) formData.append('project_id', projectId);

        const res = await fetch("/api/assets", {
          method: "POST",
          body: formData,
        });

        if (res.ok) {
          const data = await res.json();
          updateUploadedAsset(pendingAsset.id, {
            id: data.id || Date.now() + i,
            remoteUrl: data.url,
            uploadStatus: "uploaded",
            statusMessage: `${TARGET_IMAGE_SIZE}x${TARGET_IMAGE_SIZE} ready`,
          });
        } else {
          let message = "Upload failed.";
          try {
            const errorData = await res.json();
            message = errorData?.error || message;
          } catch {
            message = `Upload failed with status ${res.status}.`;
          }
          failedFiles.push(file.name);
          updateUploadedAsset(pendingAsset.id, {
            remoteUrl: null,
            uploadStatus: "failed",
            error: message,
            statusMessage: message,
          });
        }
      } catch (err) {
        console.error("Rapid upload failed", err);
        failedFiles.push(file.name);
        updateUploadedAsset(pendingAsset.id, {
          remoteUrl: null,
          uploadStatus: "failed",
          error: err.message || "Could not reach the upload API.",
          statusMessage: err.message || "Could not reach the upload API.",
        });
      }
    }

    setIsUploading(false);
    if (failedFiles.length > 0) {
      const count = failedFiles.length;
      setUploadError(
        count === files.length
          ? "The image upload failed, so detection cannot run yet. Please retry the upload."
          : `${count} file${count > 1 ? "s" : ""} failed to upload. Detection only works on successfully uploaded files.`
      );
    }
  };

  const handleFileChange = (e) => processFiles(e.target.files);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) processFiles(e.dataTransfer.files);
  };

  const getErrorMessage = async (res, fallbackMessage) => {
    try {
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json();
        return data?.error || fallbackMessage;
      }
      const text = await res.text();
      return text || fallbackMessage;
    } catch {
      return fallbackMessage;
    }
  };

  const openAnnotationPage = () => {
    navigate('/upload', {
      state: {
        projectId,
        projectName,
        visibility,
        activeTab: 'annotate',
        annotateView: 'tool',
      }
    });
  };

  const handleManualLabel = () => {
    if (uploadedImageAssets.length === 0) {
      setLabelActionError("Upload at least one image successfully before opening the annotation page.");
      return;
    }
    if (processingImageAssets.length > 0) {
      setLabelActionError(`Please wait while all images are resized to ${TARGET_IMAGE_SIZE}x${TARGET_IMAGE_SIZE}.`);
      return;
    }
    setLabelActionError(null);
    setLabelActionStatus(null);
    openAnnotationPage();
  };

  const handleAutoLabelBatch = async () => {
    if (isAutoLabeling) return;
    if (uploadedImageAssets.length === 0) {
      setLabelActionError("Upload at least one image successfully before running auto label.");
      return;
    }
    if (processingImageAssets.length > 0) {
      setLabelActionError(`Please wait while all images are resized to ${TARGET_IMAGE_SIZE}x${TARGET_IMAGE_SIZE}.`);
      return;
    }

    setIsAutoLabeling(true);
    setLabelActionError(null);
    setLabelActionStatus(null);

    try {
      const totalImages = uploadedImageAssets.length;
      const res = await fetch("/api/infer/yolo-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_ids: uploadedImageAssets.map((asset) => asset.id),
          model: "yolov8s.pt",
          conf: AUTO_LABEL_SCORE_THRESHOLD,
        })
      });

      if (!res.ok) {
        throw new Error(await getErrorMessage(res, "Auto label failed for the uploaded images."));
      }

      const data = await res.json();
      const batchResults = Array.isArray(data.results) ? data.results : [];
      const failedFiles = batchResults.filter((result) => result?.success === false).length;
      const annotatedAssets = Number(data.annotated_assets || 0);
      const count = Number(data.count || 0);
      const skippedFiles = Math.max(totalImages - annotatedAssets - failedFiles, 0);

      if (batchResults.length > 0) {
        const resultsByAssetId = new Map(
          batchResults.map((result) => [String(result.asset_id), result])
        );

        setUploadedAssets((prev) =>
          prev.map((asset) => {
            const result = resultsByAssetId.get(String(asset.id));
            if (!result) return asset;

            return {
              ...asset,
              remoteUrl: result.asset?.url || asset.remoteUrl,
              isAnnotated: result.asset?.is_annotated ?? Boolean(result.success),
            };
          })
        );
      }

      if (annotatedAssets === 0) {
        throw new Error("YOLOv8s could not process any uploaded images.");
      }

      setLabelActionStatus(
        `Summary: Total: ${totalImages} | Labeled: ${annotatedAssets} | Skipped: ${skippedFiles} | Failed: ${failedFiles}. YOLOv8s found ${count} object${count === 1 ? "" : "s"} at ${Math.round(AUTO_LABEL_SCORE_THRESHOLD * 100)}% confidence or higher.`
      );

      setTimeout(() => {
        openAnnotationPage();
      }, 2000);
    } catch (err) {
      console.error("Rapid auto label failed", err);
      setLabelActionError(err.message || "Auto label failed for the uploaded images.");
    } finally {
      setIsAutoLabeling(false);
    }
  };

  const handleFindObjects = async () => {
    if (!searchQuery.trim() || isSearching || uploadedAssets.length === 0 || !activeAssetId) return;
    setIsSearching(true);
    setApiError(null);
    setStep('build');
    setSearchFailed(false);

    const currentUrl = activeDetectionUrl;
    if (!currentUrl) {
      setApiError("This image was not uploaded to the backend. Please re-upload it before running detection.");
      setSearchFailed(true);
      setIsSearching(false);
      return;
    }

    try {
      const q = searchQuery.trim().toLowerCase();
      setLastQuery(q);
        const res = await fetch("/api/auto-label", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: currentUrl,
            queries: [q],
            model: selectedModel,
            conf: AUTO_LABEL_SCORE_THRESHOLD,
          })
        });
      
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.detections && data.detections.length > 0) {
          const existingObjects = foundObjectsByAsset[activeAssetId] || [];
          const newObj = {
             id: Date.now(),
             text: q,
             count: data.detections.length,
             color: MOCK_COLORS[existingObjects.length % MOCK_COLORS.length],
             boxes: data.detections.map(det => {
                const x = (det.x_center || 0) - (det.width || 0) / 2;
                const y = (det.y_center || 0) - (det.height || 0) / 2;
                return {
                  x: x * 100,
                  y: y * 100,
                  w: (det.width || 0) * 100,
                  h: (det.height || 0) * 100
                };
             })
          };
          addFoundObjectForAsset(activeAssetId, newObj);
          setSearchQuery("");
          setSearchFailed(false);
          setShowTips(false);
          setApiError(null);
          setStep('build');
        } else {
          setSearchFailed(true);
          setApiError("No objects were detected. Try another keyword or adjust confidence controls.");
        }
      } else {
        let message = "Detection API returned an error. Please try again.";
        try {
          const errorData = await res.json();
          message = errorData?.error || message;
        } catch {
          message = `Detection API returned status ${res.status}.`;
        }
        setSearchFailed(true);
        setApiError(message);
      }
    } catch(err) {
      console.error(err);
      setSearchFailed(true);
      setApiError("An unexpected error occurred while detecting objects. Please retry.");
    }
    
    setIsSearching(false);
  };

  const handleRunOnAllImages = async () => {
    if (!searchQuery.trim() || uploadedAssets.length === 0 || isProcessingAllImages) return;

    const query = searchQuery.trim().toLowerCase();
    const assetsToProcess = [...uploadedAssets];
    const initialObjectCounts = Object.fromEntries(
      assetsToProcess.map((asset) => [String(asset.id), (foundObjectsByAsset[String(asset.id)] || []).length])
    );

    setIsProcessingAllImages(true);
    setApiError(null);
    setSearchFailed(false);

    let lastDetectedAssetIndex = -1;
    let totalDetectedAssets = 0;
    
    for (let idx = 0; idx < assetsToProcess.length; idx++) {
      setProcessingImageIndex(idx);
      setActiveAssetIndex(idx);
      setStep('build');
      
      const asset = assetsToProcess[idx];
      const currentUrl = getDetectionUrl(asset);
      if (!currentUrl) continue;
      
      try {
        const assetId = String(asset.id);
        setLastQuery(query);
        const res = await fetch("/api/auto-label", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: currentUrl,
            queries: [query],
            model: selectedModel,
            conf: AUTO_LABEL_SCORE_THRESHOLD,
          })
        });
        
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.detections && data.detections.length > 0) {
            const nextObjectIndex = initialObjectCounts[assetId] || 0;
            const newObj = {
               id: Date.now() + idx,
               text: query,
               count: data.detections.length,
               color: MOCK_COLORS[nextObjectIndex % MOCK_COLORS.length],
               boxes: data.detections.map(det => {
                  const x = (det.x_center || 0) - (det.width || 0) / 2;
                  const y = (det.y_center || 0) - (det.height || 0) / 2;
                  return {
                    x: x * 100,
                    y: y * 100,
                    w: (det.width || 0) * 100,
                    h: (det.height || 0) * 100
                  };
               })
            };
            initialObjectCounts[assetId] = nextObjectIndex + 1;
            addFoundObjectForAsset(assetId, newObj);
            lastDetectedAssetIndex = idx;
            totalDetectedAssets += 1;
          }
        }
      } catch(err) {
        console.error(err);
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    setIsProcessingAllImages(false);
    setSearchQuery("");
    if (!assetsToProcess.some((asset) => getDetectionUrl(asset))) {
      setSearchFailed(true);
      setApiError("None of the selected files were uploaded successfully. Please upload them again.");
    } else if (totalDetectedAssets === 0) {
      setSearchFailed(true);
      setApiError(`No "${query}" detections were found across the uploaded images.`);
      setStep('build');
    } else {
      if (lastDetectedAssetIndex >= 0) {
        setActiveAssetIndex(lastDetectedAssetIndex);
      }
      setSearchFailed(false);
      setApiError(null);
      setStep('review');
    }
  };

  const proceedToProject = () => {
    navigate('/upload', { state: { projectId, projectName, visibility } });
  };

  // ----------------------------------------------------------------------
  // Renders
  // ----------------------------------------------------------------------
  
  if (step === 'upload' || step === 'prompt_gather') {
    return (
      <div className="min-h-screen bg-white font-sans flex flex-col animate-page-enter">
        <header className="flex justify-between items-center px-6 py-4 border-b border-gray-100 shadow-sm z-10 relative bg-white">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
             <span className="font-bold tracking-tight text-violet-700 text-lg">VisionFlow</span>
             <span className="text-violet-600 font-bold uppercase text-[12px] tracking-widest ml-1 mt-0.5">Rapid</span>
             <HelpCircle size={13} className="text-violet-400 ml-1 hover:text-violet-600 transition" />
          </div>
          <div className="flex items-center gap-5">
            <button className="flex items-center gap-1.5 border border-gray-200 rounded-md px-3 py-1.5 text-[12px] font-bold text-gray-600 hover:bg-gray-50 transition shadow-sm bg-white tracking-wide">
              {visibility === "Public" ? <Globe size={14} /> : <Lock size={14} />} {visibility}
            </button>
            <div className="w-8 h-8 rounded-full bg-[#8A5A44] text-white flex items-center justify-center font-bold text-[13px] cursor-pointer shadow-sm">A</div>
          </div>
        </header>

        <main className="flex-1 w-full flex flex-col items-center pt-16 pb-12 px-6">
          <div className="text-center mb-10 w-full max-w-[800px]">
             <h1 className="text-[36px] font-bold text-gray-900 mb-3 tracking-tight">
                Build a <span className="text-violet-600">Computer Vision Model</span> in Minutes
             </h1>
             <p className="text-[17px] text-gray-400 font-medium tracking-wide">Start small and we'll help improve it as your data grows.</p>
          </div>

          <div className="w-full max-w-[1000px] relative">
             <input type="file" accept="image/*,video/*" multiple ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} />
             
             {step === 'upload' ? (
                 <div className="bg-[#f8f5fa] rounded-[24px] p-6 border border-violet-50/50">
                    <div 
                      onClick={() => !isUploading && fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                      className={`w-full border-2 border-dashed rounded-[18px] h-[400px] flex flex-col justify-center items-center cursor-pointer transition-colors group ${isDragging ? 'bg-violet-100 border-violet-600' : isUploading ? 'bg-violet-50/80 cursor-wait border-[#a78bfa]' : 'border-[#a78bfa] hover:bg-violet-50/50 hover:border-violet-500'}`}
                    >
                      <div className={`w-[50px] h-[50px] rounded-full flex items-center justify-center mb-5 transition ${isUploading ? 'bg-violet-200 animate-pulse' : 'bg-violet-100 group-hover:bg-violet-200'}`}>
                         <ArrowUp className="text-violet-600" strokeWidth={2.5} size={22} />
                      </div>
                      <h3 className="text-[#8b5cf6] font-bold text-[18px] mb-2 tracking-tight">
                        {isUploading ? "Uploading Data to VisionFlow Engine..." : isDragging ? "Drop Files Here" : "Upload an image or a short video"}
                      </h3>
                    </div>
                 </div>
             ) : (
                 <div className="bg-[#f8f5fa] rounded-[24px] p-4 flex flex-col md:flex-row gap-4 border border-violet-50/50">
                    <div className="flex-1 bg-white rounded-[16px] shadow-sm p-5 border border-gray-100/50 flex flex-col min-h-[350px]">
                       <div className="flex justify-between items-center mb-6">
                           <div className="flex items-center gap-2">
                              <span className="font-bold text-gray-800 text-[14px]">Files</span>
                              <span className="bg-gray-100 text-gray-500 rounded-md px-1.5 py-0.5 text-[11px] font-bold">{uploadedAssets.length}</span>
                           </div>
                           <button onClick={() => !isUploading && fileInputRef.current?.click()} className="text-[12px] font-bold text-gray-500 hover:text-gray-800 border border-gray-200 rounded-md px-3 py-1.5 flex items-center gap-1 transition disabled:opacity-60" disabled={isUploading}>
                              <Plus size={14} /> Add Files
                           </button>
                       </div>
                       
                       <div className="flex flex-wrap gap-4">
                           {uploadedAssets.length > 0 ? uploadedAssets.map((asset, idx) => (
                             <div
                               key={asset.id}
                               onClick={() => setActiveAssetIndex(idx)}
                               className={`w-20 h-20 rounded-[8px] overflow-hidden border ${idx === activeAssetIndex ? 'border-violet-500 ring-2 ring-violet-200' : 'border-gray-200'} shadow-sm relative cursor-pointer`}
                             >
                               <div className="w-full h-full bg-cover" style={{ backgroundImage: `url(${getPreviewUrl(asset)})` }}></div>
                               {asset.uploadStatus === "processing" && (
                                 <div className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center gap-1 text-white">
                                   <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin"></span>
                                   <span className="px-1.5 text-[9px] font-bold text-center leading-tight">
                                     {asset.statusMessage || `Resizing to ${TARGET_IMAGE_SIZE}x${TARGET_IMAGE_SIZE}...`}
                                   </span>
                                 </div>
                               )}
                               {asset.uploadStatus === "failed" && (
                                 <div className="absolute top-1 right-1 rounded bg-red-600 px-1 py-0.5 text-[9px] font-bold text-white">
                                   Failed
                                 </div>
                               )}
                               <span className="absolute bottom-1 left-1 px-1.5 bg-black/50 text-white text-[10px] rounded">{asset.name?.slice(0, 10)}</span>
                             </div>
                           )) : (
                             <div className="w-20 h-20 rounded-[8px] bg-gray-100 overflow-hidden border border-gray-200 shadow-sm relative group">
                               <div className="w-full h-full flex items-center justify-center text-gray-300 pointer-events-none"><ImageIcon strokeWidth={1.5} size={24} /></div>
                             </div>
                           )}
                       </div>
                    </div>
                    
                    <div className="flex-1 bg-white rounded-[16px] shadow-sm p-10 border border-gray-100/50 flex flex-col min-h-[350px] items-center text-center justify-center relative">
                        <div className="w-12 h-12 rounded-full border border-violet-100 bg-violet-50 text-violet-600 flex items-center justify-center shadow-sm mb-6 absolute top-8">
                           <Search strokeWidth={2.5} size={20} />
                        </div>
                        
                        <div className="w-full mt-10">
                           <h3 className="text-[19px] font-bold text-gray-900 tracking-tight mb-2">Choose how you want to continue</h3>
                           <p className="text-[12px] font-bold text-gray-400 mb-6">
                              Run YOLOv8s on every uploaded image automatically, or jump straight into manual annotation.
                           </p>
                           {uploadError && (
                             <div className="mb-4 rounded-[8px] border border-red-200 bg-red-50 px-4 py-3 text-left text-[13px] font-medium text-red-700">
                               {uploadError}
                             </div>
                           )}

                           {labelActionError && (
                             <div className="mb-4 rounded-[8px] border border-red-200 bg-red-50 px-4 py-3 text-left text-[13px] font-medium text-red-700">
                               {labelActionError}
                             </div>
                           )}

                           {labelActionStatus && (
                             <div className="mb-4 rounded-[8px] border border-green-200 bg-green-50 px-4 py-3 text-left text-[13px] font-medium text-green-700">
                               {labelActionStatus}
                             </div>
                           )}

                           <div className="space-y-3">
                              <button
                                onClick={handleAutoLabelBatch}
                                disabled={isAutoLabeling || !canStartLabeling}
                                className={`w-full rounded-[8px] py-3 text-[14px] font-bold flex items-center justify-center gap-2 transition ${
                                  canStartLabeling
                                    ? "bg-violet-600 border-none text-white hover:bg-violet-700 active:scale-95"
                                    : "bg-violet-200 border-none text-white opacity-80 cursor-not-allowed"
                                }`}
                             >
                               {isAutoLabeling ? (
                                 <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                               ) : (
                                 <Sparkles size={16} />
                               )}
                               {isAutoLabeling ? "Auto Labeling..." : "Auto Label"}
                             </button>

                              <button
                                onClick={handleManualLabel}
                                disabled={isAutoLabeling || !canStartLabeling}
                                className={`w-full rounded-[8px] py-3 text-[14px] font-bold flex items-center justify-center gap-2 transition border ${
                                  canStartLabeling
                                    ? "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
                                    : "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                                }`}
                             >
                               <ArrowRight size={16} />
                               Manual Label
                             </button>
                           </div>

                           <div className="mt-5 flex items-start justify-between gap-4 rounded-[12px] border border-gray-100 bg-gray-50 px-4 py-3 text-left">
                              <div>
                                <p className="text-[12px] font-bold text-gray-700">Uploaded Images</p>
                                <p className="text-[12px] text-gray-500">
                                  {processingImageAssets.length > 0
                                    ? `${processingImageAssets.length} resizing to ${TARGET_IMAGE_SIZE}x${TARGET_IMAGE_SIZE}`
                                    : `${uploadedImageAssets.length} ready for labeling`}
                                </p>
                              </div>
                             <div className="text-right">
                               <p className="text-[12px] font-bold text-gray-700">Model</p>
                               <p className="text-[12px] text-gray-500">YOLOv8s</p>
                             </div>
                           </div>
                        </div>
                    </div>
                 </div>
             )}
          </div>
        </main>
      </div>
    );
  }

  // BUILD & REVIEW STEPS
  return (
    <div className="min-h-screen font-sans flex flex-col bg-white overflow-hidden max-h-screen">
      {/* Top Protocol Header */}
      <header className="flex justify-between items-center px-4 md:px-6 py-3 border-b border-gray-200 bg-white shrink-0 shadow-sm z-10 relative">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => navigate('/')}>
             <span className="font-bold tracking-tight text-violet-700 text-lg md:text-[20px]">visionflow</span>
             <span className="text-violet-600 font-bold uppercase text-[11px] md:text-[13px] tracking-widest mt-1">RAPID</span>
          </div>
          
          <div className="hidden md:flex items-center gap-3 ml-4">
             <div className="flex items-center gap-2">
                <div className={`w-4 h-4 rounded-full flex items-center justify-center ${step === 'build' ? 'bg-violet-600' : 'bg-gray-200'}`}>
                   {step === 'build' ? <div className="w-1.5 h-1.5 bg-white rounded-full"></div> : ''}
                </div>
                <span className={`text-[13px] font-bold ${step === 'build' ? 'text-violet-700' : 'text-gray-400'}`}>Build</span>
             </div>
             <div className="w-10 h-px bg-gray-200"></div>
             <div className="flex items-center gap-2">
                <div className={`w-4 h-4 rounded-full flex items-center justify-center ${step === 'review' ? 'bg-violet-600' : 'bg-gray-200'}`}>
                   {step === 'review' ? <div className="w-1.5 h-1.5 bg-white rounded-full"></div> : ''}
                </div>
                <span className={`text-[13px] font-bold ${step === 'review' ? 'text-violet-700' : 'text-gray-400'}`}>Review</span>
             </div>
             <div className="w-10 h-px bg-gray-200"></div>
             <div className="flex items-center gap-2">
                <div className={`w-4 h-4 rounded-full border-2 border-gray-200`}></div>
                <span className={`text-[13px] font-bold text-gray-400`}>Use</span>
             </div>
          </div>
        </div>

        <div className="flex items-center gap-3 md:gap-5">
          <span className="text-[12px] text-gray-500 font-medium hidden lg:block">How's your experience?</span>
          <div className="hidden lg:flex items-center gap-2 text-gray-400">
             <ThumbsUp size={14} className="hover:text-violet-600 cursor-pointer transition" />
             <ThumbsDown size={14} className="hover:text-red-500 cursor-pointer transition" />
          </div>
          <button className="hidden sm:block text-[12px] font-bold text-gray-700 border border-gray-200 px-3 py-1.5 rounded bg-white hover:bg-gray-50 transition">Talk with our Team</button>
          <button className="flex items-center gap-1.5 border border-gray-200 rounded-md px-3 py-1.5 text-[12px] font-bold text-gray-600 hover:bg-gray-50 transition shadow-sm bg-white tracking-wide">
             <Lock size={12} /> Private
          </button>
          <div className="w-7 h-7 rounded-full bg-[#8A5A44] text-white flex items-center justify-center font-bold text-[12px] cursor-pointer shadow-sm">A</div>
        </div>
      </header>

      {/* Main Split Interface */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        
        {/* LEFT: Dark Canvas */}
        <div className="flex-1 flex flex-col bg-[#111827] relative">
          {/* Canvas Toolbar */}
          <div className="h-12 bg-white flex justify-between items-center border-b border-gray-200 px-4 shrink-0 shadow-sm z-10">
             <span className="text-[13px] font-bold text-gray-700">{activeFilename} {step === 'review' && <span className="ml-2 text-gray-400 font-medium">Draft</span>}</span>
             <div className="flex items-center gap-3 text-gray-500">
               <Eye size={16} className="cursor-pointer hover:text-gray-900" />
               <Minus size={16} className="cursor-pointer hover:text-gray-900" />
               <Plus size={16} className="cursor-pointer hover:text-gray-900" />
               <div className="flex items-center gap-1 cursor-pointer hover:text-gray-900 ml-2">
                 <span className="text-[12px] font-bold uppercase">Reset</span>
               </div>
             </div>
          </div>
          
          {/* Work Area */}
          <div className="flex-1 relative flex items-center justify-center overflow-hidden p-8">
             {activePreviewUrl ? (
                <div className="relative inline-block max-w-full max-h-full">
                  <img src={activePreviewUrl} className="max-w-full max-h-full object-contain pointer-events-none shadow-[0_0_40px_rgba(0,0,0,0.5)] border border-gray-800" />
                  {!activeDetectionUrl && (
                    <div className="absolute inset-x-4 top-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 shadow">
                      This file is only in the browser preview. Re-upload it so the backend can detect objects.
                    </div>
                  )}

                  {/* Mock Bounding Boxes Rendered Over Image */}
                  <div className="absolute inset-0 pointer-events-none">
                     {activeFoundObjects.map((obj) => (
                       (obj.boxes || []).map((box, idx) => (
                         // Randomize visibility based on slider just for mock effect
                         (sliderValues[obj.id] > 30) ? (
                            <div 
                              key={`${obj.id}-${idx}`}
                              className="absolute border-2 shadow-sm"
                              style={{
                                left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`,
                                borderColor: obj.color, backgroundColor: `${obj.color}20`
                              }}
                            >
                               <div className="absolute top-0 left-0 -translate-y-full px-1.5 py-0.5 text-[10px] sm:text-[11px] font-bold text-white shadow-sm" style={{ backgroundColor: obj.color }}>
                                 {obj.text}
                               </div>
                            </div>
                         ) : null
                       ))
                     ))}
                  </div>
                  
                  {/* Loading Overlay */}
                  {(isSearching || isProcessingAllImages) && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded">
                      <div className="bg-white rounded-lg px-6 py-4 shadow-lg flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin"></div>
                        <div className="text-sm font-bold text-gray-800">
                          {isProcessingAllImages ? `Processing ${processingImageIndex + 1} of ${uploadedAssets.length}...` : "Detecting objects..."}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
             ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-400 text-lg font-bold">No image selected yet. Upload or choose from the list.</div>
             )}
          </div>
        </div>

        {/* RIGHT: Sidebar Controls */}
        <div className="w-[360px] md:w-[400px] shrink-0 bg-white border-l border-gray-200 flex flex-col z-20 shadow-[-4px_0_20px_rgba(0,0,0,0.03)] overflow-y-auto">
          
          {/* --- BUILD STEP SIDEBAR --- */}
          {step === 'build' && (
            <div className="p-6 flex flex-col h-full bg-white relative">
               <div className="flex items-center justify-between mb-4">
                 <h3 className="text-[14.5px] font-bold text-gray-900 tracking-tight">Find objects in this image</h3>
                 <div className="hidden">
                   {/* Model selector hidden for exact clone UI matching */}
                   <select 
                     value={selectedModel}
                     onChange={(e) => setSelectedModel(e.target.value)}
                     className="text-[11px] font-bold border border-gray-200 bg-gray-50 rounded text-gray-600 px-1 py-1 outline-none"
                   >
                     <option value="yolov8x-world.pt">🎯 X-Large (Most Accurate)</option>
                   </select>
                 </div>
               </div>
               
               <div className="flex flex-col gap-2.5 mb-6">
                 {apiError && (
                   <div className="mb-2 rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
                     {apiError}
                   </div>
                 )}
                 <input 
                   type="text" 
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && handleFindObjects()}
                   placeholder="Enter objects: person, card, dog..."
                   className="w-full border border-gray-300 rounded-[6px] px-3 py-2 text-[13px] font-medium text-gray-900 outline-none focus:border-violet-500 transition shadow-sm placeholder-gray-400 focus:ring-1 focus:ring-violet-200"
                 />
                 <button 
                   onClick={handleFindObjects}
                   disabled={!searchQuery.trim() || isSearching}
                   className="w-full border border-violet-200 text-violet-700 bg-white hover:bg-violet-50 rounded-[6px] px-4 py-2 font-bold text-[13px] transition disabled:opacity-50 flex items-center justify-center gap-1 shadow-sm"
                 >
                   {isSearching ? <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-violet-700"></span> : "Find Objects"}
                   <Sparkles size={13} className={`${isSearching ? 'hidden' : ''} text-[#a78bfa]`} />
                 </button>
               </div>

               {/* Object Cards / Empty States */}
               <div className="flex flex-col gap-4 flex-1 overflow-y-auto">
                 {searchFailed && (
                    <div className="border border-gray-200 rounded-[8px] bg-white shadow-sm overflow-hidden flex flex-col p-4 relative text-center">
                       <div className="absolute top-4 left-4 w-2.5 h-2.5 rounded-full bg-violet-600"></div>
                       <div className="font-bold text-gray-900 text-[14px] text-left ml-6 mb-4">{lastQuery || 'object'}</div>
                       
                       <p className="text-[12.5px] text-gray-500 mb-2.5 font-medium leading-tight">No objects found.<br/>Draw a box around it or try another word:</p>
                       <div className="flex gap-1.5 flex-wrap justify-center mb-4">
                          <div onClick={() => setSearchQuery('car')} className="text-[11.5px] border border-gray-200 rounded-[6px] px-2 py-1 text-gray-600 cursor-pointer hover:bg-gray-50 bg-white">car</div>
                          <div onClick={() => setSearchQuery('wheel')} className="text-[11.5px] border border-gray-200 rounded-[6px] px-2 py-1 text-gray-600 cursor-pointer hover:bg-gray-50 bg-white">wheel</div>
                          <div onClick={() => setSearchQuery('headlight')} className="text-[11.5px] border border-gray-200 rounded-[6px] px-2 py-1 text-gray-600 cursor-pointer hover:bg-gray-50 bg-white">headlight</div>
                          <div onClick={() => setSearchQuery('door')} className="text-[11.5px] border border-gray-200 rounded-[6px] px-2 py-1 text-gray-600 cursor-pointer hover:bg-gray-50 bg-white">door</div>
                       </div>
                       
                       <button onClick={() => setShowTips(!showTips)} className="w-full bg-gray-50 border border-gray-200 rounded-[6px] py-1.5 text-[12px] font-bold text-gray-600 hover:bg-gray-100 flex items-center justify-center gap-1.5">
                         <HelpCircle size={13}/> Prompting Tips
                       </button>
                    </div>
                 )}

                 {showTips && (
                    <div className="absolute top-[340px] right-[400px] w-[320px] bg-white rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.1)] border border-gray-200 p-5 z-50 flex flex-col gap-4">
                       <div className="flex justify-between items-center bg-white border-b border-gray-100 pb-3 mb-1">
                          <h4 className="font-bold text-[14px] text-gray-900">Prompting Tips</h4>
                          <X size={16} className="text-gray-400 cursor-pointer hover:text-gray-700" onClick={() => setShowTips(false)} />
                       </div>
                       
                       <div className="flex flex-col gap-5 bg-white">
                          <div className="flex gap-3">
                             <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0 border border-gray-100">🎯</div>
                             <div className="flex flex-col">
                                <span className="text-[13px] font-bold text-gray-800">Be Specific and Concise</span>
                                <span className="text-[12px] text-gray-500 leading-snug">Short, specific noun phrases work best. Instead of "vehicle," try "yellow school bus".</span>
                             </div>
                          </div>
                          <div className="flex gap-3">
                             <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0 border border-gray-100 text-[14px] font-bold text-gray-400">T</div>
                             <div className="flex flex-col">
                                <span className="text-[13px] font-bold text-gray-800">Iterate and Refine</span>
                                <span className="text-[12px] text-gray-500 leading-snug">If one prompt doesn't work, try alternatives. For example, "person" vs "human" vs "pedestrian".</span>
                             </div>
                          </div>
                          <div className="flex gap-3">
                             <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0 border border-gray-100 text-gray-400 font-bold"><List size={14}/></div>
                             <div className="flex flex-col">
                                <span className="text-[13px] font-bold text-gray-800">Use Common Terms</span>
                                <span className="text-[12px] text-gray-500 leading-snug">Simple, commonly-used words work best. Avoid jargon or overly technical terms.</span>
                             </div>
                          </div>
                          <div className="flex gap-3">
                             <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0 border border-gray-100 text-gray-400 font-bold"><Crop size={14}/></div>
                             <div className="flex flex-col">
                                <span className="text-[13px] font-bold text-gray-800">Draw a Box Around the Object</span>
                                <span className="text-[12px] text-gray-500 leading-snug">If you're having trouble finding an object using just text prompting, draw a box around it instead.</span>
                             </div>
                          </div>
                       </div>
                    </div>
                 )}

                 {activeFoundObjects.map((obj) => (
                   <div key={obj.id} className="border border-gray-200 rounded-[8px] bg-white shadow-sm overflow-hidden flex flex-col">
                      <div className="p-3 border-b border-gray-100 flex items-center justify-between bg-white">
                         <div className="flex items-center gap-2">
                           <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: obj.color }}></div>
                           <span className="font-bold text-gray-900 text-[14px]">{obj.text}</span>
                         </div>
                         <div className="flex gap-2 text-gray-400">
                           <SlidersHorizontal size={14} className="cursor-pointer hover:text-gray-800" />
                           <Trash size={14} className="cursor-pointer hover:text-red-500" onClick={() => removeFoundObjectForAsset(activeAssetId, obj.id)} />
                         </div>
                      </div>
                      <div className="p-4">
                         <div className="flex justify-between items-center mb-2">
                            <span className="text-[13px] font-bold text-gray-600">Objects</span>
                            <span className="text-[12px] font-bold flex items-center gap-1 bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded border border-violet-100">
                               {obj.count} <SlidersHorizontal size={12} />
                            </span>
                         </div>
                         
                         {/* Fake Confidence Slider */}
                         <div className="relative h-6 flex items-center my-2 select-none">
                            <div className="w-full h-1 bg-gray-200 rounded-full"></div>
                            <div className="absolute h-1 rounded-full" style={{ backgroundColor: obj.color, width: `${sliderValues[obj.id] || 50}%`}}></div>
                            <input 
                              type="range" 
                              min="0" max="100" 
                              value={sliderValues[obj.id] || 50}
                              onChange={(e) => setSliderValues((prev) => ({ ...prev, [obj.id]: e.target.value }))}
                              className="absolute w-full h-full opacity-0 cursor-pointer"
                            />
                            <div className="absolute w-4 h-4 bg-white border-2 rounded-full shadow pointer-events-none transform -translate-x-1/2" style={{ borderColor: obj.color, left: `${sliderValues[obj.id] || 50}%` }}></div>
                         </div>
                         
                         {/* Thumbnails Row */}
                         <div className="flex gap-2 mt-4 overflow-x-auto pb-1 scrollbar-hide">
                           {Array(obj.count).fill(0).map((_, i) => (
                             <div key={i} className="w-14 h-14 shrink-0 rounded-[6px] border border-gray-200 bg-gray-100 flex items-center justify-center overflow-hidden">
                                {activePreviewUrl ? (
                                   <div className="w-[300%] h-[300%] bg-cover" style={{ backgroundImage: `url(${activePreviewUrl})`, backgroundPosition: `${Math.random()*100}% ${Math.random()*100}%` }}></div>
                                ) : (
                                   <ImageIcon className="text-gray-300" size={20} />
                                )}
                             </div>
                           ))}
                         </div>
                      </div>
                   </div>
                 ))}
               </div>

               {/* Bottom CTA */}
               <div className="pt-4 mt-auto flex flex-col gap-3">
                  <div className="flex justify-center text-violet-600 font-bold text-[12px] items-center gap-1 cursor-pointer hover:underline">
                     <HelpCircle size={14} /> Labeling Tips
                  </div>
                  <button 
                    onClick={handleRunOnAllImages}
                    disabled={!searchQuery.trim() || isProcessingAllImages || !uploadedAssets.some((asset) => getDetectionUrl(asset))}
                    className={`w-full ${searchQuery.trim() && !isProcessingAllImages ? 'bg-[#8b5cf6] hover:bg-[#7c3aed]' : 'bg-gray-300 cursor-not-allowed'} text-white rounded-[6px] py-3 font-bold text-[14px] transition flex items-center justify-center gap-2`}
                  >
                     {isProcessingAllImages ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span> : '✓'} 
                     {isProcessingAllImages ? 'Processing...' : 'Run On All Images'} 
                     <span className="flex text-[10px] text-white/70 border border-white/20 rounded px-1 ml-1 bg-black/10">⌘ ↩</span>
                  </button>
               </div>
            </div>
          )}

          {/* --- REVIEW STEP SIDEBAR --- */}
          {step === 'review' && (
            <div className="p-6 flex flex-col h-full bg-gray-50/30">
               <h3 className="text-[18px] font-bold text-gray-900 mb-2 tracking-tight">How is your model looking?</h3>
               <p className="text-[13px] text-gray-500 font-medium mb-8 leading-relaxed">
                 You can adjust the slider to show more or less objects before taking your next action.
               </p>

               <div className="flex flex-col gap-4 mb-8">
                 <button 
                   onClick={proceedToProject}
                   className="w-full bg-white border border-violet-200 shadow-[0_2px_8px_rgba(139,92,246,0.12)] hover:border-violet-400 text-left rounded-[12px] p-5 transition group active:scale-[0.98]"
                 >
                    <div className="flex items-center gap-3 mb-1">
                      <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center text-violet-600 group-hover:scale-110 transition shrink-0">
                         <Rocket size={16} />
                      </div>
                      <span className="font-bold text-gray-900 text-[15px] group-hover:text-violet-700 transition">Use Model</span>
                    </div>
                    <p className="text-[13px] text-gray-500 font-medium ml-11">Start using your model now in your workspace.</p>
                 </button>

                 <button 
                   onClick={proceedToProject}
                   className="w-full bg-white border border-gray-200 shadow-sm hover:border-gray-300 text-left rounded-[12px] p-5 transition group active:scale-[0.98]"
                 >
                    <div className="flex items-center gap-3 mb-1">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 group-hover:scale-110 transition shrink-0">
                         <span className="text-[16px]">✨</span>
                      </div>
                      <span className="font-bold text-gray-900 text-[15px]">Improve Model</span>
                    </div>
                    <p className="text-[13px] text-gray-500 font-medium ml-11">Publish and retrain on new data manually.</p>
                 </button>
               </div>
               
               <div className="flex items-center gap-4 mb-6">
                 <div className="flex-1 h-px bg-gray-200"></div>
                 <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">OR</span>
                 <div className="flex-1 h-px bg-gray-200"></div>
               </div>

               <button className="w-full bg-white border border-gray-200 rounded-[8px] py-3 text-[14px] font-bold text-gray-700 hover:bg-gray-50 transition shadow-sm mb-6">
                 + Test on More Files
               </button>

               <div className="border border-gray-200 rounded-[10px] bg-white shadow-sm overflow-hidden flex flex-col mt-auto">
                 <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                    <span className="font-bold text-gray-800 text-[13px] flex items-center gap-2">
                       <span className="text-gray-400">✨</span> Adjust Objects
                    </span>
                 </div>
                 <div className="p-4 bg-gray-50/50">
                    <div className="flex justify-between items-center mb-2">
                       <span className="text-[13px] font-bold text-gray-600">Objects</span>
                       <span className="text-[12px] font-bold flex items-center gap-1 text-violet-600">
                          {activeFoundObjects.reduce((acc, obj) => acc + obj.count, 0)} <SlidersHorizontal size={12} />
                       </span>
                    </div>
                    <div className="relative h-6 flex items-center my-2">
                       <div className="w-full h-1 bg-gray-200 rounded-full"></div>
                       <div className="absolute h-1 bg-violet-500 rounded-full w-2/3"></div>
                       <div className="absolute w-4 h-4 bg-white border-2 border-violet-500 rounded-full shadow pointer-events-none transform -translate-x-1/2 left-2/3"></div>
                    </div>
                 </div>
                 
                 <button onClick={() => setStep('build')} className="w-full border-t border-gray-100 py-3 text-[13px] font-bold text-gray-600 hover:bg-gray-50 transition flex items-center justify-center gap-1">
                   ← Add New Objects
                 </button>
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
