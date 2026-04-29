import React, { useState, useEffect, useRef } from "react";
import { 
  Search, Filter, ArrowUpDown, Database, BarChart2,
  Sparkles, Download, ArrowRight, AlertTriangle, CheckCircle,
  Image as ImageIcon, Upload, FileText, Activity, Layers, Tag,
  HelpCircle, ChevronDown, Grid, List, Check, CheckSquare, Square,
  Camera, Layout
} from "lucide-react";
import AnnotatedThumbnail from "./AnnotatedThumbnail";
import DatasetOverview from "./DatasetOverview";
import logger from "../utils/logger";

export default function DatasetTab({ projectId, onImageClick }) {
  const [summary, setSummary] = useState(null);
  const [classesData, setClassesData] = useState([]);
  const [imagesData, setImagesData] = useState({ items: [], total_items: 0, total_pages: 1, current_page: 1 });
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  
  // -- Top Control Bar State --
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  
  const [page, setPage] = useState(1);
  const [splitFilter, setSplitFilter] = useState("all"); 
  const [statusFilter, setStatusFilter] = useState("all"); 
  const [filenameFilter, setFilenameFilter] = useState("");
  const [classesFilter, setClassesFilter] = useState(""); // Comma separated for now
  const [tagsFilter, setTagsFilter] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [viewMode, setViewMode] = useState("grid"); // 'grid' | 'list'
  
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [activeView, setActiveView] = useState("overview"); // 'overview' | 'images'


  // Debounce Search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1); // Reset to page 1 on search
    }, 500);
    return () => clearTimeout(handler);
  }, [searchInput]);

  useEffect(() => {
    if (projectId) {
      fetchDashboardData();
      const interval = setInterval(() => {
        fetchDashboardData();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) {
      fetchImages();
    }
  }, [projectId, page, splitFilter, statusFilter, sortBy, debouncedSearch, filenameFilter, classesFilter, tagsFilter]);

  const fetchDashboardData = async () => {
    try {
      const [summaryRes, classesRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/dataset/summary`),
        fetch(`/api/projects/${projectId}/dataset/classes`)
      ]);

      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (classesRes.ok) setClassesData(await classesRes.json());
    } catch (err) {
      logger.error("Failed to fetch dashboard data", err);
    }
  };

  const fetchImages = async () => {
    setLoading(true);
    try {
      let url = `/api/projects/${projectId}/dataset/images?page=${page}&limit=24&sort_by=${sortBy}`;
      if (splitFilter !== "all") url += `&split=${splitFilter}`;
      if (statusFilter !== "all") url += `&status=${statusFilter}`;
      if (debouncedSearch) url += `&search=${encodeURIComponent(debouncedSearch)}`;
      if (filenameFilter) url += `&filename=${encodeURIComponent(filenameFilter)}`;
      if (classesFilter) url += `&classes=${encodeURIComponent(classesFilter)}`;
      if (tagsFilter) url += `&tags=${encodeURIComponent(tagsFilter)}`;

      const res = await fetch(url);
      if (res.ok) {
        setImagesData(await res.json());
      }
    } catch (err) {
      logger.error("Failed to fetch dataset images", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAll = () => {
    if (selectedImages.size === imagesData.items.length) {
      setSelectedImages(new Set());
    } else {
      setSelectedImages(new Set(imagesData.items.map(img => img.id || img._id)));
    }
  };

  const toggleImageSelection = (id) => {
    const newSelection = new Set(selectedImages);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedImages(newSelection);
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/dataset/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_ids: Array.from(selectedImages),
          format: 'coco' // Defaulting to coco, can be made a dropdown later
        })
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.download_url) {
          const link = document.createElement('a');
          link.href = data.download_url;
          link.download = `dataset_export.zip`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      } else {
        logger.error("Export failed:", await res.text());
        alert("Failed to export dataset. Please try again.");
      }
    } catch (err) {
      logger.error("Error exporting dataset:", err);
      alert("An error occurred while exporting.");
    } finally {
      setIsExporting(false);
    }
  };

  if (!summary) {
    return (
      <div className="flex flex-col items-center justify-center h-full animate-pulse bg-white">
        <div className="w-12 h-12 border-4 border-violet-100 border-t-violet-600 rounded-full animate-spin mb-4" />
        <p className="text-gray-400 text-sm font-bold">Loading Dataset...</p>
      </div>
    );
  }

  const warnings = [];
  if (summary.health?.score < 60) {
    summary.health.recommendations.forEach(r => warnings.push(r));
  }
  if (summary.total_images < 50) {
    warnings.push("Dataset size is very small. Consider adding more images.");
  }
  
  const allSelectedOnPage = imagesData.items.length > 0 && selectedImages.size === imagesData.items.length;

  return (
    <div className="flex flex-col h-full bg-gray-50/30 overflow-hidden">
      
      {/* --- TOP NAVIGATION / CONTROL BAR --- */}
      <div className="bg-white border-b border-gray-200 z-10 shrink-0">
        
        {/* 1. Header Section */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-black text-gray-900">Dataset</h1>
            <a href="#" className="text-sm font-bold text-gray-400 hover:text-violet-600 flex items-center gap-1 transition">
              <HelpCircle size={14} /> How to Search
            </a>
          </div>
          <div className="flex items-center gap-3">
             <div className="flex items-center bg-gray-100 rounded-xl p-1 mr-2">
               <button 
                 onClick={() => setActiveView('overview')}
                 className={`px-4 py-1.5 rounded-lg text-xs font-black transition ${activeView === 'overview' ? 'bg-white text-violet-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
               >
                 Overview
               </button>
               <button 
                 onClick={() => setActiveView('images')}
                 className={`px-4 py-1.5 rounded-lg text-xs font-black transition ${activeView === 'images' ? 'bg-white text-violet-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
               >
                 Images
               </button>
             </div>
             <button className="btn-primary text-sm font-bold flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg shadow-sm hover:bg-violet-700 transition">
               Train Model <ChevronDown size={14} />
             </button>
          </div>
        </div>

        {/* 2. Search Bar Section */}
        <div className="px-6 py-3 flex items-center gap-3">
           <div className="relative flex-1">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
             <input 
               type="text" 
               placeholder="Search images by name or tags..."
               value={searchInput}
               onChange={(e) => setSearchInput(e.target.value)}
               className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium outline-none focus:border-violet-400 focus:bg-white transition"
             />
           </div>
           <button 
             onClick={() => setPage(1)} // Force search refresh
             className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-bold rounded-lg hover:bg-gray-50 shadow-sm transition"
           >
             Search
           </button>
           <button 
             onClick={handleExport}
             disabled={isExporting}
             className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-bold rounded-lg hover:bg-gray-50 shadow-sm transition flex items-center gap-2 disabled:opacity-50"
           >
             {isExporting ? <div className="w-4 h-4 border-2 border-gray-300 border-t-violet-600 rounded-full animate-spin"></div> : <Download size={16} />}
             {isExporting ? "Exporting..." : "Export"}
           </button>
        </div>

        {/* 3. Filter & Controls Row */}
        <div className="px-6 py-2 border-b border-gray-100 flex flex-wrap items-center gap-3 bg-gray-50/50">
           <div className="flex items-center bg-white border border-gray-200 rounded-md overflow-hidden">
             <input 
               type="text" 
               placeholder="Filter by filename"
               value={filenameFilter}
               onChange={e => setFilenameFilter(e.target.value)}
               className="px-3 py-1.5 text-xs font-bold text-gray-700 outline-none w-36"
             />
           </div>
           
           <select 
             value={splitFilter} 
             onChange={e => setSplitFilter(e.target.value)}
             className="text-xs font-bold text-gray-700 bg-white border border-gray-200 rounded-md px-2 py-1.5 outline-none focus:border-violet-400"
           >
             <option value="all">All Splits</option>
             <option value="train">Train</option>
             <option value="valid">Valid</option>
             <option value="test">Test</option>
           </select>

           <input 
             type="text" 
             placeholder="Classes (comma sep)"
             value={classesFilter}
             onChange={e => setClassesFilter(e.target.value)}
             className="px-3 py-1.5 text-xs font-bold text-gray-700 bg-white border border-gray-200 rounded-md outline-none w-36"
           />

           <input 
             type="text" 
             placeholder="Tags (comma sep)"
             value={tagsFilter}
             onChange={e => setTagsFilter(e.target.value)}
             className="px-3 py-1.5 text-xs font-bold text-gray-700 bg-white border border-gray-200 rounded-md outline-none w-36"
           />

           <select 
             value={sortBy} 
             onChange={e => setSortBy(e.target.value)}
             className="text-xs font-bold text-gray-700 bg-white border border-gray-200 rounded-md px-2 py-1.5 outline-none focus:border-violet-400"
           >
             <option value="newest">Newest First</option>
             <option value="oldest">Oldest First</option>
             <option value="filename">Filename</option>
           </select>

           <div className="ml-auto flex items-center">
             <button className="px-3 py-1.5 bg-violet-50 text-violet-700 border border-violet-200 text-xs font-bold rounded-md hover:bg-violet-100 transition flex items-center gap-1.5">
               <Camera size={14} /> Search by Image
             </button>
           </div>
        </div>

        {/* 4. Selection & View Controls */}
        <div className="px-6 py-2 flex items-center justify-between text-sm bg-white">
          <div className="flex items-center gap-3">
             <button 
               onClick={handleSelectAll}
               className="flex items-center gap-2 text-gray-700 hover:text-violet-600 transition"
             >
               {allSelectedOnPage ? <CheckSquare size={18} className="text-violet-600"/> : <Square size={18} className="text-gray-400"/>}
               <span className="font-bold">{selectedImages.size} images selected</span>
             </button>
          </div>
          <div className="flex items-center gap-6">
             <label className="flex items-center gap-2 cursor-pointer">
                <span className="font-bold text-gray-500 text-xs">Show annotations</span>
                <div 
                  onClick={() => setShowAnnotations(!showAnnotations)}
                  className={`w-9 h-5 rounded-full relative transition-colors ${showAnnotations ? 'bg-violet-600' : 'bg-gray-300'}`}
                >
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${showAnnotations ? 'left-5' : 'left-1'}`} />
                </div>
             </label>
             
             <div className="flex items-center bg-gray-100 rounded-md p-0.5">
               <button 
                 onClick={() => setViewMode('grid')}
                 className={`p-1 rounded ${viewMode === 'grid' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-700'}`}
               >
                 <Grid size={16} />
               </button>
               <button 
                 onClick={() => setViewMode('list')}
                 className={`p-1 rounded ${viewMode === 'list' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-700'}`}
               >
                 <List size={16} />
               </button>
             </div>
          </div>
        </div>

      </div>

      {/* --- MAIN CONTENT AREA --- */}
      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-gray-50/50">
        
        {activeView === 'overview' ? (
          <div className="max-w-7xl mx-auto">
            <DatasetOverview 
              summary={summary} 
              classesData={classesData} 
              onUpload={() => document.getElementById('project-file-input')?.click()}
              onAnnotate={() => {
                // This usually requires switching tabs in ProjectUpload.jsx
                // But we can trigger a message or use a prop-based callback if available.
                window.dispatchEvent(new CustomEvent('visionflow_switch_tab', { detail: 'annotate' }));
              }}
              onGenerate={() => {
                window.dispatchEvent(new CustomEvent('visionflow_open_generate_modal'));
              }}
            />
          </div>
        ) : (
          <>
            {warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 shadow-sm mb-6 max-w-7xl mx-auto">
            <div className="flex items-center gap-2 text-amber-800 font-bold mb-1">
              <AlertTriangle size={16} /> Dataset Warnings
            </div>
            <ul className="list-disc list-inside text-xs font-medium text-amber-700">
              {warnings.map((w, idx) => <li key={idx}>{w}</li>)}
            </ul>
          </div>
        )}

        <div className="max-w-7xl mx-auto">
          {loading ? (
             <div className="flex items-center justify-center h-40">
               <div className="w-8 h-8 border-4 border-gray-200 border-t-violet-600 rounded-full animate-spin"></div>
             </div>
          ) : imagesData.items.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-60 text-center border-2 border-dashed border-gray-200 rounded-2xl">
                <div className="w-12 h-12 bg-gray-100 text-gray-400 rounded-full flex items-center justify-center mb-3">
                   <ImageIcon size={24} />
                </div>
                <p className="text-gray-600 font-bold">No images match your search</p>
                <p className="text-xs text-gray-400 mt-1">Try clearing filters or search terms</p>
             </div>
          ) : viewMode === 'grid' ? (
             <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {imagesData.items.map(asset => {
                  const isSelected = selectedImages.has(asset.id || asset._id);
                  return (
                  <div key={asset.id || asset._id} className="group relative">
                     <div className="relative">
                       <AnnotatedThumbnail 
                         asset={asset} 
                         showAnnotations={showAnnotations}
                         onClick={() => onImageClick && onImageClick(asset)}
                       />
                       <div 
                         onClick={(e) => { e.stopPropagation(); toggleImageSelection(asset.id || asset._id); }}
                         className={`absolute top-2 left-2 z-10 w-5 h-5 rounded border ${isSelected ? 'bg-violet-600 border-violet-600' : 'bg-white border-gray-300 opacity-0 group-hover:opacity-100'} flex items-center justify-center cursor-pointer transition shadow-sm`}
                       >
                         {isSelected && <Check size={12} className="text-white" strokeWidth={3}/>}
                       </div>
                     </div>
                     <div className="mt-2 px-1">
                        <div className="flex items-center justify-between">
                           <span className="text-[10px] font-bold text-gray-900 truncate" title={asset.filename}>{asset.filename}</span>
                           {asset.dataset_split && (
                             <span className={`text-[8px] font-black uppercase px-1 py-0.5 rounded ${
                               asset.dataset_split === 'train' ? 'text-violet-600 bg-violet-50' :
                               asset.dataset_split === 'valid' ? 'text-amber-600 bg-amber-50' : 'text-emerald-600 bg-emerald-50'
                             }`}>{asset.dataset_split}</span>
                           )}
                        </div>
                     </div>
                  </div>
                )})}
             </div>
          ) : (
             <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase">
                      <th className="p-3 w-10">
                        <div 
                         onClick={handleSelectAll}
                         className={`w-4 h-4 rounded border ${allSelectedOnPage ? 'bg-violet-600 border-violet-600' : 'bg-white border-gray-300'} flex items-center justify-center cursor-pointer`}
                        >
                         {allSelectedOnPage && <Check size={10} className="text-white" strokeWidth={3}/>}
                        </div>
                      </th>
                      <th className="p-3">Image</th>
                      <th className="p-3">Filename</th>
                      <th className="p-3">Split</th>
                      <th className="p-3">Annotations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {imagesData.items.map(asset => {
                      const isSelected = selectedImages.has(asset.id || asset._id);
                      return (
                      <tr key={asset.id || asset._id} className="border-b border-gray-100 hover:bg-gray-50 transition cursor-pointer" onClick={() => onImageClick && onImageClick(asset)}>
                        <td className="p-3" onClick={(e) => { e.stopPropagation(); toggleImageSelection(asset.id || asset._id); }}>
                          <div className={`w-4 h-4 rounded border ${isSelected ? 'bg-violet-600 border-violet-600' : 'bg-white border-gray-300'} flex items-center justify-center cursor-pointer`}>
                            {isSelected && <Check size={10} className="text-white" strokeWidth={3}/>}
                          </div>
                        </td>
                        <td className="p-3 w-20">
                          <img src={asset.url} alt={asset.filename} className="w-12 h-12 object-cover rounded bg-gray-100" />
                        </td>
                        <td className="p-3 text-sm font-bold text-gray-900">{asset.filename}</td>
                        <td className="p-3">
                           {asset.dataset_split && (
                             <span className={`text-[10px] font-black uppercase px-2 py-1 rounded ${
                               asset.dataset_split === 'train' ? 'text-violet-600 bg-violet-50' :
                               asset.dataset_split === 'valid' ? 'text-amber-600 bg-amber-50' : 'text-emerald-600 bg-emerald-50'
                             }`}>{asset.dataset_split}</span>
                           )}
                        </td>
                        <td className="p-3 text-sm font-medium text-gray-500">{asset.annotation_count || 0} boxes</td>
                      </tr>
                    )})}
                  </tbody>
                </table>
             </div>
          )}

          {/* Pagination */}
          {!loading && imagesData.total_pages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-4">
              <button 
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition shadow-sm"
              >
                Previous
              </button>
              <span className="text-sm font-bold text-gray-500">
                Page {imagesData.current_page} of {imagesData.total_pages}
              </span>
              <button 
                disabled={page >= imagesData.total_pages}
                onClick={() => setPage(p => p + 1)}
                className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition shadow-sm"
              >
                Next
              </button>
            </div>
          )}
        </div>
        </>
        )}

      </div>
    </div>
  );
}
