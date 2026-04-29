import React from 'react';
import { Trash, Edit3, Layers } from 'lucide-react';
import { useAnnotation, COLORS } from '../AnnotationContext';

export default function AnnotationsTab() {
  const { annotations, selectedIdx, setSelectedIdx, setAnnotations, isClassification } = useAnnotation();

  const removeAnnotation = (idx) => {
    setAnnotations(prev => prev.filter((_, i) => i !== idx));
    if (selectedIdx === idx) setSelectedIdx(-1);
    else if (selectedIdx > idx) setSelectedIdx(prev => prev - 1);
  };

  return (
    <div className="h-full flex flex-col p-5 bg-white">
       <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center text-violet-600 shadow-inner">
             <Layers size={20} />
          </div>
          <div>
             <h3 className="text-[13px] font-black text-gray-900 uppercase tracking-tight">Active Layers</h3>
             <p className="text-[10px] font-bold text-gray-400">{annotations.length} OBJECTS DETECTED</p>
          </div>
       </div>

       <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar flex flex-col gap-2">
          {annotations.map((ann, idx) => (
             <div 
                key={idx}
                onClick={() => setSelectedIdx(idx)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer ${selectedIdx === idx ? 'border-violet-500 bg-violet-50/50 shadow-sm' : 'border-gray-50 bg-gray-50/10 hover:border-violet-100 hover:bg-white'}`}
             >
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: ann.color || COLORS[0] }}></div>
                <div className="flex-1 flex flex-col">
                   <span className={`text-[12px] font-black tracking-tight ${selectedIdx === idx ? 'text-violet-700' : 'text-gray-600'}`}>{ann.label}</span>
                   {!isClassification && (
                      <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">{ann.type || 'box'}</span>
                   )}
                </div>
                <button 
                   onClick={(e) => { e.stopPropagation(); removeAnnotation(idx); }}
                   className="p-2 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition"
                >
                   <Trash size={14} />
                </button>
             </div>
          ))}
          {annotations.length === 0 && (
             <div className="h-40 flex flex-col items-center justify-center text-center opacity-40">
                <Edit3 size={32} className="mb-2 text-gray-400" />
                <p className="text-xs font-bold text-gray-500">No annotations yet.<br/>Draw on the image to start.</p>
             </div>
          )}
       </div>
    </div>
  );
}
