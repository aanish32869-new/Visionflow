import React from 'react';
import { Sparkles, Brain, Settings } from 'lucide-react';
import { useAnnotation } from '../AnnotationContext';
import { useAnnotationAPI } from '../hooks/useAnnotationAPI';

export default function AutoLabelTab() {
  const { 
    autoLabelModel, setAutoLabelModel, confidenceThreshold, setConfidenceThreshold,
    autoLabelAll, setAutoLabelAll, isSaving, classes
  } = useAnnotation();

  const { handleAutoLabel } = useAnnotationAPI();

  return (
    <div className="h-full flex flex-col p-5 bg-white">
       <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center text-violet-600 shadow-inner">
             <Brain size={20} />
          </div>
          <div>
             <h3 className="text-[13px] font-black text-gray-900 uppercase tracking-tight">AI Assistance</h3>
             <p className="text-[10px] font-bold text-gray-400">CONFIG & RUN AUTO-LABEL</p>
          </div>
       </div>

       <div className="space-y-6 flex-1 overflow-y-auto pr-1">
          <div className="space-y-3">
             <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <Settings size={12} /> Model Selection
             </label>
             <select 
                value={autoLabelModel}
                onChange={(e) => setAutoLabelModel(e.target.value)}
                className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 text-[13px] font-bold outline-none focus:ring-2 focus:ring-violet-200 transition appearance-none"
             >
                <option value="yolov8x.pt">YOLOv8x (Standard)</option>
                <option value="yolov26s.pt">YOLOv26s (High Precision)</option>
                <option value="sam_vit_h">Segment Anything (SAM)</option>
                <option value="clip">CLIP Zero-Shot</option>
             </select>
          </div>

          <div className="space-y-3">
             <div className="flex justify-between items-center">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Confidence Threshold</label>
                <span className="text-[11px] font-black text-violet-600 bg-violet-50 px-2 py-0.5 rounded-lg border border-violet-100">{(confidenceThreshold * 100).toFixed(0)}%</span>
             </div>
             <input 
                type="range" 
                min="0.1" max="1" step="0.05"
                value={confidenceThreshold}
                onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-violet-600"
             />
          </div>

          <div className="p-4 rounded-2xl bg-gray-50/80 border border-gray-100/50 space-y-4">
             <div className="flex items-center justify-between">
                <div>
                   <h4 className="text-[12px] font-black text-gray-800">Detect All Classes</h4>
                   <p className="text-[10px] font-bold text-gray-400">Open-vocabulary detection</p>
                </div>
                <button 
                  onClick={() => setAutoLabelAll(!autoLabelAll)}
                  className={`w-12 h-6 rounded-full transition-all relative ${autoLabelAll ? 'bg-violet-600 shadow-md shadow-violet-100' : 'bg-gray-300'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoLabelAll ? 'left-7' : 'left-1 shadow-sm'}`}></div>
                </button>
             </div>
             
             {!autoLabelAll && (
               <div className="pt-2 border-t border-gray-200/50">
                  <p className="text-[10px] font-bold text-gray-500 italic">
                     Currently targeting {classes.length} project classes.
                  </p>
               </div>
             )}
          </div>
       </div>

       <div className="mt-auto pt-6 border-t border-gray-100">
          <button 
             onClick={() => handleAutoLabel()}
             disabled={isSaving}
             className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-3 shadow-xl shadow-violet-100 transition active:scale-95 text-sm uppercase tracking-widest"
          >
             <Sparkles size={20} className="animate-pulse" />
             {isSaving ? "AI Processing..." : "Run AI Labeler"}
          </button>
       </div>
    </div>
  );
}
