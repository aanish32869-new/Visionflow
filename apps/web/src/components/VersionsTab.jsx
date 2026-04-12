/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileArchive,
  GitBranch,
  GitCompare,
  Image as ImageIcon,
  Layers,
  Loader2,
  Package,
  Plus,
  Settings2,
  Sparkles,
  Tags,
  X,
  Zap,
} from "lucide-react";

const DEFAULT_FORM = {
  name: "",
  exportFormat: "yolov8",
  autoOrient: true,
  grayscale: false,
  resizeEnabled: true,
  resizeWidth: 640,
  resizeHeight: 640,
  resizeMode: "stretch",
  maxVersionSize: 3,
  requireTags: [],
  allowTags: [],
  excludeTags: [],
  augmentations: {
    horizontal_flip: true,
    rotate: false,
    brightness: false,
    blur: false,
    noise: false,
  },
  split: { train: 70, valid: 20, test: 10 },
};

const STATUS_STYLES = {
  Ready: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Training: "bg-amber-50 text-amber-700 ring-amber-200",
  Completed: "bg-blue-50 text-blue-700 ring-blue-200",
};

function versionKey(version) {
  return String(version.id || version.version_id || version.display_id);
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

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatPreprocessing(version) {
  const preprocessing = version.preprocessing || {};
  const resize = preprocessing.resize || "Original";
  const mode = preprocessing.mode && preprocessing.mode !== "none" ? preprocessing.mode : null;
  const flags = [];
  if (preprocessing.auto_orient !== false) flags.push("auto orient");
  if (preprocessing.grayscale) flags.push("grayscale");
  return `${resize}${mode ? `, ${mode}` : ""} | ${flags.join(", ") || "color"}`;
}

function formatAugmentations(version) {
  const enabled = Array.isArray(version.augmentations) && version.augmentations.length
    ? version.augmentations
    : [];
  const maxVersionSize = version.max_version_size || version.augmentation_config?.max_version_size || 1;
  const label = enabled.length
    ? enabled.map((item) => item.replace(/_/g, " ")).join(", ")
    : "No augmentations";
  return `${label} | up to ${maxVersionSize}x`;
}

function formatTagFilter(version) {
  const tagFilter = version.tag_filter || {};
  const parts = [];
  if (tagFilter.require?.length) parts.push(`Require: ${tagFilter.require.join(", ")}`);
  if (tagFilter.allow?.length) parts.push(`Allow: ${tagFilter.allow.join(", ")}`);
  if (tagFilter.exclude?.length) parts.push(`Exclude: ${tagFilter.exclude.join(", ")}`);
  return parts.join(" | ") || "All tagged and untagged images";
}

function splitLabel(split = {}) {
  return `${split.train ?? 70}/${split.valid ?? split.val ?? 20}/${split.test ?? 10}`;
}

function metricValue(value) {
  if (value === null || value === undefined || value === "") return "Not available";
  return value;
}

function compareDelta(a, b) {
  const diff = Number(b || 0) - Number(a || 0);
  if (!diff) return "No change";
  return `${diff > 0 ? "+" : ""}${formatNumber(diff)}`;
}

function TogglePill({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-bold capitalize transition ${
        active
          ? "border-violet-200 bg-violet-50 text-violet-700 shadow-sm"
          : "border-gray-200 bg-white text-gray-500 hover:border-violet-200 hover:text-violet-700"
      }`}
    >
      {label.replace(/_/g, " ")}
    </button>
  );
}

function StatTile({ icon, label, value }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-gray-50 text-violet-600">
        {icon}
      </div>
      <div className="text-2xl font-black text-gray-950">{value}</div>
      <div className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-gray-400">{label}</div>
    </div>
  );
}

function VersionCard({ version, selected, onView, onTrain, onCompare }) {
  const status = version.status || "Ready";
  const split = version.split || {};

  return (
    <article
      className={`group rounded-3xl border bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-xl hover:shadow-violet-100/60 ${
        selected ? "border-violet-300 ring-2 ring-violet-100" : "border-gray-200"
      }`}
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-xl bg-gray-950 px-2.5 py-1 text-xs font-black text-white shadow-sm">
              {version.display_id || "v1"}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ring-1 ${STATUS_STYLES[status] || STATUS_STYLES.Ready}`}>
              {status}
            </span>
          </div>
          <h3 className="text-lg font-black tracking-tight text-gray-950">{version.name || "Dataset Version"}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-gray-500">
            <Clock size={13} /> {formatDate(version.created_at)}
          </p>
          <p className="mt-1 text-xs font-semibold text-violet-600">{version.canonical_id || "project/1"}</p>
        </div>
        <div className="rounded-2xl bg-violet-50 p-2.5 text-violet-700 ring-1 ring-violet-100">
          <Layers size={18} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-gray-50 p-3">
          <div className="text-sm font-black text-gray-950">{formatNumber(version.images_count)}</div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">Images</div>
        </div>
        <div className="rounded-2xl bg-gray-50 p-3">
          <div className="text-sm font-black text-gray-950">{formatNumber(version.annotations_count)}</div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">Annotations</div>
        </div>
        <div className="rounded-2xl bg-gray-50 p-3">
          <div className="text-sm font-black text-gray-950">{splitLabel(split)}</div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">Split</div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-400">
          <Settings2 size={13} /> Preprocessing
        </div>
        <p className="text-sm font-semibold leading-6 text-gray-700">{formatPreprocessing(version)}</p>
        <p className="mt-2 text-sm font-semibold leading-6 text-gray-500">{formatAugmentations(version)}</p>
        <p className="mt-2 text-sm font-semibold leading-6 text-gray-500">{formatTagFilter(version)}</p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <button onClick={onView} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 transition hover:border-violet-200 hover:text-violet-700">
          <span className="inline-flex items-center gap-2"><Eye size={14} /> View Details</span>
        </button>
        <button onClick={onTrain} className="rounded-xl bg-violet-600 px-3 py-2 text-sm font-bold text-white shadow-sm shadow-violet-200 transition hover:bg-violet-700">
          <span className="inline-flex items-center gap-2"><Zap size={14} /> Train Model</span>
        </button>
        <button onClick={onCompare} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 transition hover:border-violet-200 hover:text-violet-700">
          <span className="inline-flex items-center gap-2"><GitCompare size={14} /> Compare</span>
        </button>
        <a href={version.download_url || "#"} download className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-center text-sm font-bold text-gray-700 transition hover:border-violet-200 hover:text-violet-700">
          <span className="inline-flex items-center gap-2"><Download size={14} /> Download</span>
        </a>
      </div>
    </article>
  );
}

