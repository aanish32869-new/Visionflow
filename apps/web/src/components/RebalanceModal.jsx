import React, { useState, useEffect } from 'react';
import { X, Scale, AlertTriangle, ExternalLink, Info } from 'lucide-react';

export default function RebalanceModal({ isOpen, onClose, onRebalance, currentSplits = { train: 70, valid: 20, test: 10 } }) {
  const [splits, setSplits] = useState(currentSplits);
  const [confirmed, setConfirmed] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Sync splits with props ONLY when modal opens
  useEffect(() => {
    if (isOpen) {
      setSplits(currentSplits);
      setConfirmed(false);
    }
    // We explicitly only want to sync when the modal OPENS or when currentSplits changes 
    // while the modal is CLOSED. We do NOT want to sync if the modal is already open.
  }, [isOpen]); 

  if (!isOpen) return null;

  const handleSliderChange = (e, type) => {
    const val = parseInt(e.target.value);
    let newSplits = { ...splits };

    if (type === 'train') {
      const remaining = 100 - val;
      if (remaining === 0) {
        newSplits = { train: val, valid: 0, test: 0 };
      } else {
        const currentOtherTotal = (splits.valid + splits.test) || 1;
        newSplits.train = val;
        newSplits.valid = Math.round(remaining * (splits.valid / currentOtherTotal));
        newSplits.test = 100 - val - newSplits.valid;
      }
    } else if (type === 'valid') {
      const remaining = 100 - val;
      // Keep train fixed if possible
      if (val + splits.train <= 100) {
        newSplits.valid = val;
        newSplits.test = 100 - val - splits.train;
      } else {
        // If valid exceeds remaining space, reduce train
        newSplits.valid = val;
        newSplits.train = 100 - val;
        newSplits.test = 0;
      }
    } else if (type === 'test') {
      const remaining = 100 - val;
      // Keep train fixed if possible
      if (val + splits.train <= 100) {
        newSplits.test = val;
        newSplits.valid = 100 - val - splits.train;
      } else {
        // If test exceeds remaining space, reduce train
        newSplits.test = val;
        newSplits.train = 100 - val;
        newSplits.valid = 0;
      }
    }
    setSplits(newSplits);
  };

  const handleRebalance = async () => {
    if (!confirmed) return;
    setIsProcessing(true);
    try {
      await onRebalance(splits);
      onClose();
    } catch (err) {
      console.error("Rebalance failed", err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col border border-white/20 animate-in zoom-in duration-300">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-50 rounded-xl">
              <Scale size={24} className="text-gray-900" />
            </div>
            <h2 className="text-xl font-black text-gray-900 tracking-tight">Rebalancing Splits</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 p-8 space-y-8 overflow-y-auto">
          {/* Warning Message */}
          <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl flex items-start gap-3">
            <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={18} />
            <p className="text-[13px] font-bold text-amber-800 leading-relaxed">
              After rebalancing, you should avoid training from a previous checkpoint of this model to prevent overfitting due to bias from previous training.
            </p>
          </div>

          {/* Splits Visualization */}
          <div className="flex justify-between items-center px-4">
            <div className="flex flex-col items-center">
              <span className="px-3 py-1 bg-violet-100 text-violet-700 text-[10px] font-black rounded-lg uppercase tracking-wider mb-1 flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-violet-600"></div> Train
              </span>
              <span className="text-2xl font-black text-violet-600">{splits.train}%</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="px-3 py-1 bg-cyan-100 text-cyan-700 text-[10px] font-black rounded-lg uppercase tracking-wider mb-1 flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-600"></div> Valid
              </span>
              <span className="text-2xl font-black text-cyan-600">{splits.valid}%</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="px-3 py-1 bg-amber-100 text-amber-700 text-[10px] font-black rounded-lg uppercase tracking-wider mb-1 flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-600"></div> Test
              </span>
              <span className="text-2xl font-black text-amber-600">{splits.test}%</span>
            </div>
          </div>

          {/* Range Slider Container */}
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex justify-between text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">
                <span>Train Ratio</span>
                <span className="text-violet-600">{splits.train}%</span>
              </div>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={splits.train}
                onChange={(e) => handleSliderChange(e, 'train')}
                className="w-full h-2 bg-gray-100 rounded-full appearance-none cursor-pointer accent-violet-600"
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">
                <span>Validation Ratio</span>
                <span className="text-cyan-600">{splits.valid}%</span>
              </div>
              <input 
                type="range" 
                min="0" 
                max={100 - splits.train} 
                value={splits.valid}
                onChange={(e) => handleSliderChange(e, 'valid')}
                className="w-full h-2 bg-gray-100 rounded-full appearance-none cursor-pointer accent-cyan-500"
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">
                <span>Test Ratio</span>
                <span className="text-amber-600">{splits.test}%</span>
              </div>
              <input 
                type="range" 
                min="0" 
                max={100 - splits.train} 
                value={splits.test}
                onChange={(e) => handleSliderChange(e, 'test')}
                className="w-full h-2 bg-gray-100 rounded-full appearance-none cursor-pointer accent-amber-500"
              />
            </div>

            <div className="relative h-3 w-full bg-gray-100 rounded-full overflow-hidden flex border border-gray-100 shadow-inner">
              <div className="h-full bg-violet-500 transition-all duration-300" style={{ width: `${splits.train}%` }}></div>
              <div className="h-full bg-cyan-400 transition-all duration-300" style={{ width: `${splits.valid}%` }}></div>
              <div className="h-full bg-amber-400 transition-all duration-300" style={{ width: `${splits.test}%` }}></div>
            </div>
          </div>

          {/* What is rebalancing info box */}
          <div className="bg-blue-50/50 border border-blue-100/50 p-6 rounded-2xl">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-black text-blue-900">What is rebalancing?</h4>
              <a href="#" className="text-xs font-black text-blue-600 flex items-center gap-1 hover:underline">
                Learn more <ExternalLink size={12} />
              </a>
            </div>
            <p className="text-xs font-bold text-blue-800/70 leading-relaxed">
              Rebalance your dataset to have better class representation across the train/valid/test splits.
            </p>
          </div>

          {/* Confirmation Checkbox */}
          <label className="flex items-start gap-3 cursor-pointer group">
            <div className="relative mt-0.5">
              <input 
                type="checkbox" 
                checked={confirmed}
                onChange={() => setConfirmed(!confirmed)}
                className="peer sr-only"
              />
              <div className="w-5 h-5 border-2 border-gray-200 rounded-lg bg-white transition-all peer-checked:bg-violet-600 peer-checked:border-violet-600 group-hover:border-violet-400"></div>
              <svg className="absolute inset-0 w-5 h-5 text-white scale-0 transition-transform peer-checked:scale-100 p-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-[13px] font-bold text-gray-600 leading-snug">
              I understand that this will permanently update my dataset splits.
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-100 bg-gray-50/50 shrink-0">
          <button 
            disabled={!confirmed || isProcessing}
            onClick={handleRebalance}
            className={`w-full py-4 rounded-2xl font-black text-sm transition-all shadow-lg ${
              confirmed && !isProcessing
                ? "bg-violet-600 text-white hover:bg-violet-700 shadow-violet-200" 
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            {isProcessing ? "Rebalancing..." : "Rebalance Splits"}
          </button>
        </div>
      </div>
    </div>
  );
}
