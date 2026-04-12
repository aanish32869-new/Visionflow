import React from 'react';
import { Eye, Zap } from 'lucide-react';

export default function VisualizeTab() {
  return (
    <div className="w-full animate-fade-in bg-white h-full pb-16 flex flex-col items-center">
      <div className="w-full flex justify-between items-center mb-12 self-start">
         <div className="flex items-center gap-3">
            <Eye className="text-gray-700" size={24} />
            <h2 className="text-[22px] font-bold text-gray-900 tracking-tight">Visualize</h2>
         </div>
      </div>
      
      <div className="flex flex-col items-center justify-center pt-24 max-w-[440px]">
         <div className="mb-8 relative w-56 h-56 opacity-90 scale-110">
            <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
               {/* Easel illustration mock */}
               <path d="M70 160L90 130V50" stroke="#8B5CF6" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
               <path d="M130 160L110 130V50" stroke="#8B5CF6" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
               <path d="M100 130V170" stroke="#8B5CF6" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
               <rect x="65" y="60" width="70" height="60" rx="4" fill="#F9FAFB" stroke="#8B5CF6" strokeWidth="4"/>
               <path d="M75 105L85 90L95 105L105 85L115 105" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
               <circle cx="105" cy="75" r="5" fill="#C4B5FD"/>
               <path d="M60 120H140" stroke="#6D28D9" strokeWidth="6" strokeLinecap="round"/>
               <path d="M80 50H120" stroke="#6D28D9" strokeWidth="6" strokeLinecap="round"/>
               
               {/* Decoration dots */}
               <circle cx="150" cy="50" r="3" fill="#E5E7EB" />
               <circle cx="40" cy="80" r="4" fill="#E5E7EB" />
               <circle cx="160" cy="110" r="2" fill="#E5E7EB" />
            </svg>
         </div>
         <h3 className="text-[18px] font-bold text-gray-900 mb-2 mt-4 whitespace-nowrap">This project does not contain any trained models to visualize.</h3>
         <p className="text-[14px] text-gray-500 mb-8 text-center leading-[1.6]">Train a model with the latest version of your dataset to get started.</p>
         
         <button className="px-5 py-2.5 bg-violet-600 text-white rounded-[8px] text-[14px] font-bold shadow-sm flex items-center gap-2 hover:bg-violet-700 transition">
            <Zap size={16} fill="currentColor" /> Train a Model
         </button>
      </div>
    </div>
  );
}
