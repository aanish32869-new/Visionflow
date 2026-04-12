import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  Gauge,
  Layers,
  Loader2,
  RefreshCcw,
  Share2,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";


const ARCHITECTURES = [
  {
    id: "rf-detr",
    name: "RF-DETR",
    accent: "text-emerald-700 bg-emerald-50 border-emerald-200",
    summary: "Higher accuracy and a stronger choice when quality matters most.",
    bullets: ["Best for accuracy-first training", "Great for hard detection cases", "Slightly slower inference"],
    defaultSize: "medium",
  },
  {
    id: "yolo11",
    name: "YOLOv11",
    accent: "text-violet-700 bg-violet-50 border-violet-200",
    summary: "Faster iteration loops and lighter deployment for real-time workflows.",
    bullets: ["Best for speed and iteration", "Fast deploy and easy testing", "Strong default for most projects"],
    defaultSize: "small",
  },
];

const MODEL_SIZE_OPTIONS = [
  { value: "nano", label: "Nano" },
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "xlarge", label: "XLarge" },
];


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

async function readApiPayload(response, fallbackMessage) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || fallbackMessage);
    }
    return data;
  }

  const text = (await response.text()).trim();
  if (!response.ok && text.startsWith("<!doctype")) {
    throw new Error("The inference service returned an HTML error page. Restart the inference service on port 5006 and try Custom Train again.");
  }

  throw new Error(text || fallbackMessage);
}

