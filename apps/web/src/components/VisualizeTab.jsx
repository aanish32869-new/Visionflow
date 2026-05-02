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

export default function VisualizeTab({ projectId, onTrainModel }) {
  const [models, setModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [image, setImage] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isInferring, setIsInferring] = useState(false);
  const [results, setResults] = useState(null);
  const [threshold, setThreshold] = useState(0.5);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  
  const fileInputRef = useRef(null);
  const imageRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const fetchModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/models`);
      if (response.ok) {
        const data = await response.json();
        const readyModels = Array.isArray(data) ? data.filter(m => m.deployment_status === 'ready' || m.status === 'Completed') : [];
        setModels(readyModels);
        if (readyModels.length > 0) setSelectedModelId(readyModels[0].model_id);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoadingModels(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImage(file);
      setPreviewUrl(URL.createObjectURL(file));
      setResults(null);
    }
  };

  const handleRunInference = async () => {
    if (!selectedModelId || !image) return;

    setIsInferring(true);
    const formData = new FormData();
    formData.append('file', image);

    try {
      const response = await fetch(`/api/projects/${projectId}/models/${selectedModelId}/infer?conf=${threshold}`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        const predictions = Array.isArray(data.predictions) ? data.predictions : [];
        setResults(predictions.map((prediction) => {
          const x = Number(prediction.x ?? prediction.x_center ?? 0.5);
          const y = Number(prediction.y ?? prediction.y_center ?? 0.5);
          const width = Number(prediction.width ?? 0);
          const height = Number(prediction.height ?? 0);
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
        }));
      } else {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error || "Inference failed");
      }
    } catch (error) {
      console.error("Inference failed:", error);
      setResults([]);
    } finally {
      setIsInferring(false);
    }
  };

  const updateContainerSize = () => {
    if (imageRef.current) {
      setContainerSize({
        width: imageRef.current.clientWidth,
        height: imageRef.current.clientHeight
      });
    }
  };

  useEffect(() => {
    window.addEventListener('resize', updateContainerSize);
    return () => window.removeEventListener('resize', updateContainerSize);
  }, []);

  const selectedModel = models.find(m => m.model_id === selectedModelId);

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
                  <option key={m.model_id} value={m.model_id}>{m.name}</option>
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
           {/* Inference Viewport */}
           <div className="bg-white rounded-[40px] border border-gray-100 p-8 shadow-sm flex flex-col items-center justify-center min-h-[600px] relative overflow-hidden">
              {previewUrl ? (
                <div className="relative w-full h-full flex items-center justify-center group">
                   <img 
                     ref={imageRef}
                     src={previewUrl} 
                     onLoad={updateContainerSize}
                     alt="Preview" 
                     className="max-w-full max-h-[700px] rounded-[24px] shadow-2xl border border-gray-100"
                   />
                   
                   {/* Results Overlay */}
                   {results && containerSize.width > 0 && results.map((res, i) => {
                     const isNorm = res.normalized;
                     const left = isNorm ? res.box[0] * containerSize.width : (res.box[0] / imageRef.current.naturalWidth) * containerSize.width;
                     const top = isNorm ? res.box[1] * containerSize.height : (res.box[1] / imageRef.current.naturalHeight) * containerSize.height;
                     const width = isNorm ? (res.box[2] - res.box[0]) * containerSize.width : ((res.box[2] - res.box[0]) / imageRef.current.naturalWidth) * containerSize.width;
                     const height = isNorm ? (res.box[3] - res.box[1]) * containerSize.height : ((res.box[3] - res.box[1]) / imageRef.current.naturalHeight) * containerSize.height;
                     
                     if (res.confidence < threshold) return null;

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
                             <div className="text-[20px] font-black text-emerald-700">{results.filter(r => r.confidence >= threshold).length}</div>
                             <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Objects Detected</div>
                          </div>
                          <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                             <div className="text-[20px] font-black text-gray-950">{results.length > 0 ? (Math.max(...results.map(r => r.confidence)) * 100).toFixed(1) : "0"}%</div>
                             <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Peak Confidence</div>
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