function ComparisonPanel({ versions, compareIds, setCompareIds }) {
  const first = versions.find((version) => versionKey(version) === compareIds[0]) || versions[0];
  const second = versions.find((version) => versionKey(version) === compareIds[1]) || versions[1] || versions[0];

  if (!versions.length) return null;

  const rows = [
    ["Image count", formatNumber(first?.images_count), formatNumber(second?.images_count), compareDelta(first?.images_count, second?.images_count)],
    ["Annotation differences", formatNumber(first?.annotations_count), formatNumber(second?.annotations_count), compareDelta(first?.annotations_count, second?.annotations_count)],
    ["Preprocessing differences", formatPreprocessing(first || {}), formatPreprocessing(second || {}), first && second && formatPreprocessing(first) === formatPreprocessing(second) ? "Same pipeline" : "Changed"],
    ["Performance metrics", metricValue(first?.metrics?.mAP), metricValue(second?.metrics?.mAP), first?.metrics?.mAP || second?.metrics?.mAP ? "Review metrics" : "Not trained yet"],
  ];

  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-700 ring-1 ring-violet-100">
            <GitCompare size={14} /> Version Comparison
          </div>
          <h3 className="text-xl font-black text-gray-950">Compare two snapshots side by side</h3>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {[0, 1].map((slot) => (
            <select
              key={slot}
              value={compareIds[slot] || ""}
              onChange={(event) => {
                const next = [...compareIds];
                next[slot] = event.target.value;
                setCompareIds(next);
              }}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            >
              {versions.map((version) => (
                <option key={versionKey(version)} value={versionKey(version)}>
                  {version.display_id || version.name} | {formatNumber(version.images_count)} images
                </option>
              ))}
            </select>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200">
        <div className="grid grid-cols-[1.1fr_1fr_1fr_0.9fr] bg-gray-50 text-xs font-black uppercase tracking-widest text-gray-400">
          <div className="p-3">Metric</div>
          <div className="p-3">{first?.display_id || "Version A"}</div>
          <div className="p-3">{second?.display_id || "Version B"}</div>
          <div className="p-3">Delta</div>
        </div>
        {rows.map(([label, a, b, delta]) => (
          <div key={label} className="grid grid-cols-[1.1fr_1fr_1fr_0.9fr] border-t border-gray-100 text-sm">
            <div className="p-3 font-black text-gray-800">{label}</div>
            <div className="p-3 font-semibold text-gray-600">{a}</div>
            <div className="p-3 font-semibold text-gray-600">{b}</div>
            <div className="p-3 font-black text-violet-700">{delta}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CreateVersionModal({ form, setForm, onClose, onCreate, isGenerating, annotationStatus, availableTags }) {
  const updateSplit = (key, rawValue) => {
    const value = Math.max(0, Math.min(100, Number(rawValue)));
    const otherKeys = ["train", "valid", "test"].filter((item) => item !== key);
    const otherTotal = otherKeys.reduce((sum, item) => sum + form.split[item], 0) || 1;
    const remaining = 100 - value;
    const next = { ...form.split, [key]: value };
    next[otherKeys[0]] = Math.round((form.split[otherKeys[0]] / otherTotal) * remaining);
    next[otherKeys[1]] = Math.max(0, 100 - value - next[otherKeys[0]]);
    setForm((prev) => ({ ...prev, split: next }));
  };

  const rebalanceSplit = () => {
    setForm((prev) => ({ ...prev, split: { train: 70, valid: 20, test: 10 } }));
  };

  const toggleTag = (kind, tagName) => {
    setForm((prev) => {
      const otherKinds = ["requireTags", "allowTags", "excludeTags"].filter((item) => item !== kind);
      const next = {
        ...prev,
        [kind]: prev[kind].includes(tagName)
          ? prev[kind].filter((item) => item !== tagName)
          : [...prev[kind], tagName],
      };
      for (const otherKind of otherKinds) {
        next[otherKind] = next[otherKind].filter((item) => item !== tagName);
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[28px] border border-white/70 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-gray-100 bg-white/95 px-6 py-5 backdrop-blur">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-700 ring-1 ring-violet-100">
              <Sparkles size={14} /> Generate New Version
            </div>
            <h2 className="text-2xl font-black tracking-tight text-gray-950">Freeze a reproducible dataset snapshot</h2>
            <p className="mt-1 text-sm font-semibold text-gray-500">Lock your split, preprocessing, and augmentation settings into a versioned training snapshot.</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6 p-6">
          {!annotationStatus.all_annotated && (
            <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <span>All images need annotations before creating a version. Current progress: {annotationStatus.annotated_assets}/{annotationStatus.total_assets} annotated.</span>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-xs font-black uppercase tracking-widest text-gray-400">Version name</span>
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Auto: Version 1"
                className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-800 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-black uppercase tracking-widest text-gray-400">Export format</span>
              <select
                value={form.exportFormat}
                onChange={(event) => setForm((prev) => ({ ...prev, exportFormat: event.target.value }))}
                className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-800 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
              >
                <option value="yolov8">YOLOv8</option>
                <option value="coco">COCO JSON</option>
                <option value="voc">Pascal VOC</option>
                <option value="tfrecord">TFRecord / CSV</option>
              </select>
            </label>
          </div>

          <div className="rounded-3xl border border-gray-200 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-gray-950">Preprocessing</h3>
                <p className="text-sm font-semibold text-gray-500">Apply fixed transforms to every image in this version before training.</p>
              </div>
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, resizeEnabled: !prev.resizeEnabled }))}
                className={`rounded-full px-3 py-1.5 text-xs font-black transition ${form.resizeEnabled ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-500"}`}
              >
                {form.resizeEnabled ? "Resize On" : "Resize Off"}
              </button>
            </div>
            <div className="mb-4 grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, autoOrient: !prev.autoOrient }))}
                className={`rounded-2xl border px-4 py-3 text-left text-sm font-bold transition ${
                  form.autoOrient
                    ? "border-violet-200 bg-violet-50 text-violet-700"
                    : "border-gray-200 bg-white text-gray-500"
                }`}
              >
                Auto-orient
                <span className="mt-1 block text-xs font-semibold text-current/80">Normalize EXIF orientation before export.</span>
              </button>
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, grayscale: !prev.grayscale }))}
                className={`rounded-2xl border px-4 py-3 text-left text-sm font-bold transition ${
                  form.grayscale
                    ? "border-violet-200 bg-violet-50 text-violet-700"
                    : "border-gray-200 bg-white text-gray-500"
                }`}
              >
                Grayscale
                <span className="mt-1 block text-xs font-semibold text-current/80">Convert every image to grayscale in this snapshot.</span>
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <input
                type="number"
                min="32"
                value={form.resizeWidth}
                onChange={(event) => setForm((prev) => ({ ...prev, resizeWidth: event.target.value }))}
                className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                disabled={!form.resizeEnabled}
              />
              <input
                type="number"
                min="32"
                value={form.resizeHeight}
                onChange={(event) => setForm((prev) => ({ ...prev, resizeHeight: event.target.value }))}
                className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                disabled={!form.resizeEnabled}
              />
              <select
                value={form.resizeMode}
                onChange={(event) => setForm((prev) => ({ ...prev, resizeMode: event.target.value }))}
                className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                disabled={!form.resizeEnabled}
              >
                <option value="stretch">Stretch</option>
                <option value="fit">Fit with padding</option>
                <option value="crop">Center crop</option>
              </select>
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 p-5">
            <h3 className="text-base font-black text-gray-950">Augmentations</h3>
            <p className="mb-4 text-sm font-semibold text-gray-500">Generate synthetic training copies only for the train split to help the model generalize.</p>
            <div className="mb-5 rounded-2xl bg-gray-50 p-4">
              <div className="mb-2 flex items-center justify-between text-sm font-black text-gray-800">
                <span>Maximum Version Size</span>
                <span>{form.maxVersionSize}x</span>
              </div>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={form.maxVersionSize}
                onChange={(event) => setForm((prev) => ({ ...prev, maxVersionSize: Number(event.target.value) }))}
                className="h-2 w-full cursor-pointer accent-violet-600"
              />
              <p className="mt-2 text-xs font-semibold text-gray-500">A value of 3x creates up to two augmented copies for each training image when augmentations are enabled.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.keys(form.augmentations).map((key) => (
                <TogglePill
                  key={key}
                  label={key}
                  active={form.augmentations[key]}
                  onClick={() => setForm((prev) => ({
                    ...prev,
                    augmentations: { ...prev.augmentations, [key]: !prev.augmentations[key] },
                  }))}
                />
              ))}
            </div>
          </div>

          {availableTags.length > 0 && (
            <div className="rounded-3xl border border-gray-200 p-5">
              <h3 className="text-base font-black text-gray-950">Filter by Tag</h3>
              <p className="mb-4 text-sm font-semibold text-gray-500">Use tags to require, allow, or exclude images before this version is frozen.</p>
              {[
                ["requireTags", "Require"],
                ["allowTags", "Allow"],
                ["excludeTags", "Exclude"],
              ].map(([kind, title]) => (
                <div key={kind} className="mb-4 last:mb-0">
                  <div className="mb-2 text-xs font-black uppercase tracking-widest text-gray-400">{title}</div>
                  <div className="flex flex-wrap gap-2">
                    {availableTags.map((tag) => (
                      <button
                        key={`${kind}-${tag.name}`}
                        type="button"
                        onClick={() => toggleTag(kind, tag.name)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                          form[kind].includes(tag.name)
                            ? "border-violet-200 bg-violet-50 text-violet-700"
                            : "border-gray-200 bg-white text-gray-500 hover:border-violet-200 hover:text-violet-700"
                        }`}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-3xl border border-gray-200 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-gray-950">Train / Test Split</h3>
                <p className="text-sm font-semibold text-gray-500">Use Rebalance to restore a healthy train, validation, and test distribution.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-gray-950 px-3 py-1 text-xs font-black text-white">{splitLabel(form.split)}</span>
                <button
                  type="button"
                  onClick={rebalanceSplit}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-black text-gray-700 transition hover:border-violet-200 hover:text-violet-700"
                >
                  Rebalance
                </button>
              </div>
            </div>
            {[
              ["train", "Train Set"],
              ["valid", "Validation Set"],
              ["test", "Test Set"],
            ].map(([key, label]) => (
              <label key={key} className="mb-4 block last:mb-0">
                <div className="mb-2 flex items-center justify-between text-sm font-black text-gray-700">
                  <span>{label}</span>
                  <span>{form.split[key]}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={form.split[key]}
                  onChange={(event) => updateSplit(key, event.target.value)}
                  className="h-2 w-full cursor-pointer accent-violet-600"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-gray-100 bg-white/95 px-6 py-5 backdrop-blur">
          <button onClick={onClose} className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-black text-gray-700 transition hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={onCreate}
            disabled={isGenerating || !annotationStatus.all_annotated}
            className="inline-flex min-w-[170px] items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-violet-200 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            {isGenerating ? "Generating..." : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VersionsTab({ projectId, onTrainVersion }) {
  const [versions, setVersions] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const [compareIds, setCompareIds] = useState(["", ""]);
  const [feedback, setFeedback] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [annotationStatus, setAnnotationStatus] = useState({
    total_assets: 0,
    annotated_assets: 0,
    all_annotated: false,
    loading: true,
  });

  useEffect(() => {
    if (!projectId) return;
    fetchVersions();
    fetchAnnotationStatus();
    fetchProjectTags();
  }, [projectId]);

  useEffect(() => {
    if (!versions.length) return;
    setSelectedVersionId((current) => current || versionKey(versions[0]));
    setCompareIds((current) => [
      current[0] || versionKey(versions[0]),
      current[1] || versionKey(versions[1] || versions[0]),
    ]);
    setForm((current) => ({
      ...current,
      name: current.name || `Version ${versions.length + 1}`,
    }));
  }, [versions]);

  const selectedVersion = useMemo(
    () => versions.find((version) => versionKey(version) === selectedVersionId) || versions[0],
    [versions, selectedVersionId],
  );

  const versionStats = useMemo(() => {
    const images = versions.reduce((sum, version) => sum + Number(version.images_count || 0), 0);
    const annotations = versions.reduce((sum, version) => sum + Number(version.annotations_count || 0), 0);
    return { images, annotations };
  }, [versions]);

  async function fetchVersions() {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/versions`);
      if (res.ok) {
        const data = await res.json();
        setVersions(Array.isArray(data) ? data : []);
      } else {
        setFeedback({ type: "error", message: "Could not load dataset versions." });
      }
    } catch (err) {
      console.error(err);
      setFeedback({ type: "error", message: "Could not connect to the versions backend." });
    }
    setIsLoading(false);
  }

  async function fetchAnnotationStatus() {
    try {
      const res = await fetch(`/api/projects/${projectId}/annotation-status`);
      if (res.ok) {
        const data = await res.json();
        setAnnotationStatus({ ...data, loading: false });
      } else {
        setAnnotationStatus((prev) => ({ ...prev, loading: false }));
      }
    } catch (err) {
      console.error(err);
      setAnnotationStatus((prev) => ({ ...prev, loading: false }));
    }
  }

  async function fetchProjectTags() {
    try {
      const res = await fetch(`/api/projects/${projectId}/classes-tags`);
      if (!res.ok) {
        setAvailableTags([]);
        return;
      }
      const data = await res.json();
      setAvailableTags(Array.isArray(data.tags) ? data.tags : []);
    } catch (err) {
      console.error(err);
      setAvailableTags([]);
    }
  }

  const createVersion = async () => {
    if (!annotationStatus.all_annotated) {
      setFeedback({
        type: "error",
        message: "All images must be annotated before creating a dataset version.",
      });
      return;
    }

    setIsGenerating(true);
    setFeedback(null);
    try {
      const augmentations = Object.entries(form.augmentations)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key);

      const res = await fetch(`/api/projects/${projectId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          export_format: form.exportFormat,
          preprocessing: {
            auto_orient: form.autoOrient,
            grayscale: form.grayscale,
            resize: {
              enabled: form.resizeEnabled,
              width: Number(form.resizeWidth),
              height: Number(form.resizeHeight),
              mode: form.resizeMode,
            },
          },
          augmentations,
          max_version_size: Number(form.maxVersionSize),
          tag_filter: {
            require: form.requireTags,
            allow: form.allowTags,
            exclude: form.excludeTags,
          },
          split: form.split,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Dataset version generation failed.");
      }

      const createdVersion = await res.json();
      await fetchVersions();
      await fetchAnnotationStatus();
      setShowCreateModal(false);
      setFeedback({
        type: "success",
        message: `Generated ${createdVersion.canonical_id || createdVersion.display_id || "new version"} successfully.`,
      });
      setForm({ ...DEFAULT_FORM, name: "" });
    } catch (err) {
      console.error(err);
      setFeedback({ type: "error", message: err.message || "Dataset version generation failed." });
    }
    setIsGenerating(false);
  };

  const handleTrain = (version) => {
    localStorage.setItem("visionflow_selected_version", JSON.stringify(version));
    if (typeof onTrainVersion === "function") {
      onTrainVersion(version);
    }
  };

  const addToCompare = (version) => {
    const key = versionKey(version);
    setCompareIds((current) => {
      if (current.includes(key)) return current;
      if (!current[0]) return [key, current[1]];
      return [current[0], key];
    });
  };

  return (
    <div className="w-full animate-page-enter space-y-6 pb-10">
      <section className="overflow-hidden rounded-[32px] border border-gray-200 bg-gradient-to-br from-white via-white to-violet-50/60 p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-100 bg-white px-3 py-1 text-xs font-black text-violet-700 shadow-sm">
              <GitBranch size={14} /> Dataset lineage
            </div>
            <h1 className="text-3xl font-black tracking-tight text-gray-950">Dataset Versions</h1>
            <p className="mt-2 text-base font-semibold text-gray-500">Freeze images, annotations, preprocessing, and augmentation settings so future edits do not change existing training results.</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            disabled={annotationStatus.loading || !annotationStatus.all_annotated}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-violet-200 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={17} /> Generate New Version
          </button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <StatTile icon={<Package size={18} />} label="Versions" value={formatNumber(versions.length)} />
          <StatTile icon={<ImageIcon size={18} />} label="Total Images" value={formatNumber(versionStats.images)} />
          <StatTile icon={<Tags size={18} />} label="Annotations" value={formatNumber(versionStats.annotations)} />
        </div>

        <div className="mt-6 rounded-2xl border border-gray-200 bg-white/80 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-widest text-gray-400">Timeline</span>
            <span className="text-xs font-bold text-gray-500">
              {annotationStatus.loading ? "Checking annotations..." : `${annotationStatus.annotated_assets}/${annotationStatus.total_assets} annotated`}
            </span>
          </div>
          {versions.length ? (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {[...versions].reverse().map((version, index, list) => (
                <React.Fragment key={versionKey(version)}>
                  <button
                    onClick={() => setSelectedVersionId(versionKey(version))}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black transition ${
                      selectedVersionId === versionKey(version)
                        ? "bg-violet-600 text-white shadow-md shadow-violet-200"
                        : "bg-gray-100 text-gray-600 hover:bg-violet-50 hover:text-violet-700"
                    }`}
                  >
                    {version.display_id || version.name}
                  </button>
                  {index < list.length - 1 && <ArrowRight size={14} className="shrink-0 text-gray-300" />}
                </React.Fragment>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-500">
              <GitBranch size={16} /> Versions will appear here as v1, v2, v3.
            </div>
          )}
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

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-80 animate-pulse rounded-3xl border border-gray-200 bg-gray-50" />
          ))}
        </div>
      ) : versions.length === 0 ? (
        <section className="flex min-h-[360px] flex-col items-center justify-center rounded-[32px] border border-dashed border-gray-300 bg-white p-10 text-center shadow-sm">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-violet-50 text-violet-700 ring-1 ring-violet-100">
            <FileArchive size={28} />
          </div>
          <h2 className="text-2xl font-black text-gray-950">No versions generated yet</h2>
          <p className="mt-2 max-w-lg text-sm font-semibold leading-6 text-gray-500">
            Create your first dataset version to freeze images, annotations, preprocessing choices, and splits for training.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            disabled={!annotationStatus.all_annotated}
            className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-violet-200 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={17} /> Generate New Version
          </button>
        </section>
      ) : (
        <>
          <div className="grid gap-5 xl:grid-cols-3">
            {versions.map((version) => (
              <VersionCard
                key={versionKey(version)}
                version={version}
                selected={selectedVersionId === versionKey(version)}
                onView={() => setSelectedVersionId(versionKey(version))}
                onTrain={() => handleTrain(version)}
                onCompare={() => addToCompare(version)}
              />
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
            <ComparisonPanel versions={versions} compareIds={compareIds} setCompareIds={setCompareIds} />
            {selectedVersion && (
              <aside className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-black uppercase tracking-widest text-violet-600">Selected for training</div>
                    <h3 className="mt-1 text-xl font-black text-gray-950">{selectedVersion.display_id} | {selectedVersion.name}</h3>
                    <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                      <Calendar size={13} /> {formatDate(selectedVersion.created_at)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-gray-950 p-2.5 text-white">
                    <BarChart3 size={18} />
                  </div>
                </div>
                <div className="space-y-3 text-sm font-semibold text-gray-600">
                  <div className="flex justify-between rounded-2xl bg-gray-50 p-3">
                    <span>Frozen ID</span>
                    <span className="font-black text-gray-950">{selectedVersion.canonical_id || selectedVersion.display_id}</span>
                  </div>
                  <div className="flex justify-between rounded-2xl bg-gray-50 p-3">
                    <span>Export format</span>
                    <span className="font-black text-gray-950">{(selectedVersion.export_format || "yolov8").toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between rounded-2xl bg-gray-50 p-3">
                    <span>Dataset split</span>
                    <span className="font-black text-gray-950">{splitLabel(selectedVersion.split)}</span>
                  </div>
                  <div className="flex justify-between rounded-2xl bg-gray-50 p-3">
                    <span>Maximum version size</span>
                    <span className="font-black text-gray-950">{selectedVersion.max_version_size || 1}x</span>
                  </div>
                  <div className="rounded-2xl bg-gray-50 p-3">
                    <span className="block text-gray-500">Preprocessing</span>
                    <span className="mt-1 block font-black text-gray-950">{formatPreprocessing(selectedVersion)}</span>
                    <span className="mt-1 block font-semibold text-gray-500">{formatAugmentations(selectedVersion)}</span>
                    <span className="mt-1 block font-semibold text-gray-500">{formatTagFilter(selectedVersion)}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleTrain(selectedVersion)}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gray-950 px-5 py-3 text-sm font-black text-white transition hover:bg-violet-700"
                >
                  <Zap size={16} /> Train with {selectedVersion.display_id}
                </button>
              </aside>
            )}
          </div>
        </>
      )}

      {showCreateModal && (
        <CreateVersionModal
          form={form}
          setForm={setForm}
          onClose={() => setShowCreateModal(false)}
          onCreate={createVersion}
          isGenerating={isGenerating}
          annotationStatus={annotationStatus}
          availableTags={availableTags}
        />
      )}
    </div>
  );
}
