import React, { useState, useEffect } from "react";
import {
  X,
  ChevronRight,
  ChevronLeft,
  Layers,
  Zap,
  BarChart2,
  CheckCircle2,
  ImageIcon,
  Maximize,
  RotateCcw,
  Sun,
  Wind,
  Plus,
  Loader2,
  Trash2,
  Eye,
  Shuffle,
  GitBranch,
  Target,
  Activity,
  ArrowRight
} from "lucide-react";

const AUGMENTATION_OPTIONS = [
  { id: "horizontal_flip", name: "Horizontal Flip", icon: <Layers size={18} />, description: "Flips the image horizontally." },
  { id: "vertical_flip", name: "Vertical Flip", icon: <Layers size={18} className="rotate-90" />, description: "Flips the image vertically." },
  { id: "rotate", name: "90° Rotation", icon: <RotateCcw size={18} />, description: "Randomly rotates by 90, 180, or 270 degrees." },
  { id: "brightness", name: "Brightness", icon: <Sun size={18} />, description: "Randomly adjusts brightness." },
  { id: "blur", name: "Blur", icon: <Wind size={18} />, description: "Applies Gaussian blur." },
  { id: "noise", name: "Noise", icon: <Zap size={18} />, description: "Adds random pixel noise." },
];

export default function GenerateVersionModal({ projectId, isOpen, onClose, onGenerated }) {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  
  const [config, setConfig] = useState({
    name: "",
    preprocessing: {
      auto_orient: true,
      resize: { enabled: true, width: 640, height: 640, mode: "stretch" },
      grayscale: false,
    },
    augmentations: [],
    max_version_size: 1, // Multiplier
    split: { train: 70, valid: 20, test: 10 },
    rebalance: true
  });

  const [previews, setPreviews] = useState([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setError(null);
      setPreviews([]);
    }
  }, [isOpen]);

  const handleGenerate = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });
      
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to generate version");
      }
      
      const data = await response.json();
      onGenerated(data);
      onClose();
    } catch (err) {
      setError(err.message);
      setIsSubmitting(false);
    }
  };

  const fetchPreviews = async () => {
    setIsPreviewLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/augment/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          augmentations: config.augmentations,
          preprocessing: config.preprocessing
        })
      });
      if (response.ok) {
        const data = await response.json();
        setPreviews(data.previews || []);
      }
    } catch (err) {
      console.error("Preview failed", err);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const toggleAugmentation = (id) => {
    setConfig(prev => {
      const exists = prev.augmentations.includes(id);
      return {
        ...prev,
        augmentations: exists 
          ? prev.augmentations.filter(a => a !== id)
          : [...prev.augmentations, id]
      };
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-950/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative w-full max-w-4xl bg-white rounded-[40px] shadow-2xl flex flex-col overflow-hidden animate-modal-enter">
        {/* Header */}
        <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-violet-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-violet-200">
              <Layers size={20} />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900">Generate New Version</h2>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Step {step} of 3</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition text-gray-400">
            <X size={20} />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="h-1 bg-gray-100 w-full shrink-0">
          <div 
            className="h-full bg-violet-600 transition-all duration-500" 
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-8 min-h-[400px]">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm font-bold flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
              <Trash2 size={18} /> {error}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
              <div>
                <label className="block text-sm font-black text-gray-900 mb-2">Version Name</label>
                <input 
                  type="text"
                  placeholder="e.g. Initial Dataset, v2-augmented..."
                  value={config.name}
                  onChange={e => setConfig({...config, name: e.target.value})}
                  className="w-full px-5 py-4 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-bold outline-none focus:border-violet-400 focus:bg-white transition"
                />
              </div>

              <div>
                <h3 className="text-lg font-black text-gray-900 mb-4 flex items-center gap-2">
                  <Maximize size={20} className="text-violet-600" /> Preprocessing Settings
                </h3>
                <div className="grid gap-4">
                  <OptionToggle 
                    icon={<RotateCcw size={18} />}
                    label="Auto-Orient"
                    description="Automatically rotate images based on EXIF data."
                    active={config.preprocessing.auto_orient}
                    onClick={() => setConfig({
                      ...config, 
                      preprocessing: {...config.preprocessing, auto_orient: !config.preprocessing.auto_orient}
                    })}
                  />
                  <div className="p-5 bg-gray-50 border border-gray-200 rounded-3xl space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Maximize size={18} className="text-gray-400" />
                        <div>
                          <p className="text-sm font-black text-gray-900">Resize</p>
                          <p className="text-xs font-bold text-gray-400">Set target dimensions for training.</p>
                        </div>
                      </div>
                      <div 
                        onClick={() => setConfig({
                          ...config, 
                          preprocessing: {...config.preprocessing, resize: {...config.preprocessing.resize, enabled: !config.preprocessing.resize.enabled}}
                        })}
                        className={`w-12 h-6 rounded-full relative transition-colors cursor-pointer ${config.preprocessing.resize.enabled ? 'bg-violet-600' : 'bg-gray-300'}`}
                      >
                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${config.preprocessing.resize.enabled ? 'left-7' : 'left-1'}`} />
                      </div>
                    </div>
                    {config.preprocessing.resize.enabled && (
                      <div className="flex items-center gap-4 animate-in fade-in zoom-in-95">
                        <div className="flex-1">
                          <label className="text-[10px] font-black uppercase text-gray-400 mb-1 block">Width</label>
                          <input 
                            type="number"
                            value={config.preprocessing.resize.width}
                            onChange={e => setConfig({...config, preprocessing: {...config.preprocessing, resize: {...config.preprocessing.resize, width: parseInt(e.target.value)}}})}
                            className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold outline-none"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] font-black uppercase text-gray-400 mb-1 block">Height</label>
                          <input 
                            type="number"
                            value={config.preprocessing.resize.height}
                            onChange={e => setConfig({...config, preprocessing: {...config.preprocessing, resize: {...config.preprocessing.resize, height: parseInt(e.target.value)}}})}
                            className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold outline-none"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] font-black uppercase text-gray-400 mb-1 block">Mode</label>
                          <select 
                            value={config.preprocessing.resize.mode}
                            onChange={e => setConfig({...config, preprocessing: {...config.preprocessing, resize: {...config.preprocessing.resize, mode: e.target.value}}})}
                            className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold outline-none"
                          >
                            <option value="stretch">Stretch</option>
                            <option value="fit">Fit (Black Edges)</option>
                            <option value="crop">Center Crop</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* NEW: Train/Test Split Section */}
              <div className="pt-6 border-t border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                      <BarChart2 size={20} className="text-amber-600" /> Train/Test Split
                    </h3>
                    <p className="text-sm font-semibold text-gray-500">Determine how your data is distributed for training and validation.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black uppercase text-gray-400">Rebalance Classes</span>
                    <div 
                      onClick={() => setConfig({...config, rebalance: !config.rebalance})}
                      className={`w-12 h-6 rounded-full relative transition-colors cursor-pointer ${config.rebalance ? 'bg-emerald-500' : 'bg-gray-300'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${config.rebalance ? 'left-7' : 'left-1'}`} />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                  <div className="space-y-6">
                    <SplitInput label="Train" value={config.split.train} color="bg-violet-600" onChange={v => setConfig({...config, split: {...config.split, train: v}})} />
                    <SplitInput label="Validation" value={config.split.valid} color="bg-amber-600" onChange={v => setConfig({...config, split: {...config.split, valid: v}})} />
                    <SplitInput label="Test" value={config.split.test} color="bg-emerald-600" onChange={v => setConfig({...config, split: {...config.split, test: v}})} />
                    
                    <div className="p-4 bg-gray-50 rounded-2xl flex items-center justify-between border border-gray-100">
                      <span className="text-xs font-black text-gray-400 uppercase">Total Distribution</span>
                      <span className={`text-sm font-black ${config.split.train + config.split.valid + config.split.test === 100 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {config.split.train + config.split.valid + config.split.test}%
                      </span>
                    </div>
                  </div>

                  <div className="bg-violet-50/50 rounded-3xl p-6 border border-violet-100/50">
                    <h4 className="text-[10px] font-black text-violet-600 uppercase tracking-widest mb-4">Splitting Workflow</h4>
                    <SplittingWorkflowDiagram activeSplit={config.split} rebalance={config.rebalance} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                    <Zap size={20} className="text-emerald-600" /> Augmentation Pipeline
                  </h3>
                  <p className="text-sm font-semibold text-gray-500">Create variations of your training set to improve model robustness.</p>
                </div>
                <button 
                  onClick={fetchPreviews}
                  disabled={isPreviewLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-violet-50 text-violet-700 rounded-xl text-xs font-black hover:bg-violet-100 transition disabled:opacity-50"
                >
                  {isPreviewLoading ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                  Preview Augmentations
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {AUGMENTATION_OPTIONS.map(opt => (
                  <div 
                    key={opt.id}
                    onClick={() => toggleAugmentation(opt.id)}
                    className={`p-4 rounded-3xl border-2 transition cursor-pointer flex items-center gap-4 ${
                      config.augmentations.includes(opt.id)
                        ? "border-violet-600 bg-violet-50/50 shadow-md"
                        : "border-gray-100 bg-white hover:border-violet-200"
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${config.augmentations.includes(opt.id) ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-400"}`}>
                      {opt.icon}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-black text-gray-900">{opt.name}</p>
                      <p className="text-[10px] font-bold text-gray-400 leading-tight">{opt.description}</p>
                    </div>
                  </div>
                ))}
              </div>

              {previews.length > 0 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                  <div className="flex items-center justify-between px-1">
                    <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">Augmentation Preview</h4>
                    <span className="text-[10px] font-bold text-violet-600">Sample of current pipeline</span>
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    {previews.map((p, i) => (
                      <div key={i} className="group relative aspect-square bg-gray-100 rounded-2xl overflow-hidden border border-gray-200 shadow-sm">
                        <img src={p.image} alt={p.type} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-gray-950/40 opacity-0 group-hover:opacity-100 transition flex items-end p-2">
                           <span className="text-[10px] font-black text-white uppercase">{p.type}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-6 bg-gray-950 rounded-[32px] text-white">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm font-black">Dataset Multiplier</p>
                    <p className="text-xs font-bold text-gray-400">Total number of versions per original image.</p>
                  </div>
                  <div className="text-2xl font-black text-emerald-400">{config.max_version_size}x</div>
                </div>
                <div className="flex gap-2">
                  {[1, 2, 3, 5].map(m => (
                    <button
                      key={m}
                      onClick={() => setConfig({...config, max_version_size: m})}
                      className={`flex-1 py-3 rounded-xl font-black text-sm transition ${
                        config.max_version_size === m
                          ? "bg-violet-600 text-white"
                          : "bg-white/10 text-white/60 hover:bg-white/20"
                      }`}
                    >
                      {m}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="p-8 bg-violet-600 rounded-[40px] text-white text-center space-y-4">
                <CheckCircle2 size={48} className="mx-auto text-violet-200" />
                <div>
                  <h3 className="text-2xl font-black">Ready to Generate</h3>
                  <p className="text-violet-100 font-bold">Review your configuration and click the button below to start.</p>
                </div>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-[32px] p-8">
                <h4 className="text-sm font-black text-gray-900 mb-4 uppercase tracking-widest">Summary</h4>
                <div className="space-y-3">
                  <SummaryItem label="Version Name" value={config.name || "Untitled Version"} />
                  <SummaryItem label="Preprocessing" value={`${config.preprocessing.resize.enabled ? 'Resize ' + config.preprocessing.resize.width + 'x' + config.preprocessing.resize.height : 'Original Size'}`} />
                  <SummaryItem label="Augmentations" value={`${config.augmentations.length} Active (x${config.max_version_size} total images)`} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 py-6 border-t border-gray-100 bg-white flex items-center justify-between shrink-0">
          <button 
            disabled={step === 1 || isSubmitting}
            onClick={() => setStep(s => s - 1)}
            className="flex items-center gap-2 text-gray-400 font-bold hover:text-gray-900 disabled:opacity-0 transition"
          >
            <ChevronLeft size={20} /> Back
          </button>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={onClose}
              className="px-6 py-3 text-gray-400 font-bold hover:bg-gray-50 rounded-2xl transition"
            >
              Cancel
            </button>
            {step < 3 ? (
              <button 
                onClick={() => setStep(s => s + 1)}
                className="px-8 py-3 bg-gray-900 text-white rounded-2xl font-black text-sm flex items-center gap-2 hover:bg-violet-600 transition shadow-lg shadow-gray-200"
              >
                Continue <ChevronRight size={18} />
              </button>
            ) : (
              <button 
                onClick={handleGenerate}
                disabled={isSubmitting || (config.split.train + config.split.valid + config.split.test !== 100)}
                className="px-10 py-3 bg-violet-600 text-white rounded-2xl font-black text-sm flex items-center gap-2 hover:bg-violet-700 transition shadow-lg shadow-violet-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                {isSubmitting ? "Generating..." : "Generate Version"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OptionToggle({ icon, label, description, active, onClick }) {
  return (
    <div className="p-5 bg-gray-50 border border-gray-200 rounded-3xl flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${active ? "bg-violet-600 text-white shadow-md shadow-violet-100" : "bg-white text-gray-400 shadow-sm"}`}>
          {icon}
        </div>
        <div>
          <p className="text-sm font-black text-gray-900">{label}</p>
          <p className="text-xs font-bold text-gray-400">{description}</p>
        </div>
      </div>
      <div 
        onClick={onClick}
        className={`w-12 h-6 rounded-full relative transition-colors cursor-pointer ${active ? 'bg-violet-600' : 'bg-gray-300'}`}
      >
        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${active ? 'left-7' : 'left-1'}`} />
      </div>
    </div>
  );
}

function SplitInput({ label, value, color, onChange }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 ${color} rounded-full`} />
          <span className="text-sm font-black text-gray-900">{label}</span>
        </div>
        <span className="text-sm font-black text-gray-500">{value}%</span>
      </div>
      <input 
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={e => onChange(parseInt(e.target.value))}
        className="w-full h-2 bg-gray-100 rounded-full appearance-none cursor-pointer accent-violet-600"
      />
    </div>
  );
}

function SummaryItem({ label, value }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-200 last:border-0">
      <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{label}</span>
      <span className="text-sm font-black text-gray-900">{value}</span>
    </div>
  );
}

function SplittingWorkflowDiagram({ activeSplit, rebalance }) {
  return (
    <div className="flex flex-col gap-4">
      {/* 1. Input */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center text-white shrink-0">
          <ImageIcon size={14} />
        </div>
        <div className="flex-1 h-[2px] bg-gray-100 relative">
          <div className="absolute -top-3 left-0 text-[8px] font-black text-gray-400 uppercase">Input Dataset</div>
          <ArrowRight size={10} className="absolute -right-1 -top-1 text-gray-300" />
        </div>
      </div>

      {/* 2. Split Process */}
      <div className="flex gap-4">
        <div className="w-8 flex flex-col items-center gap-1 shrink-0">
          <div className="w-[2px] h-full bg-gray-100" />
          <div className="w-2 h-2 rounded-full bg-gray-200" />
        </div>
        <div className="flex-1 space-y-3">
          <div className="p-3 bg-white border border-violet-100 rounded-2xl shadow-sm">
            <p className="text-[10px] font-black text-gray-900 flex items-center gap-2">
              <GitBranch size={10} className="text-violet-600" /> Initial Split
            </p>
            <div className="flex gap-1 mt-2">
              <div className="h-1.5 bg-violet-600 rounded-full" style={{ width: `${activeSplit.train}%` }} />
              <div className="h-1.5 bg-amber-600 rounded-full" style={{ width: `${activeSplit.valid}%` }} />
              <div className="h-1.5 bg-emerald-600 rounded-full" style={{ width: `${activeSplit.test}%` }} />
            </div>
          </div>

          {/* 3. Rebalance Step */}
          <div className={`p-3 border-2 rounded-2xl transition-all duration-500 ${rebalance ? 'bg-emerald-50 border-emerald-500 shadow-md shadow-emerald-100 scale-[1.02]' : 'bg-white border-gray-100 opacity-50'}`}>
             <p className="text-[10px] font-black text-gray-900 flex items-center gap-2">
              <Shuffle size={10} className={rebalance ? 'text-emerald-600' : 'text-gray-400'} /> Rebalance & Stratify
            </p>
            <p className="text-[8px] font-bold text-gray-500 mt-1">Ensures class consistency across sets.</p>
          </div>

          {/* 4. Outputs */}
          <div className="grid grid-cols-3 gap-2">
            <div className="p-2 bg-violet-50 rounded-xl border border-violet-100 text-center">
               <p className="text-[8px] font-black text-violet-700">TRAIN</p>
               <p className="text-[10px] font-black text-violet-900">{activeSplit.train}%</p>
            </div>
            <div className="p-2 bg-amber-50 rounded-xl border border-amber-100 text-center">
               <p className="text-[8px] font-black text-amber-700">VALID</p>
               <p className="text-[10px] font-black text-amber-900">{activeSplit.valid}%</p>
            </div>
            <div className="p-2 bg-emerald-50 rounded-xl border border-emerald-100 text-center">
               <p className="text-[8px] font-black text-emerald-700">TEST</p>
               <p className="text-[10px] font-black text-emerald-900">{activeSplit.test}%</p>
            </div>
          </div>

          {/* 5. Training Flow */}
          <div className="pt-2 flex items-center justify-between gap-2">
             <div className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full h-1 bg-violet-200 rounded-full" />
                <Target size={12} className="text-violet-400" />
             </div>
             <div className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full h-1 bg-amber-200 rounded-full" />
                <Activity size={12} className="text-amber-400" />
             </div>
             <div className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full h-1 bg-emerald-200 rounded-full" />
                <CheckCircle2 size={12} className="text-emerald-400" />
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
