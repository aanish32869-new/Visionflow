import React, { useState, useEffect } from "react";
import { X, Download, CheckCircle, AlertTriangle, Box, ChevronRight } from "lucide-react";
import logger from "../utils/logger";

const FORMATS = [
  { id: "yolo", name: "YOLO" },
  { id: "coco", name: "COCO" },
];

export default function ExportModal({ isOpen, onClose, projectId, assetIds = [] }) {
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
          source: "dataset",
          asset_ids: assetIds,
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
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[450px] border border-white/20">
        <div className="flex-1 flex flex-col bg-white overflow-hidden">
          <div className="flex items-center justify-between p-6 border-b border-gray-100 shrink-0">
            <h2 className="text-xl font-black text-gray-900 flex items-center gap-2"><Download className="text-violet-600" size={24} /> Export Dataset</h2>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400"><X size={20} /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {status === "idle" && (
              <div className="flex flex-col items-center justify-center h-full py-10 text-center">
                <div className="w-20 h-20 bg-violet-50 rounded-full flex items-center justify-center mb-6"><Box size={40} className="text-violet-600" /></div>
                <h3 className="text-xl font-black text-gray-900 mb-2">Choose Format</h3>
                <div className="mb-4 grid grid-cols-2 gap-2 w-full max-w-xs">
                  {FORMATS.map((format) => (
                    <button key={format.id} onClick={() => setSelectedFormat(format.id)} className={`px-3 py-2 rounded-xl border text-sm font-bold ${selectedFormat === format.id ? "border-violet-600 bg-violet-50 text-violet-700" : "border-gray-200 text-gray-600"}`}>
                      {format.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(status === "preparing" || status === "processing" || status === "ready" || status === "failed") && (
              <div className="flex flex-col items-center justify-center h-full max-w-sm mx-auto text-center py-10">
                {(status === "preparing" || status === "processing") && <div className="relative mb-8"><div className="w-24 h-24 rounded-full border-4 border-gray-100 border-t-violet-600 animate-spin" /><div className="absolute inset-0 flex items-center justify-center font-black text-violet-600">{progress}%</div></div>}
                {status === "ready" && <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mb-6"><CheckCircle size={40} className="text-emerald-500" /></div>}
                {status === "failed" && <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mb-6"><AlertTriangle size={40} className="text-rose-500" /></div>}

                {status === "ready" && <button onClick={handleDownload} className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-black py-4 rounded-2xl"><Download size={20} /> Download Dataset</button>}
                {status === "failed" && <p className="text-sm font-bold text-rose-500">{error || "Export failed."}</p>}
              </div>
            )}
          </div>

          <div className="p-6 border-t border-gray-100 bg-gray-50/50 shrink-0 flex items-center justify-end">
            {status === "idle" && (
              <div className="flex gap-3">
                <button onClick={onClose} className="px-6 py-3 text-sm font-black text-gray-600 hover:text-gray-900 transition-colors">Cancel</button>
                <button onClick={handleStartExport} className="px-8 py-3 bg-violet-600 hover:bg-violet-700 text-white text-sm font-black rounded-2xl transition-all shadow-lg shadow-violet-200 flex items-center gap-2">Start Export <ChevronRight size={18} /></button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
