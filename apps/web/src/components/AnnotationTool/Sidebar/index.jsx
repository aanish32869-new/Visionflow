import React from 'react';
import { Tag, Sparkles, Edit3 } from 'lucide-react';
import { useAnnotation } from '../AnnotationContext';
import ClassesTab from './ClassesTab';
import AutoLabelTab from './AutoLabelTab';
import AnnotationsTab from './AnnotationsTab';

export default function Sidebar() {
  const { activeTab, setActiveTab, isSidebarOpen, setIsSidebarOpen } = useAnnotation();

  if (!isSidebarOpen) {
    return (
      <div className="w-12 bg-white border-l border-gray-200 flex flex-col items-center py-4 shrink-0 shadow-sm z-30">
        <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-violet-50 rounded-lg text-gray-400 hover:text-violet-600 transition">
          <Edit3 size={20} />
        </button>
      </div>
    );
  }

  return (
    <div className="w-80 bg-white border-l border-gray-200 flex flex-col shrink-0 shadow-2xl z-30 animate-in slide-in-from-right duration-300">
       <div className="h-14 border-b border-gray-100 flex items-center px-1 bg-gray-50/50">
          <button 
            onClick={() => setActiveTab('classes')}
            className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-lg text-xs font-black transition-all ${activeTab === 'classes' ? 'bg-white text-violet-600 shadow-sm border border-gray-200/50' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <Tag size={14} /> Classes
          </button>
          <button 
            onClick={() => setActiveTab('auto-label')}
            className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-lg text-xs font-black transition-all ${activeTab === 'auto-label' ? 'bg-white text-violet-600 shadow-sm border border-gray-200/50' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <Sparkles size={14} /> Auto-Label
          </button>
          <button 
            onClick={() => setActiveTab('annotations')}
            className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-lg text-xs font-black transition-all ${activeTab === 'annotations' ? 'bg-white text-violet-600 shadow-sm border border-gray-200/50' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <Edit3 size={14} /> Layers
          </button>
          <button 
             onClick={() => setIsSidebarOpen(false)}
             className="p-3 text-gray-300 hover:text-gray-600 transition"
          >
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
       </div>

       <div className="flex-1 overflow-hidden">
          {activeTab === 'classes' && <ClassesTab />}
          {activeTab === 'auto-label' && <AutoLabelTab />}
          {activeTab === 'annotations' && <AnnotationsTab />}
       </div>
    </div>
  );
}
