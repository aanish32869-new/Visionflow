/* eslint-disable react-hooks/exhaustive-deps, no-unused-vars */
import React, { useState, useEffect, useRef } from "react";
import { Server, ImageIcon, ShieldCheck, Crosshair, HelpCircle, Loader } from "lucide-react";

export default function DeployTab({ projectId }) {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [_imageFile, setImageFile] = useState(null);
  const [imageURL, setImageURL] = useState(null);
  const [predictions, setPredictions] = useState(null);
  const [isInferencing, setIsInferencing] = useState(false);
  const [infereceTime, setInferenceTime] = useState(null);
  const [activeCodeTab, setActiveCodeTab] = useState('python');
  const [copyMessage, setCopyMessage] = useState("");
  
  const fileInputRef = useRef(null);
  const imgRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    fetchModels();
     

  }, [projectId]);

  async function fetchModels() {
    try {
      const res = await fetch(`/api/projects/${projectId}/models`);
      if (res.ok) {
        const data = await res.json();
        setModels(data);
        if (data.length > 0) setSelectedModel(data[data.length - 1].id || data[data.length - 1]._id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const currentModel = models.find(m => (m.id || m._id) === selectedModel);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      const url = URL.createObjectURL(file);
      setImageURL(url);
      setPredictions(null);
      setInferenceTime(null);
      runInference(file, selectedModel);
    }
  };

  const runInference = async (file, modelId) => {
    if (!file || !modelId) return;
    setIsInferencing(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      // Give it a tiny delay to pretend it's uploading/inferencing on cloud
      await new Promise(r => setTimeout(r, 600));

      const res = await fetch(`/api/projects/${projectId}/models/${modelId}/infer`, {
        method: "POST",
        body: formData
      });
      
      if (res.ok) {
        const data = await res.json();
        setPredictions(data.predictions);
        setInferenceTime(data.time);
      }
    } catch (err) {
      console.error(err);
    }
    setIsInferencing(false);
  };

  const drawPredictions = () => {
    if (!predictions || !imgRef.current || !canvasRef.current) return;
    
    const img = imgRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Match canvas to image dimensions
    canvas.width = img.width;
    canvas.height = img.height;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    predictions.forEach(p => {
      const w = p.width * canvas.width;
      const h = p.height * canvas.height;
      const x = p.x * canvas.width - w / 2;
      const y = p.y * canvas.height - h / 2;
      
      // Draw Box
      ctx.strokeStyle = '#8b5cf6';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = 'rgba(139, 92, 246, 0.2)';
      ctx.fillRect(x, y, w, h);
      
      // Draw Label
      const label = `${p.class} ${(p.confidence * 100).toFixed(1)}%`;
      ctx.fillStyle = '#8b5cf6';
      const textWidth = ctx.measureText(label).width + 10;
      ctx.fillRect(x, y - 18, Math.max(80, textWidth), 18);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(label, x + 4, y - 5);
    });
  };

  const currentCodeSnippet = activeCodeTab === 'python' ? `import requests

url = "https://infer.visionflow.io/${projectId}/1"
files = {"file": open("image.jpg", "rb")}

response = requests.post(url, files=files)
print(response.json())` :
`import okhttp3.*;

OkHttpClient client = new OkHttpClient();
RequestBody body = new MultipartBody.Builder()
  .setType(MultipartBody.FORM)
  .addFormDataPart("file", "image.jpg",
    RequestBody.create(
      MediaType.parse("image/jpeg"), 
      new File("image.jpg")
    ))
  .build();

Request request = new Request.Builder()
  .url("https://infer.visionflow.io/${projectId}/1")
  .post(body)
  .build();

Response response = client.newCall(request).execute();
System.out.println(response.body().string());`;

  const handleCopySnippet = async () => {
    try {
      await navigator.clipboard.writeText(currentCodeSnippet);
      setCopyMessage("Copied");
      setTimeout(() => setCopyMessage(""), 1500);
    } catch (err) {
      console.error("Failed to copy code snippet", err);
      setCopyMessage("Copy failed");
      setTimeout(() => setCopyMessage(""), 1500);
    }
  };

  useEffect(() => {
    drawPredictions();
     

  }, [predictions]);

  return (
    <div className="flex flex-col gap-6 w-full animate-page-enter max-w-[1200px] mx-auto min-h-[70vh]">
      <div className="flex justify-between items-center mb-2">
         <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
           <Server className="text-violet-600" /> Deploy via VisionFlow API
         </h2>
      </div>

      <div className="flex flex-col xl:flex-row gap-8 h-full">
         
         {/* Left Side: Test your model directly */}
         <div className="flex-1 bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col overflow-hidden min-h-[500px]">
            <div className="bg-gray-50 border-b border-gray-200 p-4 flex items-center justify-between">
               <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                  <Crosshair size={16} /> Test Inference
               </h3>
               {infereceTime && (
                  <span className="text-[11px] font-bold tracking-widest uppercase bg-green-100 text-green-700 px-2 py-0.5 rounded">
                     {infereceTime * 1000}ms Speed
                  </span>
               )}
            </div>

            <div className="flex-1 bg-gray-100 relative flex items-center justify-center p-6 min-h-[400px]">
               {models.length === 0 ? (
                  <div className="text-center text-gray-400">
                    <ShieldCheck size={48} className="mb-4 text-gray-300 mx-auto" />
                    <p className="font-medium text-[15px]">No models trained.</p>
                    <p className="text-[13px] mt-1">Train a model first to test inference.</p>
                  </div>
               ) : !imageURL ? (
                  <div className="text-center">
                     <p className="font-bold text-gray-600 mb-6 drop-shadow-sm">Upload an image to test inference</p>
                     <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
                     <button onClick={() => fileInputRef.current?.click()} className="bg-white border-2 border-dashed border-violet-400 text-violet-700 hover:bg-violet-50 font-bold px-8 py-4 rounded-xl shadow-sm transition flex gap-3 m-auto items-center">
                        <ImageIcon size={20} /> Select Image
                     </button>
                  </div>
               ) : (
                  <div className="relative inline-block max-w-full max-h-full">
                     <img 
                       ref={imgRef} 
                       src={imageURL} 
                       alt="Inference" 
                       className={`max-h-[50vh] object-contain rounded-lg shadow-xl outline outline-4 outline-white transition ${isInferencing ? 'opacity-50 blur-[2px]' : ''}`} 
                       onLoad={drawPredictions} 
                     />
                     <canvas 
                       ref={canvasRef} 
                       className="absolute top-0 left-0 pointer-events-none"
                     ></canvas>

                     {isInferencing && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                           <Loader className="animate-spin text-white drop-shadow-md" size={48} strokeWidth={2.5} />
                        </div>
                     )}
                     
                     {!isInferencing && predictions && (
                        <button onClick={() => fileInputRef.current?.click()} className="absolute -bottom-16 left-1/2 -translate-x-1/2 bg-white text-gray-800 font-bold px-4 py-2 rounded-lg shadow border border-gray-200 text-sm hover:bg-gray-50 flex items-center gap-2">
                           <ImageIcon size={14} /> Try Another
                           <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
                        </button>
                     )}
                  </div>
               )}
            </div>
         </div>

         {/* Right Side: Deployment Configs */}
         <div className="w-full xl:w-[350px] shrink-0 flex flex-col gap-6">
            <h3 className="font-bold text-gray-800 text-sm tracking-wide uppercase">Deployment Settings</h3>
            
            <div className="bg-white border text-left border-gray-200 rounded-xl p-5 shadow-sm">
               <label className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mb-2 block">Selected Model</label>
               <select 
                  className="w-full border py-2 px-3 border-gray-300 rounded-md outline-none focus:border-violet-500 font-medium text-gray-800 text-sm mb-4"
                  value={selectedModel || ''}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={models.length === 0}
               >
                  {models.map((m, _i) => (
                     <option key={m.id || m._id} value={m.id || m._id}>{m.name}</option>
                  ))}
                  {models.length === 0 && <option>No models available</option>}
               </select>

               {currentModel && (
                  <div className="flex items-center gap-2 mb-4 bg-green-50 p-2 rounded border border-green-100">
                     <ShieldCheck size={16} className="text-green-600" />
                     <span className="text-xs font-bold text-green-800">Model verified and deployed</span>
                  </div>
               )}
               
               <label className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mb-2 block mt-6 flex gap-1 items-center">
                 API Endpoint <HelpCircle size={10} />
               </label>
                <div className="flex bg-gray-50 rounded border border-gray-200 overflow-hidden mb-6">
                 <span className="text-gray-500 text-xs py-2 px-3 border-r border-gray-200 font-mono self-center">POST</span>
                 <input type="text" readOnly value={`https://infer.visionflow.io/${projectId}/1`} className="w-full bg-transparent text-gray-800 text-xs font-mono outline-none px-3" />
               </div>

               <p className="text-[11px] text-gray-500 mt-2 border-b border-gray-100 pb-4 mb-4">
                 You can immediately deploy this model natively using the VisionFlow mobile SDKs or Docker containers.
               </p>

               {/* Code Snippet Area */}
               <label className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mb-3 block">Implementation Code</label>
               
               <div className="flex bg-[#1e1e1e] rounded-t-lg border-x border-t border-[#333] pt-2 px-2">
                  <div 
                     className={`px-3 py-1.5 text-xs font-bold cursor-pointer rounded-t-md transition ${activeCodeTab === 'python' ? 'bg-[#333] text-white' : 'text-gray-400 hover:text-gray-200'}`}
                     onClick={() => setActiveCodeTab('python')}
                  >
                     Python (Requests)
                  </div>
                  <div 
                     className={`px-3 py-1.5 text-xs font-bold cursor-pointer rounded-t-md transition ${activeCodeTab === 'java' ? 'bg-[#333] text-white' : 'text-gray-400 hover:text-gray-200'}`}
                     onClick={() => setActiveCodeTab('java')}
                  >
                     Java (OkHttp)
                  </div>
               </div>
               <div className="bg-[#1e1e1e] p-4 rounded-b-lg border-x border-b border-[#333] overflow-x-auto relative group shadow-inner">
                  <pre className="text-gray-300 text-[11px] font-mono leading-relaxed">{currentCodeSnippet}</pre>
                  <button 
                     onClick={handleCopySnippet}
                     className="absolute top-2 right-2 bg-[#444] text-white hover:bg-violet-600 px-3 py-1.5 rounded text-[10px] font-bold opacity-0 group-hover:opacity-100 transition shadow"
                  >
                     {copyMessage || "Copy"}
                  </button>
               </div>
            </div>
         </div>

      </div>
    </div>
  );
}
