import React, { useState, useRef, useEffect } from "react";
import Layout from "../components/Layout";
import { UploadCloud, FileImage, ArrowUp, Database, FileCode, Film, FileText, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Uploads() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("global");

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await fetch("/api/projects");
        if (res.ok) {
          setProjects(await res.json());
        }
      } catch (err) {
        console.error(err);
      }
    };

    fetchProjects();
  }, []);

  const uploadFile = async (file, targetProjectId) => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const percentComplete = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(prev => ({ ...prev, [file.name]: percentComplete }));
        }
      });
      xhr.onload = () => resolve(xhr.response);
      xhr.onerror = () => reject(xhr.statusText);
      xhr.open("POST", "/api/assets");
      const formData = new FormData();
      formData.append("file", file);
      if (targetProjectId) {
        formData.append("project_id", targetProjectId);
      }
      xhr.send(formData);
    });
  };

  const processFiles = async (files) => {
    if (!files.length) return;
    setIsUploading(true);
    
    let targetProjectId = selectedProjectId;
    let projData = projects.find(proj => proj.id === selectedProjectId);

    if (selectedProjectId === "global") {
       try {
         const res = await fetch("/api/projects", {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ name: `Batch ${new Date().toLocaleDateString()}`, project_type: "Object Detection" })
         });
         projData = await res.json();
         targetProjectId = projData.id;
       } catch (err) {
         console.error("Failed to auto-create project", err);
       }
    }

    const initialProgress = {};
    for (let i = 0; i < files.length; i++) initialProgress[files[i].name] = 0;
    setUploadProgress(initialProgress);
    
    const promises = [];
    for (let i = 0; i < files.length; i++) {
       promises.push(uploadFile(files[i], targetProjectId));
    }
    
    await Promise.all(promises);
    setIsUploading(false);
    
    if (projData) {
       navigate('/upload', { 
         state: { 
           projectId: projData.id, 
           projectName: projData.name, 
           visibility: projData.visibility || 'Public', 
           projectType: projData.project_type || 'Object Detection', 
           classificationType: projData.classification_type, 
           activeTab: 'annotate' 
         } 
       });
    } else {
       setTimeout(() => setUploadProgress({}), 3000);
    }
  };

  const handleFileChange = (e) => processFiles(e.target.files);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) processFiles(e.dataTransfer.files);
  };

  return (
    <Layout>
      <div className="w-full max-w-[1200px] mx-auto pt-6 pb-12 flex flex-col min-h-full animate-page-enter">
        <div className="flex flex-col mb-8 bg-white border border-gray-200 rounded-xl p-6 md:p-10 shadow-sm relative overflow-visible">
          {/* Decorative background accent */}
          <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-gradient-to-bl from-violet-100/50 to-transparent rounded-full transform translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>

          <h1 className="text-[28px] font-bold text-gray-900 tracking-tight mb-2">Workspace Uploads</h1>
          <p className="text-gray-500 font-medium text-[15px] max-w-[600px] mb-8">
            Upload images, videos, and annotations directly to your global asset library, or route them straight down into an existing project.
          </p>

          <div className="flex flex-col sm:flex-row gap-6 mb-8 relative z-10 w-full">
            <div className="flex-1 max-w-[400px]">
              <label className="block text-[13px] font-bold text-gray-700 mb-2">Route Uploads To:</label>
              <select 
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full border border-gray-300 rounded-[8px] px-3 py-2.5 text-[14px] text-gray-800 outline-none focus:border-violet-500 shadow-sm bg-white"
              >
                <option value="global">Global Asset Library (No Project)</option>
                <optgroup label="Your Projects">
                   {projects.map(p => (
                     <option key={p.id} value={p.id}>{p.name}</option>
                   ))}
                </optgroup>
              </select>
            </div>
            
            <div className="flex-1 flex items-end">
               <div className="flex items-center gap-3 bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-100 px-4 py-2.5 rounded-[8px] shadow-sm mb-0.5">
                  <Database className="text-violet-500" size={18} />
                  <div className="flex flex-col">
                     <span className="text-[11px] font-bold text-violet-800 uppercase tracking-widest leading-none mb-0.5">Enterprise Vault</span>
                     <span className="text-[13px] font-medium text-gray-600 leading-none">Unlimited workspace storage enabled</span>
                  </div>
               </div>
            </div>
          </div>

          <div 
            className={`w-full relative border rounded-[20px] p-8 sm:p-12 flex flex-col items-center shadow-sm transition-all z-10 ${isDragging ? 'bg-violet-50 border-violet-400 border-2 border-dashed' : 'bg-gray-50/50 border-gray-200'}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <div className="absolute inset-0 border-2 border-dashed border-gray-300 rounded-[20px] pointer-events-none opacity-50 m-2"></div>
            
            <div className="w-20 h-20 rounded-full bg-white shadow-sm flex items-center justify-center mb-6">
              <UploadCloud size={32} className={isDragging ? 'text-violet-500' : 'text-gray-500'} strokeWidth={2} />
            </div>
            
            <h3 className="text-[22px] font-bold text-gray-900 mb-8 tracking-tight text-center">Drag and drop to upload, or:</h3>
            
            <div className="flex flex-col sm:flex-row gap-4 mb-10 w-full sm:w-auto relative z-10">
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="bg-white border hover:border-violet-300 text-gray-800 w-full sm:w-auto px-8 py-3 rounded-[10px] flex items-center justify-center font-bold text-[15px] gap-2 hover:bg-violet-50 hover:text-violet-700 transition-all shadow-sm border-gray-300 disabled:opacity-70 disabled:cursor-wait active:scale-95"
              >
                 <FileImage size={18} className="text-gray-500" /> {isUploading ? "Uploading..." : "Select Files"}
              </button>
              <input 
                type="file" 
                multiple 
                accept="image/*,video/mp4,video/quicktime"
                ref={fileInputRef} 
                style={{ display: 'none' }} 
                onChange={handleFileChange} 
              />
            </div>
          </div>

          {/* Upload Progress */}
          {Object.keys(uploadProgress).length > 0 && (
            <div className="w-full mt-8 flex flex-col gap-4 max-h-[300px] overflow-y-auto pr-2 z-10 relative">
              <h4 className="font-bold text-gray-800 text-[15px]">Uploading {Object.keys(uploadProgress).length} Files...</h4>
              {Object.entries(uploadProgress).map(([fileName, progress]) => (
                <div key={fileName} className="flex flex-col bg-white border border-gray-200 rounded-[10px] p-4 shadow-sm">
                  <div className="flex justify-between text-[14px] mb-3">
                    <span className="font-semibold text-gray-700 truncate max-w-[80%]">{fileName}</span>
                    <span className="text-violet-600 font-bold">{progress}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2 border border-gray-200">
                    <div className="bg-violet-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
