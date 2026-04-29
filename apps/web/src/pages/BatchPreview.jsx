import React, { useState, useEffect, useRef } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { 
  ChevronLeft, Layout, Check, X, Edit3, Image as ImageIcon, 
  ExternalLink, BarChart2, Info, ArrowRight, Layers, Sparkles,
  Search, Filter, Plus, PieChart, Activity
} from "lucide-react";
import logger from "../utils/logger";
import AnnotatedThumbnail from "../components/AnnotatedThumbnail";

export default function BatchPreview() {
  const { batchId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const projectId = searchParams.get("project_id");
  
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("annotated"); // annotated | unassigned
  
  // Modal State
  const [isDatasetModalOpen, setIsDatasetModalOpen] = useState(false);
  const [ratios, setRatios] = useState({ train: 80, valid: 10, test: 10 });
  const [isMoving, setIsMoving] = useState(false);

  useEffect(() => {
    if (batchId && projectId) {
      fetchBatchAssets();
    }
  }, [batchId, projectId, activeTab]);

  const fetchBatchAssets = async () => {
    setLoading(true);
    try {
      const statusFilter = activeTab === "annotated" ? "annotated" : "unassigned";
      const res = await fetch(`/api/batches/${batchId}/assets?project_id=${projectId}&status=${statusFilter}`);
      if (res.ok) {
        const result = await res.json();
        setData(result);
      }
    } catch (err) {
      logger.error("Failed to fetch batch preview data", err);
    } finally {
      setLoading(false);
    }
  };

  const handleMoveToDataset = async () => {
    setIsMoving(true);
    try {
      const res = await fetch(`/api/batches/${batchId}/dataset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, ratios })
      });
      if (res.ok) {
        navigate(`/upload?project_id=${projectId}&tab=annotate`, { state: { flash: "Batch successfully moved to Dataset!" } });
      } else {
        const err = await res.json();
        alert(err.error || "Failed to move images to dataset.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsMoving(false);
      setIsDatasetModalOpen(false);
    }
  };

  const startManualLabeling = () => {
    // Navigate back to project upload but trigger the tool view for this batch
    navigate(`/upload?project_id=${projectId}&activeTab=annotate`, { 
      state: { 
        annotateView: 'tool', 
        activeAnnotationBatchId: batchId, 
        activeAnnotationState: 'unassigned' 
      } 
    });
  };

  const openInEditor = (assetId) => {
    navigate(`/upload?project_id=${projectId}&activeTab=annotate`, { 
      state: { 
        annotateView: 'tool', 
        activeAnnotationBatchId: batchId, 
        activeAnnotationState: activeTab,
        targetAssetId: assetId // Future prompt: select this specific asset in the tool
      } 
    });
  };

  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center h-screen overflow-y-auto bg-gray-50 p-10">
        <div className="bg-white p-8 rounded-2xl shadow-xl border border-gray-100 max-w-md text-center">
          <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <X size={32} />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Project ID Missing</h2>
          <p className="text-gray-500 mb-6">We couldn't identify which project this batch belongs to.</p>
          <button 
            onClick={() => navigate('/upload')}
            className="w-full py-3 bg-violet-600 text-white rounded-xl font-bold hover:bg-violet-700 transition"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-gray-50 flex flex-col">
      {/* Navbar Container */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => navigate(`/upload?project_id=${projectId}&tab=annotate`)}
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="flex flex-col">
              <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                Batch: {batchId.split("-").slice(0, 2).join(" ")}
                <span className="bg-gray-100 text-gray-500 text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded font-mono">#{batchId.length > 6 ? batchId.slice(-6).toUpperCase() : batchId.toUpperCase()}</span>
              </h1>
              <p className="text-xs text-gray-400 font-medium">Viewing {data?.total_images || 0} images in project</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
             <div className="flex items-center bg-gray-100 p-1 rounded-lg">
                <button 
                  onClick={() => setActiveTab("annotated")}
                  className={`px-4 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-2 ${activeTab === "annotated" ? 'bg-white shadow-sm text-violet-600' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <Check size={14} /> Annotated ({data?.annotated_count || 0})
                </button>
                <button 
                  onClick={() => setActiveTab("unassigned")}
                  className={`px-4 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-2 ${activeTab === "unassigned" ? 'bg-white shadow-sm text-amber-600' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <Activity size={14} /> Unassigned ({data ? data.total_images - data.annotated_count : 0})
                </button>
             </div>
             
             {activeTab === 'annotated' && data?.annotated_count > 0 && (
               <button 
                 onClick={() => setIsDatasetModalOpen(true)}
                 className="bg-violet-600 text-white px-5 py-2 rounded-xl text-sm font-bold shadow-lg shadow-violet-200 hover:bg-violet-700 transition flex items-center gap-2"
               >
                  <Layers size={16} /> Add to Dataset
               </button>
             )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 max-w-[1600px] mx-auto w-full flex overflow-hidden">
        {/* Left Scrollable Grid */}
        <div className="flex-1 p-8 px-6 overflow-y-auto custom-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-40 animate-pulse">
              <div className="w-12 h-12 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin mb-4"></div>
              <p className="text-gray-400 font-medium text-sm">Fetching batch data...</p>
            </div>
          ) : (
            <>
              {!data || !data.images || data.images.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-40 bg-white rounded-3xl border border-dashed border-gray-200 shadow-sm">
                  <div className="w-20 h-20 bg-gray-50 text-gray-200 rounded-full flex items-center justify-center mb-6">
                    <ImageIcon size={40} />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-1">No images found</h3>
                  <p className="text-gray-400 text-sm max-w-xs text-center">There are no images in this batch with the status "{activeTab}".</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-6 pb-20">
                  {data.images.map(image => (
                    <div key={image.id} className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm hover:border-violet-200 hover:shadow-xl transition-all group flex flex-col cursor-pointer" onClick={() => openInEditor(image.id)}>
                      <AnnotatedThumbnail asset={image} />
                      <div className="mt-4 flex flex-col gap-1.5 px-1">
                        <div className="flex justify-between items-start">
                          <span className="text-[11px] font-bold text-gray-900 truncate max-w-[120px]">{image.filename}</span>
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${image.status === 'annotated' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{image.status}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1 text-[10px] text-gray-400 font-medium">
                             <Layout size={10} />
                             {image.annotations?.length || 0} Boxes
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Right Side Action Panel (For Unassigned) */}
        {activeTab === 'unassigned' && (
          <div className="w-[320px] border-l border-gray-200 bg-white p-8 overflow-y-auto shrink-0 transition-all animate-slide-in-right">
             <div className="mb-8">
               <h3 className="text-[15px] font-bold text-gray-900 mb-2">Automate this batch</h3>
               <p className="text-xs text-gray-500 font-medium leading-relaxed">Use AI to generate bounding box suggestions for all images in this batch.</p>
             </div>

             <div className="space-y-4">
                <button className="w-full bg-gradient-to-br from-violet-600 to-indigo-700 text-white p-5 rounded-2xl shadow-lg shadow-violet-200 flex flex-col items-start gap-4 hover:scale-[1.02] transition-transform group">
                   <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center group-hover:bg-white/30 transition">
                      <Sparkles size={20} className="text-white" />
                   </div>
                   <div className="text-left">
                     <span className="block text-sm font-bold">Auto-Label (YOLOv26s)</span>
                     <span className="block text-[11px] text-white/70 font-medium">Fast, accurate suggestions</span>
                   </div>
                </button>

                <div className="relative py-4 flex items-center gap-4">
                  <div className="h-[1px] bg-gray-100 flex-1"></div>
                  <span className="text-[10px] font-bold text-gray-400">OR</span>
                  <div className="h-[1px] bg-gray-100 flex-1"></div>
                </div>

                <button 
                  onClick={startManualLabeling}
                  className="w-full border border-gray-200 bg-gray-50/50 p-5 rounded-2xl flex flex-col items-start gap-4 hover:bg-white hover:border-violet-200 transition group"
                >
                   <div className="w-10 h-10 bg-white border border-gray-100 rounded-xl flex items-center justify-center text-gray-400 group-hover:text-violet-600 transition">
                      <Edit3 size={20} />
                   </div>
                   <div className="text-left">
                     <span className="block text-sm font-bold text-gray-900">Manual Annotation</span>
                     <span className="block text-[11px] text-gray-500 font-medium italic">Label myself from scratch</span>
                   </div>
                </button>
             </div>

             <div className="mt-12 p-5 bg-amber-50 border border-amber-100 rounded-2xl">
                <div className="flex items-center gap-3 mb-3 text-amber-700">
                   <Info size={16} />
                   <span className="text-[13px] font-bold">Heads up!</span>
                </div>
                <p className="text-[11px] text-amber-800/70 font-medium leading-relaxed">Images must be annotated before they can be moved to the finalized Dataset workspace.</p>
             </div>
          </div>
        )}
      </div>

      {/* Dataset Modal */}
      {isDatasetModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6 animate-fade-in">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-scale-up">
            <div className="bg-violet-600 p-8 text-white relative">
              <button 
                onClick={() => setIsDatasetModalOpen(false)}
                className="absolute top-6 right-6 p-2 hover:bg-white/20 rounded-xl transition"
              >
                <X size={20} />
              </button>
              <div className="flex items-center gap-4 mb-4">
                 <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center">
                    <PieChart size={24} />
                 </div>
                 <div>
                    <h2 className="text-xl font-bold">Finalize Image Batch</h2>
                    <p className="text-sm text-white/70">Moving {data?.annotated_count} images to Dataset</p>
                 </div>
              </div>
            </div>

            <div className="p-8">
               <h4 className="text-[13px] font-bold text-gray-900 mb-6 uppercase tracking-wider">Configure Dataset Split</h4>
               
               <div className="space-y-6">
                  {/* Train */}
                  <div className="flex items-center justify-between">
                     <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-violet-600"></div>
                        <div className="flex flex-col">
                           <span className="text-sm font-bold text-gray-900">Training Set</span>
                           <span className="text-[11px] text-gray-500 font-medium">Used for core learning</span>
                        </div>
                     </div>
                     <div className="flex items-center gap-2">
                        <input 
                          type="number" 
                          value={ratios.train}
                          onChange={(e) => setRatios({...ratios, train: parseInt(e.target.value) || 0})}
                          className="w-16 p-2 bg-gray-50 border border-gray-200 rounded-lg text-right text-sm font-bold focus:border-violet-400 outline-none"
                        />
                        <span className="text-gray-400 font-bold">%</span>
                     </div>
                  </div>

                  {/* Valid */}
                  <div className="flex items-center justify-between">
                     <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                        <div className="flex flex-col">
                           <span className="text-sm font-bold text-gray-900">Validation Set</span>
                           <span className="text-[11px] text-gray-500 font-medium">Measure performance</span>
                        </div>
                     </div>
                     <div className="flex items-center gap-2">
                        <input 
                          type="number" 
                          value={ratios.valid}
                          onChange={(e) => setRatios({...ratios, valid: parseInt(e.target.value) || 0})}
                          className="w-16 p-2 bg-gray-50 border border-gray-200 rounded-lg text-right text-sm font-bold focus:border-violet-400 outline-none"
                        />
                        <span className="text-gray-400 font-bold">%</span>
                     </div>
                  </div>

                  {/* Test */}
                  <div className="flex items-center justify-between">
                     <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                        <div className="flex flex-col">
                           <span className="text-sm font-bold text-gray-900">Testing Set</span>
                           <span className="text-[11px] text-gray-500 font-medium">Unseen final evaluation</span>
                        </div>
                     </div>
                     <div className="flex items-center gap-2">
                        <input 
                          type="number" 
                          value={ratios.test}
                          onChange={(e) => setRatios({...ratios, test: parseInt(e.target.value) || 0})}
                          className="w-16 p-2 bg-gray-50 border border-gray-200 rounded-lg text-right text-sm font-bold focus:border-violet-400 outline-none"
                        />
                        <span className="text-gray-400 font-bold">%</span>
                     </div>
                  </div>
               </div>

               {/* Visualization of split */}
               <div className="mt-10 mb-8 w-full h-3 bg-gray-100 rounded-full flex overflow-hidden">
                  <div className="bg-violet-600 h-full transition-all" style={{ width: `${ratios.train}%` }}></div>
                  <div className="bg-amber-500 h-full transition-all" style={{ width: `${ratios.valid}%` }}></div>
                  <div className="bg-emerald-500 h-full transition-all" style={{ width: `${ratios.test}%` }}></div>
               </div>

               <div className="flex gap-4">
                  <button 
                    onClick={() => setIsDatasetModalOpen(false)}
                    className="flex-1 py-3 text-sm font-bold text-gray-500 hover:text-gray-700 transition"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleMoveToDataset}
                    disabled={isMoving || (ratios.train + ratios.valid + ratios.test !== 100)}
                    className="flex-[2] py-3 bg-violet-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-violet-200 hover:bg-violet-700 transition disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-2"
                  >
                    {isMoving ? <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div> : <Check size={18} />}
                    {ratios.train + ratios.valid + ratios.test !== 100 ? "Ratios must equal 100%" : "Finalize & Add to Dataset"}
                  </button>
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
