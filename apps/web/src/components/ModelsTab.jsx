import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Download,
  Gauge,
  Layers,
  Network,
  Search,
  Target,
  Trash2,
  Zap,
  ExternalLink,
  ChevronRight,
  Database,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Loader2
} from "lucide-react";

function metricValue(value, suffix = "") {
  if (value === null || value === undefined || value === "") return "N/A";
  if (typeof value === "number") {
    return `${value.toFixed(3)}${suffix}`;
  }
  return `${value}${suffix}`;
}

function asNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function resolveModelMetrics(model) {
  const m = model?.metrics || {};
  const map50 = asNumber(m.mAP, m.map50, m["metrics/mAP50(B)"], m.accuracy);
  const precision = asNumber(m.precision, m.mp, m["metrics/precision(B)"]);
  const recall = asNumber(m.recall, m.mr, m["metrics/recall(B)"]);
  const speedMs = asNumber(m.speed_ms, m.inference_ms, m.infer_speed_ms);
  return { map50, precision, recall, speedMs };
}

function formatDate(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function ModelCard({ model, onDelete, onDownload, onDeploy, onCheck }) {
  const resolved = resolveModelMetrics(model);
  const primaryMetricLabel = resolved.map50 !== null && model?.metrics?.mAP !== undefined ? "mAP @.50" : "Accuracy";
  return (
    <article className="group rounded-[32px] border border-gray-100 bg-white p-6 shadow-sm transition-all duration-300 hover:shadow-xl hover:shadow-violet-100/50 hover:border-violet-200">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex gap-4">
           <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm border ${
             model.architecture === 'yolov8n' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
             model.architecture === 'vit' ? 'bg-indigo-50 text-indigo-600 border-indigo-100' :
             'bg-violet-50 text-violet-600 border-violet-100'
           }`}>
             {model.architecture?.includes("yolo") ? <Target size={28} /> : <Gauge size={28} />}
           </div>
           <div>
              <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-gray-950 px-2.5 py-1 text-[9px] font-black text-white uppercase tracking-widest">
                 {model.architecture_label || "Model"}
              </div>
              <h3 className="text-[17px] font-black tracking-tight text-gray-950 leading-tight">{model.name}</h3>
              <p className="mt-1 text-[11px] font-bold text-gray-400 uppercase tracking-tighter">{formatDate(model.created_at)}</p>
           </div>
        </div>
        <div className="flex gap-1.5">
           <button 
             onClick={() => onDownload(model)}
             className="p-2.5 rounded-xl bg-gray-50 text-gray-400 hover:bg-violet-50 hover:text-violet-600 border border-transparent hover:border-violet-100 transition-all"
             title="Download Weights"
           >
             <Download size={18} />
           </button>
           <button 
             onClick={() => onDelete(model)}
             className="p-2.5 rounded-xl bg-gray-50 text-gray-400 hover:bg-rose-50 hover:text-rose-600 border border-transparent hover:border-rose-100 transition-all"
             title="Delete Model"
           >
             <Trash2 size={18} />
           </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-2xl bg-gray-50/80 p-4 border border-gray-50">
          <div className="text-[16px] font-black text-gray-950">{metricValue(resolved.map50)}</div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-gray-400">{primaryMetricLabel}</div>
        </div>
        <div className="rounded-2xl bg-gray-50/80 p-4 border border-gray-50">
          <div className="text-[16px] font-black text-gray-950">{metricValue(resolved.precision)}</div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-gray-400">Precision</div>
        </div>
        <div className="rounded-2xl bg-gray-50/80 p-4 border border-gray-50">
          <div className="text-[16px] font-black text-gray-950">{metricValue(resolved.recall)}</div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-gray-400">Recall</div>
        </div>
        <div className="rounded-2xl bg-gray-50/80 p-4 border border-gray-50">
          <div className="text-[16px] font-black text-gray-950">{metricValue(resolved.speedMs, " ms")}</div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-gray-400">Inf. Speed</div>
        </div>
      </div>

      <div className="space-y-3 pt-4 border-t border-gray-50">
        <div className="flex items-center justify-between px-1">
           <div className="flex items-center gap-2">
              <Database size={14} className="text-gray-400" />
              <span className="text-[12px] font-bold text-gray-500 uppercase tracking-tighter">Source Version</span>
           </div>
           <span className="text-[11px] font-black text-gray-950 bg-gray-100 px-2 py-0.5 rounded-md uppercase">
              {model.version_canonical_id || model.version_display_id || "V1"}
           </span>
        </div>
        
        <div className="grid grid-cols-2 gap-2 mt-4">
          <button 
            onClick={() => onCheck(model)}
            className="py-3.5 bg-white border border-gray-200 text-gray-900 rounded-2xl text-[13px] font-black hover:border-violet-300 hover:text-violet-700 transition-all flex items-center justify-center gap-2"
          >
             Check Model <ExternalLink size={14} />
          </button>
          <button 
            onClick={() => onDeploy(model)}
            className="py-3.5 bg-gray-950 text-white rounded-2xl text-[13px] font-black hover:bg-violet-600 transition-all flex items-center justify-center gap-2 shadow-lg shadow-gray-100 group-hover:shadow-violet-200"
          >
             Deploy Model <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </article>
  );
}

export default function ModelsTab({ projectId, onTrainModel }) {
  const [models, setModels] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [checkModel, setCheckModel] = useState(null);
  const [checkImage, setCheckImage] = useState(null);
  const [checkThreshold, setCheckThreshold] = useState(0.5);
  const [isChecking, setIsChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [modelToDelete, setModelToDelete] = useState(null);
  const [isDeletingModel, setIsDeletingModel] = useState(false);

  const fetchModels = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/models`);
      if (response.ok) {
        const data = await response.json();
        setModels(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const handleDelete = async () => {
    if (!modelToDelete?.model_id) return;
    setIsDeletingModel(true);
    try {
      const res = await fetch(`/api/models/${modelToDelete.model_id}`, { method: 'DELETE' });
      if (res.ok) {
        setModels(prev => prev.filter(m => m.model_id !== modelToDelete.model_id));
        setFeedback({ type: 'success', message: 'Model deleted successfully.' });
      }
    } catch (e) {
      setFeedback({ type: 'error', message: 'Failed to delete model.' });
    } finally {
      setIsDeletingModel(false);
      setModelToDelete(null);
    }
  };

  const handleDownload = (model) => {
    window.open(`/api/models/${model.model_id}/weights`, '_blank');
  };

  const handleDeploy = (model) => {
    const deploy = async () => {
      try {
        const projectsRes = await fetch("/api/projects");
        const projects = projectsRes.ok ? await projectsRes.json() : [];
        const project = Array.isArray(projects) ? projects.find((p) => String(p.id) === String(projectId)) : null;
        const m = model.metrics || {};
        const score = Number(m.mAP ?? m.accuracy ?? model.mAP ?? model.accuracy ?? 0);
        const boundedScore = Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
        const createRes = await fetch("/api/deployments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deployment_key: "hosted_api",
            name: `${model.name} Deployment`,
            project_id: String(projectId),
            project_name: project?.name || "Project",
            model_id: model.model_id || model.id,
            model_name: model.name,
            version_id: model.version_id,
            version_display_id: model.version_display_id || model.version_canonical_id || null,
            success_score: boundedScore,
            config: { confidence_threshold: 0.5 },
          }),
        });
        const deployment = await createRes.json().catch(() => ({}));
        if (!createRes.ok) throw new Error(deployment?.error || "Failed to create deployment");

        await fetch(`/api/deployments/${deployment.id}/activate`, { method: "POST" });
        await fetch(`/api/models/${model.model_id || model.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deployment_status: "deployed",
            deployment_id: deployment.id,
            api_key: deployment.api_key || null,
            success_score: boundedScore,
          }),
        });
        setFeedback({ type: "success", message: `${model.name} deployed successfully.` });
        fetchModels();
      } catch (e) {
        setFeedback({ type: "error", message: e.message || "Deployment failed." });
      }
    };
    deploy();
  };

  const handleCheck = (model) => {
    setCheckModel(model);
    setCheckImage(null);
    setCheckResult(null);
    setCheckThreshold(0.5);
  };

  const runModelCheck = async () => {
    if (!checkModel?.model_id || !checkImage) return;
    setIsChecking(true);
    try {
      const form = new FormData();
      form.append("file", checkImage);
      const response = await fetch(`/api/projects/${projectId}/models/${checkModel.model_id}/infer?conf=${checkThreshold}`, {
        method: "POST",
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Inference failed");
      const predictions = Array.isArray(data.predictions) ? data.predictions : [];
      const confs = predictions.map((p) => Number(p.confidence ?? 0)).filter((n) => Number.isFinite(n));
      const avgConfidence = confs.length ? (confs.reduce((a, b) => a + b, 0) / confs.length) : 0;
      setCheckResult({
        detections: predictions.length,
        avgConfidence,
        threshold: checkThreshold,
      });
    } catch (error) {
      setCheckResult({ error: error.message || "Check failed" });
    } finally {
      setIsChecking(false);
    }
  };

  const filteredModels = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return models;
    return models.filter((model) =>
      [model.name, model.architecture_label, model.version_canonical_id, model.version_display_id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [models, search]);

  const stats = useMemo(() => {
    if (!models.length) return { total: 0, bestMap: 0, ready: 0 };
    const best = Math.max(...models.map((m) => {
      const r = resolveModelMetrics(m);
      return r.map50 ?? 0;
    }));
    return {
      total: models.length,
      bestMap: best,
      ready: models.filter(m => m.deployment_status === 'ready').length
    };
  }, [models]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-violet-600" size={40} />
      </div>
    );
  }

  return (
    <div className="w-full animate-page-enter space-y-8 pb-20">
      {checkModel && (
        <section className="bg-white rounded-[32px] border border-gray-100 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-[18px] font-black text-gray-900">Check Model: {checkModel.name}</h2>
            <button className="text-sm font-black text-gray-500 hover:text-gray-800" onClick={() => setCheckModel(null)}>Close</button>
          </div>
          <div className="grid md:grid-cols-[1fr_auto] gap-4 items-end">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Threshold {(checkThreshold * 100).toFixed(0)}%</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={checkThreshold}
                onChange={(e) => setCheckThreshold(Number(e.target.value))}
                className="w-full mt-2 accent-violet-600"
              />
            </div>
            <div className="flex gap-2">
              <input type="file" accept="image/*" onChange={(e) => setCheckImage(e.target.files?.[0] || null)} className="text-xs font-bold" />
              <button
                onClick={runModelCheck}
                disabled={!checkImage || isChecking}
                className="px-4 py-2 bg-violet-600 text-white rounded-xl text-xs font-black disabled:opacity-50"
              >
                {isChecking ? "Checking..." : "Upload & Check"}
              </button>
            </div>
          </div>
          {checkResult && !checkResult.error && (
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-gray-100 p-3"><div className="text-xs text-gray-400 font-bold uppercase">Detections</div><div className="text-xl font-black">{checkResult.detections}</div></div>
              <div className="rounded-xl border border-gray-100 p-3"><div className="text-xs text-gray-400 font-bold uppercase">Avg Confidence</div><div className="text-xl font-black">{(checkResult.avgConfidence * 100).toFixed(1)}%</div></div>
              <div className="rounded-xl border border-gray-100 p-3"><div className="text-xs text-gray-400 font-bold uppercase">Threshold</div><div className="text-xl font-black">{(checkResult.threshold * 100).toFixed(0)}%</div></div>
            </div>
          )}
          {checkResult?.error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 p-3 text-sm font-bold">{checkResult.error}</div>
          )}
        </section>
      )}

      <header className="flex justify-between items-start">
        <div>
          <h1 className="text-[26px] font-black text-gray-900 tracking-tight">Model Registry</h1>
          <p className="text-[13px] font-semibold text-gray-400 mt-1 uppercase tracking-widest">Inventory & Deployment Hub</p>
        </div>
        <button
          type="button"
          onClick={onTrainModel}
          className="px-6 py-2.5 bg-violet-600 text-white rounded-xl text-[13px] font-bold shadow-lg shadow-violet-200 hover:bg-violet-700 transition flex items-center gap-2"
        >
          <Zap size={16} /> Train New Model
        </button>
      </header>

      {feedback && (
        <div className={`p-4 rounded-2xl border font-bold flex items-center gap-3 animate-in slide-in-from-top-2 ${feedback.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
          {feedback.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          {feedback.message}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="bg-white border border-gray-100 rounded-[24px] p-6 shadow-sm">
           <div className="text-[24px] font-black text-gray-950">{stats.total}</div>
           <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-1">Fine-tuned Models</div>
        </div>
        <div className="bg-white border border-gray-100 rounded-[24px] p-6 shadow-sm">
           <div className="text-[24px] font-black text-gray-950">{stats.bestMap.toFixed(3)}</div>
           <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-1">Peak mAP Achievement</div>
        </div>
        <div className="bg-white border border-gray-100 rounded-[24px] p-6 shadow-sm">
           <div className="text-[24px] font-black text-gray-950">{stats.ready}</div>
           <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-1">Edge Deployment Ready</div>
        </div>
      </div>

      <section className="bg-white rounded-[32px] border border-gray-100 p-6 shadow-sm flex flex-col md:flex-row justify-between gap-4 md:items-center">
         <div className="max-w-2xl">
            <h2 className="text-[18px] font-black text-gray-950">Model Inventory</h2>
            <p className="text-[12px] font-semibold text-gray-400">Search across architectures, versions, and training runs.</p>
         </div>
         <div className="relative w-full max-w-sm">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name or version..."
              className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-3 pl-11 pr-4 text-[13px] font-bold text-gray-800 outline-none transition focus:border-violet-300 focus:ring-4 focus:ring-violet-50"
            />
         </div>
      </section>

      {!filteredModels.length ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white rounded-[32px] border border-dashed border-gray-200">
           <div className="w-16 h-16 bg-gray-50 rounded-3xl flex items-center justify-center text-gray-300 mb-6">
              <Network size={32} />
           </div>
           <h3 className="text-[18px] font-black text-gray-900">No trained models found</h3>
           <p className="text-[13px] text-gray-400 font-bold max-w-xs text-center mt-2 leading-relaxed">
             Start a training job in the Train Tab to populate your project's model registry.
           </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {filteredModels.map((model) => (
            <ModelCard 
              key={model.model_id || model.id} 
              model={model} 
              onDelete={() => setModelToDelete(model)}
              onDownload={handleDownload}
              onDeploy={handleDeploy}
              onCheck={handleCheck}
            />
          ))}
        </div>
      )}

      {modelToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-gray-100">
            <h3 className="text-xl font-black text-gray-950">Delete Model?</h3>
            <p className="mt-2 text-sm font-semibold text-gray-600">
              Delete <span className="text-gray-900">"{modelToDelete.name}"</span> permanently?
            </p>
            <p className="mt-2 text-sm font-semibold text-gray-500">
              This removes it from the database and related deployment/inference records.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => !isDeletingModel && setModelToDelete(null)}
                disabled={isDeletingModel}
                className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-bold hover:bg-gray-50 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeletingModel}
                className="px-4 py-2.5 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 transition disabled:opacity-60"
              >
                {isDeletingModel ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
