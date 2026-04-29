import React from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { useAnnotation } from '../AnnotationContext';

export default function RejectModal() {
  const { 
    showRejectModal, setShowRejectModal, reviewComment, setReviewComment,
    currentAsset, setAssetState, updateAsset, showFeedback
  } = useAnnotation();

  if (!showRejectModal) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-in fade-in duration-200">
       <div className="bg-white rounded-[32px] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
          <div className="p-8">
             <div className="w-16 h-16 bg-rose-100 rounded-2xl flex items-center justify-center text-rose-600 mb-6">
                <AlertTriangle size={32} />
             </div>
             
             <h3 className="text-2xl font-black text-gray-900 mb-2 tracking-tight">Reject Annotation</h3>
             <p className="text-gray-500 font-bold leading-relaxed mb-6">
                Please provide feedback for the labeler about what needs to be fixed.
             </p>

             <textarea 
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder="Example: Bounding boxes are too loose, or incorrect class label..."
                className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-4 text-sm font-bold h-32 focus:ring-2 focus:ring-rose-200 outline-none transition resize-none"
             />
          </div>

          <div className="p-6 bg-gray-50 flex gap-3">
             <button 
                onClick={() => setShowRejectModal(false)}
                className="flex-1 py-4 text-sm font-black text-gray-400 hover:text-gray-600 transition"
             >
                CANCEL
             </button>
             <button 
                onClick={async () => {
                   const res = await fetch(`/api/assets/${currentAsset.id}/review`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'reject', comment: reviewComment })
                   });
                   if (res.ok) {
                      setAssetState('rejected');
                      setShowRejectModal(false);
                      showFeedback("Annotation rejected. Feedback sent.", "success");
                      if (typeof updateAsset === 'function') updateAsset(currentAsset.id, true, 'rejected');
                   }
                }}
                disabled={!reviewComment.trim()}
                className="flex-[2] py-4 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white rounded-2xl font-black text-sm shadow-lg shadow-rose-200 transition active:scale-95 uppercase tracking-widest"
             >
                Confirm Rejection
             </button>
          </div>
       </div>
    </div>
  );
}
