 
import React, { useState, useEffect } from 'react';
import { Search, Download, ChevronDown, Image as ImageIcon, LayoutGrid, List, Check, X } from "lucide-react";// Generic checkbox component for tags/projects dropdowns
const CheckToggle = ({ label, isClearAll }) => (
  <div className={`flex items-center ${isClearAll ? 'justify-between' : ''} px-2 py-1.5 hover:bg-gray-50 cursor-pointer rounded`}>
    <div className="flex items-center gap-2">
      <div className="flex items-center border border-gray-200 rounded-[4px] bg-gray-50">
        <div className="px-1 py-0.5 border-r border-gray-200 text-gray-300"><Check size={12} strokeWidth={3} /></div>
        <div className="px-1 py-0.5 text-gray-300"><X size={12} strokeWidth={3} /></div>
      </div>
      <span className="text-[13px] text-gray-700">{label}</span>
    </div>
    {isClearAll && <span className="text-[12px] text-gray-500">Clear All</span>}
  </div>
);

export default function AssetLibrary() {
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [activeDropdown, setActiveDropdown] = useState(null);
  const [viewMode, setViewMode] = useState('grid');
  const [assets, setAssets] = useState([]);

  async function fetchAssets() {
    try {
      const res = await fetch("/api/assets");
      const data = await res.json();
      setAssets(data);
    } catch (err) {
      console.error("Failed to fetch assets:", err);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAssets();
  }, []);

  const toggleDropdown = (name) => {
    setActiveDropdown(prev => prev === name ? null : name);
  };  return (
    <div className="w-full h-full flex flex-col animate-fade-in" onClick={() => activeDropdown && setActiveDropdown(null)}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <ImageIcon size={22} className="text-gray-600 stroke-[1.5px]" />
        <h2 className="text-[22px] font-semibold text-gray-900 tracking-tight">Workspace</h2>
        <a href="#" className="text-[#6B21A8] text-[13px] font-bold ml-2 hover:underline tracking-tight">How to Search</a>
      </div>

      {/* Main Search Bar */}
      <div className="flex flex-col md:flex-row items-center gap-3 mb-4">
        <div className="w-full relative flex-1">
          <input 
            type="text" 
            placeholder="Search images" 
            className="w-full px-4 py-2.5 border border-gray-300 rounded-[6px] text-[14px] outline-none focus:border-[#6B21A8] focus:ring-1 focus:ring-[#6B21A8] bg-white text-gray-800 shadow-sm"
          />
        </div>
        <button className="flex items-center justify-center gap-2 border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 px-5 py-2.5 rounded-[6px] text-[14px] font-semibold transition shadow-sm whitespace-nowrap active:scale-95">
          <Search size={16} className="text-gray-500" /> Search
        </button>
        <button className="flex items-center justify-center gap-2 border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 px-5 py-2.5 rounded-[6px] text-[14px] font-semibold transition shadow-sm whitespace-nowrap active:scale-95">
          <Download size={16} className="text-gray-500" /> Export
        </button>
      </div>

      {/* Secondary Filters Bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6" onClick={e => e.stopPropagation()}>
        <input 
          type="text" 
          placeholder="Filter by filename" 
          className="border border-gray-300 rounded-[6px] px-4 py-2 text-[14px] outline-none focus:border-[#6B21A8] focus:ring-1 focus:ring-[#6B21A8] shadow-sm min-w-[200px]"
        />
        
        {/* Split Dropdown */}
        <div className="relative">
          <button onClick={() => toggleDropdown('split')} className="flex items-center justify-between gap-2 border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 px-4 py-2 rounded-[6px] text-[14px] font-medium transition active:scale-95 min-w-[80px] shadow-sm">
            Split <ChevronDown size={14} className="text-gray-400" />
          </button>
          {activeDropdown === 'split' && (
             <div className="absolute top-full mt-2 left-0 w-[120px] bg-white border border-gray-200 rounded-[6px] shadow-lg py-1 z-20">
               <div className="px-4 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50 cursor-pointer">All</div>
               <div className="px-4 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50 cursor-pointer">Train</div>
               <div className="px-4 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50 cursor-pointer">Valid</div>
               <div className="px-4 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50 cursor-pointer">Test</div>
             </div>
          )}
        </div>
        
        {/* Tags Dropdown */}
        <div className="relative">
          <button onClick={() => toggleDropdown('tags')} className="flex items-center justify-between gap-2 border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 px-4 py-2 rounded-[6px] text-[14px] font-medium transition active:scale-95 min-w-[80px] shadow-sm">
            Tags <ChevronDown size={14} className="text-gray-400" />
          </button>
          {activeDropdown === 'tags' && (
             <div className="absolute top-full mt-2 left-0 w-[240px] bg-white border border-gray-200 rounded-[8px] shadow-lg p-2 z-20">
               <input type="text" placeholder="Search tags" className="w-full px-3 py-1.5 border border-gray-300 rounded-[6px] text-[13px] outline-none focus:border-[#6B21A8] focus:ring-1 focus:ring-[#6B21A8] mb-2 shadow-sm" />
               <CheckToggle label="Toggle All" isClearAll />
               <CheckToggle label="rapid-initial-data" />
             </div>
          )}
        </div>

        {/* Projects Dropdown */}
        <div className="relative">
          <button onClick={() => toggleDropdown('projects')} className="flex items-center justify-between gap-2 border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 px-4 py-2 rounded-[6px] text-[14px] font-medium transition active:scale-95 min-w-[100px] shadow-sm">
            Projects <ChevronDown size={14} className="text-gray-400" />
          </button>
          {activeDropdown === 'projects' && (
             <div className="absolute top-full mt-2 left-0 w-[240px] bg-white border border-gray-200 rounded-[8px] shadow-lg p-2 z-20">
               <input type="text" placeholder="Search projects" className="w-full px-3 py-1.5 border border-gray-300 rounded-[6px] text-[13px] outline-none focus:border-[#6B21A8] focus:ring-1 focus:ring-[#6B21A8] mb-2 shadow-sm" />
               <CheckToggle label="No project" />
               <CheckToggle label="Toggle All" isClearAll />
               <CheckToggle label="Find objects" />
               <CheckToggle label="wcwdw" />
             </div>
          )}
        </div>

        {/* Sort Dropdown */}
        <div className="relative">
          <button onClick={() => toggleDropdown('sort')} className="flex items-center justify-between gap-2 border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 px-4 py-2 rounded-[6px] text-[14px] font-medium transition active:scale-95 min-w-[140px] shadow-sm">
            Sort By <span className="text-gray-900 font-bold ml-1">Newest</span> <ChevronDown size={14} className="text-gray-400" />
          </button>
          {activeDropdown === 'sort' && (
             <div className="absolute top-full mt-2 left-0 w-[140px] bg-white border border-gray-200 rounded-[6px] shadow-lg py-1 z-20">
               <div className="px-4 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50 cursor-pointer">Newest</div>
               <div className="px-4 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50 cursor-pointer">Updated</div>
               <div className="px-4 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50 cursor-pointer">Filename</div>
               <div className="px-4 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50 cursor-pointer">Oldest</div>
             </div>
          )}
        </div>

        <button className="flex items-center justify-center gap-2 border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 px-4 py-2 rounded-[6px] text-[14px] font-medium transition shadow-sm active:scale-95 ml-auto md:ml-0">
          <ImageIcon size={16} className="text-gray-500" /> Search by Image
        </button>
      </div>

      {/* Checkbox and view toggles area */}
      <div className="flex items-center justify-between mb-4 pb-2">
        <div className="flex items-center gap-3">
           <div className="w-[18px] h-[18px] border-[1.5px] border-gray-300 rounded-[4px] flex items-center justify-center text-transparent hover:border-[#6B21A8] cursor-pointer bg-white transition-colors">
             {/* Note: In active state, this would have bg-[#6B21A8] */}
           </div>
           <span className="text-gray-500 text-[14px] font-medium">0 images selected</span>
        </div>

        <div className="flex items-center gap-5">
           {/* Toggle Switch */}
           <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => setShowAnnotations(!showAnnotations)}>
             <div className={`w-[36px] h-[20px] rounded-full p-[2px] transition-colors duration-200 shadow-inner flex items-center ${showAnnotations ? 'bg-[#6B21A8]' : 'bg-gray-300'}`}>
                <div className={`bg-white w-[16px] h-[16px] rounded-full shadow-sm transform transition-transform duration-200 ${showAnnotations ? 'translate-x-[16px]' : 'translate-x-[1px]'}`}></div>
             </div>
             <span className="text-[13px] font-bold text-[#6B21A8]">Show annotations</span>
           </div>

           {/* List / Grid Toggles */}
           <div className="flex items-center border border-gray-300 rounded-[6px] overflow-hidden shadow-sm">
             <button 
               onClick={() => setViewMode('list')}
               className={`p-2 transition border-r border-gray-300 ${viewMode === 'list' ? 'bg-[#F3E8FF] text-[#6B21A8]' : 'bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50'}`}
             >
               <List size={18} />
             </button>
             <button 
               onClick={() => setViewMode('grid')}
               className={`p-2 transition ${viewMode === 'grid' ? 'bg-[#F3E8FF] text-[#6B21A8]' : 'bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50'}`}
             >
               <LayoutGrid size={18} />
             </button>
           </div>
        </div>
      </div>
      
      {/* Dynamic Content Area */}
      <div className="flex-1 mt-4 border-t border-gray-200 pt-6">
        {assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center h-48 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            <p className="text-gray-500 font-medium text-[14px]">No assets found</p>
            <p className="text-gray-400 text-[12px] mt-1">Upload assets via API or wait for integration.</p>
          </div>
        ) : (
          <div className={`gap-4 ${viewMode === 'list' ? 'flex flex-col' : 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5'}`}>
            {assets.map((asset) => (
              <div key={asset.id} className="border border-gray-200 rounded-[8px] bg-white overflow-hidden hover:shadow-md transition-shadow cursor-pointer">
                 {asset.url ? (
                   <div className="w-full h-[120px] bg-gray-100 flex items-center justify-center overflow-hidden">
                     <img src={asset.url} alt={asset.filename} className="w-full h-full object-cover" />
                   </div>
                 ) : (
                   <div className="w-full h-[120px] bg-gray-100 flex items-center justify-center">
                      <ImageIcon className="text-gray-300 w-8 h-8"/>
                   </div>
                 )}
                 <div className="p-3">
                   <p className="font-bold text-gray-800 text-[12px] truncate">{asset.filename}</p>
                 </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
