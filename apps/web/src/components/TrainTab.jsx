import React, { useEffect, useMemo, useState } from "react";
import { Cpu, Monitor, Layers, Play, Loader2, CheckCircle2 } from "lucide-react";

const ARCHITECTURES = [
  {
    id: "vit",
    name: "Vision Transformer (ViT)",
    description: "High accuracy, transformer-based, slower training/inference.",
    sizes: ["tiny", "base", "large"],
    flow: "Image -> Patch Split -> Token Embedding -> Transformer Layers -> Classification Head",
    strengths: ["High accuracy", "Strong global context", "Scales well with data"],
    caveats: ["Slower training", "Needs more data"],
    defaults: { epochs: 80, batch: 16, image: 224, workers: 4 },
  },
  {
    id: "resnet",
    name: "ResNet",
    description: "Trains deep networks reliably using residual learning and skip connections. Excellent for transfer learning.",
    sizes: ["resnet18", "resnet34", "resnet50"],
    flow: "Input -> Initial Conv -> Residual Blocks -> Feature Extraction -> Downsampling -> GAP -> FC",
    strengths: ["Residual learning logic", "Identity skip connections", "Vanishing gradient prevention", "Stable deep optimization"],
    caveats: ["Requires bottleneck for >50 layers", "Fixed resolution input (224)"],
    defaults: { epochs: 50, batch: 32, image: 224, workers: 4 },
  },
  {
    id: "yolov8",
    name: "YOLOv8",
    description: "State-of-the-art object detection. Fast, accurate, and easy to use.",
    sizes: ["nano", "small", "medium"],
    flow: "Image -> Backbone -> Neck (FPN/PAN) -> Head (Detection)",
    strengths: ["SOTA Accuracy", "Extremely fast", "Real-time performance"],
    caveats: ["Primarily for detection", "Heavier than classification-only models"],
    defaults: { epochs: 50, batch: 16, image: 640, workers: 4 },
  },
  {
    id: "dinov3",
    name: "DINOv3",
    description: "Trains very quickly, Resolution-agnostic, Inference speed comparable to ViT, Accuracy varies dataset-to-dataset.",
    sizes: ["small", "base", "large"],
    flow: "Image -> Patch Embedding -> Transformer Encoder -> Feature Vector -> Classification Head",
    strengths: ["Trains very quickly", "Resolution-agnostic", "Inference speed comparable to ViT", "Accuracy varies dataset-to-dataset"],
    caveats: ["Heavier than ResNet", "Best results with pretraining"],
    defaults: { epochs: 60, batch: 16, image: 224, workers: 4 },
  },
];

function Step({ n, title, children }) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-5">
      <div className="text-[11px] font-black uppercase tracking-wider text-violet-600">Step {n}</div>
      <h3 className="text-lg font-black text-gray-900 mb-4">{title}</h3>
      {children}
    </section>
  );
}

