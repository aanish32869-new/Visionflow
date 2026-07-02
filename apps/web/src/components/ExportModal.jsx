import React, { useCallback, useRef, useState, useEffect } from "react";
import { X, Download, CheckCircle, AlertTriangle, Box, ChevronRight } from "lucide-react";
import logger from "../utils/logger";
import { emitVisionFlowNotification } from "../utils/notifications";

const FORMAT_GROUPS = [
  {
    heading: "Object Detection",
    formats: [
      { id: "yolov5", name: "YOLOv5 / YOLOv8 / YOLOv11", backend: "yolo" },
      { id: "coco_json", name: "COCO JSON", backend: "coco" },
      { id: "pascal_voc_xml", name: "Pascal VOC XML", backend: "yolo" },
      { id: "tensorflow_tfrecord", name: "TensorFlow TFRecord", backend: "coco" },
      { id: "createml", name: "CreateML", backend: "coco" },
      { id: "darknet_yolo", name: "Darknet YOLO", backend: "yolo" },
      { id: "rf_detr", name: "RF-DETR", backend: "coco" },
      { id: "ssd_mobilenet", name: "SSD MobileNet", backend: "coco" },
    ],
  },
  {
    heading: "Classification",
    formats: [
      { id: "folder_classification", name: "Folder-based Classification", backend: "yolo" },
      { id: "tensorflow_classification", name: "TensorFlow Classification", backend: "coco" },
      { id: "multi_label_classification", name: "Multi-label Classification", backend: "coco" },
    ],
  },
];

export default function ExportModal({ isOpen, onClose, projectId, assetIds = [] }) {
  const [selectedFormat, setSelectedFormat] = useState("yolov5");
  const [exportId, setExportId] = useState(null);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [displayProgress, setDisplayProgress] = useState(0);
  const [pendingReady, setPendingReady] = useState(false);
  const [error, setError] = useState(null);
  const [exportData, setExportData] = useState(null);
  const notifiedExportRef = useRef(new Set());

  const fetchStatus = useCallback(async (targetExportId = exportId) => {
    if (!targetExportId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/dataset/exports/${targetExportId}`);
      if (!res.ok) return;
      const data = await res.json();
      setProgress(data.progress || 0);
      if (data.status === "Ready") {
        setProgress(100);
        setExportData(data);
        setPendingReady(true);
        if (!notifiedExportRef.current.has(`ready-${targetExportId}`)) {
          notifiedExportRef.current.add(`ready-${targetExportId}`);
          emitVisionFlowNotification({
            id: `dataset-export-completed-${targetExportId}`,
            status: "Success",
            title: "Dataset export completed",
            description: "Your dataset export is ready to download.",
            route: "/upload",
            projectId,
            source: "dataset-export",
          });
        }
      } else if (data.status === "Failed") {
        setStatus("failed");
        setError(data.error || "Export failed unexpectedly.");
        if (!notifiedExportRef.current.has(`failed-${targetExportId}`)) {
          notifiedExportRef.current.add(`failed-${targetExportId}`);
          emitVisionFlowNotification({
            id: `dataset-export-failed-${targetExportId}`,
            status: "Error",
            title: "Export failed",
            description: data.error || "Dataset export failed unexpectedly.",
            route: "/upload",
            projectId,
            source: "dataset-export",
          });
        }
      } else if (data.status === "Processing") {
        setStatus("processing");
      }
    } catch (err) {
      logger.error("Failed to fetch export status", err);
    }
  }, [exportId, projectId]);

  useEffect(() => {
    let interval;
    if (exportId && (status === "preparing" || status === "processing")) {
      interval = setInterval(fetchStatus, 500);
    }
    return () => clearInterval(interval);
  }, [exportId, fetchStatus, status]);

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
          source: "dataset",
          asset_ids: assetIds,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setExportId(data.export_id);
        emitVisionFlowNotification({
          id: `dataset-export-started-${data.export_id || Date.now()}`,
          status: "Information",
          title: "Dataset export started",
          description: "VisionFlow is preparing your dataset export.",
          route: "/upload",
          projectId,
          source: "dataset-export",
        });
        fetchStatus(data.export_id);
      }
      else {
        setStatus("failed");
        setError(data.error || "Failed to start export.");
        emitVisionFlowNotification({
          id: `dataset-export-failed-start-${Date.now()}`,
          status: "Error",
          title: "Export failed",
          description: data.error || "Failed to start dataset export.",
          route: "/upload",
          projectId,
          source: "dataset-export",
        });
      }
    } catch (err) {
      logger.error("Failed to start dataset export", err);
      setStatus("failed");
      setError("An error occurred while connecting to the server.");
      emitVisionFlowNotification({
        id: `dataset-export-network-failed-${Date.now()}`,
        status: "Error",
        title: "Server unavailable",
        description: "VisionFlow could not connect to start the export.",
        route: "/upload",
        projectId,
        source: "dataset-export",
      });
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
                <div className="mb-4 w-full max-w-2xl space-y-4">
                  {FORMAT_GROUPS.map((group) => (
                    <div key={group.heading}>
                      <p className="text-xs font-black uppercase tracking-wide text-gray-500 mb-2 text-left">{group.heading}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {group.formats.map((format) => (
                          <button key={format.id} onClick={() => setSelectedFormat(format.id)} className={`px-3 py-2 rounded-xl border text-sm font-bold text-left ${selectedFormat === format.id ? "border-violet-600 bg-violet-50 text-violet-700" : "border-gray-200 text-gray-600"}`}>
                            {format.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
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
