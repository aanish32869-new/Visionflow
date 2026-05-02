import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  Cpu,
  Gauge,
  Layers,
  Loader2,
  Monitor,
  RefreshCcw,
  Server,
  Share2,
  Target,
  Trash2,
  Zap,
  Activity,
  Plus,
  Lock,
  ChevronRight,
  Info,
  Download,
  BarChart3,
  TrendingUp,
  X
} from "lucide-react";

const ARCHITECTURES = [
  {
    id: "yolov8n",
    name: "YOLOv8 Nano",
    accent: "text-emerald-700 bg-emerald-50 border-emerald-200",
    summary: "Ultra-fast, perfect for real-time mobile and edge applications.",
    bullets: ["Lightest weights (~6MB)", "Blazing fast inference", "Optimal for mobile"],
    type: "detection"
  },
  {
    id: "yolov8m",
    name: "YOLOv8 Medium",
    accent: "text-blue-700 bg-blue-50 border-blue-200",
    summary: "Superior accuracy for complex scenes with moderate speed.",
    bullets: ["High precision", "Great for hard cases", "Balanced performance"],
    type: "detection"
  },
  {
    id: "resnet18",
    name: "ResNet18",
    accent: "text-rose-700 bg-rose-50 border-rose-200",
    summary: "Classic, reliable architecture with excellent inference speed.",
    bullets: ["Reliable baseline", "Fast training", "Proven results"],
    type: "classification"
  },
  {
    id: "vit",
    name: "ViT (Vision Transformer)",
    accent: "text-indigo-700 bg-indigo-50 border-indigo-200",
    summary: "High accuracy foundation model for complex visual recognition.",
    bullets: ["State-of-the-art", "Self-attention layers", "High accuracy"],
    type: "classification"
  },
  {
    id: "dinov3",
    name: "DINOv3",
    accent: "text-amber-700 bg-amber-50 border-amber-200",
    summary: "Self-supervised foundation model, resolution-agnostic and ultra-fast.",
    bullets: ["Foundation model", "Zero-shot capabilities", "Resolution agnostic"],
    type: "foundation",
    upgrade: false
  },
];

const DEVICE_OPTIONS = [
  { value: "cpu", label: "CPU", icon: Cpu },
  { value: "gpu", label: "GPU (NVIDIA)", icon: Monitor },
];

const TRAINING_MODES = [
  { id: "local", label: "Local Training", description: "Use your system GPU/CPU", icon: Monitor },
  { id: "server", label: "Server Training", description: "Scale with Cloud GPU", icon: Server, disabled: true },
];

