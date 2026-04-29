import React from 'react';
import { useRouteError, useNavigate } from 'react-router-dom';
import { AlertTriangle, RotateCcw, Home, ChevronLeft } from 'lucide-react';

export default function ErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  console.error("Application Error Caught by Boundary:", error);

  return (
    <div className="h-screen overflow-y-auto bg-gray-50 flex items-center justify-center p-6 font-sans">
      <div className="max-w-md w-full bg-white rounded-[24px] shadow-2xl shadow-gray-200/50 border border-gray-100 overflow-hidden animate-in fade-in zoom-in duration-300">
        <div className="bg-rose-50 p-8 flex justify-center">
          <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center text-rose-500 animate-bounce duration-[2000ms]">
            <AlertTriangle size={32} />
          </div>
        </div>
        
        <div className="p-8 text-center">
          <h1 className="text-2xl font-black text-gray-900 mb-2 tracking-tight">Unexpected Application Error</h1>
          <p className="text-gray-500 text-[14px] leading-relaxed mb-8 font-medium">
            Something went wrong while rendering this page. Our team has been notified, and we're working to fix it.
          </p>

          <div className="bg-gray-50 rounded-xl p-4 mb-8 text-left border border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Error Details</p>
            <p className="text-[12px] font-mono text-rose-600 break-words font-semibold">
              {error?.message || error?.statusText || "Unknown Runtime Error"}
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3.5 bg-gray-900 text-white rounded-xl text-[14px] font-bold hover:bg-black transition shadow-lg shadow-gray-200 flex items-center justify-center gap-2 group"
            >
              <RotateCcw size={18} className="group-hover:rotate-180 transition-transform duration-500" />
              Try Again
            </button>
            
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => navigate(-1)}
                className="py-3 bg-white border border-gray-200 text-gray-700 rounded-xl text-[13px] font-bold hover:bg-gray-50 transition flex items-center justify-center gap-2"
              >
                <ChevronLeft size={16} />
                Go Back
              </button>
              <button 
                onClick={() => navigate('/')}
                className="py-3 bg-white border border-gray-200 text-gray-700 rounded-xl text-[13px] font-bold hover:bg-gray-50 transition flex items-center justify-center gap-2"
              >
                <Home size={16} />
                Dashboard
              </button>
            </div>
          </div>
        </div>

        <div className="bg-gray-50/50 p-4 border-t border-gray-100 flex justify-center">
          <p className="text-[11px] text-gray-400 font-medium tracking-tight">
            VisionFlow v2.0 • Advanced Error Recovery Active
          </p>
        </div>
      </div>
    </div>
  );
}