function VersionOption({ version, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-3xl border p-4 text-left transition ${
        selected
          ? "border-violet-300 bg-violet-50/60 shadow-sm shadow-violet-100"
          : "border-gray-200 bg-white hover:border-violet-200 hover:shadow-sm"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex rounded-full bg-gray-950 px-2.5 py-1 text-[11px] font-black text-white">
            {version.display_id}
          </div>
          <h3 className="text-base font-black text-gray-950">{version.name}</h3>
          <p className="mt-1 text-xs font-semibold text-violet-600">{version.canonical_id}</p>
        </div>
        {selected && <CheckCircle2 size={18} className="text-violet-600" />}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-2xl bg-white/80 p-3">
          <div className="font-black text-gray-950">{version.images_count || 0}</div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">Images</div>
        </div>
        <div className="rounded-2xl bg-white/80 p-3">
          <div className="font-black text-gray-950">{version.annotations_count || 0}</div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">Labels</div>
        </div>
        <div className="rounded-2xl bg-white/80 p-3">
          <div className="font-black text-gray-950">{version.max_version_size || 1}x</div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">Version Size</div>
        </div>
      </div>
      <p className="mt-4 text-xs font-semibold text-gray-500">{formatDate(version.created_at)}</p>
    </button>
  );
}

function ArchitectureCard({ architecture, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(architecture.id)}
      className={`w-full rounded-3xl border p-5 text-left transition ${
        selected
          ? "border-violet-300 bg-violet-50/50 shadow-sm shadow-violet-100"
          : "border-gray-200 bg-white hover:border-violet-200 hover:shadow-sm"
      }`}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black ${architecture.accent}`}>
            {architecture.id === "rf-detr" ? <Target size={13} /> : <Gauge size={13} />}
            {architecture.name}
          </div>
          <p className="mt-3 text-sm font-semibold leading-6 text-gray-600">{architecture.summary}</p>
        </div>
        {selected && <CheckCircle2 size={18} className="text-violet-600" />}
      </div>
      <div className="space-y-2">
        {architecture.bullets.map((bullet) => (
          <div key={bullet} className="text-sm font-semibold text-gray-700">
            {bullet}
          </div>
        ))}
      </div>
    </button>
  );
}

export default function TrainTab({ projectId, onOpenVersions, onOpenModels }) {
  const [versions, setVersions] = useState([]);
  const [models, setModels] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [selectedArchitecture, setSelectedArchitecture] = useState("rf-detr");
  const [modelSize, setModelSize] = useState("medium");
  const [checkpointModelId, setCheckpointModelId] = useState("");
  const [checkpointText, setCheckpointText] = useState("");

  const selectedVersion = useMemo(
    () => versions.find((version) => String(version.id) === String(selectedVersionId)) || versions[0],
    [versions, selectedVersionId],
  );

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [versionsRes, modelsRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/versions`),
        fetch(`/api/projects/${projectId}/models`),
      ]);

      const versionsData = versionsRes.ok ? await versionsRes.json() : [];
      const modelsData = modelsRes.ok ? await readApiPayload(modelsRes, "Could not load saved models.") : [];

      setVersions(Array.isArray(versionsData) ? versionsData : []);
      setModels(Array.isArray(modelsData) ? modelsData : []);
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Could not load the training configuration." });
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    loadData();
  }, [loadData, projectId]);

  useEffect(() => {
    if (!versions.length) return;
    const storedVersion = JSON.parse(localStorage.getItem("visionflow_selected_version") || "null");
    const storedId = storedVersion?.id;
    const matchingVersion = versions.find((version) => String(version.id) === String(storedId));
    const nextVersion = matchingVersion || versions[0];
    setSelectedVersionId(nextVersion.id);
  }, [versions]);

  useEffect(() => {
    const architecture = ARCHITECTURES.find((item) => item.id === selectedArchitecture);
    if (architecture && !modelSize) {
      setModelSize(architecture.defaultSize);
    }
  }, [modelSize, selectedArchitecture]);

  const handleArchitectureSelect = (architectureId) => {
    setSelectedArchitecture(architectureId);
    const architecture = ARCHITECTURES.find((item) => item.id === architectureId);
    if (architecture) {
      setModelSize(architecture.defaultSize);
    }
  };

  const handleTrain = async () => {
    if (!selectedVersion) {
      setFeedback({ type: "error", message: "Generate a dataset version before starting training." });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version_id: selectedVersion.id,
          architecture: selectedArchitecture,
          model_size: modelSize,
          checkpoint_model_id: checkpointModelId || undefined,
          checkpoint: checkpointText.trim() || undefined,
          training_mode: "custom",
        }),
      });

      const data = await readApiPayload(response, "Training could not be started.");

      localStorage.setItem("visionflow_selected_version", JSON.stringify(selectedVersion));
      localStorage.setItem("visionflow_selected_model", JSON.stringify(data));
      setFeedback({
        type: "success",
        message: `${data.name} is ready and linked to ${selectedVersion.canonical_id || selectedVersion.display_id}.`,
      });
      await loadData();
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: error.message || "Training could not be started." });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="h-[520px] animate-pulse rounded-[32px] border border-gray-200 bg-gray-50" />
        <div className="h-[520px] animate-pulse rounded-[32px] border border-gray-200 bg-gray-50" />
      </div>
    );
  }

  if (!versions.length) {
    return (
      <section className="flex min-h-[420px] flex-col items-center justify-center rounded-[32px] border border-dashed border-gray-300 bg-white p-10 text-center shadow-sm">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-violet-50 text-violet-700 ring-1 ring-violet-100">
          <Layers size={28} />
        </div>
        <h2 className="text-2xl font-black text-gray-950">Generate a version before training</h2>
        <p className="mt-2 max-w-xl text-sm font-semibold leading-6 text-gray-500">
          Training is permanently linked to a frozen dataset version, so create a version first and then come back here for custom training.
        </p>
        <button
          type="button"
          onClick={onOpenVersions}
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-violet-200 transition hover:bg-violet-700"
        >
          <Layers size={16} /> Open Versions
        </button>
      </section>
    );
  }

  return (
    <div className="w-full animate-page-enter space-y-6 pb-10">
      <section className="overflow-hidden rounded-[32px] border border-gray-200 bg-gradient-to-br from-white via-white to-violet-50/70 p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-100 bg-white px-3 py-1 text-xs font-black text-violet-700 shadow-sm">
              <Share2 size={14} /> Custom Train
            </div>
            <h1 className="text-3xl font-black tracking-tight text-gray-950">Train on a frozen version</h1>
            <p className="mt-2 text-base font-semibold text-gray-500">
              Pick a version, choose the architecture and size you want, and optionally warm-start from a checkpoint for faster transfer learning.
            </p>
          </div>
          <button
            type="button"
            onClick={handleTrain}
            disabled={isSubmitting || !selectedVersion}
            className="inline-flex min-w-[170px] items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-violet-200 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            {isSubmitting ? "Training..." : "Custom Train"}
          </button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-2xl font-black text-gray-950">{versions.length}</div>
            <div className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Available Versions</div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-2xl font-black text-gray-950">{models.length}</div>
            <div className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Previous Models</div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-2xl font-black text-gray-950">{selectedVersion?.display_id || "v1"}</div>
            <div className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Active Training Version</div>
          </div>
        </div>
      </section>

      {feedback && (
        <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-bold ${
          feedback.type === "success"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-red-200 bg-red-50 text-red-700"
        }`}>
          {feedback.type === "success" ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
          {feedback.message}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-[32px] border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-700 ring-1 ring-violet-100">
                <Layers size={14} /> Version Selection
              </div>
              <h2 className="text-xl font-black text-gray-950">Choose the dataset version to train</h2>
            </div>
          </div>
          <div className="space-y-4">
            {versions.map((version) => (
              <VersionOption
                key={version.id}
                version={version}
                selected={String(version.id) === String(selectedVersion?.id)}
                onClick={() => {
                  setSelectedVersionId(version.id);
                  localStorage.setItem("visionflow_selected_version", JSON.stringify(version));
                }}
              />
            ))}
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-[32px] border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">
              <Sparkles size={14} /> Instant Training Logic
            </div>
            <p className="text-sm font-semibold leading-6 text-gray-600">
              Roboflow-style instant training belongs in the background annotation flow. For now, this project uses a manual Custom Train step that still stays permanently tied to the selected version.
            </p>
          </section>

          <section className="rounded-[32px] border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-violet-600">
              <Boxes size={14} /> Selected Version Summary
            </div>
            <div className="space-y-3 text-sm font-semibold text-gray-600">
              <div className="rounded-2xl bg-gray-50 p-3">
                <span className="block text-gray-500">Frozen ID</span>
                <span className="mt-1 block font-black text-gray-950">{selectedVersion?.canonical_id}</span>
              </div>
              <div className="rounded-2xl bg-gray-50 p-3">
                <span className="block text-gray-500">Preprocessing</span>
                <span className="mt-1 block font-black text-gray-950">{selectedVersion?.preprocessing?.resize || "Original"}</span>
              </div>
              <div className="rounded-2xl bg-gray-50 p-3">
                <span className="block text-gray-500">Created</span>
                <span className="mt-1 block font-black text-gray-950">{formatDate(selectedVersion?.created_at)}</span>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-[32px] border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-700 ring-1 ring-violet-100">
              <Target size={14} /> Architecture
            </div>
            <h2 className="text-xl font-black text-gray-950">Select model architecture</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {ARCHITECTURES.map((architecture) => (
              <ArchitectureCard
                key={architecture.id}
                architecture={architecture}
                selected={selectedArchitecture === architecture.id}
                onSelect={handleArchitectureSelect}
              />
            ))}
          </div>
        </section>

        <section className="rounded-[32px] border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-700 ring-1 ring-violet-100">
              <RefreshCcw size={14} /> Checkpoints
            </div>
            <h2 className="text-xl font-black text-gray-950">Warm-start this training run</h2>
          </div>

          <label className="mb-4 block">
            <span className="mb-2 block text-xs font-black uppercase tracking-widest text-gray-400">Model size</span>
            <select
              value={modelSize}
              onChange={(event) => setModelSize(event.target.value)}
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-800 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
            >
              {MODEL_SIZE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="mb-4 block">
            <span className="mb-2 block text-xs font-black uppercase tracking-widest text-gray-400">Checkpoint from this project</span>
            <select
              value={checkpointModelId}
              onChange={(event) => setCheckpointModelId(event.target.value)}
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-800 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
            >
              <option value="">Start from scratch</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-black uppercase tracking-widest text-gray-400">External checkpoint</span>
            <input
              value={checkpointText}
              onChange={(event) => setCheckpointText(event.target.value)}
              placeholder="Optional custom weights or Universe checkpoint name"
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-800 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
            />
          </label>

          <button
            type="button"
            onClick={handleTrain}
            disabled={isSubmitting || !selectedVersion}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gray-950 px-5 py-3 text-sm font-black text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            {isSubmitting ? "Training..." : "Start Custom Train"}
          </button>

          <button
            type="button"
            onClick={onOpenModels}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-black text-gray-700 transition hover:border-violet-200 hover:text-violet-700"
          >
            <Boxes size={16} /> View Trained Models
          </button>
        </section>
      </div>
    </div>
  );
}
