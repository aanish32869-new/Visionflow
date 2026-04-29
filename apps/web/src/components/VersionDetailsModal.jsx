import React, { useState, useEffect } from "react";
import {
  X,
  Zap,
  Layers,
  Calendar,
  Image as ImageIcon,
  CheckCircle2,
  Download,
  BarChart2,
  Activity,
  ArrowRight,
  Target,
  Box,
  PieChart,
} from "lucide-react";

export default function VersionDetailsModal({ isOpen, onClose, version, onTrain }) {
  const [activeTab, setActiveTab] = useState("overview");

  if (!isOpen || !version) return null;

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const preprocessing = version.options?.preprocessing || {};
  const augmentations = version.options?.augmentations || [];
  const split = version.options?.split || { train: 70, valid: 20, test: 10 };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-950/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative w-full max-w-5xl h-[85vh] bg-white rounded-[40px] shadow-2xl flex flex-col overflow-hidden animate-modal-enter">
        {/* Header */}
        <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-violet-50 rounded-2xl flex items-center justify-center text-violet-600">
              <Layers size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 bg-gray-950 text-white text-[10px] font-black rounded uppercase">
                  {version.display_id}
                </span>
                <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Immutable Snapshot
                </span>
              </div>
              <h2 className="text-2xl font-black text-gray-900">{version.name}</h2>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition text-gray-400 hover:text-gray-900"
          >
            <X size={24} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-8 flex border-b border-gray-100 bg-gray-50/50 shrink-0">
          <TabButton active={activeTab === "overview"} onClick={() => setActiveTab("overview")} icon={<Activity size={16} />} label="Overview" />
          <TabButton active={activeTab === "pipeline"} onClick={() => setActiveTab("pipeline")} icon={<Zap size={16} />} label="Pipeline" />
          <TabButton active={activeTab === "images"} onClick={() => setActiveTab("images")} icon={<ImageIcon size={16} />} label="Sample Images" />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
          {activeTab === "overview" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
              {/* Stats Grid */}
              <div className="grid grid-cols-4 gap-6">
                <StatCard label="Total Images" value={version.images_count} icon={<ImageIcon size={20} />} color="text-violet-600 bg-violet-50" />
                <StatCard label="Annotations" value={version.annotations_count} icon={<Box size={20} />} color="text-emerald-600 bg-emerald-50" />
                <StatCard label="Classes" value={version.classes?.length || 0} icon={<Target size={20} />} color="text-amber-600 bg-amber-50" />
                <StatCard label="Created" value={formatDate(version.created_at)} icon={<Calendar size={20} />} color="text-gray-600 bg-gray-50" fullValue />
              </div>

              <div className="grid grid-cols-3 gap-8">
                {/* Class Distribution */}
                <div className="col-span-2 bg-white border border-gray-200 rounded-[32px] p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                      <PieChart size={20} className="text-violet-600" /> Class Distribution
                    </h3>
                  </div>
                  <div className="space-y-4">
                    {version.classes?.map((cls, idx) => {
                      const count = version.class_distribution?.[cls] || 0;
                      const percentage = version.annotations_count ? (count / version.annotations_count * 100) : 0;
                      return (
                        <div key={cls} className="space-y-1.5">
                          <div className="flex justify-between text-xs font-bold">
                            <span className="text-gray-700">{cls}</span>
                            <span className="text-gray-400">{count} labels ({percentage.toFixed(1)}%)</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-violet-600 rounded-full" 
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Dataset Split */}
                <div className="bg-white border border-gray-200 rounded-[32px] p-6 shadow-sm flex flex-col">
                  <h3 className="text-lg font-black text-gray-900 mb-6 flex items-center gap-2">
                    <BarChart2 size={20} className="text-emerald-600" /> Dataset Split
                  </h3>
                  <div className="flex-1 flex flex-col justify-center gap-6">
                    <SplitRing label="Train" value={split.train} color="bg-violet-600" />
                    <SplitRing label="Validation" value={split.valid} color="bg-amber-600" />
                    <SplitRing label="Test" value={split.test} color="bg-emerald-600" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "pipeline" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300 max-w-3xl mx-auto">
              <section className="bg-gray-50 border border-gray-200 rounded-[32px] p-8">
                <h3 className="text-xl font-black text-gray-900 mb-6 flex items-center gap-3">
                  <Activity size={24} className="text-violet-600" /> Preprocessing Settings
                </h3>
                <div className="grid gap-4">
                  <PipelineStep label="Auto-Orient" value="Enabled" enabled={preprocessing.auto_orient} />
                  <PipelineStep label="Resize" value={`${preprocessing.resize?.width}x${preprocessing.resize?.height} (${preprocessing.resize?.mode})`} enabled={preprocessing.resize?.enabled} />
                  <PipelineStep label="Grayscale" value="Enabled" enabled={preprocessing.grayscale} />
                </div>
              </section>

              <section className="bg-gray-50 border border-gray-200 rounded-[32px] p-8">
                <h3 className="text-xl font-black text-gray-900 mb-6 flex items-center gap-3">
                  <Zap size={24} className="text-emerald-600" /> Augmentation Settings
                </h3>
                {augmentations.length > 0 ? (
                  <div className="grid gap-4">
                    {augmentations.map((aug, idx) => (
                      <PipelineStep key={idx} label={aug.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} value="Active" enabled={true} />
                    ))}
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex justify-between text-sm font-bold">
                        <span className="text-gray-500 uppercase tracking-widest text-[10px]">Dataset Multiplier</span>
                        <span className="text-emerald-600">{version.options?.max_version_size || 1}x</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-500 font-semibold italic text-center py-4">No augmentations applied to this version.</p>
                )}
              </section>
            </div>
          )}

          {activeTab === "images" && (
            <div className="grid grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
               {/* This would ideally fetch actual samples from the version, but we'll show placeholders/empty state for now */}
               <div className="col-span-4 py-20 flex flex-col items-center justify-center text-center">
                 <div className="w-16 h-16 bg-gray-50 text-gray-300 rounded-full flex items-center justify-center mb-4">
                    <ImageIcon size={32} />
                 </div>
                 <h4 className="text-lg font-black text-gray-950">Snapshotted Images</h4>
                 <p className="text-sm font-semibold text-gray-500 max-w-md mt-2">
                   This version contains {version.images_count} frozen images. You can view them in the main Dataset tab by filtering for this version.
                 </p>
               </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-8 py-6 border-t border-gray-100 bg-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4 text-xs font-bold text-gray-400">
            <span className="flex items-center gap-1"><Layers size={14} /> ID: {version.version_id}</span>
            <span className="flex items-center gap-1"><Target size={14} /> Hash: {version.canonical_id}</span>
          </div>
          <div className="flex items-center gap-3">
             <a 
               href={version.download_url}
               download
               className="px-6 py-3 bg-white border border-gray-200 text-gray-900 rounded-2xl font-black text-sm flex items-center gap-2 hover:border-violet-300 hover:text-violet-600 transition"
             >
               <Download size={18} /> Download Dataset
             </a>
             <button 
               onClick={() => onTrain(version)}
               className="px-8 py-3 bg-violet-600 text-white rounded-2xl font-black text-sm flex items-center gap-2 hover:bg-violet-700 transition shadow-lg shadow-violet-200"
             >
               <Zap size={18} /> Train Model
             </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }) {
  return (
    <button 
      onClick={onClick}
      className={`px-8 py-4 text-sm font-black flex items-center gap-2 transition relative ${
        active ? 'text-violet-600' : 'text-gray-400 hover:text-gray-600'
      }`}
    >
      {icon} {label}
      {active && <div className="absolute bottom-0 left-0 right-0 h-1 bg-violet-600" />}
    </button>
  );
}

function StatCard({ label, value, icon, color, fullValue = false }) {
  return (
    <div className="bg-white border border-gray-200 rounded-[32px] p-5 shadow-sm">
      <div className={`w-10 h-10 ${color} rounded-2xl flex items-center justify-center mb-3`}>
        {icon}
      </div>
      <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">{label}</div>
      <div className={`${fullValue ? 'text-sm' : 'text-2xl'} font-black text-gray-950`}>{value}</div>
    </div>
  );
}

function SplitRing({ label, value, color }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={`w-3 h-3 ${color} rounded-full`} />
        <span className="text-sm font-bold text-gray-700">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full ${color} rounded-full`} style={{ width: `${value}%` }} />
        </div>
        <span className="text-xs font-black text-gray-900 w-8 text-right">{value}%</span>
      </div>
    </div>
  );
}

function PipelineStep({ label, value, enabled }) {
  return (
    <div className="flex items-center justify-between p-4 bg-white rounded-2xl border border-gray-100 shadow-sm">
      <span className="text-sm font-bold text-gray-900">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-50 text-gray-400'}`}>
          {enabled ? value : 'Disabled'}
        </span>
        {enabled && <CheckCircle2 size={14} className="text-emerald-500" />}
      </div>
    </div>
  );
}
