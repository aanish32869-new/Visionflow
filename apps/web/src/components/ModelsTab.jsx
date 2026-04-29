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

function formatDate(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function ModelCard({ model, onDelete, onDownload, onDeploy }) {
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
          <div className="text-[16px] font-black text-gray-950">{metricValue(model.metrics?.mAP)}</div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-gray-400">mAP @.50</div>
        </div>
        <div className="rounded-2xl bg-gray-50/80 p-4 border border-gray-50">
          <div className="text-[16px] font-black text-gray-950">{metricValue(model.metrics?.precision)}</div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-gray-400">Precision</div>
        </div>
        <div className="rounded-2xl bg-gray-50/80 p-4 border border-gray-50">
          <div className="text-[16px] font-black text-gray-950">{metricValue(model.metrics?.recall)}</div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-gray-400">Recall</div>
        </div>
        <div className="rounded-2xl bg-gray-50/80 p-4 border border-gray-50">
          <div className="text-[16px] font-black text-gray-950">{metricValue(model.metrics?.speed_ms, " ms")}</div>
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
        
        <button 
          onClick={() => onDeploy(model)}
          className="w-full mt-4 py-3.5 bg-gray-950 text-white rounded-2xl text-[13px] font-black hover:bg-violet-600 transition-all flex items-center justify-center gap-2 shadow-lg shadow-gray-100 group-hover:shadow-violet-200"
        >
           Deploy Model <ArrowRight size={16} />
        </button>
      </div>
    </article>
  );
}

export default function ModelsTab({ projectId, onTrainModel }) {
  const [models, setModels] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState(null);

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

  const handleDelete = async (model) => {
    if (!window.confirm(`Are you sure you want to delete model "${model.name}"?`)) return;
    try {
      const res = await fetch(`/api/models/${model.model_id}`, { method: 'DELETE' });
      if (res.ok) {
        setModels(prev => prev.filter(m => m.model_id !== model.model_id));
        setFeedback({ type: 'success', message: 'Model deleted successfully.' });
      }
    } catch (e) {
      setFeedback({ type: 'error', message: 'Failed to delete model.' });
    }
  };

  const handleDownload = (model) => {
    window.open(`/api/models/${model.model_id}/weights`, '_blank');
  };

  const handleDeploy = (model) => {
    setFeedback({ type: 'success', message: `Deploying ${model.name} to edge inference server...` });
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
    const best = Math.max(...models.map(m => m.metrics?.mAP || 0));
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
              key={model.id} 
              model={model} 
              onDelete={handleDelete}
              onDownload={handleDownload}
              onDeploy={handleDeploy}
            />
          ))}
        </div>
      )}
    </div>
  );
}