function formatDate(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function VersionOption({ version, selected, onClick }) {
  const isProcessing = version.status === "Processing" || version.status === "Queued";
  
  return (
    <div
      onClick={isProcessing ? undefined : onClick}
      className={`w-full rounded-3xl border p-4 text-left transition-all duration-300 ${isProcessing ? 'opacity-60 grayscale cursor-not-allowed' : 'cursor-pointer'} ${
        selected && !isProcessing
          ? "border-violet-300 bg-violet-50 shadow-lg shadow-violet-100/50 scale-[1.01]"
          : "border-gray-200 bg-white hover:border-violet-200 hover:shadow-md"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-2">
            <div className="inline-flex rounded-full bg-gray-950 px-2.5 py-1 text-[10px] font-black text-white uppercase tracking-wider">
              {version.display_id || "V1"}
            </div>
            {isProcessing && (
              <span className="flex items-center gap-1 text-[9px] font-black text-violet-600 animate-pulse uppercase tracking-widest">
                <Loader2 size={10} className="animate-spin" /> Processing
              </span>
            )}
          </div>
          <h3 className="text-[15px] font-black text-gray-950 truncate max-w-[180px]">{version.name}</h3>
          <p className="mt-0.5 text-[10px] font-bold text-violet-600 tracking-tight">{version.canonical_id || version.version_id}</p>
        </div>
        {selected && !isProcessing && <div className="p-1 bg-violet-600 rounded-full shrink-0"><CheckCircle2 size={14} className="text-white" /></div>}
      </div>
      
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="bg-gray-50/80 rounded-xl p-2.5 text-center">
          <div className="text-[14px] font-black text-gray-950">{version.images_count || 0}</div>
          <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Images</div>
        </div>
        <div className="bg-gray-50/80 rounded-xl p-2.5 text-center">
          <div className="text-[14px] font-black text-gray-950">{version.annotations_count || 0}</div>
          <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Labels</div>
        </div>
        <div className="bg-gray-50/80 rounded-xl p-2.5 text-center">
          <div className="text-[14px] font-black text-gray-950">{version.classes?.length || 0}</div>
          <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Classes</div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4">
         <span className="text-[10px] font-bold text-gray-400">Created {formatDate(version.created_at).split(',')[0]}</span>
         <button 
           onClick={(e) => {
             e.stopPropagation();
             onClick(true); // Signal delete
           }}
           className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
         >
           <Trash2 size={14} />
         </button>
      </div>
    </div>
  );
}

function ArchitectureCard({ architecture, selected, onSelect }) {
  const Icon = architecture.type === 'detection' ? Boxes : 
               architecture.type === 'classification' ? Layers : 
               Zap;

  return (
    <button
      type="button"
      onClick={() => onSelect(architecture.id)}
      className={`relative group w-full rounded-[24px] border p-5 text-left transition-all duration-500 ${
        selected
          ? "border-violet-300 bg-violet-50 shadow-xl shadow-violet-100/50 scale-[1.02]"
          : "border-gray-100 bg-white hover:border-violet-200 hover:shadow-lg"
      }`}
    >
      {architecture.upgrade && (
        <div className="absolute -top-2.5 right-4 px-2.5 py-1 bg-gradient-to-r from-amber-400 to-orange-500 text-white text-[9px] font-black uppercase tracking-widest rounded-full shadow-lg border border-white/20">
          Upgrade
        </div>
      )}

      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl ${
            architecture.type === 'detection' ? 'bg-emerald-50 text-emerald-600' :
            architecture.type === 'classification' ? 'bg-indigo-50 text-indigo-600' :
            'bg-amber-50 text-amber-600'
          }`}>
            <Icon size={18} />
          </div>
          <div>
            <h3 className="text-[14px] font-black text-gray-950 tracking-tight">{architecture.name}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
               <div className={`w-1 h-1 rounded-full ${
                 architecture.type === 'detection' ? 'bg-emerald-500' :
                 architecture.type === 'classification' ? 'bg-indigo-500' :
                 'bg-amber-500'
               }`} />
               <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">{architecture.type}</span>
            </div>
          </div>
        </div>
        {selected && (
          <div className="w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center shadow-lg">
            <CheckCircle2 size={12} className="text-white" />
          </div>
        )}
      </div>

      <p className="mb-4 text-[11px] font-medium leading-relaxed text-gray-500">{architecture.summary}</p>
      
      <div className="space-y-1.5">
        {architecture.bullets.map((bullet) => (
          <div key={bullet} className="flex items-center gap-2 text-[10px] font-bold text-gray-400">
            <div className="w-1 h-1 rounded-full bg-gray-200" />
            {bullet}
          </div>
        ))}
      </div>
    </button>
  );
}

export default function TrainTab({ projectId, onOpenVersions }) {
  const [versions, setVersions] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [selectedArchitecture, setSelectedArchitecture] = useState("yolov8n");
  
  // Hyperparameters (Default to "auto")
  const [epochs, setEpochs] = useState("auto");
  const [batchSize, setBatchSize] = useState("auto");
  const [imgSize, setImgSize] = useState("auto");
  const [workers, setWorkers] = useState("auto");
  const [device, setDevice] = useState("auto");
  const [trainingMode, setTrainingMode] = useState("local");
  const [pipelineConfig, setPipelineConfig] = useState(null);
  const [hardware, setHardware] = useState({ gpu_available: false, gpu_name: null });
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, type: null, id: null, name: "" });
  const [viewingJob, setViewingJob] = useState(null);
  const jobsRef = React.useRef(jobs);
  const isFetchingRef = React.useRef(false);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    const stored = localStorage.getItem("visionflow_selected_version");
    if (stored) {
      try {
        const v = JSON.parse(stored);
        setSelectedVersionId(v.version_id || v.id || v._id);
        localStorage.removeItem("visionflow_selected_version");
      } catch (e) {
        console.error("Failed to parse stored version", e);
      }
    }
  }, []);

  const selectedVersion = useMemo(
    () => versions.find((v) => String(v.version_id || v.id || v._id) === String(selectedVersionId)) || versions[0],
    [versions, selectedVersionId]
  );

  const pidString = String(typeof projectId === 'object' && projectId !== null ? (projectId.id || projectId._id) : projectId);
  const pid = useMemo(() => pidString, [pidString]);

  const loadData = useCallback(async (isBackground = false) => {
    if (isFetchingRef.current) return;
    if (!isBackground) setIsLoading(true);
    isFetchingRef.current = true;
    
    try {
      const endpoints = [
        fetch(`/api/projects/${pid}/jobs`),
        fetch(`/api/projects/${pid}/versions`)
      ];
      if (!isBackground) {
        endpoints.push(fetch(`/api/training/config`));
        endpoints.push(fetch('/api/training/hardware'));
      }

      const responses = await Promise.all(endpoints);
      const data = await Promise.all(responses.map(async res => {
        if (!res.ok) throw new Error(`Service error: ${res.status}`);
        return res.json();
      }));

      if (isBackground) {
        const [jobsData, versionsData] = data;
        
        const jobMap = new Map();
        jobsData.forEach(j => {
          const key = j.job_id || j.id || j._id;
          const existing = jobMap.get(key);
          if (!existing || j.progress > (existing.progress || 0)) {
            jobMap.set(key, j);
          }
        });
        const uniqueJobs = Array.from(jobMap.values());

        const versionMap = new Map();
        versionsData.forEach(v => {
          const key = v.version_id || v.id || v._id;
          const existing = versionMap.get(key);
          if (!existing || (v.status === 'Ready' && existing.status !== 'Ready') || (v.images_count > (existing.images_count || 0))) {
            versionMap.set(key, v);
          }
        });
        const uniqueVersions = Array.from(versionMap.values());

        setJobs(uniqueJobs);
        setVersions(uniqueVersions);
      } else {
        const [jobsData, versionsData, config, hw] = data;
        
        // De-duplicate versions and jobs to prevent React key conflicts
        // Use a fallback key and pick the most complete/Ready record if duplicates exist
        const versionMap = new Map();
        versionsData.forEach(v => {
          const key = v.version_id || v.id || v._id;
          const existing = versionMap.get(key);
          // If we have a duplicate, prioritize 'Ready' status and higher image counts
          if (!existing || 
              (v.status === 'Ready' && existing.status !== 'Ready') || 
              (v.images_count > (existing.images_count || 0))) {
            versionMap.set(key, v);
          }
        });
        const uniqueVersions = Array.from(versionMap.values());
        
        const jobMap = new Map();
        jobsData.forEach(j => {
          const key = j.job_id || j.id || j._id;
          const existing = jobMap.get(key);
          if (!existing || j.progress > (existing.progress || 0)) {
            jobMap.set(key, j);
          }
        });
        const uniqueJobs = Array.from(jobMap.values());
        
        setVersions(uniqueVersions);
        setJobs(uniqueJobs);
        setTrainingMode(config.mode || "local");
        setDevice(config.device || "cpu");
        setPipelineConfig({ preprocessing: config.preprocessing, augmentation: config.augmentation });
        if (config.local) {
          setEpochs(config.local.epochs);
          setBatchSize(config.local.batch_size);
          setImgSize(config.local.img_size);
          setWorkers(config.local.workers);
        }
        setHardware(hw);
        // We still fetch these but they might be overridden by "auto" in the UI
        if (config.local && epochs === "auto") {
           // Keep "auto" as default in UI, but we can pre-populate if needed
        }
        if (hw.gpu_available && device === "auto") {
           // Keep "auto"
        }
      }
    } catch (e) {
      console.error("Failed to load training data:", e);
      if (!isBackground) {
        setFeedback({
          type: 'error',
          message: `Failed to load workspace data. Ensure services are running.`
        });
      }
    } finally {
      if (!isBackground) setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [pid]);

  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (!initialLoadDone.current || pid !== initialLoadDone.current) {
      loadData();
      initialLoadDone.current = pid;
    }
    
    const interval = setInterval(() => {
      const activeStatuses = ['Training', 'Queued', 'Preparing', 'Processing'];
      const hasActiveJob = jobsRef.current.some(j => activeStatuses.includes(j.status));
      if (hasActiveJob) {
        loadData(true);
      }
    }, 12000);
    return () => clearInterval(interval);
  }, [pid]);

  const handleTrain = async () => {
    if (!selectedVersion) {
      setFeedback({ type: "error", message: "Please select a dataset version." });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/projects/${pid}/train`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version_id: selectedVersion.version_id,
          architecture: selectedArchitecture,
          params: { epochs, batch_size: batchSize, img_size: imgSize, workers, device, training_mode: trainingMode }
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to start training");
      }
      
      setFeedback({ type: "success", message: "Training job successfully initiated." });
      loadData();
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteJob = async (jobId) => {
    if (!window.confirm("Are you sure you want to permanently delete this training job and its artifacts?")) return;
    try {
      const response = await fetch(`/api/projects/${pid}/jobs/${jobId}`, { method: "DELETE" });
      if (response.ok) {
        setJobs(prev => {
          const next = prev.filter(j => (j.job_id || j.id || j._id) !== jobId);
          jobsRef.current = next;
          return next;
        });
        setFeedback({ type: "success", message: "Training job deleted successfully." });
        // Notify other tabs
        window.dispatchEvent(new CustomEvent('visionflow_data_changed', { detail: { type: 'job', id: jobId } }));
      }
    } catch (e) {
      setFeedback({ type: "error", message: "Failed to delete job." });
    }
  };

  const handleDeleteVersion = async (versionId) => {
    try {
      const response = await fetch(`/api/versions/${versionId}`, { method: "DELETE" });
      if (response.ok) {
        setVersions(prev => prev.filter(v => (v.version_id || v.id || v._id) !== versionId));
        if (selectedVersionId === versionId) setSelectedVersionId("");
        setFeedback({ type: "success", message: "Dataset version deleted successfully." });
        // Notify other tabs
        window.dispatchEvent(new CustomEvent('visionflow_data_changed', { detail: { type: 'version', id: versionId } }));
      }
    } catch (e) {
      setFeedback({ type: "error", message: "Failed to delete version." });
    }
  };

  const confirmDelete = () => {
    if (deleteConfirm.type === 'job') {
      handleDeleteJob(deleteConfirm.id);
    } else {
      handleDeleteVersion(deleteConfirm.id);
    }
    setDeleteConfirm({ ...deleteConfirm, isOpen: false });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-violet-600" size={40} />
      </div>
    );
  }


  return (
    <div className="w-full animate-page-enter space-y-8 pb-20">
      {/* Header Section */}
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-[26px] font-black text-gray-900 tracking-tight">Train Workspace</h1>
          <p className="text-[13px] font-semibold text-gray-400 mt-1 uppercase tracking-widest flex items-center gap-2">
            Model Pipeline Dashboard 
            {pid && <span className="bg-gray-100 px-2 py-0.5 rounded text-[10px] font-mono text-gray-500 lowercase">ID: {String(pid)}</span>}
          </p>
        </div>
        <div className="flex gap-3">
          <button className="px-5 py-2.5 bg-gray-50 border border-gray-200 text-gray-700 rounded-xl text-[13px] font-bold hover:bg-gray-100 transition shadow-sm">
            Advanced Settings
          </button>
          <button 
            onClick={handleTrain}
            disabled={isSubmitting}
            className="px-6 py-2.5 bg-violet-600 text-white rounded-xl text-[13px] font-bold shadow-lg shadow-violet-200 hover:bg-violet-700 transition flex items-center gap-2 disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            Train Model
          </button>
        </div>
      </header>

      {feedback && (
        <div className={`p-4 rounded-2xl border font-bold flex items-center gap-3 animate-in slide-in-from-top-2 ${feedback.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
          {feedback.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          {feedback.message}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        {/* Main Content Area */}
        <div className="space-y-8">
          
          {/* 1. SELECT DATASET VERSION */}
          <section className="bg-white rounded-[32px] border border-gray-100 p-8 shadow-sm">
             <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                   <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center text-violet-600 shadow-sm border border-violet-100">
                      <Layers size={20} />
                   </div>
                   <h2 className="text-[19px] font-black text-gray-950 tracking-tight">1. Select Dataset Version</h2>
                </div>
                <button 
                  onClick={onOpenVersions}
                  className="text-[11px] font-bold text-violet-600 uppercase tracking-widest hover:underline"
                >
                  Manage Versions
                </button>
             </div>

             <div className="grid gap-4 md:grid-cols-2">
                {versions.length > 0 ? (
                  versions.map(v => (
                    <VersionOption 
                      key={v.version_id} 
                      version={v} 
                      selected={selectedVersion?.version_id === v.version_id}
                      onClick={(isDelete = false) => {
                        if (isDelete) {
                          setDeleteConfirm({ isOpen: true, type: 'version', id: v.version_id, name: v.name });
                        } else {
                          setSelectedVersionId(v.version_id);
                        }
                      }}
                    />
                  ))
                ) : (
                  <div className="col-span-full py-12 flex flex-col items-center justify-center border-2 border-dashed border-gray-100 rounded-[24px] bg-gray-50/50">
                    <Layers size={32} className="text-gray-300 mb-3" />
                    <p className="text-[13px] font-bold text-gray-400">No dataset versions found for this project.</p>
                  </div>
                )}
             </div>
          </section>

          {/* 2. MODEL ARCHITECTURE */}
          <section className="bg-white rounded-[32px] border border-gray-100 p-8 shadow-sm">
             <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 shadow-sm border border-emerald-100">
                   <Target size={20} />
                </div>
                <h2 className="text-[19px] font-black text-gray-950 tracking-tight">2. Model Architecture</h2>
             </div>

             <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {ARCHITECTURES.map(a => (
                  <ArchitectureCard 
                    key={a.id} 
                    architecture={a} 
                    selected={selectedArchitecture === a.id}
                    onSelect={setSelectedArchitecture}
                  />
                ))}
             </div>
          </section>

          {/* 3. PREPROCESSING & AUGMENTATIONS */}
          <section className="bg-white rounded-[32px] border border-gray-100 p-8 shadow-sm">
             <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                   <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600 shadow-sm border border-amber-100">
                      <RefreshCcw size={20} />
                   </div>
                   <h2 className="text-[19px] font-black text-gray-950 tracking-tight">3. Preprocessing & Augmentations</h2>
                </div>
                <div className="px-3 py-1 bg-violet-50 rounded-full text-[9px] font-black text-violet-600 uppercase tracking-[0.2em] border border-violet-100">
                  Version Controlled
                </div>
             </div>

             <div className="grid md:grid-cols-2 gap-10">
                <div className="space-y-4">
                   <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                      <Info size={12} /> Preprocessing
                   </h4>
                   <div className="space-y-2">
                      {selectedVersion?.options?.preprocessing && Object.entries(selectedVersion.options.preprocessing).map(([key, val]) => (
                        <div key={key} className="flex items-center justify-between p-3.5 rounded-2xl bg-gray-50/80 border border-gray-100">
                           <span className="text-[12px] font-bold text-gray-700 capitalize">{key.replace(/_/g, ' ')}</span>
                           <CheckCircle2 size={16} className="text-emerald-500" />
                        </div>
                      ))}
                      {!selectedVersion?.options?.preprocessing && (
                        <p className="text-[12px] text-gray-400 font-medium italic italic">No preprocessing steps applied.</p>
                      )}
                   </div>
                </div>

                <div className="space-y-4">
                   <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                      <Zap size={12} /> Augmentations
                   </h4>
                   <div className="space-y-2">
                      {selectedVersion?.options?.augmentation && Object.entries(selectedVersion.options.augmentation).map(([key, val]) => (
                        <div key={key} className="flex items-center justify-between p-3.5 rounded-2xl bg-gray-50/80 border border-gray-100">
                           <span className="text-[12px] font-bold text-gray-700 capitalize">{key.replace(/_/g, ' ')}</span>
                           <CheckCircle2 size={16} className="text-amber-500" />
                        </div>
                      ))}
                      {!selectedVersion?.options?.augmentation && (
                        <p className="text-[12px] text-gray-400 font-medium italic">No offline augmentations applied.</p>
                      )}
                   </div>
                </div>
             </div>
          </section>

        </div>

        {/* Sidebar Configuration */}
        <aside className="space-y-8">


           {/* Hyperparameters Override */}
           <section className="bg-white rounded-[32px] border border-gray-100 p-6 shadow-sm">
              <h2 className="text-[17px] font-black text-gray-950 mb-6 flex items-center gap-2">
                 <RefreshCcw size={18} className="text-violet-600" /> Configuration
              </h2>
              <div className="space-y-5">
                 <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex justify-between">
                       Epochs <span>{epochs === 'auto' ? '(Auto)' : ''}</span>
                    </label>
                    <div className="flex gap-2">
                       <input 
                         type="text" 
                         value={epochs} 
                         onChange={e => setEpochs(e.target.value)} 
                         className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-[13px] font-black focus:ring-4 focus:ring-violet-100 outline-none transition" 
                       />
                       <button onClick={() => setEpochs("auto")} className="px-3 bg-violet-50 text-violet-600 rounded-xl text-[10px] font-black uppercase border border-violet-100">Auto</button>
                    </div>
                 </div>
                 <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex justify-between">
                       Batch Size <span>{batchSize === 'auto' ? '(Auto)' : ''}</span>
                    </label>
                    <div className="flex gap-2">
                       <input 
                         type="text" 
                         value={batchSize} 
                         onChange={e => setBatchSize(e.target.value)} 
                         className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-[13px] font-black focus:ring-4 focus:ring-violet-100 outline-none transition" 
                       />
                       <button onClick={() => setBatchSize("auto")} className="px-3 bg-violet-50 text-violet-600 rounded-xl text-[10px] font-black uppercase border border-violet-100">Auto</button>
                    </div>
                 </div>
                 <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex justify-between">
                       Hardware <span>{device === 'auto' ? '(Auto Detect)' : ''}</span>
                    </label>
                    <div className="flex gap-2">
                       <select 
                         value={device} 
                         onChange={e => setDevice(e.target.value)}
                         className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-[13px] font-black focus:ring-4 focus:ring-violet-100 outline-none transition appearance-none"
                       >
                          <option value="auto">Auto Detect</option>
                          <option value="cpu">Force CPU</option>
                          <option value="gpu">Force GPU</option>
                       </select>
                    </div>
                 </div>
              </div>
           </section>
        </aside>
      </div>

      {/* Recent Training Jobs */}
      {jobs.length > 0 && (
        <section className="bg-white rounded-[32px] border border-gray-100 p-8 shadow-sm">
           <div className="flex items-center justify-between mb-8">
              <h2 className="text-[20px] font-black text-gray-950 tracking-tight">Recent Training Jobs</h2>
              <div className="flex items-center gap-2">
                 <Activity size={16} className="text-violet-600" />
                 <span className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.2em]">Live Monitoring</span>
              </div>
           </div>
           
           <div className="overflow-x-auto">
              <table className="w-full text-left">
                 <thead>
                    <tr className="text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100">
                       <th className="pb-4 pl-2">Job ID / Status</th>
                       <th className="pb-4">Architecture</th>
                       <th className="pb-4">Version</th>
                       <th className="pb-4">Progress / Est. Time</th>
                       <th className="pb-4">Metrics (mAP)</th>
                       <th className="pb-4 text-right">Date</th>
                       <th className="pb-4 text-right pr-2">Actions</th>
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-50">
                    {jobs.map(job => (
                      <tr 
                        key={job.id} 
                        onClick={() => setViewingJob(job)}
                        className="group hover:bg-gray-50/50 transition-colors cursor-pointer"
                      >
                         <td className="py-5 pl-2">
                            <div className="flex items-center gap-3">
                               <div className={`w-2.5 h-2.5 rounded-full ${
                                 job.status === 'Completed' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
                                 job.status === 'Failed' ? 'bg-rose-500' :
                                 'bg-violet-500 animate-pulse'
                               }`} />
                               <div>
                                  <div className="text-[13px] font-black text-gray-900 leading-none mb-1">{job.status}</div>
                                  <div className="text-[10px] font-bold text-gray-400 font-mono tracking-tighter uppercase">{job.job_id?.slice(0, 8)}</div>
                                  {job.status === 'Failed' && job.error && (
                                    <div className="mt-2 p-2 bg-rose-50 border border-rose-100 rounded-lg text-[9px] font-bold text-rose-600 max-w-[200px] break-words">
                                      {job.error.slice(-120)}
                                    </div>
                                  )}
                               </div>
                            </div>
                         </td>
                         <td className="py-5 font-black text-gray-950 text-[13px]">{job.architecture_label}</td>
                         <td className="py-5">
                            <span className="px-2 py-0.5 bg-violet-50 text-violet-600 text-[10px] font-black rounded-md border border-violet-100 uppercase tracking-wider">
                               {job.version_id?.slice(0, 8)}
                            </span>
                         </td>
                         <td className="py-5">
                            <div className="flex flex-col gap-1.5">
                               <div className="flex items-center gap-3">
                                  <div className="w-32 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                     <div 
                                       className={`h-full transition-all duration-1000 rounded-full ${job.status === 'Failed' ? 'bg-rose-400' : 'bg-violet-600'}`}
                                       style={{ width: `${job.progress}%` }}
                                     />
                                  </div>
                                  <span className="text-[11px] font-black text-gray-400">{job.progress}%</span>
                               </div>
                               {(job.status === 'Training' || job.status === 'Preparing') && (
                                  <div className="text-[9px] font-bold text-violet-500 uppercase tracking-widest flex items-center gap-1">
                                     <Loader2 size={8} className="animate-spin" /> Est: {job.estimated_time_remaining || 'Calculating...'}
                                  </div>
                               )}
                            </div>
                         </td>
                         <td className="py-5">
                            {job.metrics?.mAP ? (
                              <div className="flex items-center gap-1.5">
                                 <span className="text-[14px] font-black text-gray-950">{job.metrics.mAP.toFixed(3)}</span>
                                 <ChevronRight size={14} className="text-gray-300" />
                              </div>
                            ) : (
                              <span className="text-[11px] font-bold text-gray-300 uppercase tracking-widest">In Progress</span>
                            )}
                         </td>
                         <td className="py-5 text-right">
                            <div className="text-[12px] font-black text-gray-950">{formatDate(job.created_at).split(',')[0]}</div>
                            <div className="text-[10px] font-bold text-gray-400 mt-0.5">{formatDate(job.created_at).split(',')[1]}</div>
                         </td>
                         <td className="py-5 text-right pr-2">
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                               {job.status === 'Completed' && (
                                 <button 
                                   onClick={(e) => {
                                     e.stopPropagation();
                                     window.open(`/api/projects/${pid}/jobs/${job.job_id}/weights`);
                                   }}
                                   className="p-1.5 text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors"
                                   title="Download Weights"
                                 >
                                    <Download size={15} />
                                 </button>
                               )}
                               <button 
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   setDeleteConfirm({ isOpen: true, type: 'job', id: job.job_id, name: `Job ${job.job_id?.slice(0, 8)}` });
                                 }}
                                 className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                 title="Delete"
                               >
                                  <Trash2 size={15} />
                               </button>
                            </div>
                         </td>
                      </tr>
                    ))}
                 </tbody>
              </table>
           </div>
        </section>
      )}
      {/* Delete Confirmation Modal */}
      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-gray-950/60 backdrop-blur-sm" onClick={() => setDeleteConfirm({ ...deleteConfirm, isOpen: false })} />
           <div className="relative w-full max-w-md bg-white rounded-[32px] p-8 shadow-2xl animate-modal-enter">
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                 <AlertCircle size={32} />
              </div>
              <h3 className="text-xl font-black text-gray-950 text-center mb-2">Confirm Deletion</h3>
              <p className="text-sm font-bold text-gray-500 text-center mb-8">
                 Are you sure you want to delete <span className="text-gray-950">"{deleteConfirm.name}"</span>? 
                 This action cannot be undone and will remove it from all project records.
              </p>
              <div className="flex gap-3">
                 <button 
                   onClick={() => setDeleteConfirm({ ...deleteConfirm, isOpen: false })}
                   className="flex-1 py-3.5 bg-gray-50 text-gray-500 rounded-2xl font-black text-[13px] hover:bg-gray-100 transition"
                 >
                    Cancel
                 </button>
                 <button 
                   onClick={confirmDelete}
                   className="flex-1 py-3.5 bg-red-600 text-white rounded-2xl font-black text-[13px] hover:bg-red-700 transition shadow-lg shadow-red-100"
                 >
                    Confirm Delete
                 </button>
              </div>
           </div>
        </div>
      )}
      {/* Job Details & Metrics Modal */}
      <AnimatePresence>
        {viewingJob && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-gray-950/80 backdrop-blur-md" 
              onClick={() => setViewingJob(null)} 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-4xl bg-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Modal Header */}
              <div className="p-8 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg ${
                    viewingJob.status === 'Completed' ? 'bg-emerald-500' : 'bg-violet-600'
                  }`}>
                    <TrendingUp size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-gray-950">Training Analytics — {viewingJob.job_id?.slice(0, 8)}</h3>
                    <p className="text-[12px] font-bold text-gray-400 uppercase tracking-widest">{viewingJob.architecture_label} • {viewingJob.status}</p>
                  </div>
                </div>
                <button onClick={() => setViewingJob(null)} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-400">
                  <X size={24} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-10 space-y-10">
                {/* Metrics Grid */}
                <div className="grid grid-cols-3 gap-6">
                  <div className="bg-gray-50 rounded-3xl p-6 border border-gray-100">
                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1">mAP@50</div>
                    <div className="text-3xl font-black text-gray-950">{viewingJob.metrics?.mAP?.toFixed(3) || "0.000"}</div>
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-emerald-600">
                       <TrendingUp size={12} /> +12.4% vs baseline
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-3xl p-6 border border-gray-100">
                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1">Precision</div>
                    <div className="text-3xl font-black text-gray-950">{viewingJob.metrics?.precision?.toFixed(3) || "0.000"}</div>
                  </div>
                  <div className="bg-gray-50 rounded-3xl p-6 border border-gray-100">
                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1">Recall</div>
                    <div className="text-3xl font-black text-gray-950">{viewingJob.metrics?.recall?.toFixed(3) || "0.000"}</div>
                  </div>
                </div>

                {/* Training Curve */}
                <section>
                   <div className="flex items-center justify-between mb-6">
                      <h4 className="text-[15px] font-black text-gray-950 flex items-center gap-2">
                         <BarChart3 size={18} className="text-violet-600" /> Accuracy Curve (mAP)
                      </h4>
                      <div className="flex items-center gap-4">
                         <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-violet-600" />
                            <span className="text-[11px] font-bold text-gray-500 uppercase">Training</span>
                         </div>
                      </div>
                   </div>

                   <div className="h-64 bg-gray-50 rounded-[32px] border border-gray-100 relative p-8">
                      {viewingJob.metrics_history ? (
                        <svg className="w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
                           {/* Simple SVG Line Chart */}
                           <path
                             d={`M 0,${100 - (viewingJob.metrics_history[0].mAP * 100)} ${viewingJob.metrics_history.map((h, i) => 
                               `L ${(i / (viewingJob.metrics_history.length - 1)) * 100},${100 - (h.mAP * 100)}`
                             ).join(' ')}`}
                             fill="none"
                             stroke="url(#violet-gradient)"
                             strokeWidth="3"
                             strokeLinecap="round"
                             strokeLinejoin="round"
                           />
                           <defs>
                             <linearGradient id="violet-gradient" x1="0" y1="0" x2="1" y2="0">
                               <stop offset="0%" stopColor="#8b5cf6" />
                               <stop offset="100%" stopColor="#6d28d9" />
                             </linearGradient>
                           </defs>
                           {/* Circles for data points */}
                           {viewingJob.metrics_history.map((h, i) => (
                             <circle 
                               key={i} 
                               cx={(i / (viewingJob.metrics_history.length - 1)) * 100} 
                               cy={100 - (h.mAP * 100)} 
                               r="1.5" 
                               className="fill-white stroke-violet-600 stroke-[1]"
                             />
                           ))}
                        </svg>
                      ) : (
                        <div className="flex items-center justify-center h-full text-gray-400 font-bold text-[13px]">
                          Chart unavailable for active or failed jobs
                        </div>
                      )}
                      <div className="absolute bottom-4 left-0 right-0 px-8 flex justify-between text-[9px] font-black text-gray-300 uppercase tracking-widest">
                         <span>Epoch 1</span>
                         <span>Epoch {viewingJob.metrics_history?.length || 'N'}</span>
                      </div>
                   </div>
                </section>

                {/* Weights Download */}
                {viewingJob.status === 'Completed' && (
                  <div className="p-8 bg-emerald-50 rounded-[32px] border border-emerald-100 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-emerald-600 shadow-sm">
                        <Download size={24} />
                      </div>
                      <div>
                        <div className="text-[13px] font-black text-emerald-950 tracking-tight">Best Weights Ready</div>
                        <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">best.pt • 14.2 MB</div>
                      </div>
                    </div>
                    <button 
                      onClick={() => window.open(`/api/projects/${pid}/jobs/${viewingJob.job_id}/weights`)}
                      className="px-8 py-3.5 bg-emerald-600 text-white rounded-2xl font-black text-[13px] hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
                    >
                      Download Model Weights
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
