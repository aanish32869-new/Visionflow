import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Gauge,
  Layers,
  Network,
  Search,
  Target,
  Zap,
} from "lucide-react";


function metricValue(value, suffix = "") {
  if (value === null || value === undefined || value === "") return "Not available";
  if (typeof value === "number") {
    return `${value}${suffix}`;
  }
  return `${value}${suffix}`;
}

function formatDate(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function readApiPayload(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return await response.json();
  }

  const text = (await response.text()).trim();
  if (text.startsWith("<!doctype")) {
    throw new Error("The inference service returned an HTML error page. Restart the inference service on port 5006 to load models.");
  }

  throw new Error(text || "Could not load models.");
}

function ModelCard({ model }) {
  return (
    <article className="rounded-[30px] border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-lg hover:shadow-violet-100/50">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-700 ring-1 ring-violet-100">
            <Network size={13} /> {model.status || "Ready"}
          </div>
          <h3 className="text-lg font-black tracking-tight text-gray-950">{model.name}</h3>
          <p className="mt-1 text-xs font-semibold text-gray-500">{formatDate(model.created_at)}</p>
        </div>
        <div className="rounded-2xl bg-gray-950 p-2.5 text-white">
          {model.architecture === "rf-detr" ? <Target size={18} /> : <Gauge size={18} />}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-gray-50 p-3">
          <div className="text-sm font-black text-gray-950">{metricValue(model.metrics?.mAP)}</div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">mAP</div>
        </div>
        <div className="rounded-2xl bg-gray-50 p-3">
          <div className="text-sm font-black text-gray-950">{metricValue(model.metrics?.precision)}</div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">Precision</div>
        </div>
        <div className="rounded-2xl bg-gray-50 p-3">
          <div className="text-sm font-black text-gray-950">{metricValue(model.metrics?.recall)}</div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">Recall</div>
        </div>
        <div className="rounded-2xl bg-gray-50 p-3">
          <div className="text-sm font-black text-gray-950">{metricValue(model.metrics?.speed_ms, "ms")}</div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">Speed</div>
        </div>
      </div>

      <div className="mt-4 space-y-3 text-sm font-semibold text-gray-600">
        <div className="rounded-2xl bg-gray-50 p-3">
          <span className="block text-gray-500">Version</span>
          <span className="mt-1 block font-black text-gray-950">{model.version_canonical_id || model.version_display_id}</span>
        </div>
        <div className="flex justify-between rounded-2xl bg-gray-50 p-3">
          <span>Architecture</span>
          <span className="font-black text-gray-950">{model.architecture_label}</span>
        </div>
        <div className="flex justify-between rounded-2xl bg-gray-50 p-3">
          <span>Model size</span>
          <span className="font-black text-gray-950">{String(model.model_size || "small").replace(/^./, (value) => value.toUpperCase())}</span>
        </div>
        <div className="rounded-2xl bg-gray-50 p-3">
          <span className="block text-gray-500">Checkpoint</span>
          <span className="mt-1 block font-black text-gray-950">{model.checkpoint || "Scratch"}</span>
        </div>
      </div>
    </article>
  );
}

export default function ModelsTab({ projectId, onTrainModel }) {
  const [models, setModels] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchModels = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/models`);
      const data = response.ok ? await readApiPayload(response) : [];
      setModels(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setModels([]);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    fetchModels();
  }, [fetchModels, projectId]);

  const filteredModels = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return models;
    return models.filter((model) =>
      [
        model.name,
        model.architecture_label,
        model.version_canonical_id,
        model.version_display_id,
        model.checkpoint,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [models, search]);

  const bestMap = useMemo(() => {
    if (!models.length) return null;
    return models.reduce((best, model) => {
      const current = Number(model.metrics?.mAP || 0);
      return current > Number(best?.metrics?.mAP || 0) ? model : best;
    }, models[0]);
  }, [models]);

  return (
    <div className="w-full animate-page-enter space-y-6 pb-10">
      <section className="overflow-hidden rounded-[32px] border border-gray-200 bg-gradient-to-br from-white via-white to-violet-50/70 p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-100 bg-white px-3 py-1 text-xs font-black text-violet-700 shadow-sm">
              <Network size={14} /> Trained Models
            </div>
            <h1 className="text-3xl font-black tracking-tight text-gray-950">Version-linked model registry</h1>
            <p className="mt-2 text-base font-semibold text-gray-500">
              Every training run stays pinned to the version it came from, so you can compare results without your dataset moving underneath the model.
            </p>
          </div>
          <button
            type="button"
            onClick={onTrainModel}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-violet-200 transition hover:bg-violet-700"
          >
            <Zap size={16} /> Train Model
          </button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-2xl font-black text-gray-950">{models.length}</div>
            <div className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Fine-tuned Models</div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-2xl font-black text-gray-950">{bestMap ? metricValue(bestMap.metrics?.mAP) : "Not available"}</div>
            <div className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Best mAP</div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-2xl font-black text-gray-950">{models.filter((model) => model.deployment_status === "deployed").length}</div>
            <div className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Deploy-ready</div>
          </div>
        </div>
      </section>

      <section className="rounded-[32px] border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <h2 className="text-xl font-black text-gray-950">Model inventory</h2>
            <p className="mt-1 text-sm font-semibold text-gray-500">Search across architectures, versions, and checkpoints.</p>
          </div>
          <label className="relative block w-full max-w-sm">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search models..."
              className="w-full rounded-2xl border border-gray-200 py-3 pl-11 pr-4 text-sm font-semibold text-gray-800 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
            />
          </label>
        </div>
      </section>

      {isLoading ? (
        <div className="grid gap-5 xl:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-80 animate-pulse rounded-[30px] border border-gray-200 bg-gray-50" />
          ))}
        </div>
      ) : !filteredModels.length ? (
        <section className="flex min-h-[360px] flex-col items-center justify-center rounded-[32px] border border-dashed border-gray-300 bg-white p-10 text-center shadow-sm">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-violet-50 text-violet-700 ring-1 ring-violet-100">
            <Activity size={28} />
          </div>
          <h2 className="text-2xl font-black text-gray-950">No trained models yet</h2>
          <p className="mt-2 max-w-lg text-sm font-semibold leading-6 text-gray-500">
            Start a custom training run from a generated version and your trained models will appear here with mAP, precision, recall, and deployment details.
          </p>
          <button
            type="button"
            onClick={onTrainModel}
            className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-violet-200 transition hover:bg-violet-700"
          >
            <Zap size={16} /> Train a Model
          </button>
        </section>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {filteredModels.map((model) => (
            <ModelCard key={model.id} model={model} />
          ))}
        </div>
      )}

      {!!bestMap && (
        <section className="rounded-[32px] border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">
            <Layers size={14} /> Best Current Run
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="text-xs font-black uppercase tracking-widest text-gray-400">Model</div>
              <div className="mt-2 font-black text-gray-950">{bestMap.name}</div>
            </div>
            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="text-xs font-black uppercase tracking-widest text-gray-400">mAP</div>
              <div className="mt-2 font-black text-gray-950">{metricValue(bestMap.metrics?.mAP)}</div>
            </div>
            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="text-xs font-black uppercase tracking-widest text-gray-400">Architecture</div>
              <div className="mt-2 font-black text-gray-950">{bestMap.architecture_label}</div>
            </div>
            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="text-xs font-black uppercase tracking-widest text-gray-400">Version</div>
              <div className="mt-2 font-black text-gray-950">{bestMap.version_canonical_id || bestMap.version_display_id}</div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
