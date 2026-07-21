import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { useAnnotation } from '../AnnotationContext';

export default function ClassSelectorModal() {
  const { 
    showClassSelector, 
    setShowClassSelector, 
    pendingClassName, 
    setPendingClassName, 
    commitPendingAnnotation,
    classes
  } = useAnnotation();

  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    if (showClassSelector) {
      setInputValue("");
    }
  }, [showClassSelector]);

  if (!showClassSelector) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (inputValue.trim()) {
      commitPendingAnnotation(inputValue.trim());
    }
  };

  const handleSelectExisting = (className) => {
    commitPendingAnnotation(className);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50/50">
          <h3 className="font-black text-gray-900 text-[15px]">Name this Object</h3>
          <button 
            onClick={() => {
              setShowClassSelector(false);
              setPendingClassName("");
            }}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg transition"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5">
          <form onSubmit={handleSubmit} className="mb-4">
            <label className="block text-[11px] font-black text-gray-400 uppercase tracking-widest mb-2">
              New or Existing Class
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="e.g. Person, Car, Helmet..."
                className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition"
              />
              <button 
                type="submit"
                disabled={!inputValue.trim()}
                className="bg-violet-600 text-white p-2.5 rounded-xl hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                <Check size={18} />
              </button>
            </div>
          </form>

          {classes.length > 0 && (
            <div>
              <div className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-2">
                Or select existing:
              </div>
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-1">
                {classes.map((c) => (
                  <button
                    key={c.id || c.name}
                    onClick={() => handleSelectExisting(c.name)}
                    className="px-3 py-1.5 bg-gray-50 hover:bg-violet-50 text-gray-700 hover:text-violet-700 text-xs font-bold rounded-lg border border-gray-200 hover:border-violet-200 transition"
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }}></div>
                      {c.name}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