export default function TrainTab({ projectId, onOpenModels }) {
  const [versions, setVersions] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  const [device, setDevice] = useState("auto");
  const [architecture, setArchitecture] = useState("dinov3");
  const [modelSize, setModelSize] = useState("base");
  const [versionId, setVersionId] = useState("");

  const [epochs, setEpochs] = useState("50");
  const [batchSize, setBatchSize] = useState("16");
  const [imageSize, setImageSize] = useState("224");
  const [workers, setWorkers] = useState("4");

  const currentArch = useMemo(() => ARCHITECTURES.find((a) => a.id === architecture) || ARCHITECTURES[0], [architecture]);

  const safeJson = async (res) => {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { error: text };
    }
  };

  useEffect(() => {
    if (!currentArch.sizes.includes(modelSize)) {
      setModelSize(currentArch.sizes[0]);
    }
  }, [currentArch, modelSize]);

  useEffect(() => {
    setEpochs(String(currentArch.defaults.epochs));
    setBatchSize(String(currentArch.defaults.batch));
    setImageSize(String(currentArch.defaults.image));
    setWorkers(String(currentArch.defaults.workers));
  }, [architecture]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [vRes, jRes, pRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/versions`),
          fetch(`/api/projects/${projectId}/jobs`),
          fetch(`/api/projects/${projectId}`),
        ]);
        const v = vRes.ok ? await safeJson(vRes) : [];
        const j = jRes.ok ? await safeJson(jRes) : [];
        const p = pRes.ok ? await safeJson(pRes) : {};
        
        setProject(p);
        setVersions(Array.isArray(v) ? v : []);
        setJobs(Array.isArray(j) ? j : []);
        if (!versionId && v?.length) setVersionId(v[0].version_id);
        
      } catch {
        setMessage({ type: "error", text: "Failed to load train workspace." });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [projectId]);

  const startTraining = async () => {
    if (!versionId) {
      setMessage({ type: "error", text: "Please select a dataset version." });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const precheck = await fetch(`/api/projects/${projectId}/train/precheck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version_id: versionId, architecture, model_size: modelSize }),
      });
      const pre = await safeJson(precheck);
      if (!precheck.ok || pre.ok === false) {
        throw new Error(pre?.issues?.[0] || pre?.error || "Training precheck failed.");
      }

      const res = await fetch(`/api/projects/${projectId}/train`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version_id: versionId,
          architecture,
          model_size: modelSize,
          params: {
            epochs: Number(epochs),
            batch_size: Number(batchSize),
            img_size: Number(imageSize),
            workers: Number(workers),
            device,
            training_mode: "local",
          },
        }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || "Failed to start training");
      setMessage({ type: "success", text: `Training started. Job: ${data.job_id?.slice(0, 8) || "created"}` });
      const jRes = await fetch(`/api/projects/${projectId}/jobs`);
      if (jRes.ok) setJobs(await safeJson(jRes));
    } catch (e) {
      setMessage({ type: "error", text: e.message || "Failed to start training." });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="p-8 font-bold text-gray-500">Loading Train workspace...</div>;
  }

  return (
    <div className="space-y-6">

      {message && (
        <div className={`rounded-xl border px-4 py-3 text-sm font-bold ${message.type === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {message.text}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Step n={1} title="Select Engine">
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setDevice("cpu")} className={`p-3 rounded-xl border font-bold text-sm ${device === "cpu" ? "border-violet-500 bg-violet-50" : "border-gray-200"}`}><Cpu className="inline mr-2" size={16} />CPU</button>
            <button onClick={() => setDevice("gpu")} className={`p-3 rounded-xl border font-bold text-sm ${device === "gpu" ? "border-violet-500 bg-violet-50" : "border-gray-200"}`}><Monitor className="inline mr-2" size={16} />GPU</button>
          </div>
        </Step>

        <Step n={2} title="Select Architecture">
          <div className="space-y-2">
            {ARCHITECTURES.map((a) => (
              <button 
                key={a.id} 
                onClick={() => setArchitecture(a.id)} 
                className={`w-full text-left p-3 rounded-xl border transition ${
                  architecture === a.id 
                    ? "border-violet-500 bg-violet-50" 
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="flex justify-between items-center">
                  <div className="font-black text-sm text-gray-900">{a.name}</div>
                  {a.id === "yolov8" ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-700 uppercase">Detection</span>
                  ) : a.id === "dinov3" ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-100 text-purple-700 uppercase">Foundation</span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 uppercase">Classification</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1">{a.description}</div>
              </button>
            ))}
          </div>
        </Step>

        <Step n={3} title="Select Model Size">
          <div className="grid grid-cols-3 gap-2">
            {currentArch.sizes.map((s) => (
              <button key={s} onClick={() => setModelSize(s)} className={`p-3 rounded-xl border font-bold text-xs uppercase ${modelSize === s ? "border-violet-500 bg-violet-50" : "border-gray-200"}`}>{s}</button>
            ))}
          </div>
        </Step>

        <Step n={4} title="Select Dataset Version">
          <select value={versionId} onChange={(e) => setVersionId(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-3 font-bold text-sm">
            <option value="">Select version</option>
            {versions.map((v) => (
              <option key={v.version_id} value={v.version_id}>{v.display_id || v.version_id} - {v.name}</option>
            ))}
          </select>
        </Step>

        <Step n={5} title="Configure Training">
          <div className="grid grid-cols-2 gap-3">
            <div className="relative group">
              <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">Epochs</label>
              <div className="flex items-center border border-gray-200 rounded-xl px-3 py-2 bg-gray-50/30 focus-within:border-violet-500 focus-within:ring-1 focus-within:ring-violet-500 transition-all">
                <input 
                  type="number"
                  value={epochs} 
                  onChange={(e) => setEpochs(e.target.value)} 
                  className="bg-transparent w-full font-black text-gray-900 outline-none text-sm" 
                />
                <span className="text-[9px] font-bold text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded border border-violet-100">Ref: {currentArch.defaults.epochs}</span>
              </div>
            </div>
            <div className="relative group">
              <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">Batch Size</label>
              <div className="flex items-center border border-gray-200 rounded-xl px-3 py-2 bg-gray-50/30 focus-within:border-violet-500 focus-within:ring-1 focus-within:ring-violet-500 transition-all">
                <input 
                  type="number"
                  value={batchSize} 
                  onChange={(e) => setBatchSize(e.target.value)} 
                  className="bg-transparent w-full font-black text-gray-900 outline-none text-sm" 
                />
                <span className="text-[9px] font-bold text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded border border-violet-100">Ref: {currentArch.defaults.batch}</span>
              </div>
            </div>
            <div className="relative group">
              <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">Image Size</label>
              <div className="flex items-center border border-gray-200 rounded-xl px-3 py-2 bg-gray-50/30 focus-within:border-violet-500 focus-within:ring-1 focus-within:ring-violet-500 transition-all">
                <input 
                  type="number"
                  value={imageSize} 
                  onChange={(e) => setImageSize(e.target.value)} 
                  className="bg-transparent w-full font-black text-gray-900 outline-none text-sm" 
                />
                <span className="text-[9px] font-bold text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded border border-violet-100">Ref: {currentArch.defaults.image}</span>
              </div>
            </div>
            <div className="relative group">
              <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">Workers</label>
              <div className="flex items-center border border-gray-200 rounded-xl px-3 py-2 bg-gray-50/30 focus-within:border-violet-500 focus-within:ring-1 focus-within:ring-violet-500 transition-all">
                <input 
                  type="number"
                  value={workers} 
                  onChange={(e) => setWorkers(e.target.value)} 
                  className="bg-transparent w-full font-black text-gray-900 outline-none text-sm" 
                />
                <span className="text-[9px] font-bold text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded border border-violet-100">Ref: {currentArch.defaults.workers}</span>
              </div>
            </div>
          </div>
        </Step>

        <Step n={6} title="Start Training">
          <button onClick={startTraining} disabled={submitting} className="w-full px-4 py-3 rounded-xl bg-violet-600 text-white font-black text-sm hover:bg-violet-700 disabled:opacity-50">
            {submitting ? <><Loader2 size={16} className="inline mr-2 animate-spin" />Starting...</> : <><Play size={16} className="inline mr-2" />Start Training</>}
          </button>
        </Step>
      </div>

      <section className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="text-lg font-black text-gray-900 mb-3">Model Details</h3>
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="lg:col-span-2 rounded-xl border border-gray-100 p-4 bg-gray-50/60">
            <div className="text-[10px] font-black uppercase tracking-widest text-violet-600 mb-2">Selected Architecture</div>
            <div className="text-base font-black text-gray-900">{currentArch.name} ({modelSize})</div>
            <p className="text-sm text-gray-600 mt-2">{currentArch.description}</p>
            <p className="text-xs text-gray-500 mt-3 font-medium border-l-2 border-violet-200 pl-3 py-1 bg-white/50 rounded-r-lg italic">
              Pipeline: {currentArch.flow}
            </p>
            
            <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-100">
              <div>
                <div className="text-[10px] font-black uppercase text-emerald-600 mb-2">Strengths</div>
                <ul className="space-y-1">
                  {currentArch.strengths.map(s => (
                    <li key={s} className="text-[11px] font-bold text-gray-700 flex items-center">
                      <div className="w-1 h-1 bg-emerald-500 rounded-full mr-2" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase text-amber-600 mb-2">Caveats</div>
                <ul className="space-y-1">
                  {currentArch.caveats.map(c => (
                    <li key={c} className="text-[11px] font-bold text-gray-700 flex items-center">
                      <div className="w-1 h-1 bg-amber-500 rounded-full mr-2" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-black text-gray-900">Recent Training Jobs</h3>
          <button
            type="button"
            onClick={() => onOpenModels?.()}
            className="text-xs font-black text-violet-700 hover:text-violet-800"
          >
            Open Models Tab
          </button>
        </div>
        {jobs.length === 0 ? <p className="text-sm text-gray-500">No jobs yet.</p> : (
          <div className="space-y-2">
            {jobs.map((j) => (
              <div key={j.id || j.job_id} className="border border-gray-100 rounded-xl px-3 py-2 flex items-center justify-between">
                <div>
                  <div className="font-black text-sm text-gray-900">{j.architecture_label || j.architecture}</div>
                  <div className="text-xs text-gray-500">Job {j.job_id?.slice(0, 8) || "created"} • {j.version_id?.slice(0, 8)}</div>
                </div>
                <div className="text-xs font-bold text-gray-600">{j.status} {j.status === "Completed" && <CheckCircle2 size={14} className="inline ml-1 text-emerald-500" />}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
