import React, { useState, useEffect } from "react";
import { 
  X, Download, CheckCircle, AlertTriangle, Clock, 
  Settings, Zap, Box, Layers, Image as ImageIcon, 
  ChevronRight, FileText, Loader2, ExternalLink
} from "lucide-react";
import logger from "../utils/logger";

const CATEGORIES = [
  {
    id: "detection",
    name: "Object Detection",
    icon: <Box size={18} className="text-blue-500" />,
    description: "Bounding box and polygon formats for detection models.",
    formats: [
      { id: "yolov8", name: "YOLOv8", framework: "Ultralytics", icon: "⚡" },
      { id: "yolov5", name: "YOLOv5", framework: "Ultralytics", icon: "🔥" },
      { id: "coco", name: "COCO JSON", framework: "Standard", icon: "📦" },
      { id: "voc", name: "Pascal VOC", framework: "XML", icon: "📄" },
      { id: "createml", name: "CreateML", framework: "Apple", icon: "🍎" }
    ]
  },
  {
    id: "classification",
    name: "Image Classification",
    icon: <Layers size={18} className="text-emerald-500" />,
    description: "Categorize entire images into predefined classes.",
    formats: [
      { id: "classification", name: "Folder Structure", framework: "PyTorch/TF", icon: "📁" },
      { id: "csv", name: "CSV / Single Label", framework: "General", icon: "📊" }
    ]
  },
  {
    id: "segmentation",
    name: "Segmentation",
    icon: <Zap size={18} className="text-violet-500" />,
    description: "Pixel-level or polygon masks for fine-grained control.",
    formats: [
      { id: "coco_seg", name: "COCO Segmentation", framework: "JSON", icon: "🧩" },
      { id: "mask", name: "PNG Masks", framework: "Semantic", icon: "🎭" }
    ]
  }
];

