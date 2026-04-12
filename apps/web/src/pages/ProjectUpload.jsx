/* eslint-disable react-hooks/exhaustive-deps, no-unused-vars */
import { useNavigate, useLocation } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { 
  Upload, Tag, HelpCircle, HardDrive, Edit3, Database, Layers, BarChart2, Hash, 
  Cpu, Box, Eye, Rocket, Check, ArrowUp, FileImage, FileCode, Film, FileText, Code, Globe, Lock,
  Sparkles, User, Users, Building, ChevronRight, UploadCloud, Activity, List, Share2, Network, PieChart,
  Search, X, Plus, Crop, FileCheck, MoreVertical, ArrowRight, Image as ImageIcon, CheckCircle, Info, ChevronDown, Trash
} from "lucide-react";
import AnnotationTool from "../components/AnnotationTool";
import VersionsTab from "../components/VersionsTab";
import TrainTab from "../components/TrainTab";
import DeployTab from "../components/DeployTab";
import AnalyticsTab from "../components/AnalyticsTab";
import ClassesTab from "../components/ClassesTab";
import ModelsTab from "../components/ModelsTab";
import VisualizeTab from "../components/VisualizeTab";
import AutoLabelBatchPanel from "../components/AutoLabelBatchPanel";
import * as tf from '@tensorflow/tfjs';
import * as mobilenet from '@tensorflow-models/mobilenet';

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
  const [annotateView, setAnnotateView] = useState(location.state?.annotateView || 'board');
  const [createBatchInstantly, setCreateBatchInstantly] = useState(true);
  const [autoLabelClasses, setAutoLabelClasses] = useState([{ name: "", description: "" }]);
  const [autoLabelStrategy, setAutoLabelStrategy] = useState("auto");
  const [autoLabelPreview, setAutoLabelPreview] = useState([]);
  const [autoLabelStatus, setAutoLabelStatus] = useState("");
  const [autoLabelError, setAutoLabelError] = useState("");
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [isApplyingAutoLabel, setIsApplyingAutoLabel] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (projectId) {
      localStorage.setItem("visionflow_active_project_id", projectId);
      fetchAssets();
      fetchProjectData();
    }
    if (projectName) {
      localStorage.setItem("visionflow_active_project_name", projectName);
    }
  }, [projectId]);

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

  const fetchProjectData = async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        const me = data.find(p => String(p.id) === String(projectId));
        if (me) {
           if (me.project_type) setProjectType(me.project_type);
           if (me.classification_type) setClassificationType(me.classification_type);
        }
      }
    } catch(err) {
      console.error(err);
    }
  };

  const fetchAssets = async () => {
    try {
      const res = await fetch(`/api/assets?project_id=${projectId}`);
      if (res.ok) {
        setAssets(await res.json());
      }
    } catch(err) {
      console.error(err);
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
    
    // Trigger the dialogue box showing options instead of auto navigating!
    setIsUploadComplete(true);
  };

  const handleFileChange = (e) => processFiles(e.target.files);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) processFiles(e.dataTransfer.files);
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

  const hasAssets = assets.length > 0;
  // TODO: Check if versions exist for Models disabled state, for now lock Models if no assets
  const hasVersions = false;

  return (
    <div className="min-h-screen bg-white flex font-sans animate-page-enter">
      
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
              <NavItem icon={<Database size={16} />} label="Dataset" active={activeTab === 'dataset'} onClick={() => setActiveTab('dataset')} disabled={!hasAssets} />
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
        <div className={`flex flex-col flex-1 overflow-x-hidden relative ${activeTab === 'annotate' ? 'p-0' : 'px-5 sm:px-10 xl:flex-row gap-8 py-8'}`}>
          
          {/* UPLOAD TAB */}
          {activeTab === 'upload' && (
            <>
              {/* Upload Complete Dialogue Box */}
              {isUploadComplete && (
                 <div className="absolute inset-0 bg-black/10 backdrop-blur-[2px] z-50 flex items-center justify-center animate-fade-in p-4 rounded-xl">
                    <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-md p-6 animate-slide-up relative">
                       <button 
                         className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition bg-gray-50 rounded-full p-1.5"
                         onClick={() => {
                            setIsUploadComplete(false);
                            setIsUploading(false);
                            fetchAssets();
                            setActiveTab("dataset");
                         }}
                       >
                         <X size={16} />
                       </button>
                       <div className="w-12 h-12 bg-violet-100 rounded-full flex items-center justify-center mb-4">
                          <Check className="text-violet-600" size={24} strokeWidth={3} />
                       </div>
                       <h3 className="text-[20px] font-bold text-gray-900 mb-2 tracking-tight">Upload Complete!</h3>
                       <p className="text-[13px] text-gray-600 mb-6 font-medium leading-[1.6]">
                          Your files have been uploaded into a project batch successfully.
                          {detectedObject && detectedObject !== 'related objects' && (
                             <span> VisionFlow suggests starting with <strong className="text-violet-600 px-1 py-0.5 bg-violet-50 rounded uppercase text-[11px] tracking-widest">"{detectedObject}"</strong> as an AI labeling class.</span>
                          )}
                          <br/><br/>
                          Next, choose whether you want to review the dataset grid or go straight into AI-assisted labeling.
                       </p>
                       
                       <div className="flex gap-3 w-full">
                          <button 
                             onClick={() => {
                                setIsUploadComplete(false);
                                setIsUploading(false);
                                fetchAssets();
                                setActiveTab("dataset");
                             }}
                             className="flex-1 px-4 py-2.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-lg transition text-[13px] shadow-sm"
                          >
                             Review Dataset
                          </button>
                           <button 
                             onClick={() => {
                                setIsUploadComplete(false);
                                setIsUploading(false);
                                fetchAssets();
                                setActiveTab(createBatchInstantly ? "annotate" : "dataset");
                                setAnnotateView("batch");
                             }}
                             className="flex-1 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-lg shadow-md transition flex items-center justify-center gap-2 text-[13px]"
                          >
                             <Sparkles size={16}/> Open YOLO Labeling
                          </button>
                       </div>
                    </div>
                 </div>
              )}

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
                         <button onClick={handleUploadClick} className="bg-white border text-gray-700 w-full sm:w-auto px-6 py-3 sm:py-2.5 rounded-[8px] flex items-center justify-center font-bold gap-2 hover:bg-gray-50 transition shadow-sm border-gray-300">
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
                          <div>
                            <h4 className="text-[13px] text-gray-800 font-bold flex items-center gap-2 mb-1"><FileCode size={14}/> Annotations</h4>
                            <p className="text-[12px] text-violet-600 font-medium">in 26 formats ↗</p>
                          </div>
                          <div>
                            <h4 className="text-[13px] text-gray-800 font-bold flex items-center gap-2 mb-1"><Film size={14}/> Videos</h4>
                            <p className="text-[12px] text-gray-400 font-mono tracking-tighter">.mov, .mp4, .avi</p>
                          </div>
                          <div>
                            <h4 className="text-[13px] text-gray-800 font-bold flex items-center gap-2 mb-1"><FileText size={14}/> PDFs</h4>
                            <p className="text-[12px] text-gray-400 font-mono tracking-tighter">.pdf</p>
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
              <div className="flex-1 w-full flex flex-col items-start min-w-0">
                <h3 className="font-bold text-gray-800 text-[18px] mb-6">Generated Dataset ({assets.length} images)</h3>
                {assets.length === 0 ? (
                  <div className="w-full h-64 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center text-gray-400 text-[14px]">No generated assets found for this project yet. Upload data first!</div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 w-full">
                    {assets.map(asset => (
                      <div key={asset.id} onClick={() => setActiveTab('annotate')} className="w-full bg-gray-100 rounded-lg aspect-square overflow-hidden border border-gray-200 shadow-sm relative group cursor-pointer hover:border-violet-500 hover:shadow-md transition">
                         <img src={asset.url} className="w-full h-full object-cover" />
                         <div className={`absolute top-2 left-2 text-white text-[10px] font-bold px-2 py-0.5 rounded cursor-default border shadow-sm ${asset.is_annotated ? 'bg-green-500 border-green-600' : 'bg-black/60 border-white/20'}`}>
                            {asset.is_annotated ? 'Annotated' : 'Unannotated'}
                         </div>
                         <button 
                            onClick={(e) => { e.stopPropagation(); deleteAsset(asset.id); }}
                            className="absolute top-2 right-2 bg-red-500/80 hover:bg-red-600 text-white p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition shadow-sm z-10"
                            title="Delete Image"
                         >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                         </button>
                      </div>
                    ))}
                  </div>
                )}
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
                           <h2 className="text-[22px] font-bold text-gray-900 tracking-tight">Annotate</h2>
                        </div>
                        <div className="flex items-center gap-4">
                           <div className="flex items-center gap-2 text-[13px] font-bold text-gray-700">
                              <Users size={16} className="text-gray-500" /> VisionFlow Labeling
                           </div>
                           <button className="px-4 py-2 border border-gray-200 rounded-[8px] text-[13px] font-bold text-gray-700 bg-white shadow-sm flex items-center gap-2 hover:bg-gray-50 transition">
                              <FileCheck size={16} className="text-gray-500" /> Enable Review Mode <span className="bg-violet-100 text-violet-700 p-0.5 rounded ml-1"><Lock size={12}/></span>
                           </button>
                           <button className="px-5 py-2 bg-violet-600 text-white rounded-[8px] text-[13px] font-bold shadow-sm flex items-center gap-2 hover:bg-violet-700 transition">
                              <Plus size={16} /> New Version
                           </button>
                        </div>
                    </div>

                    <div className="px-8 pb-4">
                       <div className="flex items-center gap-2 mb-6">
                           <span className="text-[12px] font-bold text-gray-500 uppercase tracking-wide">Sort By:</span>
                           <button className="px-3 py-1.5 border border-gray-200 rounded-[8px] text-[13px] font-bold text-gray-700 bg-white shadow-sm flex items-center gap-2 hover:bg-gray-50 transition">
                              Newest <ChevronDown size={14} className="text-gray-400" />
                           </button>
                       </div>
                    
                       {/* Kanban Columns */}
                       <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full items-stretch w-full">
                          
                          {/* Unassigned */}
                          <div className="bg-white border border-gray-200 rounded-[12px] shadow-sm flex flex-col p-5">
                             <div className="flex justify-between items-start mb-6">
                                <div className="flex-1 text-center pr-4 pl-8">
                                   <h3 className="font-bold text-[16px] text-gray-900 tracking-tight">Unassigned</h3>
                                   <p className="text-[12px] text-gray-400 font-mono tracking-tighter mt-1 uppercase">1 Batch</p>
                                </div>
                                <HelpCircle size={14} className="text-gray-400 cursor-pointer" />
                             </div>
                             
                             <div className="flex flex-col gap-4 items-center mb-8">
                                <button onClick={() => setActiveTab('upload')} className="text-violet-600 text-[13px] font-bold flex items-center gap-2 hover:text-violet-800 transition">
                                   <UploadCloud size={16} /> Upload More Images
                                </button>
                                <button onClick={() => setAnnotateView('batch')} className="text-violet-600 text-[13px] font-bold flex items-center gap-2 hover:text-violet-800 transition">
                                   <Search size={16} /> View Unassigned Images
                                </button>
                             </div>

                             <div className="border border-gray-200 rounded-[10px] p-5 shadow-sm relative hover:border-violet-300 transition group cursor-pointer" onClick={() => setAnnotateView('batch')}>
                                <div className="flex justify-between items-start mb-4">
                                   <h4 className="text-[13px] font-bold text-gray-900 w-3/4">Uploaded on {new Date().toLocaleDateString(undefined, { year: '2-digit', month: '2-digit', day: '2-digit' })} at {new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</h4>
                                   <MoreVertical size={16} className="text-gray-400" />
                                </div>
                                <p className="text-[12px] text-gray-700 font-medium mb-8">{assets.length || 1} unassigned images</p>
                                
                                <button className="absolute bottom-5 right-5 text-violet-600 text-[12px] font-bold flex items-center gap-1.5 group-hover:text-violet-800 transition">
                                   Annotate Images <ArrowRight size={14} />
                                </button>
                             </div>
                          </div>

                          {/* Annotating */}
                          <div className="bg-white border border-gray-200 rounded-[12px] shadow-sm flex flex-col p-5">
                             <div className="flex justify-between items-start mb-6">
                                <div className="flex-1 text-center pr-4 pl-8">
                                   <h3 className="font-bold text-[16px] text-gray-900 tracking-tight">Annotating</h3>
                                   <p className="text-[12px] text-gray-400 font-mono tracking-tighter mt-1 uppercase">0 Jobs</p>
                                </div>
                                <HelpCircle size={14} className="text-gray-400 cursor-pointer" />
                             </div>
                             <div className="flex-1 flex items-center justify-center">
                                <p className="text-[14px] text-gray-400 font-medium">Upload and assign images to an annotator.</p>
                             </div>
                          </div>

                          {/* Dataset */}
                          <div className="bg-white border border-gray-200 rounded-[12px] shadow-sm flex flex-col p-5">
                             <div className="flex justify-between items-start mb-6">
                                <div className="flex-1 text-center pr-4 pl-8">
                                   <h3 className="font-bold text-[16px] text-gray-900 tracking-tight">Dataset</h3>
                                   <p className="text-[12px] text-gray-400 font-mono tracking-tighter mt-1 uppercase">{assets.length > 0 ? '1 Job' : '0 Jobs'}</p>
                                </div>
                                <HelpCircle size={14} className="text-gray-400 cursor-pointer" />
                             </div>
                             
                             <div className="flex justify-center mb-6">
                                <button onClick={() => setActiveTab('dataset')} className="text-violet-600 text-[13px] font-bold flex items-center gap-2 hover:text-violet-800 transition">
                                   <ImageIcon size={16} /> See all {assets.length || 0} images
                                </button>
                             </div>

                             <div className="flex flex-col gap-3">
                                {assets.length > 0 && (
                                  <div className="border border-gray-200 rounded-[10px] p-4 shadow-sm hover:border-violet-300 transition group relative">
                                     <div className="flex justify-between items-start mb-2 cursor-pointer" onClick={() => setActiveTab('dataset')}>
                                        <h4 className="text-[13px] font-bold text-gray-900 truncate max-w-[80%]">Batch {new Date().toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: '2-digit' })}</h4>
                                        <MoreVertical size={16} className="text-gray-400" />
                                     </div>
                                     <p className="text-[12px] text-gray-600 font-medium mb-1 truncate cursor-pointer" onClick={() => setActiveTab('dataset')}>Workspace Owner</p>
                                     <div className="flex justify-between items-end">
                                        <p className="text-[12px] text-gray-500 font-medium cursor-pointer" onClick={() => setActiveTab('dataset')}>{assets.length} Images</p>
                                        <div className="flex items-center gap-2 bg-gray-50 border border-gray-100 p-1 rounded">
                                           <button 
                                             onClick={async () => {
                                                const ok = window.confirm("Are you sure you want to delete this dataset subset?");
                                                if (!ok) return;
                                                try {
                                                   await Promise.all(assets.map((asset) => fetch(`/api/assets/${asset.id}`, { method: 'DELETE' })));
                                                   setAssets([]);
                                                } catch (err) {
                                                   console.error("Failed deleting dataset subset", err);
                                                }
                                             }} 
                                             className="text-gray-400 hover:text-red-500 hover:bg-red-50 p-1 rounded transition" 
                                             title="Delete Job"
                                           >
                                              <Trash size={14} />
                                           </button>
                                        </div>
                                     </div>
                                  </div>
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
                               <div key={a.id} className="flex flex-col group cursor-pointer" onClick={() => setAnnotateView('tool')}>
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
                            <div onClick={() => setAnnotateView('tool')} className="bg-white border border-gray-200 rounded-[12px] p-5 cursor-pointer hover:border-violet-300 hover:shadow-md transition group">
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
                            <div onClick={() => setAnnotateView('tool')} className="bg-white border border-gray-200 rounded-[12px] p-5 cursor-pointer hover:border-violet-300 hover:shadow-md transition group">
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
                            <div onClick={() => setAnnotateView('tool')} className="bg-white border border-gray-200 rounded-[12px] p-5 cursor-pointer hover:border-violet-300 hover:shadow-md transition group">
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
              ) : (
                <div className="flex-1 w-full flex flex-col min-w-0 h-[calc(100vh-80px)] px-5 sm:px-10 py-6">
                   <div className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-500">
                      <button onClick={() => setAnnotateView('batch')} className="hover:text-violet-600 flex items-center gap-1">
                         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                         Back to Batch
                      </button>
                   </div>
                   <AnnotationTool 
                      assets={assets} 
                      projectId={projectId} 
                      projectType={projectType} 
                      classificationType={classificationType} 
                      updateAsset={(id, isAnnotated) => {
                         setAssets(assets.map(a => a.id === id ? { ...a, is_annotated: isAnnotated } : a));
                      }}
                   />
                </div>
              )
          )}

          {/* VERSIONS TAB */}
          {activeTab === 'versions' && (
              <div className="flex-1 w-full flex flex-col min-w-0">
                 <VersionsTab
                   projectId={projectId}
                   onTrainVersion={(version) => {
                     localStorage.setItem("visionflow_selected_version", JSON.stringify(version));
                     setActiveTab("train");
                   }}
                 />
              </div>
          )}

          {/* TRAIN TAB */}
          {activeTab === 'train' && (
              <div className="flex-1 w-full flex flex-col min-w-0">
                 <TrainTab
                   projectId={projectId}
                   onOpenVersions={() => setActiveTab('versions')}
                   onOpenModels={() => setActiveTab('models')}
                 />
              </div>
          )}

          {/* ANALYTICS TAB */}
          {activeTab === 'analytics' && (
              <div className="flex-1 w-full flex flex-col min-w-0">
                 <AnalyticsTab assets={assets} />
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


        </div>
      </div>
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
