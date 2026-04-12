import { Rocket, Sparkles, Brain } from "lucide-react";

export default function AutoLabelBatchPanel({
  assetCount,
  autoLabelError,
  autoLabelStatus,
  applyAutoLabelToBatch,
  isApplyingAutoLabel,
  onCancel,
}) {
  return (
    <div className="flex-1 flex flex-col h-full bg-[#fbfcff] animate-fade-in pb-12 w-full p-8 items-center justify-center">
      <div className="bg-white max-w-xl w-full border border-gray-200 shadow-xl rounded-2xl overflow-hidden animate-slide-up">
        <div className="p-6 border-b border-gray-100 bg-violet-50/50 flex items-center gap-4">
          <div className="w-12 h-12 bg-violet-100 rounded-full flex items-center justify-center">
            <Brain className="text-violet-600" size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">Rapid YOLO Labeling</h2>
            <p className="text-sm font-medium text-gray-500">
              Run local YOLO model to autonomously annotate your {assetCount} images.
            </p>
          </div>
        </div>

        <div className="p-8">
          <div className="mb-8">
             <h3 className="text-[15px] font-bold text-gray-800 mb-2">Production-Grade Object Detection</h3>
             <p className="text-[13px] text-gray-500 leading-relaxed">
               This process will trigger the onboard YOLOv8 model to scan every image in this batch. 
               It will automatically generate bounding boxes, assign class labels, and calculate 
               confidence scores for over 80+ common object categories.
             </p>
          </div>

          <div className="bg-violet-50 border border-violet-100 rounded-xl p-5 mb-8">
             <div className="flex items-center gap-3 mb-3">
                <Sparkles size={18} className="text-violet-600" />
                <span className="text-[13px] font-bold text-violet-900">Zero-Config Labeling</span>
             </div>
             <p className="text-[12px] text-violet-700/80 font-medium">
                No manual class definition required. The system uses the pre-trained weights to 
                find the most relevant features and map them to your project's schema.
             </p>
          </div>

          {autoLabelError && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12px] font-semibold flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> {autoLabelError}
            </div>
          )}

          {autoLabelStatus && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-[12px] font-semibold flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> {autoLabelStatus}
            </div>
          )}

          <div className="flex gap-4">
            <button
              onClick={onCancel}
              className="px-6 py-3.5 border border-gray-200 text-gray-600 hover:bg-gray-50 font-bold rounded-xl transition flex-1 text-sm shadow-sm"
            >
              Cancel
            </button>
            <button
              onClick={applyAutoLabelToBatch}
              disabled={isApplyingAutoLabel}
              className="px-6 py-3.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl transition flex-[2] flex items-center justify-center gap-2 text-sm shadow-md disabled:opacity-70 disabled:cursor-wait"
            >
              <Rocket size={18} /> {isApplyingAutoLabel ? "Running YOLO Inference..." : "Run YOLO Labeling"}
            </button>
          </div>
        </div>
        
        <div className="px-8 py-4 bg-gray-50 border-t border-gray-100 text-center">
           <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em]">Edge Inference Mode Active</p>
        </div>
      </div>
    </div>
  );
}
