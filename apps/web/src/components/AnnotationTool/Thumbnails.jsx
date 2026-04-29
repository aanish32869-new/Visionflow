import React, { useRef, useEffect } from 'react';
import { Check } from 'lucide-react';
import { useAnnotation } from './AnnotationContext';
import { useAnnotationAPI } from './hooks/useAnnotationAPI';

export default function Thumbnails() {
  const { assets, currentAssetIndex, setCurrentAssetIndex } = useAnnotation();
  const { saveAnnotations } = useAnnotationAPI();
  const listRef = useRef(null);

  // Auto-scroll to selected thumbnail
  useEffect(() => {
     if (listRef.current) {
        const selected = listRef.current.children[currentAssetIndex];
        if (selected) {
           selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
     }
  }, [currentAssetIndex]);

  return (
    <div className="w-52 bg-white border-r border-gray-200 flex flex-col shrink-0 overflow-hidden">
       <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/30">
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Image Batch</span>
          <span className="bg-violet-100 text-violet-700 text-[10px] font-black px-2 py-0.5 rounded-full">{assets.length}</span>
       </div>
       <div ref={listRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 custom-scrollbar scroll-smooth">
          {assets.map((asset, idx) => (
             <div 
                key={asset.id}
                onClick={async () => {
                   if (currentAssetIndex !== idx) {
                      await saveAnnotations();
                      setCurrentAssetIndex(idx);
                   }
                }}
                className={`relative aspect-[3/2] rounded-xl overflow-hidden border-2 transition-all cursor-pointer group shrink-0 ${currentAssetIndex === idx ? 'border-violet-500 ring-4 ring-violet-50 shadow-md scale-[1.02]' : 'border-gray-100 hover:border-violet-200 hover:shadow-sm'}`}
             >
                <img src={asset.url} className="w-full h-full object-cover" alt={`Thumb ${idx}`} />
                <div className={`absolute inset-0 bg-black/5 transition-opacity ${currentAssetIndex === idx ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'}`}></div>
                {asset.is_annotated && (
                   <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-emerald-500 rounded-full border-2 border-white flex items-center justify-center">
                      <Check size={8} className="text-white" strokeWidth={5} />
                   </div>
                )}
             </div>
          ))}
       </div>
    </div>
  );
}
