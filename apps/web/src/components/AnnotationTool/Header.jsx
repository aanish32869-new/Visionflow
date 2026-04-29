import React from 'react';
import { Save, Square, Hexagon, Tag, Sparkles, FileCheck, X, Hand } from 'lucide-react';
import { useAnnotation } from './AnnotationContext';
import { useAnnotationAPI } from './hooks/useAnnotationAPI';

export default function Header() {
  const {
    onBack, currentAssetIndex, assets, currentAsset,
    isClassification, tool, setTool, setCurrentPolygon,
    isSaving, saveAnnotations, handleAutoLabel,
    assetState, setAssetState, setShowRejectModal,
    setCurrentAssetIndex, showFeedback, updateAsset,
    setActiveTab, onBatchComplete
  } = useAnnotation();

  const { saveAnnotations: apiSave } = useAnnotationAPI();

  const navigateAsset = async (direction) => {
    const didSave = await apiSave();
    if (!didSave) return;
    const newIdx = currentAssetIndex + direction;
    if (newIdx >= 0 && newIdx < assets.length) {
      setCurrentAssetIndex(newIdx);
    }
  };

  return (
    <div className="h-16 border-b border-gray-200 flex items-center justify-between px-6 bg-white shrink-0">
      <div className="flex items-center gap-4">
        {onBack && (
          <button 
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-violet-600 transition -ml-2"
            title="Back to Kanban Board"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
        )}
        <div className="flex flex-col">
          <div className="flex items-center gap-2 text-[11px] font-bold text-gray-400 uppercase tracking-tighter">
            <span>Annotating Batch</span>
            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
            <span>Image {currentAssetIndex + 1} of {assets.length}</span>
          </div>
          <h2 className="text-[14px] font-black text-gray-900 truncate max-w-[240px]">
            {currentAsset?.filename || "Batch Asset"}
          </h2>
        </div>
        
        <div className="h-8 w-[1px] bg-gray-100 mx-2"></div>

        {/* Canvas Tools */}
        <div className="flex bg-gray-100/80 p-0.5 rounded-xl border border-gray-200/50">
           {!isClassification ? (
             <>
                <button 
                  onClick={() => setTool('box')} 
                  className={`px-3 py-1.5 rounded-lg flex items-center justify-center transition-all ${tool === 'box' ? 'bg-white text-violet-600 shadow-sm font-bold' : 'text-gray-500 hover:text-gray-900'}`}
                  title="Bounding Box"
                >
                   <Square size={16} />
                </button>
                <button 
                  onClick={() => { setTool('polygon'); setCurrentPolygon([]); }} 
                  className={`px-3 py-1.5 rounded-lg flex items-center justify-center transition-all ${tool === 'polygon' ? 'bg-white text-violet-600 shadow-sm font-bold' : 'text-gray-500 hover:text-gray-900'}`}
                  title="Polygon Tool"
                >
                   <Hexagon size={16} />
                </button>
                <button 
                  onClick={() => setTool('drag')} 
                  className={`px-3 py-1.5 rounded-lg flex items-center justify-center transition-all ${tool === 'drag' ? 'bg-white text-violet-600 shadow-sm font-bold' : 'text-gray-500 hover:text-gray-900'}`}
                  title="Drag / Pan Tool"
                >
                   <Hand size={16} />
                </button>
                <button 
                  onClick={() => setTool('magic')} 
                  className={`px-3 py-1.5 rounded-lg flex items-center justify-center transition-all ${tool === 'magic' ? 'bg-white text-violet-600 shadow-sm font-bold active:scale-95' : 'text-gray-500 hover:text-gray-900'}`}
                  title="Smart Click (Prompt AI)"
                >
                   <Sparkles size={16} />
                </button>
             </>
           ) : (
             <div className="px-3 py-1.5 text-[11px] font-black text-violet-700 uppercase tracking-widest flex items-center gap-1.5">
               <Tag size={13} strokeWidth={3} /> Tagging Mode
             </div>
           )}
        </div>
      </div>

      <div className="flex items-center gap-3">
         <div className="flex gap-1 bg-gray-50 p-1 rounded-lg border border-gray-100">
           <button 
              onClick={() => navigateAsset(-1)}
              disabled={currentAssetIndex === 0 || isSaving}
              className="w-10 h-8 flex items-center justify-center rounded-md hover:bg-white hover:text-violet-600 disabled:opacity-30 transition shadow-sm text-gray-500"
           >
             <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
           </button>
           <button 
              onClick={() => navigateAsset(1)}
              disabled={currentAssetIndex === assets.length - 1 || isSaving}
              className="w-10 h-8 flex items-center justify-center rounded-md hover:bg-white hover:text-violet-600 disabled:opacity-30 transition shadow-sm text-gray-500"
           >
             <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
           </button>
         </div>

         <div className="h-6 w-[1px] bg-gray-200 mx-2"></div>

         <button 
            onClick={apiSave}
            disabled={isSaving}
            className="px-5 py-2 text-xs font-black text-white bg-violet-600 hover:bg-violet-700 rounded-xl focus:outline-none flex items-center gap-2 whitespace-nowrap shadow-lg shadow-violet-100 transition active:scale-95"
         >
           <Save size={16} /> {isSaving ? "Saving..." : "Save Annotations"}
         </button>

         <button 
            onClick={() => {
               setActiveTab('auto-label');
               handleAutoLabel();
            }}
            disabled={isSaving}
            className="px-5 py-2 text-xs font-black text-violet-700 bg-violet-50 border border-violet-200 hover:bg-violet-100 rounded-xl focus:outline-none flex items-center gap-2 whitespace-nowrap transition active:scale-95"
         >
           <Sparkles size={16} className="text-violet-500" /> Auto Label
         </button>

         {assetState === 'approved' ? (
            <div className="flex items-center gap-2 px-5 py-2 bg-emerald-100 text-emerald-700 rounded-xl font-black text-xs border border-emerald-200 uppercase tracking-widest shadow-sm">
               <FileCheck size={16} strokeWidth={3} /> Approved
            </div>
         ) : (
            <div className="flex gap-2">
               <button 
                  onClick={async () => {
                     if (currentAsset?.batch_id) {
                        const res = await fetch(`/api/batches/${currentAsset.batch_id}/dataset`, {
                           method: 'POST',
                           headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify({ project_id: currentAsset.project_id })
                        });
                        if (res.ok) {
                           showFeedback("Batch moved to Dataset!", "success");
                           if (typeof onBatchComplete === 'function') onBatchComplete();
                        } else {
                           showFeedback("Failed to approve batch.");
                        }
                     } else {
                        // Fallback for single asset (if no batch_id)
                        const res = await fetch(`/api/assets/${currentAsset.id}/review`, {
                           method: 'PATCH',
                           headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify({ action: 'approve' })
                        });
                        if (res.ok) {
                           setAssetState('approved');
                           showFeedback("Image approved for Dataset!", "success");
                           if (typeof updateAsset === 'function') updateAsset(currentAsset.id, true, 'approved');
                        }
                     }
                  }}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-200 transition flex items-center gap-2 active:scale-95 uppercase tracking-widest"
               >
                  <FileCheck size={16} strokeWidth={2.5} /> Approve
               </button>
               <button 
                  onClick={async () => {
                     if (currentAsset?.batch_id) {
                        const res = await fetch(`/api/batches/${currentAsset.batch_id}/unassign`, {
                           method: 'PATCH',
                           headers: { 'Content-Type': 'application/json' }
                        });
                        if (res.ok) {
                           showFeedback("Batch moved to Unassigned!", "success");
                           if (typeof onBatchComplete === 'function') onBatchComplete();
                        } else {
                           showFeedback("Failed to reject batch.");
                        }
                     } else {
                        setShowRejectModal(true);
                     }
                  }}
                  className="px-5 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-xs font-black shadow-lg shadow-rose-200 transition flex items-center gap-2 active:scale-95 uppercase tracking-widest"
               >
                  <X size={16} strokeWidth={2.5} /> Reject
               </button>
            </div>
         )}
      </div>
    </div>
  );
}
