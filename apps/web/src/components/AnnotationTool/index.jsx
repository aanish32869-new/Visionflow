import React, { useEffect } from 'react';
import { AnnotationProvider, useAnnotation } from './AnnotationContext';
import Header from './Header';
import Thumbnails from './Thumbnails';
import Canvas from './Canvas';
import Sidebar from './Sidebar';
import ConflictModal from './Modals/ConflictModal';
import RejectModal from './Modals/RejectModal';
import { useAnnotationAPI } from './hooks/useAnnotationAPI';

function AnnotationToolInner() {
  const { 
    projectId, currentAssetIndex, currentAsset, initialAssetId, assets,
    setCurrentAssetIndex, feedback, setFeedback
  } = useAnnotation();

  const { fetchProjectLabels, fetchAnnotations } = useAnnotationAPI();

  // 1. Initial Load of Project Config
  useEffect(() => {
    if (projectId) {
      fetchProjectLabels();
    }
  }, [projectId]);

  // 2. Handle Shortcuts
  useEffect(() => {
    const down = (e) => { 
      // Add global shortcuts if needed, or they are handled in canvas hook
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  const hasInitialized = React.useRef(false);
  
  // 3. Handle initialAssetId routing
  useEffect(() => {
    if (!hasInitialized.current && assets && assets.length > 0) {
      if (initialAssetId) {
         const idx = assets.findIndex(a => a.id === initialAssetId);
         if (idx !== -1) setCurrentAssetIndex(idx);
         else setCurrentAssetIndex(0);
      } else {
         setCurrentAssetIndex(0);
      }
      hasInitialized.current = true;
    }
  }, [assets, initialAssetId]);

  // 4. Fetch Annotations on Asset change
  useEffect(() => {
    if (currentAsset) {
      fetchAnnotations(currentAsset.id);
    }
  }, [currentAssetIndex, currentAsset]);

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans overflow-hidden">
      <Header />
      
      <div className="flex flex-1 overflow-hidden relative">
        <Thumbnails />
        
        <Canvas />

        <Sidebar />

        {/* Global Feedback Overlay */}
        {feedback && (
          <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-5 duration-300">
             <div className={`px-6 py-3 rounded-2xl shadow-2xl font-black text-xs uppercase tracking-widest flex items-center gap-3 border-2 ${feedback.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-rose-50 border-rose-200 text-rose-600'}`}>
                <div className={`w-2 h-2 rounded-full ${feedback.type === 'success' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></div>
                {feedback.message}
                <button onClick={() => setFeedback(null)} className="ml-2 hover:opacity-50 transition"><X size={14} /></button>
             </div>
          </div>
        )}
      </div>

      <ConflictModal />
      <RejectModal />
    </div>
  );
}

// Export a wrapper that provides the context
export default function AnnotationTool(props) {
  return (
    <AnnotationProvider {...props}>
      <AnnotationToolInner />
    </AnnotationProvider>
  );
}

// Helper icons for feedback
function X({ size, className }) {
   return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M18 6L6 18M6 6l12 12"/></svg>
   )
}