export default function ExportModal({ isOpen, onClose, projectId, assetIds = [] }) {
  const [activeCategory, setActiveCategory] = useState("detection");
  const [selectedFormat, setSelectedFormat] = useState("yolov8");
  const [exportId, setExportId] = useState(null);
  const [status, setStatus] = useState("idle"); // 'idle' | 'preparing' | 'processing' | 'ready' | 'failed'
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
      if (res.ok) {
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
      }
    } catch (err) {
      logger.error("Failed to fetch export status", err);
    }
  };

  const handleStartExport = async () => {
    setStatus("preparing");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/dataset/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: selectedFormat,
          asset_ids: assetIds
        })
      });

      const data = await res.json();
      if (res.ok) {
        setExportId(data.export_id);
      } else {
        setStatus("failed");
        setError(data.error || "Failed to start export.");
      }
    } catch (err) {
      setStatus("failed");
      setError("An error occurred while connecting to the server.");
    }
  };

  const handleDownload = () => {
    if (exportData?.download_url) {
      window.location.href = exportData.download_url;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row h-[600px] border border-white/20">
        
        {/* Left Sidebar - Categories */}
        <div className="w-full md:w-72 bg-gray-50 border-r border-gray-100 flex flex-col">
          <div className="p-6 border-b border-gray-100">
            <h2 className="text-xl font-black text-gray-900 flex items-center gap-2">
              <Download className="text-violet-600" size={24} /> Export
            </h2>
            <p className="text-xs font-bold text-gray-400 mt-1 uppercase tracking-wider">Standardized Formats</p>
          </div>
          
          <div className="flex-1 p-3 space-y-1">
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-2xl transition-all duration-200 ${
                  activeCategory === cat.id 
                    ? "bg-white shadow-sm border border-gray-100 text-violet-600" 
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <div className={`p-2 rounded-xl ${activeCategory === cat.id ? "bg-violet-50" : "bg-gray-100"}`}>
                  {cat.icon}
                </div>
                <div className="text-left">
                  <p className="text-sm font-black">{cat.name}</p>
                </div>
                {activeCategory === cat.id && <ChevronRight size={16} className="ml-auto" />}
              </button>
            ))}
          </div>

          <div className="p-6 bg-violet-600 text-white">
             <div className="flex items-center gap-2 mb-2">
               <Zap size={16} className="fill-white" />
               <span className="text-xs font-black uppercase">Pro Tip</span>
             </div>
             <p className="text-[10px] font-bold opacity-80 leading-relaxed">
               Use YOLOv8 for modern computer vision tasks. It's optimized for both speed and accuracy.
             </p>
          </div>
        </div>

        {/* Right Content - Formats & Progress */}
        <div className="flex-1 flex flex-col bg-white overflow-hidden">
          <div className="flex items-center justify-between p-6 border-b border-gray-100 shrink-0">
             <div>
                <h3 className="text-lg font-black text-gray-900">{CATEGORIES.find(c => c.id === activeCategory)?.name}</h3>
                <p className="text-xs font-bold text-gray-400 mt-0.5">{CATEGORIES.find(c => c.id === activeCategory)?.description}</p>
             </div>
             <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400">
               <X size={20} />
             </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {status === "idle" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {CATEGORIES.find(c => c.id === activeCategory)?.formats.map(format => (
                  <button
                    key={format.id}
                    onClick={() => setSelectedFormat(format.id)}
                    className={`flex items-start gap-4 p-4 rounded-2xl border-2 transition-all duration-200 text-left ${
                      selectedFormat === format.id 
                        ? "border-violet-600 bg-violet-50/50 shadow-sm" 
                        : "border-gray-100 hover:border-gray-200 bg-white"
                    }`}
                  >
                    <div className="text-2xl mt-1">{format.icon}</div>
                    <div className="flex-1 min-w-0">
                       <p className={`text-sm font-black ${selectedFormat === format.id ? "text-violet-600" : "text-gray-900"}`}>
                         {format.name}
                       </p>
                       <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter mt-0.5">
                         {format.framework} Compatible
                       </p>
                    </div>
                    {selectedFormat === format.id && (
                      <div className="w-5 h-5 bg-violet-600 rounded-full flex items-center justify-center">
                        <CheckCircle size={12} className="text-white" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}

            {(status === "preparing" || status === "processing" || status === "ready" || status === "failed") && (
              <div className="flex flex-col items-center justify-center h-full max-w-sm mx-auto text-center py-10">
                 {status === "preparing" || status === "processing" ? (
                    <div className="relative mb-8">
                       <div className="w-24 h-24 rounded-full border-4 border-gray-100 border-t-violet-600 animate-spin" />
                       <div className="absolute inset-0 flex items-center justify-center font-black text-violet-600">
                         {progress}%
                       </div>
                    </div>
                 ) : status === "ready" ? (
                    <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mb-6 animate-in zoom-in duration-300">
                       <CheckCircle size={40} className="text-emerald-500" />
                    </div>
                 ) : (
                    <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mb-6">
                       <AlertTriangle size={40} className="text-rose-500" />
                    </div>
                 )}

                 <h4 className="text-xl font-black text-gray-900 mb-2">
                    {status === "preparing" ? "Preparing Dataset..." : 
                     status === "processing" ? "Converting Formats..." : 
                     status === "ready" ? "Export Complete!" : "Export Failed"}
                 </h4>
                 <p className="text-sm font-bold text-gray-400 mb-8">
                    {status === "preparing" ? "Scanning assets and validating metadata." : 
                     status === "processing" ? "Translating annotations and zipping files." : 
                     status === "ready" ? "Your framework-compatible dataset is ready for download." : 
                     error || "Check your network connection and try again."}
                 </p>

                 {status === "ready" && (
                   <button 
                     onClick={handleDownload}
                     className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-black py-4 rounded-2xl transition-all shadow-lg shadow-violet-200"
                   >
                     <Download size={20} /> Download Dataset
                   </button>
                 )}

                 {status === "failed" && (
                   <button 
                     onClick={() => setStatus("idle")}
                     className="w-full bg-gray-900 hover:bg-black text-white font-black py-4 rounded-2xl transition-all"
                   >
                     Try Again
                   </button>
                 )}
              </div>
            )}
          </div>

          <div className="p-6 border-t border-gray-100 bg-gray-50/50 shrink-0 flex items-center justify-between">
             <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 text-xs font-black text-gray-400">
                   <Clock size={14} /> Link expires in 24h
                </div>
                <div className="flex items-center gap-1.5 text-xs font-black text-gray-400">
                   <Settings size={14} /> {assetIds.length || "All"} images selected
                </div>
             </div>
             
             {status === "idle" && (
               <div className="flex gap-3">
                 <button 
                   onClick={onClose}
                   className="px-6 py-3 text-sm font-black text-gray-600 hover:text-gray-900 transition-colors"
                 >
                   Cancel
                 </button>
                 <button 
                   onClick={handleStartExport}
                   className="px-8 py-3 bg-violet-600 hover:bg-violet-700 text-white text-sm font-black rounded-2xl transition-all shadow-lg shadow-violet-200 flex items-center gap-2"
                 >
                   Start Export <ChevronRight size={18} />
                 </button>
               </div>
             )}
          </div>
        </div>
      </div>
    </div>
  );
}
