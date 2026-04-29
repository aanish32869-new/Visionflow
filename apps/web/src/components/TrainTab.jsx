import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  Info
} from "lucide-react";

const ARCHITECTURES = [
  {
    id: "yolov8n",
    name: "YOLOv8 Nano",
    accent: "text-emerald-700 bg-emerald-50 border-emerald-200",
    summary: "Ultra-fast, perfect for real-time mobile and edge applications.",
    bullets: ["Lightest weights (~6MB)", "Blazing fast inference", "Lower accuracy than larger models"],
    type: "detection"
  },
  {
    id: "dinov3",
    name: "DINOv3",
    accent: "text-amber-700 bg-amber-50 border-amber-200",
    summary: "Transformer-based, resolution-agnostic and ultra-fast for specific tasks.",
    bullets: ["Trains very quickly", "Resolution-agnostic", "Inference speed comparable to ViT"],
    type: "foundation",
    upgrade: true
  },
  {
    id: "vit",
    name: "ViT (Vision Transformer)",
    accent: "text-indigo-700 bg-indigo-50 border-indigo-200",
    summary: "High accuracy foundation model for complex visual recognition.",
    bullets: ["Higher Accuracy", "Slower Inference", "Slower Training"],
    type: "classification"
  },
  {
    id: "resnet18",
    name: "ResNet18",
    accent: "text-rose-700 bg-rose-50 border-rose-200",
    summary: "Classic, reliable architecture with excellent inference speed.",
    bullets: ["Lower Accuracy", "Faster Inference", "Faster Training"],
    type: "classification"
  },
  {
    id: "yolov8m",
    name: "YOLOv8 Medium",
    accent: "text-blue-700 bg-blue-50 border-blue-200",
    summary: "Higher accuracy for complex scenes with moderate speed.",
    bullets: ["Superior accuracy", "Great for hard detection cases", "Slower inference"],
    type: "detection"
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
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-3xl border p-4 text-left transition-all duration-300 ${
        selected
          ? "border-violet-300 bg-violet-50 shadow-lg shadow-violet-100/50 scale-[1.01]"
          : "border-gray-200 bg-white hover:border-violet-200 hover:shadow-md"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex rounded-full bg-gray-950 px-2.5 py-1 text-[10px] font-black text-white uppercase tracking-wider">
            {version.display_id || "V1"}
          </div>
          <h3 className="text-[15px] font-black text-gray-950 truncate max-w-[180px]">{version.name}</h3>
          <p className="mt-0.5 text-[10px] font-bold text-violet-600 tracking-tight">{version.canonical_id || version.version_id}</p>
        </div>
        {selected && <div className="p-1 bg-violet-600 rounded-full"><CheckCircle2 size={14} className="text-white" /></div>}
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
    </button>
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
  
  // Hyperparameters
  const [epochs, setEpochs] = useState(25);
  const [batchSize, setBatchSize] = useState(8);
  const [imgSize, setImgSize] = useState(640);
  const [workers, setWorkers] = useState(4);
  const [device, setDevice] = useState("cpu");
  const [trainingMode, setTrainingMode] = useState("local");
  const [pipelineConfig, setPipelineConfig] = useState(null);
  const [hardware, setHardware] = useState({ gpu_available: false, gpu_name: null });

  const selectedVersion = useMemo(
    () => versions.find((v) => String(v.version_id) === String(selectedVersionId)) || versions[0],
    [versions, selectedVersionId]
  );

  const loadData = useCallback(async (isBackground = false) => {
    if (!isBackground) setIsLoading(true);
    
    // Ensure we have a string ID if projectId is an object
    const pid = typeof projectId === 'object' && projectId !== null ? (projectId.id || projectId._id) : projectId;
    
    try {
      const [vRes, jRes, cRes] = await Promise.all([
        fetch(`/api/projects/${pid}/versions`),
        fetch(`/api/projects/${pid}/jobs`),
        fetch(`/api/training/config`)
      ]);

      const results = await Promise.all([vRes, jRes, cRes].map(async res => {
        if (!res.ok) throw new Error(`Service error: ${res.status} ${res.statusText}`);
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
          return res.json();
        }
        throw new Error("Invalid response from server (HTML instead of JSON). Check if backend services are running.");
      }));

      const [versions, jobs, config] = results;
      setVersions(versions);
      setJobs(jobs);
      
      setTrainingMode(config.mode || "local");
        setDevice(config.device || "cpu");
        setPipelineConfig({
          preprocessing: config.preprocessing,
          augmentation: config.augmentation
        });
        if (config.local) {
          setEpochs(config.local.epochs);
          setBatchSize(config.local.batch_size);
          setImgSize(config.local.img_size);
          setWorkers(config.local.workers);
        }

        // Fetch Hardware specifically
        try {
          const hRes = await fetch('/api/training/hardware');
          if (hRes.ok) {
            const hData = await hRes.json();
            setHardware(hData);
            // Auto-select GPU if available
            if (hData.gpu_available) {
              setDevice("gpu");
            } else {
              setDevice("cpu");
            }
          }
        } catch (hErr) {
          console.error("Hardware detection failed", hErr);
        }
    } catch (e) {
      console.error("Failed to load training data:", e);
      setFeedback({
        type: 'error',
        message: `Failed to load workspace data: ${e.message}. Please ensure all backend services are running.`
      });
    } finally {
      if (!isBackground) setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(true), 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleTrain = async () => {
    if (!selectedVersion) {
      setFeedback({ type: "error", message: "Please select a dataset version." });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/train`, {
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-violet-600" size={40} />
      </div>
    );
  }

  const pid = typeof projectId === 'object' && projectId !== null ? (projectId.id || projectId._id) : projectId;

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
                      onClick={() => setSelectedVersionId(v.version_id)}
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

          {/* 4. REVIEW TRAINING PIPELINE */}
          <section className="bg-violet-900 rounded-[32px] p-8 shadow-2xl shadow-violet-200 overflow-hidden relative group">
             <div className="absolute top-0 right-0 w-64 h-64 bg-violet-800 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2 opacity-50 group-hover:opacity-80 transition-opacity"></div>
             
             <div className="relative z-10">
                <div className="flex items-center gap-3 mb-8">
                   <div className="w-10 h-10 bg-violet-800 rounded-xl flex items-center justify-center text-violet-100 shadow-inner border border-violet-700">
                      <Gauge size={20} />
                   </div>
                   <h2 className="text-[19px] font-black text-white tracking-tight">4. Review Training Pipeline</h2>
                </div>

                <div className="grid md:grid-cols-2 gap-8 mb-8">
                   <div className="bg-violet-800/40 rounded-[24px] p-6 border border-violet-700/50 backdrop-blur-sm">
                      <h4 className="text-[10px] font-black text-violet-300 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <CheckCircle2 size={12} /> Standard Preprocessing (Deterministic)
                      </h4>
                      <div className="flex flex-wrap gap-2">
                         {pipelineConfig?.preprocessing && Object.entries(pipelineConfig.preprocessing).map(([key, val]) => (
                           val && (
                             <span key={key} className="px-3 py-1.5 bg-violet-950/50 text-violet-100 text-[11px] font-bold rounded-lg border border-violet-700/30 capitalize">
                               {key.replace(/_/g, ' ')}
                             </span>
                           )
                         ))}
                      </div>
                   </div>

                   <div className="bg-violet-800/40 rounded-[24px] p-6 border border-violet-700/50 backdrop-blur-sm">
                      <h4 className="text-[10px] font-black text-violet-300 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <Activity size={12} /> Live Augmentations (Stochastic)
                      </h4>
                      <div className="flex flex-wrap gap-2">
                         {pipelineConfig?.augmentation && Object.entries(pipelineConfig.augmentation).map(([key, val]) => (
                           val && (
                             <span key={key} className="px-3 py-1.5 bg-violet-950/50 text-violet-100 text-[11px] font-bold rounded-lg border border-violet-700/30 capitalize">
                               {key.replace(/_/g, ' ')}
                             </span>
                           )
                         ))}
                      </div>
                   </div>
                </div>

                <div className="flex items-center justify-between p-6 bg-violet-950/40 rounded-[24px] border border-violet-700/50">
                   <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-violet-500 rounded-2xl flex items-center justify-center text-white shadow-lg">
                         <Target size={24} />
                      </div>
                      <div>
                         <div className="text-[11px] font-bold text-violet-300 uppercase tracking-widest">Ready to initiate</div>
                         <div className="text-[15px] font-black text-white tracking-tight">{selectedArchitecture} on {selectedVersion?.name || 'V1'}</div>
                      </div>
                   </div>
                   <button 
                     onClick={handleTrain}
                     disabled={isSubmitting || !selectedVersion}
                     className="px-10 py-4 bg-white text-violet-900 rounded-[20px] text-[15px] font-black shadow-xl hover:bg-violet-50 transition-all flex items-center gap-3 active:scale-95 disabled:opacity-50"
                   >
                     {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} fill="currentColor" />}
                     Start Training Run
                   </button>
                </div>
             </div>
          </section>
        </div>

        {/* Sidebar Configuration */}
        <aside className="space-y-8">
           {/* Hyperparameters */}
           <section className="bg-white rounded-[32px] border border-gray-100 p-6 shadow-sm">
              <h2 className="text-[17px] font-black text-gray-950 mb-6 flex items-center gap-2">
                 <RefreshCcw size={18} className="text-violet-600" /> Hyperparameters
              </h2>
              <div className="space-y-5">
                 <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Epochs</label>
                    <input 
                      type="number" 
                      value={epochs} 
                      onChange={e => setEpochs(Number(e.target.value))} 
                      className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3.5 text-[14px] font-black focus:ring-4 focus:ring-violet-100 focus:border-violet-400 outline-none transition" 
                    />
                 </div>
                 <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Batch Size</label>
                    <input 
                      type="number" 
                      value={batchSize} 
                      onChange={e => setBatchSize(Number(e.target.value))} 
                      className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3.5 text-[14px] font-black focus:ring-4 focus:ring-violet-100 focus:border-violet-400 outline-none transition" 
                    />
                 </div>
                 <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Image Size</label>
                    <input 
                      type="number" 
                      value={imgSize} 
                      onChange={e => setImgSize(Number(e.target.value))} 
                      className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3.5 text-[14px] font-black focus:ring-4 focus:ring-violet-100 focus:border-violet-400 outline-none transition" 
                    />
                 </div>
                 <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Workers</label>
                    <input 
                      type="number" 
                      value={workers} 
                      onChange={e => setWorkers(Number(e.target.value))} 
                      className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3.5 text-[14px] font-black focus:ring-4 focus:ring-violet-100 focus:border-violet-400 outline-none transition" 
                    />
                 </div>
              </div>
           </section>

           {/* Hardware & Mode */}
           <section className="bg-white rounded-[32px] border border-gray-100 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-[17px] font-black text-gray-950 flex items-center gap-2">
                   <Monitor size={18} className="text-violet-600" /> Hardware & Mode
                </h2>
                {hardware.gpu_available ? (
                  <div className="px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[8px] font-black uppercase rounded-md border border-emerald-100 flex items-center gap-1">
                    <Zap size={8} fill="currentColor" /> GPU Detected
                  </div>
                ) : (
                  <div className="px-2 py-0.5 bg-gray-50 text-gray-400 text-[8px] font-black uppercase rounded-md border border-gray-100">
                    CPU Only
                  </div>
                )}
              </div>
              <div className="space-y-6">
                 <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Training Mode</label>
                    <div className="space-y-2">
                       {TRAINING_MODES.map(m => (
                         <button
                           key={m.id}
                           disabled={m.disabled}
                           onClick={() => setTrainingMode(m.id)}
                           className={`w-full flex items-center gap-3 p-4 rounded-[20px] border text-left transition-all ${
                             trainingMode === m.id 
                               ? 'bg-violet-600 border-violet-700 text-white shadow-lg shadow-violet-100' 
                               : 'bg-gray-50 border-gray-100 text-gray-500 opacity-60 hover:opacity-100'
                           }`}
                         >
                           <m.icon size={18} className={trainingMode === m.id ? 'text-white' : 'text-gray-400'} />
                           <div>
                             <div className="text-[12px] font-black">{m.label}</div>
                             <div className={`text-[10px] font-bold ${trainingMode === m.id ? 'text-violet-100' : 'text-gray-400'}`}>{m.description}</div>
                           </div>
                           {m.disabled && <Lock size={12} className="ml-auto opacity-40" />}
                         </button>
                       ))}
                    </div>
                 </div>

                 <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Compute Device</label>
                    <div className="flex gap-2">
                       {DEVICE_OPTIONS.map(d => (
                         <button
                           key={d.value}
                           onClick={() => setDevice(d.value)}
                           className={`flex-1 flex items-center justify-center gap-2 p-3.5 rounded-xl border transition-all font-black text-[11px] uppercase tracking-wider ${
                             device === d.value 
                               ? 'bg-violet-600 text-white border-violet-700 shadow-md' 
                               : 'bg-gray-50 text-gray-400 border-gray-100 hover:bg-white hover:border-violet-200'
                           }`}
                         >
                           <d.icon size={14} /> {d.label}
                         </button>
                       ))}
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
                       <th className="pb-4">Progress</th>
                       <th className="pb-4">Metrics (mAP)</th>
                       <th className="pb-4 text-right pr-2">Date</th>
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-50">
                    {jobs.map(job => (
                      <tr key={job.id} className="group hover:bg-gray-50/50 transition-colors">
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
                            <div className="flex items-center gap-3">
                               <div className="w-32 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                  <div 
                                    className={`h-full transition-all duration-1000 rounded-full ${job.status === 'Failed' ? 'bg-rose-400' : 'bg-violet-600'}`}
                                    style={{ width: `${job.progress}%` }}
                                  />
                               </div>
                               <span className="text-[11px] font-black text-gray-400">{job.progress}%</span>
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
                         <td className="py-5 text-right pr-2">
                            <div className="text-[12px] font-black text-gray-950">{formatDate(job.created_at).split(',')[0]}</div>
                            <div className="text-[10px] font-bold text-gray-400 mt-0.5">{formatDate(job.created_at).split(',')[1]}</div>
                         </td>
                      </tr>
                    ))}
                 </tbody>
              </table>
           </div>
        </section>
      )}
    </div>
  );
}
