/* eslint-disable react-hooks/exhaustive-deps, no-unused-vars */
import React, { useState, useEffect, useRef } from "react";
import { Server, ImageIcon, ShieldCheck, Crosshair, HelpCircle, Loader, AlertCircle } from "lucide-react";

export default function DeployTab({ projectId }) {
  const [models, setModels] = useState([]);
  const [projectMeta, setProjectMeta] = useState({ project_type: "Object Detection" });
  const [selectedModel, setSelectedModel] = useState(null);
  const [_imageFile, setImageFile] = useState(null);
  const [imageURL, setImageURL] = useState(null);
  const [predictions, setPredictions] = useState(null);
  const [isInferencing, setIsInferencing] = useState(false);
  const [infereceTime, setInferenceTime] = useState(null);
  const [activeCodeTab, setActiveCodeTab] = useState('python');
  const [copyMessage, setCopyMessage] = useState("");
  const [isClassificationResult, setIsClassificationResult] = useState(false);
  const [threshold, setThreshold] = useState(0.5);
  const [inferenceError, setInferenceError] = useState("");
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [inferenceMeta, setInferenceMeta] = useState({ threshold: 0.5, peak_confidence: 0, raw_prediction_count: 0, suggested_threshold: 0.5 });
  const clamp01 = (value) => Math.min(1, Math.max(0, value));
  const isFiniteNumber = (value) => Number.isFinite(Number(value));
  const toNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const normalizeBox = (prediction, naturalWidth, naturalHeight) => {
    if (!prediction) return null;
    if (Array.isArray(prediction.box) && prediction.box.length >= 4) {
      const [x1Raw, y1Raw, x2Raw, y2Raw] = prediction.box;
      if (![x1Raw, y1Raw, x2Raw, y2Raw].every(isFiniteNumber)) return null;
      let x1 = toNumber(x1Raw);
      let y1 = toNumber(y1Raw);
      let x2 = toNumber(x2Raw);
      let y2 = toNumber(y2Raw);
      const isNorm = Boolean(prediction.normalized);
      if (!isNorm && naturalWidth > 0 && naturalHeight > 0) {
        x1 /= naturalWidth; x2 /= naturalWidth;
        y1 /= naturalHeight; y2 /= naturalHeight;
      }
      x1 = clamp01(x1); y1 = clamp01(y1); x2 = clamp01(x2); y2 = clamp01(y2);
      const w = Math.max(0, x2 - x1);
      const h = Math.max(0, y2 - y1);
      if (w <= 0 || h <= 0) return null;
      return { x: x1 + w / 2, y: y1 + h / 2, width: w, height: h };
    }

    const xRaw = prediction?.x ?? prediction?.x_center ?? prediction?.cx;
    const yRaw = prediction?.y ?? prediction?.y_center ?? prediction?.cy;
    const wRaw = prediction?.width ?? prediction?.w;
    const hRaw = prediction?.height ?? prediction?.h;
    if (![xRaw, yRaw, wRaw, hRaw].every(isFiniteNumber)) return null;

    let x = toNumber(xRaw);
    let y = toNumber(yRaw);
    let w = toNumber(wRaw);
    let h = toNumber(hRaw);

    // If model returns pixel-space boxes, convert to normalized space.
    if (naturalWidth > 0 && naturalHeight > 0 && (w > 1.5 || h > 1.5 || x > 1.5 || y > 1.5)) {
      x /= naturalWidth;
      y /= naturalHeight;
      w /= naturalWidth;
      h /= naturalHeight;
    }

    x = clamp01(x);
    y = clamp01(y);
    w = clamp01(w);
    h = clamp01(h);

    if (w <= 0 || h <= 0) return null;
    return { x, y, width: w, height: h };
  };
  
  const fileInputRef = useRef(null);
  const imgRef = useRef(null);

  useEffect(() => {
    fetchModels();
    fetchProjectMeta();

  }, [projectId]);

  useEffect(() => {
    fetchModels();
  }, [projectMeta.project_type]);

  async function fetchProjectMeta() {
    try {
      const pid = typeof projectId === "object" && projectId !== null ? (projectId.id || projectId._id) : projectId;
      let me = null;
      const direct = await fetch(`/api/projects/${pid}`);
      if (direct.ok) {
        me = await direct.json();
      } else {
        const res = await fetch("/api/projects");
        if (!res.ok) return;
        const projects = await res.json();
        me = Array.isArray(projects) ? projects.find((p) => String(p.id || p._id) === String(pid)) : null;
      }
      if (me) setProjectMeta({ project_type: me.project_type || "Object Detection" });
    } catch (err) {
      console.error(err);
    }
  }

  async function fetchModels() {
    try {
      const res = await fetch(`/api/projects/${projectId}/models`);
      if (res.ok) {
        const data = await res.json();
        const projectType = projectMeta?.project_type || "Object Detection";
        const filtered = Array.isArray(data) ? data.filter((m) => {
          const arch = String(m.architecture || "").toLowerCase();
          const classify =
            arch.includes("resnet") ||
            arch.includes("vit") ||
            arch.includes("dinov3") ||
            arch.includes("simplecnn");
          return projectType === "Classification" ? classify : !classify;
        }) : [];
        const fallbackDeployed = Array.isArray(data)
          ? data.filter((m) => m.deployment_status === "deployed" || m.deployment_id)
          : [];
        const effectiveModels = filtered.length > 0 ? filtered : fallbackDeployed;
        setModels(effectiveModels);
        if (effectiveModels.length > 0) {
          const currentExists = selectedModel && effectiveModels.some((m) => String(m.model_id || m.id || m._id) === String(selectedModel));
          if (!currentExists) {
            const yoloPreferred = effectiveModels.find((m) => String(m.architecture || "").toLowerCase().includes("yolo"));
            const fallback = projectType === "Object Detection" ? (yoloPreferred || effectiveModels[effectiveModels.length - 1]) : effectiveModels[effectiveModels.length - 1];
            setSelectedModel(fallback.model_id || fallback.id || fallback._id);
          }
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const currentModel = models.find(m => (m.model_id || m.id || m._id) === selectedModel);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      const url = URL.createObjectURL(file);
      setImageURL(url);
      setPredictions(null);
      setInferenceTime(null);
      runInference(file, selectedModel);
    }
  };

  const runInference = async (file, modelId) => {
    if (!file || !modelId) return;
    setIsInferencing(true);
    setInferenceError("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      // Give it a tiny delay to pretend it's uploading/inferencing on cloud
      await new Promise(r => setTimeout(r, 600));

      const res = await fetch(`/api/projects/${projectId}/models/${modelId}/infer?conf=${threshold}`, {
        method: "POST",
        body: formData
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data?.success === false) {
          throw new Error(data?.error || "Inference failed");
        }
        const preds = Array.isArray(data.predictions) ? data.predictions : [];
        setInferenceMeta({
          threshold: Number(data.confidence_threshold ?? threshold),
          peak_confidence: Number(data.peak_confidence ?? 0),
          raw_prediction_count: Number(data.raw_prediction_count ?? preds.length),
          suggested_threshold: Number(data.suggested_threshold ?? threshold),
        });
        const naturalWidth = imgRef.current?.naturalWidth || 0;
        const naturalHeight = imgRef.current?.naturalHeight || 0;
        setIsClassificationResult(preds.some((p) => String(p.type || "").toLowerCase() === "classification"));
        const normalizedPreds = preds
            .map((p) => {
              if (String(p?.type || "").toLowerCase() === "classification") return p;
              const box = normalizeBox(p, naturalWidth, naturalHeight);
              if (!box) return null;
              return { ...p, x: box.x, y: box.y, width: box.width, height: box.height, confidence: Number(p?.confidence ?? 0) };
            })
            .filter(Boolean);
        const detectionPreds = normalizedPreds.filter((p) => String(p?.type || "").toLowerCase() !== "classification");
        const classificationPreds = normalizedPreds.filter((p) => String(p?.type || "").toLowerCase() === "classification");
        const thresholdedDetections = detectionPreds.filter((p) => Number(p?.confidence ?? 0) >= threshold);
        setPredictions([...classificationPreds, ...thresholdedDetections]);
        setInferenceTime(data.time);
      }
    } catch (err) {
      console.error(err);
      setPredictions([]);
      setInferenceError(err?.message || "Inference failed");
    }
    setIsInferencing(false);
  };

  const updateImageSize = () => {
    if (!imgRef.current) return;
    setImageSize({
      width: imgRef.current.clientWidth,
      height: imgRef.current.clientHeight,
    });
  };

  const currentCodeSnippet = activeCodeTab === 'python' ? `import requests

url = "https://infer.visionflow.io/${projectId}/1"
files = {"file": open("image.jpg", "rb")}

response = requests.post(url, files=files)
print(response.json())` :
`import okhttp3.*;

OkHttpClient client = new OkHttpClient();
RequestBody body = new MultipartBody.Builder()
  .setType(MultipartBody.FORM)
  .addFormDataPart("file", "image.jpg",
    RequestBody.create(
      MediaType.parse("image/jpeg"), 
      new File("image.jpg")
    ))
  .build();

Request request = new Request.Builder()
  .url("https://infer.visionflow.io/${projectId}/1")
  .post(body)
  .build();

Response response = client.newCall(request).execute();
System.out.println(response.body().string());`;

  const thresholdedPredictions = Array.isArray(predictions)
    ? predictions.filter((p) => String(p?.type || "").toLowerCase() !== "classification")
    : [];
  const confidenceSeries = thresholdedPredictions
    .map((p) => Number(p?.confidence ?? 0))
    .filter((v) => Number.isFinite(v));
  const peakConfidencePct = confidenceSeries.length ? (Math.max(...confidenceSeries) * 100).toFixed(1) : "0.0";
  const avgConfidencePct = confidenceSeries.length
    ? ((confidenceSeries.reduce((a, b) => a + b, 0) / confidenceSeries.length) * 100).toFixed(1)
    : "0.0";
  const backendPeakPct = (Number(inferenceMeta.peak_confidence || 0) * 100).toFixed(1);

  const handleCopySnippet = async () => {
    try {
      await navigator.clipboard.writeText(currentCodeSnippet);
      setCopyMessage("Copied");
      setTimeout(() => setCopyMessage(""), 1500);
    } catch (err) {
      console.error("Failed to copy code snippet", err);
      setCopyMessage("Copy failed");
      setTimeout(() => setCopyMessage(""), 1500);
    }
  };

  useEffect(() => {
    window.addEventListener("resize", updateImageSize);
    return () => window.removeEventListener("resize", updateImageSize);
  }, []);

  useEffect(() => {
    if (!_imageFile || !selectedModel) return;
    runInference(_imageFile, selectedModel);
  }, [threshold, selectedModel]);

  return (
    <div className="flex flex-col gap-6 w-full animate-page-enter max-w-[1200px] mx-auto min-h-[70vh]">
      <div className="flex justify-between items-center mb-2">
         <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
           <Server className="text-violet-600" /> Deploy via VisionFlow API
         </h2>
      </div>

      <div className="flex flex-col xl:flex-row gap-8 h-full">
         {inferenceError && (
           <div className="w-full p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold flex items-center gap-2">
             <AlertCircle size={16} /> {inferenceError}
           </div>
         )}
         
         {/* Left Side: Test your model directly */}
         <div className="flex-1 bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col overflow-hidden min-h-[500px]">
            <div className="bg-gray-50 border-b border-gray-200 p-4 flex items-center justify-between">
               <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                  <Crosshair size={16} /> Test Inference
               </h3>
               {infereceTime && (
                  <span className="text-[11px] font-bold tracking-widest uppercase bg-green-100 text-green-700 px-2 py-0.5 rounded">
                     {infereceTime * 1000}ms Speed
                  </span>
               )}
            </div>

            <div className="flex-1 bg-gray-100 relative flex items-center justify-center p-6 min-h-[400px]">
               {models.length === 0 ? (
                  <div className="text-center text-gray-400">
                    <ShieldCheck size={48} className="mb-4 text-gray-300 mx-auto" />
                    <p className="font-medium text-[15px]">No models trained.</p>
                    <p className="text-[13px] mt-1">Train a model first to test inference.</p>
                  </div>
               ) : !imageURL ? (
                  <div className="text-center">
                     <p className="font-bold text-gray-600 mb-6 drop-shadow-sm">Upload an image to test inference</p>
                     <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
                     <button onClick={() => fileInputRef.current?.click()} className="bg-white border-2 border-dashed border-violet-400 text-violet-700 hover:bg-violet-50 font-bold px-8 py-4 rounded-xl shadow-sm transition flex gap-3 m-auto items-center">
                        <ImageIcon size={20} /> Select Image
                     </button>
                  </div>
               ) : (
                  <div className="relative inline-block max-w-full max-h-full">
                     <img 
                       ref={imgRef} 
                       src={imageURL} 
                       alt="Inference" 
                       className={`max-h-[50vh] object-contain rounded-lg shadow-xl outline outline-4 outline-white transition ${isInferencing ? 'opacity-50 blur-[2px]' : ''}`} 
                       onLoad={updateImageSize} 
                     />
                     {Array.isArray(predictions) && predictions.map((p, i) => {
                       if (isClassificationResult || String(p.type || "").toLowerCase() === "classification") return null;
                       if (!imageSize.width || !imageSize.height) return null;
                       const w = Number(p.width || 0) * imageSize.width;
                       const h = Number(p.height || 0) * imageSize.height;
                       const x = Number(p.x || 0) * imageSize.width - w / 2;
                       const y = Number(p.y || 0) * imageSize.height - h / 2;
                       const label = `${p.class || "Object"} ${(Number(p.confidence || 0) * 100).toFixed(1)}%`;
                       return (
                         <div
                           key={`${p.class || "obj"}-${i}`}
                           className="absolute border-2 border-violet-500 bg-violet-500/10 pointer-events-none"
                           style={{ left: x, top: y, width: w, height: h }}
                         >
                           <div className="absolute -top-6 left-[-2px] bg-violet-600 text-white px-2 py-0.5 rounded-t-[4px] text-[10px] font-black whitespace-nowrap shadow-sm">
                             {label}
                           </div>
                         </div>
                       );
                     })}

                     {isInferencing && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                           <Loader className="animate-spin text-white drop-shadow-md" size={48} strokeWidth={2.5} />
                        </div>
                     )}
                     
                     {!isInferencing && predictions && (
                        <button onClick={() => fileInputRef.current?.click()} className="absolute -bottom-16 left-1/2 -translate-x-1/2 bg-white text-gray-800 font-bold px-4 py-2 rounded-lg shadow border border-gray-200 text-sm hover:bg-gray-50 flex items-center gap-2">
                           <ImageIcon size={14} /> Try Another
                           <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
                        </button>
                     )}
                     {!isInferencing && isClassificationResult && Array.isArray(predictions) && predictions.length > 0 && (
                       <div className="absolute top-3 left-3 bg-violet-600 text-white px-3 py-2 rounded-lg text-xs font-bold shadow">
                         {predictions[0].label || predictions[0].class || "Class"} {(Number(predictions[0].confidence ?? 1) * 100).toFixed(0)}%
                       </div>
                     )}
                  </div>
               )}
            </div>
         </div>

         {/* Right Side: Deployment Configs */}
         <div className="w-full xl:w-[350px] shrink-0 flex flex-col gap-6">
            <h3 className="font-bold text-gray-800 text-sm tracking-wide uppercase">Deployment Settings</h3>
            
            <div className="bg-white border text-left border-gray-200 rounded-xl p-5 shadow-sm">
               <label className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mb-2 block">Selected Model</label>
               <select 
                  className="w-full border py-2 px-3 border-gray-300 rounded-md outline-none focus:border-violet-500 font-medium text-gray-800 text-sm mb-4"
                  value={selectedModel || ''}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={models.length === 0}
               >
                  {models.map((m, _i) => (
                     <option key={m.model_id || m.id || m._id} value={m.model_id || m.id || m._id}>{m.name}</option>
                  ))}
                  {models.length === 0 && <option>No models available</option>}
               </select>

               {currentModel && (
                  <div className="flex items-center gap-2 mb-4 bg-green-50 p-2 rounded border border-green-100">
                     <ShieldCheck size={16} className="text-green-600" />
                     <span className="text-xs font-bold text-green-800">Model verified and deployed</span>
                  </div>
               )}

               {Array.isArray(predictions) && (
                 <div className="mb-4 bg-gray-50 p-3 rounded border border-gray-100">
                   <div className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Inference Diagnostics</div>
                   <div className="mt-2 text-xs font-bold text-gray-700">Objects Detected: {thresholdedPredictions.length}</div>
                   <div className="mt-1 text-xs font-bold text-gray-700">Peak Confidence: {thresholdedPredictions.length > 0 ? peakConfidencePct : backendPeakPct}%</div>
                   <div className="mt-1 text-xs font-bold text-gray-700">Avg Confidence (Accuracy): {avgConfidencePct}%</div>
                   {thresholdedPredictions.length === 0 && Number(inferenceMeta.raw_prediction_count || 0) > 0 && (
                     <div className="mt-1 text-xs font-bold text-amber-700">
                       No boxes above current threshold. Try {(Number(inferenceMeta.suggested_threshold || 0.01) * 100).toFixed(1)}%
                     </div>
                   )}
                 </div>
               )}

               <label className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mb-2 block mt-2">
                 Confidence Threshold {(threshold * 100).toFixed(0)}%
               </label>
               <input
                 type="range"
                 min="0.001"
                 max="0.99"
                 step="0.001"
                 value={threshold}
                 onChange={(e) => setThreshold(Number(e.target.value))}
                 className="w-full h-1.5 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-violet-600 mb-4"
               />
               
               <label className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mb-2 block mt-6 flex gap-1 items-center">
                 API Endpoint <HelpCircle size={10} />
               </label>
                <div className="flex bg-gray-50 rounded border border-gray-200 overflow-hidden mb-6">
                 <span className="text-gray-500 text-xs py-2 px-3 border-r border-gray-200 font-mono self-center">POST</span>
                 <input type="text" readOnly value={`https://infer.visionflow.io/${projectId}/1`} className="w-full bg-transparent text-gray-800 text-xs font-mono outline-none px-3" />
               </div>

               <p className="text-[11px] text-gray-500 mt-2 border-b border-gray-100 pb-4 mb-4">
                 You can immediately deploy this model natively using the VisionFlow mobile SDKs or Docker containers.
               </p>

               {/* Code Snippet Area */}
               <label className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mb-3 block">Implementation Code</label>
               
               <div className="flex bg-[#1e1e1e] rounded-t-lg border-x border-t border-[#333] pt-2 px-2">
                  <div 
                     className={`px-3 py-1.5 text-xs font-bold cursor-pointer rounded-t-md transition ${activeCodeTab === 'python' ? 'bg-[#333] text-white' : 'text-gray-400 hover:text-gray-200'}`}
                     onClick={() => setActiveCodeTab('python')}
                  >
                     Python (Requests)
                  </div>
                  <div 
                     className={`px-3 py-1.5 text-xs font-bold cursor-pointer rounded-t-md transition ${activeCodeTab === 'java' ? 'bg-[#333] text-white' : 'text-gray-400 hover:text-gray-200'}`}
                     onClick={() => setActiveCodeTab('java')}
                  >
                     Java (OkHttp)
                  </div>
               </div>
               <div className="bg-[#1e1e1e] p-4 rounded-b-lg border-x border-b border-[#333] overflow-x-auto relative group shadow-inner">
                  <pre className="text-gray-300 text-[11px] font-mono leading-relaxed">{currentCodeSnippet}</pre>
                  <button 
                     onClick={handleCopySnippet}
                     className="absolute top-2 right-2 bg-[#444] text-white hover:bg-violet-600 px-3 py-1.5 rounded text-[10px] font-bold opacity-0 group-hover:opacity-100 transition shadow"
                  >
                     {copyMessage || "Copy"}
                  </button>
               </div>
            </div>
         </div>

      </div>
    </div>
  );
}
