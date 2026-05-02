import React, { useState, useEffect } from "react";
import { 
  X, Download, CheckCircle, AlertTriangle, Clock, 
  Settings, Zap, Box, Layers, Image as ImageIcon, 
  ChevronRight, FileText, Loader2, ExternalLink,
  Code, Terminal, Copy
} from "lucide-react";
import logger from "../utils/logger";

const FORMATS = [
  { id: "yolov8", name: "YOLOv8", framework: "Ultralytics", icon: "⚡" },
  { id: "yolov5", name: "YOLOv5", framework: "Ultralytics", icon: "🔥" },
  { id: "coco", name: "COCO JSON", framework: "Standard", icon: "📦" },
  { id: "voc", name: "Pascal VOC", framework: "XML", icon: "📄" },
  { id: "createml", name: "CreateML", framework: "Apple", icon: "🍎" },
  { id: "classification", name: "Folder Structure", framework: "PyTorch/TF", icon: "📁" },
  { id: "coco_seg", name: "COCO Segmentation", framework: "JSON", icon: "🧩" }
];

export default function VersionDownloadModal({ isOpen, onClose, projectId, version }) {
  const [selectedFormat, setSelectedFormat] = useState("yolov8");
  const [exportId, setExportId] = useState(null);
  const [status, setStatus] = useState("idle"); // 'idle' | 'preparing' | 'processing' | 'ready' | 'failed'
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [exportData, setExportData] = useState(null);
  const [activeTab, setActiveTab] = useState("download"); // 'download' | 'code'

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
          version_id: version.version_id,
          is_version_export: true
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
      <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[650px] border border-white/20">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 shrink-0">
           <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 bg-violet-100 text-violet-700 text-[10px] font-black rounded-md uppercase tracking-wider">Version {version.version_number}</span>
                <h2 className="text-xl font-black text-gray-900 flex items-center gap-2">
                  <Download className="text-violet-600" size={24} /> Download Dataset
                </h2>
              </div>
              <p className="text-xs font-bold text-gray-400 mt-1 uppercase tracking-wider">Download frozen snapshot in your preferred format</p>
           </div>
           <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400">
             <X size={20} />
           </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 bg-gray-50/30">
          <button 
            onClick={() => setActiveTab("download")}
            className={`px-8 py-3 text-sm font-black transition-all border-b-2 ${activeTab === "download" ? "border-violet-600 text-violet-600 bg-white" : "border-transparent text-gray-400 hover:text-gray-600"}`}
          >
            Download ZIP
          </button>
          <button 
            onClick={() => setActiveTab("code")}
            className={`px-8 py-3 text-sm font-black transition-all border-b-2 ${activeTab === "code" ? "border-violet-600 text-violet-600 bg-white" : "border-transparent text-gray-400 hover:text-gray-600"}`}
          >
            Code Snippet
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          {status === "idle" ? (
            activeTab === "download" ? (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {FORMATS.map(format => (
                    <button
                      key={format.id}
                      onClick={() => setSelectedFormat(format.id)}
                      className={`flex items-start gap-4 p-4 rounded-2xl border-2 transition-all duration-200 text-left h-full ${
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
                           {format.framework}
                         </p>
                      </div>
                      {selectedFormat === format.id && (
                        <div className="w-5 h-5 bg-violet-600 rounded-full flex items-center justify-center shrink-0">
                          <CheckCircle size={12} className="text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-gray-900 rounded-2xl p-6 relative group">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-gray-400">
                      <Terminal size={16} />
                      <span className="text-xs font-black uppercase tracking-widest">Python SDK</span>
                    </div>
                    <button className="text-gray-400 hover:text-white transition">
                      <Copy size={16} />
                    </button>
                  </div>
                  <pre className="text-sm font-mono text-emerald-400 overflow-x-auto whitespace-pre">
                    {`import visionflow\n\nproject = visionflow.Project("${projectId}")\nversion = project.version(${version.version_number})\n\nversion.download(format="${selectedFormat}")`}
                  </pre>
                </div>

                <div className="bg-gray-900 rounded-2xl p-6 relative group">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-gray-400">
                      <Code size={16} />
                      <span className="text-xs font-black uppercase tracking-widest">cURL Command</span>
                    </div>
                    <button className="text-gray-400 hover:text-white transition">
                      <Copy size={16} />
                    </button>
                  </div>
                  <pre className="text-sm font-mono text-blue-400 overflow-x-auto whitespace-pre">
                    {`curl -X GET "https://api.visionflow.ai/v1/download?version=${version.version_id}&format=${selectedFormat}" \\\n     -H "Authorization: Bearer YOUR_API_KEY"`}
                  </pre>
                </div>
              </div>
            )
          ) : (
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
                  {status === "preparing" ? "Preparing Version..." : 
                   status === "processing" ? "Converting Formats..." : 
                   status === "ready" ? "Download Ready!" : "Export Failed"}
               </h4>
               <p className="text-sm font-bold text-gray-400 mb-8">
                  {status === "preparing" ? "Retrieving immutable snapshot data." : 
                   status === "processing" ? "Structuring dataset and zipping files." : 
                   status === "ready" ? "The requested format has been successfully packaged." : 
                   error || "Check your network connection and try again."}
               </p>

               {status === "ready" && (
                 <button 
                   onClick={handleDownload}
                   className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-black py-4 rounded-2xl transition-all shadow-lg shadow-violet-200"
                 >
                   <Download size={20} /> Download ZIP
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

        {/* Footer */}
        <div className="p-6 border-t border-gray-100 bg-gray-50/50 shrink-0 flex items-center justify-between">
           <div className="flex items-center gap-1.5 text-xs font-black text-gray-400">
              <Zap size={14} /> Caching enabled: exports are stored for instant reuse
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
                 {activeTab === "download" ? "Start Download" : "Generate Link"} <ChevronRight size={18} />
               </button>
             </div>
           )}
        </div>
      </div>
    </div>
  );
}
