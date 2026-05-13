import React, { useState, useEffect } from "react";
import { X, Download, CheckCircle, AlertTriangle, ChevronRight, Copy, Code2 } from "lucide-react";
import logger from "../utils/logger";

const FORMAT_GROUPS = [
  {
    heading: "Object Detection",
    formats: [
      { id: "yolov5", name: "YOLOv5 / YOLOv8 / YOLOv11" },
      { id: "coco_json", name: "COCO JSON" },
      { id: "pascal_voc_xml", name: "Pascal VOC XML" },
      { id: "tensorflow_tfrecord", name: "TensorFlow TFRecord" },
      { id: "createml", name: "CreateML" },
      { id: "darknet_yolo", name: "Darknet YOLO" },
      { id: "rf_detr", name: "RF-DETR" },
      { id: "ssd_mobilenet", name: "SSD MobileNet" },
    ],
  },
  {
    heading: "Classification",
    formats: [
      { id: "folder_classification", name: "Folder-based Classification" },
      { id: "tensorflow_classification", name: "TensorFlow Classification" },
      { id: "multi_label_classification", name: "Multi-label Classification" },
    ],
  },
];

export default function VersionDownloadModal({ isOpen, onClose, projectId, version }) {
  const [selectedFormat, setSelectedFormat] = useState("yolov5");
  const [projectType, setProjectType] = useState("Object Detection");
  const [exportId, setExportId] = useState(null);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [displayProgress, setDisplayProgress] = useState(0);
  const [pendingReady, setPendingReady] = useState(false);
  const [error, setError] = useState(null);
  const [exportData, setExportData] = useState(null);
  const [snippetStatus, setSnippetStatus] = useState("idle");
  const [snippetProgress, setSnippetProgress] = useState(0);
  const [snippet, setSnippet] = useState("");
  const [snippetError, setSnippetError] = useState("");

  useEffect(() => {
    if (!isOpen || !projectId) return;
    const pid = typeof projectId === "object" && projectId !== null ? (projectId.id || projectId._id) : projectId;
    const loadProjectType = async () => {
      try {
        const res = await fetch(`/api/projects/${pid}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.project_type) setProjectType(data.project_type);
      } catch (err) {
        logger.error("Failed to fetch project metadata for version download", err);
      }
    };
    loadProjectType();
  }, [isOpen, projectId]);

  const isClassificationProject = String(projectType || "").toLowerCase() === "classification";
  const visibleFormatGroups = isClassificationProject
    ? FORMAT_GROUPS.filter((g) => g.heading === "Classification")
    : FORMAT_GROUPS.filter((g) => g.heading === "Object Detection");
  const visibleFormats = visibleFormatGroups.flatMap((g) => g.formats);

  useEffect(() => {
    if (!visibleFormats.length) return;
    const isValid = visibleFormats.some((f) => f.id === selectedFormat);
    if (!isValid) setSelectedFormat(visibleFormats[0].id);
  }, [selectedFormat, visibleFormats]);

  useEffect(() => {
    let interval;
    if (exportId && (status === "preparing" || status === "processing")) {
      interval = setInterval(fetchStatus, 500);
    }
    return () => clearInterval(interval);
  }, [exportId, status]);

  useEffect(() => {
    if (!(status === "preparing" || status === "processing")) return undefined;
    const interval = setInterval(() => {
      setDisplayProgress((prev) => {
        if (prev >= progress) return prev;
        const step = Math.max(1, Math.ceil((progress - prev) / 4));
        const next = Math.min(progress, prev + step);
        if (pendingReady && next >= 100) {
          setPendingReady(false);
          setStatus("ready");
        }
        return next;
      });
    }, 150);
    return () => clearInterval(interval);
  }, [progress, pendingReady, status]);

  useEffect(() => {
    if (snippetStatus !== "generating") return undefined;
    const interval = setInterval(() => {
      setSnippetProgress((prev) => {
        if (prev >= 100) {
          setSnippetStatus("ready");
          return 100;
        }
        return Math.min(100, prev + Math.max(1, Math.ceil((100 - prev) / 6)));
      });
    }, 120);
    return () => clearInterval(interval);
  }, [snippetStatus]);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/dataset/exports/${exportId}`);
      if (!res.ok) return;
      const data = await res.json();
      setProgress(data.progress || 0);
      if (data.status === "Ready") {
        setProgress(100);
        setExportData(data);
        setPendingReady(true);
      } else if (data.status === "Failed") {
        setStatus("failed");
        setError(data.error || "Export failed unexpectedly.");
      } else if (data.status === "Processing") {
        setStatus("processing");
      }
    } catch (err) {
      logger.error("Failed to fetch export status", err);
    }
  };

  const handleGenerateSnippet = async () => {
    setSnippetStatus("generating");
    setSnippetProgress(0);
    setSnippet("");
    setSnippetError("");
    const interval = setInterval(() => {
      setSnippetProgress((prev) => Math.min(95, prev + Math.max(1, Math.ceil((95 - prev) / 4))));
    }, 120);
    try {
      const versionId = version?.version_id;
      if (!versionId) throw new Error("Version id missing");
      const framework = (
        selectedFormat === "tensorflow_tfrecord" ||
        selectedFormat === "ssd_mobilenet" ||
        selectedFormat === "tensorflow_classification"
      ) ? "tensorflow" : (
        selectedFormat === "yolov5" || selectedFormat === "yolov8" || selectedFormat === "yolov11"
      ) ? "ultralytics" : "";
      const res = await fetch(
        `/api/projects/${projectId}/versions/${versionId}/code-snippet?format=${encodeURIComponent(selectedFormat)}&language=python&framework=${encodeURIComponent(framework)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate snippet.");
      let rendered = data.snippet || "";
      if (Array.isArray(data.install) && data.install.length > 0) {
        rendered = `${data.install.map((line) => `# ${line}`).join("\n")}\n\n${rendered}`;
      }
      clearInterval(interval);
      setSnippetProgress(100);
      setSnippet(rendered);
      setSnippetStatus("ready");
    } catch (err) {
      clearInterval(interval);
      setSnippetStatus("idle");
      setSnippetProgress(0);
      setSnippetError(err?.message || "Failed to generate snippet.");
      logger.error("Failed to generate version code snippet", err);
    }
  };

  const handleCopySnippet = async () => {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
    } catch (err) {
      logger.error("Failed to copy snippet", err);
    }
  };

  const handleStartExport = async () => {
    setStatus("preparing");
    setProgress(0);
    setDisplayProgress(0);
    setPendingReady(false);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/export-dataset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: selectedFormat,
          source: "version",
          version_id: version.version_id,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setExportId(data.export_id);
        fetchStatus();
      }
      else {
        setStatus("failed");
        setError(data.error || "Failed to start export.");
      }
    } catch (err) {
      setStatus("failed");
      setError("An error occurred while connecting to the server.");
    }
  };

  const handleDownload = () => {
    if (exportData?.download_url) window.location.href = exportData.download_url;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[520px] border border-white/20">
        <div className="flex items-center justify-between p-6 border-b border-gray-100 shrink-0">
          <h2 className="text-xl font-black text-gray-900 flex items-center gap-2"><Download className="text-violet-600" size={24} /> Download Version</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          {status === "idle" && (
            <div className="max-w-2xl mx-auto">
              <p className="text-sm font-bold text-gray-500 mb-4">
                Select {isClassificationProject ? "classification" : "object detection"} export format for this immutable version snapshot.
              </p>
              <div className="space-y-4">
                {visibleFormatGroups.map((group) => (
                  <div key={group.heading}>
                    <p className="text-xs font-black uppercase tracking-wide text-gray-500 mb-2">{group.heading}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {group.formats.map((format) => (
                        <button key={format.id} onClick={() => setSelectedFormat(format.id)} className={`px-3 py-3 rounded-xl border text-sm font-bold text-left ${selectedFormat === format.id ? "border-violet-600 bg-violet-50 text-violet-700" : "border-gray-200 text-gray-600"}`}>
                          {format.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 border border-gray-200 rounded-2xl p-4 bg-gray-50/60">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-black text-gray-700 flex items-center gap-2"><Code2 size={16} /> Download Code Snippet</p>
                  <button
                    onClick={handleGenerateSnippet}
                    className="px-3 py-1.5 bg-white border border-gray-200 text-xs font-bold rounded-lg hover:bg-gray-50"
                  >
                    Generate Snippet
                  </button>
                </div>
                {snippetStatus === "generating" && (
                  <div className="relative mb-3">
                    <div className="w-full h-2 rounded-full bg-gray-200 overflow-hidden">
                      <div className="h-2 bg-violet-600 transition-all duration-150" style={{ width: `${snippetProgress}%` }} />
                    </div>
                    <p className="text-xs font-black text-violet-600 mt-2">Generating snippet... {snippetProgress}%</p>
                  </div>
                )}
                {snippetError && (
                  <p className="text-xs font-bold text-rose-600 mb-3">{snippetError}</p>
                )}
                {snippet && (
                  <div>
                    <pre className="text-xs bg-gray-900 text-gray-100 p-3 rounded-xl overflow-x-auto">{snippet}</pre>
                    <button
                      onClick={handleCopySnippet}
                      className="mt-3 px-3 py-1.5 bg-violet-600 text-white text-xs font-bold rounded-lg flex items-center gap-1.5"
                    >
                      <Copy size={12} /> Copy Snippet
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {(status === "preparing" || status === "processing" || status === "ready" || status === "failed") && (
            <div className="flex flex-col items-center justify-center h-full max-w-sm mx-auto text-center py-10">
              {(status === "preparing" || status === "processing") && <div className="relative mb-8"><div className="w-24 h-24 rounded-full border-4 border-gray-100 border-t-violet-600 animate-spin" /><div className="absolute inset-0 flex items-center justify-center font-black text-violet-600">{displayProgress}%</div></div>}
              {status === "ready" && <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mb-6"><CheckCircle size={40} className="text-emerald-500" /></div>}
              {status === "failed" && <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mb-6"><AlertTriangle size={40} className="text-rose-500" /></div>}

              {status === "ready" && <button onClick={handleDownload} className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-black py-4 rounded-2xl"><Download size={20} /> Download Dataset</button>}
              {status === "failed" && <p className="text-sm font-bold text-rose-500">{error || "Export failed."}</p>}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-100 bg-gray-50/50 shrink-0 flex items-center justify-end">
          {status === "idle" && <button onClick={handleStartExport} className="px-8 py-3 bg-violet-600 hover:bg-violet-700 text-white text-sm font-black rounded-2xl transition-all shadow-lg shadow-violet-200 flex items-center gap-2">Start Download <ChevronRight size={18} /></button>}
        </div>
      </div>
    </div>
  );
}
