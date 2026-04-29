import React from 'react';
import { Plus, Tag } from 'lucide-react';
import { useAnnotation, COLORS } from '../AnnotationContext';

export default function ClassesTab() {
  const { 
    classes, setClasses, activeClassIdx, setActiveClassIdx, 
    newClassName, setNewClassName, lockAnnotationClasses,
    showFeedback, projectId
  } = useAnnotation();

  const addClass = async () => {
    const name = newClassName.trim();
    if (!name) return;
    if (lockAnnotationClasses) {
      showFeedback("Class creation is locked for this project.");
      return;
    }
    if (classes.find(c => c.name.toLowerCase() === name.toLowerCase())) {
      setNewClassName("");
      return;
    }

    try {
      const res = await fetch(`/api/projects/${projectId}/classes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (res.ok) {
        const data = await res.json();
        const serverClasses = Array.isArray(data.classes) ? data.classes : [];
        const nextClasses = serverClasses.map((item, index) => ({
          name: item.name,
          color: item.color || COLORS[index % COLORS.length],
          attributes: item.attributes || [],
        }));
        setClasses(nextClasses);
        const nextIndex = nextClasses.findIndex((item) => item.name.toLowerCase() === name.toLowerCase());
        if (nextIndex >= 0) setActiveClassIdx(nextIndex);
        setNewClassName("");
      }
    } catch (error) {
      console.error(error);
      showFeedback("Could not create that class.");
    }
  };

  return (
    <div className="h-full flex flex-col p-5 bg-white">
       <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center text-violet-600 shadow-inner">
             <Tag size={20} />
          </div>
          <div>
             <h3 className="text-[13px] font-black text-gray-900 uppercase tracking-tight">Project Classes</h3>
             <p className="text-[10px] font-bold text-gray-400">SELECT OR ADD LABELS</p>
          </div>
       </div>

       {!lockAnnotationClasses && (
         <div className="flex gap-2 mb-6">
            <input 
               type="text" 
               value={newClassName}
               onChange={(e) => setNewClassName(e.target.value)}
               onKeyDown={(e) => e.key === 'Enter' && addClass()}
               placeholder="Enter new class..."
               className="flex-1 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 text-[13px] font-bold focus:ring-2 focus:ring-violet-200 outline-none transition"
            />
            <button 
               onClick={addClass}
               className="bg-violet-600 hover:bg-violet-700 text-white w-12 rounded-xl flex items-center justify-center shadow-lg shadow-violet-100 transition active:scale-95"
            >
               <Plus size={20} />
            </button>
         </div>
       )}

       <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar flex flex-col gap-2">
          {classes.map((cls, idx) => (
             <button 
                key={idx}
                onClick={() => setActiveClassIdx(idx)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all group ${activeClassIdx === idx ? 'border-violet-500 bg-violet-50/50 shadow-sm' : 'border-gray-50 bg-gray-50/30 hover:border-violet-200 hover:bg-white'}`}
             >
                <div className="w-5 h-5 rounded-lg shadow-sm group-hover:scale-110 transition-transform" style={{ backgroundColor: cls.color }}></div>
                <span className={`text-[13px] font-black tracking-tight ${activeClassIdx === idx ? 'text-violet-700' : 'text-gray-600'}`}>{cls.name}</span>
                {activeClassIdx === idx && (
                   <div className="ml-auto w-2 h-2 bg-violet-500 rounded-full animate-pulse"></div>
                )}
             </button>
          ))}
          {classes.length === 0 && (
             <div className="h-40 flex flex-col items-center justify-center text-center opacity-40">
                <Tag size={32} className="mb-2 text-gray-400" />
                <p className="text-xs font-bold text-gray-500">No classes defined.<br/>Add one above to start.</p>
             </div>
          )}
       </div>
    </div>
  );
}
