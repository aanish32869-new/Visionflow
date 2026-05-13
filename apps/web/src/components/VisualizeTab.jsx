import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Eye, 
  Zap, 
  Upload, 
  Image as ImageIcon, 
  Target, 
  Cpu, 
  Settings, 
  Loader2, 
  AlertCircle,
  X,
  ChevronDown,
  Maximize2,
  Activity
} from 'lucide-react';
import logger from "../utils/logger";

export default function VisualizeTab({ projectId, onTrainModel }) {
  const [models, setModels] = useState([]);
  const [projectMeta, setProjectMeta] = useState({ project_type: "Object Detection" });
  const [selectedModelId, setSelectedModelId] = useState("");
  const [image, setImage] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isInferring, setIsInferring] = useState(false);
  const [results, setResults] = useState(null);
  const [threshold, setThreshold] = useState(0.5);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [isClassificationResult, setIsClassificationResult] = useState(false);
  const [inferenceMeta, setInferenceMeta] = useState({ threshold: 0.5 });
  const [inferenceError, setInferenceError] = useState("");
  const [debugCounts, setDebugCounts] = useState({ raw: 0, mapped: 0 });
  const [suppressedCount, setSuppressedCount] = useState(0);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const isFiniteNumber = (value) => Number.isFinite(Number(value));
  const toNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const normalizeBox = (prediction, naturalWidth, naturalHeight) => {
    if (!prediction) return null;
    if (Array.isArray(prediction.box) && prediction.box.length >= 4) {
      const [aRaw, bRaw, cRaw, dRaw] = prediction.box;
      if (![aRaw, bRaw, cRaw, dRaw].every(isFiniteNumber)) return null;
      const a = toNumber(aRaw), b = toNumber(bRaw), c = toNumber(cRaw), d = toNumber(dRaw);
      const xyxyLike = prediction.box_mode === "xyxy" || (c > a && d > b);
      if (xyxyLike) {
        let x1 = a, y1 = b, x2 = c, y2 = d;
        if (!prediction.normalized && naturalWidth > 0 && naturalHeight > 0) {
          x1 /= naturalWidth; x2 /= naturalWidth;
          y1 /= naturalHeight; y2 /= naturalHeight;
        }
        x1 = clamp01(x1); y1 = clamp01(y1); x2 = clamp01(x2); y2 = clamp01(y2);
        const w = Math.max(0, x2 - x1);
        const h = Math.max(0, y2 - y1);
        if (w <= 0 || h <= 0) return null;
        return { x: x1 + w / 2, y: y1 + h / 2, width: w, height: h };
      }
      // Assume xywh (normalized)
      const x = clamp01(a);
      const y = clamp01(b);
      const w = clamp01(c);
      const h = clamp01(d);
      if (w <= 0 || h <= 0) return null;
      return { x, y, width: w, height: h };
    }

    let x = prediction?.x ?? prediction?.x_center ?? prediction?.cx;
    let y = prediction?.y ?? prediction?.y_center ?? prediction?.cy;
    let w = prediction?.width ?? prediction?.w;
    let h = prediction?.height ?? prediction?.h;

    // Optional xyxy style fields
    if ((!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w) || !isFiniteNumber(h)) &&
        [prediction?.x1, prediction?.y1, prediction?.x2, prediction?.y2].every(isFiniteNumber)) {
      const x1 = toNumber(prediction.x1);
      const y1 = toNumber(prediction.y1);
      const x2 = toNumber(prediction.x2);
      const y2 = toNumber(prediction.y2);
      x = (x1 + x2) / 2;
      y = (y1 + y2) / 2;
      w = Math.max(0, x2 - x1);
      h = Math.max(0, y2 - y1);
    }

    if (![x, y, w, h].every(isFiniteNumber)) return null;
    x = toNumber(x); y = toNumber(y); w = toNumber(w); h = toNumber(h);
    if (w <= 0 || h <= 0) return null;
    if (naturalWidth > 0 && naturalHeight > 0 && (w > 1.5 || h > 1.5 || x > 1.5 || y > 1.5)) {
      x /= naturalWidth; y /= naturalHeight;
      w /= naturalWidth; h /= naturalHeight;
    }
    x = clamp01(x); y = clamp01(y); w = clamp01(w); h = clamp01(h);
    if (w <= 0 || h <= 0) return null;
    return { x, y, width: w, height: h };
  };
  const isFullFrameLike = (box) => {
    if (!box) return false;
    const { x, y, width, height } = box;
    return width >= 0.92 && height >= 0.92 && Math.abs(x - 0.5) <= 0.1 && Math.abs(y - 0.5) <= 0.1;
  };
  
  const fileInputRef = useRef(null);
  const imageRef = useRef(null);
  const imageFrameRef = useRef(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const modelRef = (m) => String(m?.model_id || m?.id || m?._id || "");
  const selectionKey = `visionflow_visualize_selected_model_${projectId}`;

  const fetchModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/models`);
      if (response.ok) {
        const data = await response.json();
        const allModels = Array.isArray(data)
          ? data.filter((m) => m.deployment_status === "ready" || m.deployment_status === "deployed" || m.status === "Completed")
          : [];
        const projectTypeNow = projectMeta?.project_type || "Object Detection";
        const taskFiltered = allModels.filter((m) => {
          const arch = String(m.architecture || "").toLowerCase();
          const isClassify = arch.includes("resnet") || arch.includes("vit") || arch.includes("dinov3") || arch.includes("simplecnn");
          return projectTypeNow === "Object Detection" ? !isClassify : isClassify;
        });
        const deployedModels = taskFiltered.filter((m) => m.deployment_status === "deployed" || m.deployment_id);
        const fallbackDeployed = allModels.filter((m) => m.deployment_status === "deployed" || m.deployment_id);
        const readyModels =
          deployedModels.length > 0
            ? deployedModels
            : (taskFiltered.length > 0 ? taskFiltered : fallbackDeployed);
        setModels(readyModels);
        if (readyModels.length > 0) {
          const preferred = localStorage.getItem("visionflow_selected_model_id");
          const sticky = localStorage.getItem(selectionKey);
          const preferredExists = preferred && readyModels.some((m) => modelRef(m) === String(preferred));
          const stickyExists = sticky && readyModels.some((m) => modelRef(m) === String(sticky));
          const yoloPreferred = readyModels.find((m) => String(m.architecture || "").toLowerCase().includes("yolo"));
          const fallback = projectTypeNow === "Object Detection" ? (yoloPreferred || readyModels[0]) : readyModels[0];

          if (preferredExists) {
            setSelectedModelId(preferred);
            localStorage.removeItem("visionflow_selected_model_id");
          } else if (stickyExists) {
            setSelectedModelId(String(sticky));
          } else {
            setSelectedModelId(modelRef(fallback));
          }
        } else {
          setSelectedModelId("");
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoadingModels(false);
    }
  }, [projectId, projectMeta, selectionKey]);

  useEffect(() => {
    if (!selectedModelId) return;
    try {
      localStorage.setItem(selectionKey, String(selectedModelId));
    } catch {}
  }, [selectedModelId, selectionKey]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    const run = async () => {
      try {
        const pid = typeof projectId === "object" && projectId !== null ? (projectId.id || projectId._id) : projectId;
        let me = null;
        const direct = await fetch(`/api/projects/${pid}`);
        if (direct.ok) {
          me = await direct.json();
        } else {
          const res = await fetch("/api/projects");
          if (res.ok) {
            const projects = await res.json();
            me = Array.isArray(projects)
              ? projects.find((p) => String(p.id || p._id) === String(pid))
              : null;
          }
        }
        if (me) setProjectMeta({ project_type: me.project_type || "Object Detection" });
      } catch (err) {
        logger.error("Failed to load project metadata for visualize", err);
      }
    };
    run();
  }, [projectId]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImage(file);
      setPreviewUrl(URL.createObjectURL(file));
      setResults(null);
      setDebugCounts({ raw: 0, mapped: 0 });
      setSuppressedCount(0);
    }
  };

  const handleRunInference = async () => {
    if (!selectedModelId || !image) return;

    setIsInferring(true);
    setInferenceError("");
    const formData = new FormData();
    formData.append('file', image);

    try {
      const response = await fetch(`/api/projects/${projectId}/models/${selectedModelId}/infer?conf=${threshold}`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        if (data?.success === false) {
          throw new Error(data?.error || "Inference failed");
        }
        const predictions = Array.isArray(data.predictions) ? data.predictions : [];
        setInferenceMeta({ threshold: Number(data.confidence_threshold ?? threshold) });
        const classification = predictions.some((p) => String(p.type || "").toLowerCase() === "classification");
        setIsClassificationResult(classification);
        let suppressed = 0;
        const mapped = predictions.map((prediction) => {
          if (String(prediction.type || "").toLowerCase() === "classification") {
            return {
              label: prediction.label || prediction.class || "Class",
              confidence: Number(prediction.confidence ?? 1),
              type: "classification",
            };
          }
          const nw = imageRef.current?.naturalWidth || 0;
          const nh = imageRef.current?.naturalHeight || 0;
          const box = normalizeBox(prediction, nw, nh);
          if (!box) return null;
          if (isFullFrameLike(box)) {
            suppressed += 1;
            return null;
          }
          const { x, y, width, height } = box;

          return {
            box: [
              Math.max(0, x - width / 2),
              Math.max(0, y - height / 2),
              Math.min(1, x + width / 2),
              Math.min(1, y + height / 2),
            ],
            label: prediction.label || prediction.class || "Object",
            confidence: Number(prediction.confidence || 0),
            normalized: true,
          };
        });
        const cleaned = mapped.filter(Boolean);
        setDebugCounts({ raw: predictions.length, mapped: cleaned.length });
        setSuppressedCount(suppressed);
        setResults(cleaned);
      } else {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error || "Inference failed");
      }
    } catch (error) {
      console.error("Inference failed:", error);
      setResults([]);
      setDebugCounts({ raw: 0, mapped: 0 });
      setSuppressedCount(0);
      setInferenceError(error?.message || "Inference failed");
    } finally {
      setIsInferring(false);
    }
  };

  const updateImageSize = () => {
    if (!imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    setImageSize({
      width: rect.width,
      height: rect.height,
    });
  };

  useEffect(() => {
    window.addEventListener('resize', updateImageSize);
    return () => window.removeEventListener('resize', updateImageSize);
  }, []);

  const selectedModel = models.find((m) => modelRef(m) === String(selectedModelId));

  return (
    <div className="w-full animate-page-enter space-y-8 pb-20">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-[26px] font-black text-gray-900 tracking-tight">Visualize</h1>
          <p className="text-[13px] font-semibold text-gray-400 mt-1 uppercase tracking-widest">Inference & Model Testing</p>
        </div>
        <div className="flex gap-3">
          <div className="relative">
             <select 
               value={selectedModelId}
               onChange={(e) => setSelectedModelId(e.target.value)}
               className="appearance-none bg-white border border-gray-100 rounded-xl px-4 py-2.5 pr-10 text-[13px] font-black text-gray-900 focus:border-violet-300 outline-none shadow-sm transition-all"
             >
                {models.map(m => (
                  <option key={modelRef(m)} value={modelRef(m)}>{m.name}</option>
                ))}
                {models.length === 0 && <option value="">No models available</option>}
             </select>
             <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
          <button 
            onClick={() => fileInputRef.current.click()}
            className="px-5 py-2.5 bg-gray-950 text-white rounded-xl text-[13px] font-bold shadow-lg shadow-gray-200 hover:bg-violet-600 transition flex items-center gap-2"
          >
            <Upload size={16} /> Upload Image
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            className="hidden" 
            accept="image/*"
          />
        </div>
      </header>

      {!models.length && !isLoadingModels ? (
        <div className="flex flex-col items-center justify-center py-32 bg-white rounded-[32px] border border-dashed border-gray-200">
           <div className="w-20 h-20 bg-gray-50 rounded-[2.5rem] flex items-center justify-center text-gray-300 mb-8 scale-110">
              <Eye size={40} />
           </div>
           <h3 className="text-[20px] font-black text-gray-900">No models to visualize</h3>
           <p className="text-[14px] text-gray-400 font-bold max-w-sm text-center mt-3 leading-relaxed">
             You need at least one trained model in your project registry to perform real-time inference tests.
           </p>
           <button 
             onClick={onTrainModel}
             className="mt-8 px-6 py-3 bg-violet-600 text-white rounded-2xl text-[13px] font-black shadow-xl shadow-violet-100 hover:bg-violet-700 transition flex items-center gap-2"
           >
              <Zap size={16} /> Go to Train Tab
           </button>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
           {inferenceError && (
             <div className="lg:col-span-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold flex items-center gap-2">
               <AlertCircle size={16} /> {inferenceError}
             </div>
           )}
           {/* Inference Viewport */}
           <div className="bg-white rounded-[40px] border border-gray-100 p-8 shadow-sm flex flex-col items-center justify-center min-h-[600px] relative overflow-hidden">
              {previewUrl ? (
                <div className="relative w-full h-full flex items-center justify-center group">
                   <div ref={imageFrameRef} className="relative inline-block">
                     <img 
                       ref={imageRef}
                       src={previewUrl} 
                       onLoad={updateImageSize}
                       alt="Preview" 
                       className="block max-w-full max-h-[700px] rounded-[24px] shadow-2xl border border-gray-100"
                     />
                   
                   {/* Results Overlay */}
                    {results && imageSize.width > 0 && results.map((res, i) => {
                     if (!res || !Array.isArray(res.box)) return null;
                     if (String(res.type || "").toLowerCase() === "classification") return null;
                     const isNorm = res.normalized;
                     const left = isNorm ? res.box[0] * imageSize.width : (res.box[0] / imageRef.current.naturalWidth) * imageSize.width;
                     const top = isNorm ? res.box[1] * imageSize.height : (res.box[1] / imageRef.current.naturalHeight) * imageSize.height;
                     const width = isNorm ? (res.box[2] - res.box[0]) * imageSize.width : ((res.box[2] - res.box[0]) / imageRef.current.naturalWidth) * imageSize.width;
                     const height = isNorm ? (res.box[3] - res.box[1]) * imageSize.height : ((res.box[3] - res.box[1]) / imageRef.current.naturalHeight) * imageSize.height;
                     
                     if (Number(res.confidence || 0) < threshold) return null;
                     if (isClassificationResult && res.type === "classification") {
                       return (
                         <div key={i} className="absolute top-4 left-4 bg-violet-600 text-white px-3 py-2 rounded-xl text-[12px] font-black shadow-lg">
                           {res.label} {(res.confidence * 100).toFixed(0)}%
                         </div>
                       );
                     }

                     return (
                       <div 
                         key={i}
                         className="absolute border-2 border-violet-500 bg-violet-500/10 pointer-events-none group-hover:bg-violet-500/20 transition-all"
                         style={{ left, top, width, height }}
                       >
                          <div className="absolute -top-6 left-[-2px] bg-violet-600 text-white px-2 py-0.5 rounded-t-[4px] text-[10px] font-black whitespace-nowrap shadow-sm">
                             {res.label} {(res.confidence * 100).toFixed(0)}%
                          </div>
                       </div>
                     );
                   })}
                   </div>

                   {isInferring && (
                     <div className="absolute inset-0 bg-white/40 backdrop-blur-[2px] flex flex-col items-center justify-center rounded-[24px] animate-in fade-in duration-300">
                        <div className="w-16 h-16 bg-white rounded-full shadow-2xl flex items-center justify-center mb-4">
                           <Loader2 size={32} className="animate-spin text-violet-600" />
                        </div>
                        <span className="text-[14px] font-black text-gray-900 tracking-tight">Analyzing pixels...</span>
                     </div>
                   )}
                </div>
              ) : (
                <div 
                  onClick={() => fileInputRef.current.click()}
                  className="flex flex-col items-center justify-center cursor-pointer group"
                >
                   <div className="w-24 h-24 bg-gray-50 rounded-[2.5rem] flex items-center justify-center text-gray-300 mb-8 transition-all group-hover:scale-110 group-hover:bg-violet-50 group-hover:text-violet-400">
                      <Upload size={40} />
                   </div>
                   <h3 className="text-[18px] font-black text-gray-900">Upload image to test</h3>
                   <p className="text-[13px] text-gray-400 font-bold mt-2">Drag and drop or click to browse</p>
                </div>
              )}
              
              {/* Bottom Actions Overlay */}
              {previewUrl && !isInferring && (
                <div className="absolute bottom-8 flex gap-3 animate-in slide-in-from-bottom-4">
                   <button 
                     onClick={handleRunInference}
                     className="px-8 py-3 bg-violet-600 text-white rounded-2xl text-[14px] font-black shadow-2xl shadow-violet-200 hover:bg-violet-700 transition flex items-center gap-2"
                   >
                     <Zap size={18} fill="white" /> Run Inference
                   </button>
                   <button 
                     onClick={() => { setPreviewUrl(null); setImage(null); setResults(null); }}
                     className="px-4 py-3 bg-white/90 backdrop-blur-md border border-gray-100 text-gray-500 rounded-2xl hover:text-rose-500 transition shadow-lg"
                   >
                     <X size={18} />
                   </button>
                </div>
              )}
           </div>

           {/* Controls Sidebar */}
           <aside className="space-y-6">
              <section className="bg-white rounded-[32px] border border-gray-100 p-6 shadow-sm">
                 <h2 className="text-[17px] font-black text-gray-950 mb-6 flex items-center gap-2">
                    <Settings size={18} className="text-violet-600" /> Inference Engine
                 </h2>
                 <div className="space-y-6">
                    <div>
                       <div className="flex justify-between mb-3">
                          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Confidence Threshold</label>
                          <span className="text-[11px] font-black text-violet-600 bg-violet-50 px-2 rounded-full border border-violet-100">{(threshold * 100).toFixed(0)}%</span>
                       </div>
                       <input 
                         type="range" 
                         min="0" 
                         max="1" 
                         step="0.01" 
                         value={threshold} 
                         onChange={(e) => setThreshold(parseFloat(e.target.value))}
                         className="w-full h-1.5 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-violet-600"
                       />
                       <div className="flex justify-between mt-2 text-[9px] font-bold text-gray-300 uppercase tracking-tighter">
                          <span>0.0</span>
                          <span>0.5</span>
                          <span>1.0</span>
                       </div>
                    </div>

                    <div className="pt-4 border-t border-gray-50 space-y-4">
                       <div className="flex items-center justify-between">
                          <span className="text-[12px] font-bold text-gray-500">Active Model</span>
                          <span className="text-[12px] font-black text-gray-900">{selectedModel?.name || "None"}</span>
                       </div>
                       <div className="flex items-center justify-between">
                          <span className="text-[12px] font-bold text-gray-500">Architecture</span>
                          <span className="text-[12px] font-black text-gray-900">{selectedModel?.architecture_label || "N/A"}</span>
                       </div>
                       <div className="flex items-center justify-between">
                          <span className="text-[12px] font-bold text-gray-500">Source Device</span>
                          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-gray-950 rounded-md text-white">
                             <Cpu size={10} />
                             <span className="text-[10px] font-black uppercase tracking-wider">Local CPU</span>
                          </div>
                       </div>
                    </div>
                 </div>
              </section>

              <section className="bg-white rounded-[32px] border border-gray-100 p-6 shadow-sm">
                 <h2 className="text-[17px] font-black text-gray-950 mb-4">Diagnostics</h2>
                 <div className="space-y-4">
                    {results ? (
                       <div className="space-y-3">
                          <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                             <div className="text-[20px] font-black text-emerald-700">{results.filter(r => Number(r?.confidence || 0) >= threshold).length}</div>
                             <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Objects Detected</div>
                          </div>
                          <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                             <div className="text-[20px] font-black text-gray-950">{results.length > 0 ? (Math.max(...results.map(r => Number(r?.confidence || 0))) * 100).toFixed(1) : "0"}%</div>
                             <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Peak Confidence</div>
                             <div className="text-[10px] font-bold uppercase tracking-widest text-violet-500 mt-2">Server Threshold {(Number(inferenceMeta.threshold || threshold) * 100).toFixed(0)}%</div>
                             <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-2">Raw {debugCounts.raw} | Mapped {debugCounts.mapped} | Suppressed {suppressedCount}</div>
                          </div>
                       </div>
                    ) : (
                       <div className="flex flex-col items-center justify-center py-10 opacity-40">
                          <Activity size={32} className="text-gray-300 mb-2" />
                          <p className="text-[11px] font-bold text-gray-400 uppercase text-center">Awaiting analysis</p>
                       </div>
                    )}
                 </div>
              </section>
           </aside>
        </div>
      )}
    </div>
  );
}
