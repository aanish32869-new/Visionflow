import React from 'react';
import { Sparkles, AlertCircle, Trash, Plus } from 'lucide-react';
import { useAnnotation } from '../AnnotationContext';
import { useAnnotationAPI } from '../hooks/useAnnotationAPI';

export default function ConflictModal() {
  const { showAutoLabelConflict, setShowAutoLabelConflict } = useAnnotation();
  const { handleAutoLabel } = useAnnotationAPI();

  if (!showAutoLabelConflict) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
       <div className="bg-white rounded-[32px] w-full max-w-md overflow-hidden shadow-2xl border border-white/20 animate-in zoom-in-95 duration-200">
          <div className="p-8">
             <div className="w-16 h-16 bg-violet-100 rounded-2xl flex items-center justify-center text-violet-600 mb-6 shadow-sm">
                <Sparkles size={32} />
             </div>
             
             <h3 className="text-2xl font-black text-gray-900 mb-2 tracking-tight">AI Conflict Detected</h3>
             <p className="text-gray-500 font-bold leading-relaxed mb-8">
                This image already has annotations. How should the AI proceed?
             </p>

             <div className="grid gap-3">
                <button 
                   onClick={() => handleAutoLabel('replace')}
                   className="flex items-center gap-4 p-4 rounded-2xl border-2 border-gray-100 hover:border-violet-600 hover:bg-violet-50 group transition-all text-left"
                >
                   <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center text-gray-400 group-hover:bg-white group-hover:text-violet-600 transition">
                      <Trash size={20} />
                   </div>
                   <div>
                      <span className="block font-black text-gray-900 group-hover:text-violet-700">Replace Existing</span>
                      <span className="block text-xs font-bold text-gray-400">Clear current work and start fresh</span>
                   </div>
                </button>

                <button 
                   onClick={() => handleAutoLabel('append')}
                   className="flex items-center gap-4 p-4 rounded-2xl border-2 border-gray-100 hover:border-violet-600 hover:bg-violet-50 group transition-all text-left"
                >
                   <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center text-gray-400 group-hover:bg-white group-hover:text-violet-600 transition">
                      <Plus size={20} />
                   </div>
                   <div>
                      <span className="block font-black text-gray-900 group-hover:text-violet-700">Append Suggestions</span>
                      <span className="block text-xs font-bold text-gray-400">Keep your work and add AI labels</span>
                   </div>
                </button>
             </div>
          </div>

          <div className="p-6 bg-gray-50 flex gap-3">
             <button 
                onClick={() => setShowAutoLabelConflict(false)}
                className="flex-1 py-4 text-sm font-black text-gray-500 hover:text-gray-700 transition"
             >
                CANCEL
             </button>
          </div>
       </div>
    </div>
  );
}
