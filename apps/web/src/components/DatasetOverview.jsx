import React from "react";
import { 
  ImageIcon, Box, Target, CheckCircle2, 
  AlertTriangle, ArrowRight, BarChart2,
  PieChart, Zap, Activity, Layers, Tag
} from "lucide-react";

export default function DatasetOverview({ summary, classesData, onUpload, onAnnotate, onGenerate }) {
  if (!summary) return null;

  const stats = [
    { label: "Total Images", value: summary.total_images, icon: <ImageIcon size={20} />, color: "text-violet-600 bg-violet-50" },
    { label: "Annotated", value: summary.annotated_images, icon: <CheckCircle2 size={20} />, color: "text-emerald-600 bg-emerald-50" },
    { label: "Unassigned", value: summary.unassigned_images, icon: <Activity size={20} />, color: "text-amber-600 bg-amber-50" },
    { label: "Classes", value: classesData.length, icon: <Target size={20} />, color: "text-blue-600 bg-blue-50" },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Quick Actions Bar */}
      <div className="flex items-center justify-between bg-white border border-gray-200 rounded-[32px] p-6 shadow-sm">
        <div>
          <h2 className="text-xl font-black text-gray-900">Dataset Overview</h2>
          <p className="text-sm font-semibold text-gray-500">Manage your raw data and prepare it for training.</p>
        </div>
        <div className="flex items-center gap-3">
           <button 
             onClick={onUpload}
             className="px-6 py-3 bg-white border border-gray-200 text-gray-900 rounded-2xl font-black text-sm flex items-center gap-2 hover:border-violet-300 hover:text-violet-600 transition"
           >
             <ImageIcon size={18} /> Upload Images
           </button>
           <button 
             onClick={onAnnotate}
             className="px-6 py-3 bg-white border border-gray-200 text-gray-900 rounded-2xl font-black text-sm flex items-center gap-2 hover:border-violet-300 hover:text-violet-600 transition"
           >
             <Tag size={18} /> Annotate
           </button>
           <button 
             onClick={onGenerate}
             className="px-8 py-3 bg-violet-600 text-white rounded-2xl font-black text-sm flex items-center gap-2 hover:bg-violet-700 transition shadow-lg shadow-violet-200"
           >
             <Layers size={18} /> Generate Version
           </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-6">
        {stats.map((stat, idx) => (
          <div key={idx} className="bg-white border border-gray-200 rounded-[32px] p-6 shadow-sm hover:shadow-md transition">
            <div className={`w-12 h-12 ${stat.color} rounded-2xl flex items-center justify-center mb-4`}>
              {stat.icon}
            </div>
            <div className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">{stat.label}</div>
            <div className="text-3xl font-black text-gray-950">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-8">
        {/* Class Distribution Chart */}
        <div className="col-span-2 bg-white border border-gray-200 rounded-[40px] p-8 shadow-sm">
          <div className="flex items-center justify-between mb-8">
             <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
               <BarChart2 size={20} className="text-violet-600" /> Class Distribution
             </h3>
             <span className="text-xs font-bold text-gray-400">{summary.total_annotations} Total Labels</span>
          </div>
          <div className="space-y-6">
            {classesData.slice(0, 10).map((cls, idx) => {
              const count = cls.count || 0;
              const percentage = summary.total_annotations ? (count / summary.total_annotations * 100) : 0;
              return (
                <div key={idx} className="space-y-2">
                  <div className="flex justify-between text-sm font-bold">
                    <span className="text-gray-700">{cls.name}</span>
                    <span className="text-gray-400">{count} ({percentage.toFixed(1)}%)</span>
                  </div>
                  <div className="h-3 bg-gray-50 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-violet-600 rounded-full transition-all duration-1000" 
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {classesData.length > 10 && (
              <p className="text-xs text-center font-bold text-gray-400 mt-4">
                + {classesData.length - 10} more classes
              </p>
            )}
          </div>
        </div>

        {/* Health & Recommendations */}
        <div className="flex flex-col gap-6">
          <div className="bg-white border border-gray-200 rounded-[40px] p-8 shadow-sm flex-1">
            <h3 className="text-lg font-black text-gray-900 mb-6 flex items-center gap-2">
              <Zap size={20} className="text-amber-500" /> Dataset Health
            </h3>
            <div className="flex flex-col items-center justify-center py-6">
              <div className="relative w-32 h-32 mb-4">
                <svg className="w-full h-full" viewBox="0 0 36 36">
                  <path
                    className="text-gray-100 stroke-current"
                    strokeWidth="3"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                  <path
                    className={`${summary.health?.score > 70 ? 'text-emerald-500' : 'text-amber-500'} stroke-current`}
                    strokeWidth="3"
                    strokeDasharray={`${summary.health?.score || 0}, 100`}
                    strokeLinecap="round"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-black text-gray-950">{summary.health?.score || 0}%</span>
                  <span className="text-[8px] font-black uppercase text-gray-400">Score</span>
                </div>
              </div>
            </div>
            <div className="space-y-3">
               {summary.health?.recommendations?.map((rec, i) => (
                 <div key={i} className="flex gap-2 p-3 bg-gray-50 rounded-2xl">
                    <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] font-bold text-gray-600 leading-tight">{rec}</p>
                 </div>
               ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
