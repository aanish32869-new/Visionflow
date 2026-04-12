import React from 'react';
import { Heart, RefreshCw, Info, Download, Scale, ChevronDown, CheckSquare, Square, ZoomIn, Search } from 'lucide-react';

export default function AnalyticsTab({ assets }) {
  const imagesCount = assets?.length || 23;
  
  return (
    <div className="w-full animate-fade-in pb-16">
      <div className="flex items-center gap-3 mb-6">
         <Heart className="text-gray-700" size={24} />
         <h2 className="text-[22px] font-bold text-gray-900 tracking-tight">Dataset Analytics</h2>
      </div>
      
      <div className="flex items-center gap-4 text-[13px] text-gray-500 font-medium mb-8">
         <span>Generated on {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric'})} at {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit'})}</span>
         <button className="text-violet-600 font-bold flex items-center gap-1.5 hover:text-violet-700 transition">
            <RefreshCw size={14} /> Regenerate
         </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
         {/* Card 1 */}
         <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col">
            <h4 className="font-bold text-gray-900 text-[15px] mb-4">Number of Images</h4>
            <div className="text-[32px] font-medium text-gray-900 mb-6">{imagesCount}</div>
            <div className="flex flex-col gap-2 mt-auto">
               <div className="flex items-center gap-2 text-[13px] text-gray-500 font-medium">
                  <CheckSquare size={16} className="text-gray-400" /> {imagesCount} single-class
               </div>
               <div className="flex items-center gap-2 text-[13px] text-gray-500 font-medium">
                  <Square size={16} className="text-gray-400" /> 0 multi-class
               </div>
            </div>
         </div>

         {/* Card 2 */}
         <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col">
            <h4 className="font-bold text-gray-900 text-[15px] mb-4">Average Image Size</h4>
            <div className="text-[32px] font-medium text-gray-900 mb-6">0.40 mp</div>
            <div className="flex flex-col gap-2 mt-auto">
               <div className="flex items-center gap-2 text-[13px] text-gray-500 font-medium">
                  <ZoomIn size={16} className="text-gray-400" /> from <span className="text-violet-600">0.05 mp</span>
               </div>
               <div className="flex items-center gap-2 text-[13px] text-gray-500 font-medium">
                  <ZoomIn size={16} className="text-gray-400" /> to <span className="text-violet-600">5.63 mp</span>
               </div>
            </div>
         </div>

         {/* Card 3 */}
         <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col">
            <h4 className="font-bold text-gray-900 text-[15px] mb-4">Median Image Ratio</h4>
            <div className="text-[32px] font-medium text-gray-900 mb-6 font-mono tracking-tighter">772x512</div>
            <div className="flex items-center gap-2 text-[13px] text-gray-500 font-medium mt-auto">
               <div className="w-4 h-3 border-[1.5px] border-gray-400 rounded-[2px] opacity-70"></div> wide
            </div>
         </div>
      </div>

      <div className="mb-12">
         <div className="flex justify-between items-start mb-6">
            <div>
               <h3 className="text-[18px] font-bold text-gray-900 flex items-center gap-2 mb-1.5">
                  Classes <Info size={16} className="text-violet-600" />
               </h3>
               <p className="text-[13px] text-gray-500 font-medium">Overview of the number of annotations for each class in your dataset.</p>
            </div>
            <div className="flex gap-2">
               <button className="px-4 py-2 border border-gray-200 rounded-[8px] text-[13px] font-bold text-gray-700 bg-white shadow-sm flex items-center gap-2 hover:bg-gray-50 transition">
                  Tags <ChevronDown size={14} className="text-gray-400" />
               </button>
               <button className="px-4 py-2 border border-gray-200 rounded-[8px] text-[13px] font-bold text-gray-700 bg-white shadow-sm flex items-center gap-2 hover:bg-gray-50 transition">
                  <Scale size={14} className="text-gray-500" /> Rebalance Splits
               </button>
               <button className="px-4 py-2 border border-gray-200 rounded-[8px] text-[13px] font-bold text-gray-700 bg-white shadow-sm flex items-center gap-2 hover:bg-gray-50 transition">
                  <Download size={14} className="text-gray-500" /> Download CSV
               </button>
            </div>
         </div>

         <div className="bg-white border border-gray-200 rounded-[12px] shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 bg-white">
               <div className="relative mb-6">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" placeholder="Search by class name" className="w-full border border-gray-200 rounded-[8px] pl-9 pr-4 py-2.5 text-[14px] text-gray-800 outline-none focus:border-violet-500" />
               </div>
               <div className="flex justify-between items-center">
                  <div className="flex items-center gap-6">
                     <label className="flex items-center gap-2 text-[13px] font-bold text-violet-700 cursor-pointer">
                        <div className="w-3 h-3 rounded-full border-[3px] border-violet-600"></div> All Splits
                     </label>
                     <label className="flex items-center gap-2 text-[13px] font-medium text-gray-600 cursor-pointer">
                        <div className="w-3 h-3 rounded-full border border-violet-200"></div> Train
                     </label>
                     <label className="flex items-center gap-2 text-[13px] font-medium text-gray-600 cursor-pointer">
                        <div className="w-3 h-3 rounded-full border border-cyan-200"></div> Valid
                     </label>
                     <label className="flex items-center gap-2 text-[13px] font-medium text-gray-600 cursor-pointer">
                        <div className="w-3 h-3 rounded-full border border-amber-200"></div> Test
                     </label>
                  </div>
                  <button className="px-3 py-1.5 border border-gray-200 rounded-[8px] text-[13px] font-bold text-gray-700 bg-white shadow-sm flex items-center gap-2 hover:bg-gray-50">
                     Sort <ChevronDown size={14} className="text-gray-400" />
                  </button>
               </div>
            </div>
            <div className="p-5 bg-white">
               <div className="flex flex-col gap-2">
                  <div className="flex items-center text-[14px] mb-1">
                     <span className="font-semibold text-violet-700 w-32">target_object</span>
                     <span className="text-gray-500 font-medium ml-2">{imagesCount}</span>
                  </div>
                  <div className="w-full bg-gray-50 rounded-full h-[6px] border border-gray-100 p-[1px]">
                     <div className="bg-violet-400 h-full rounded-full w-full opacity-80"></div>
                  </div>
               </div>
            </div>
         </div>
      </div>

      <div>
         <h3 className="text-[18px] font-bold text-gray-900 flex items-center gap-2 mb-1.5">
            Dimension Insights <Info size={16} className="text-violet-600" />
         </h3>
         <p className="text-[13px] text-gray-500 font-medium mb-6">Overview of the sizes and aspect ratios of the images in your dataset.</p>
         <div className="w-full h-72 border border-gray-200 rounded-[12px] bg-gray-50/50 flex flex-col items-center justify-center relative overflow-hidden shadow-sm">
            <span className="text-gray-400 font-medium text-[14px]">Dimension scatter plot mapping</span>
         </div>
      </div>
    </div>
  );
}
