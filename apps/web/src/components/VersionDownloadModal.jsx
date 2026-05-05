import React, { useState, useEffect } from "react";
import { X, Download, CheckCircle, AlertTriangle, ChevronRight } from "lucide-react";
import logger from "../utils/logger";

const FORMATS = [
  { id: "yolo", name: "YOLO" },
  { id: "coco", name: "COCO" },
];

export default function VersionDownloadModal({ isOpen, onClose, projectId, version }) {
  const [selectedFormat, setSelectedFormat] = useState("yolo");
  const [exportId, setExportId] = useState(null);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [exportData, setExportData] = useState(null);

  useEffect(() => {
    let interval;
    if (exportId && (status === "preparing" || status === "processing")) {
      interval = setInterval(fetchStatus, 2000);
    }
    return () => clearInterval(interval);
  }, [exportId, status]);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/dataset/exports/${exportId}`);
      if (!res.ok) return;
      const data = await res.json();
      setProgress(data.progress || 0);
      if (data.status === "Ready") {
        setStatus("ready");
        setExportData(data);
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

  const handleStartExport = async () => {
    setStatus("preparing");
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
      if (res.ok) setExportId(data.export_id);
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
            <div className="max-w-md mx-auto text-center">
              <p className="text-sm font-bold text-gray-500 mb-4">Select export format for this immutable version snapshot.</p>
              <div className="grid grid-cols-2 gap-3">
                {FORMATS.map((format) => (
                  <button key={format.id} onClick={() => setSelectedFormat(format.id)} className={`px-3 py-3 rounded-xl border text-sm font-bold ${selectedFormat === format.id ? "border-violet-600 bg-violet-50 text-violet-700" : "border-gray-200 text-gray-600"}`}>
                    {format.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(status === "preparing" || status === "processing") && <div className="text-center font-black text-violet-600">Preparing export... {progress}%</div>}
          {status === "ready" && <div className="text-center"><CheckCircle className="mx-auto text-emerald-500 mb-3" size={42} /><button onClick={handleDownload} className="px-6 py-3 bg-violet-600 text-white rounded-xl font-black">Download ZIP</button></div>}
          {status === "failed" && <div className="text-center text-rose-500 font-bold"><AlertTriangle className="mx-auto mb-3" size={36} />{error}</div>}
        </div>

        <div className="p-6 border-t border-gray-100 bg-gray-50/50 shrink-0 flex items-center justify-end">
          {status === "idle" && <button onClick={handleStartExport} className="px-8 py-3 bg-violet-600 hover:bg-violet-700 text-white text-sm font-black rounded-2xl transition-all shadow-lg shadow-violet-200 flex items-center gap-2">Start Download <ChevronRight size={18} /></button>}
        </div>
      </div>
    </div>
  );
}
