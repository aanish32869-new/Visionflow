/* eslint-disable react-hooks/exhaustive-deps, no-unused-vars */
import React, { useState, useRef, useEffect } from "react";
import { Edit3, Save, Trash, X, Plus, Square, Hexagon, Tag, Sparkles } from "lucide-react";
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

const COLORS = ['#8b5cf6', '#ef4444', '#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#14b8a6'];

export default function AnnotationTool({ assets, projectId, projectType = "Object Detection", classificationType = null, updateAsset }) {
  const [currentAssetIndex, setCurrentAssetIndex] = useState(0);
  const [annotations, setAnnotations] = useState([]);
  const [autoLabelModel, setAutoLabelModel] = useState("yolov8x.pt");
  
  const isClassification = projectType === "Classification";
  const isSegmentation = projectType.includes("Segmentation");
  
  // Tools
  const [tool, setTool] = useState(isClassification ? 'tag' : (isSegmentation ? 'polygon' : 'box'));
  
  // Classes
  const [classes, setClasses] = useState([]);
  const [activeClassIdx, setActiveClassIdx] = useState(0);
  const [newClassName, setNewClassName] = useState("");
  const [lockAnnotationClasses, setLockAnnotationClasses] = useState(false);
  const [pendingAnnotation, setPendingAnnotation] = useState(null);
  const [showClassSelector, setShowClassSelector] = useState(false);
  const [pendingClassName, setPendingClassName] = useState("");
  const [autoLabelAll, setAutoLabelAll] = useState(false);
  const [autoLabelDetectedClasses, setAutoLabelDetectedClasses] = useState([]);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.75);

  // Drawing State
  const [isDrawingBox, setIsDrawingBox] = useState(false);
  const [startPoint, setStartPoint] = useState(null);
  const [currentBox, setCurrentBox] = useState(null);
  const [currentPolygon, setCurrentPolygon] = useState([]);
  const [mousePos, setMousePos] = useState(null);
  const [crosshair, setCrosshair] = useState(null);

  const [isSaving, setIsSaving] = useState(false);
  const [showSaveToast, setShowSaveToast] = useState(false);
  const [feedback, setFeedback] = useState(null);
  
  
  const imgRef = useRef(null);
  const containerRef = useRef(null);

  const currentAsset = assets[currentAssetIndex];
  const activeClass = classes[activeClassIdx] || classes[0] || null;
  const activeColor = activeClass?.color || COLORS[0];

  useEffect(() => {
    if (!projectId) return;
    fetchProjectLabels();
  }, [projectId]);

  useEffect(() => {
    if (currentAsset) {
      fetchAnnotations(currentAsset.id);
      setIsDrawingBox(false);
      setCurrentPolygon([]);
      setCurrentBox(null);
      setFeedback(null);
    }
     

  }, [currentAssetIndex, currentAsset]);

  async function fetchProjectLabels() {
    try {
      const res = await fetch(`/api/projects/${projectId}/classes-tags`);
      if (!res.ok) return;
      const data = await res.json();
      const nextClasses = Array.isArray(data.classes) ? data.classes : [];
      setClasses(nextClasses.map((item, index) => ({
        name: item.name,
        color: item.color || COLORS[index % COLORS.length],
        attributes: item.attributes || [],
      })));
      setLockAnnotationClasses(Boolean(data.settings?.lock_annotation_classes));
      setActiveClassIdx(0);
    } catch (err) {
      console.error(err);
    }
  }

  async function fetchAnnotations(assetId) {
    try {
      const res = await fetch(`/api/assets/${assetId}/annotations`);
      if (res.ok) {
        const data = await res.json();
        setAnnotations(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  async function ensureProjectClasses(classNames) {
    const normalizedNames = [...new Set((classNames || []).map((item) => String(item || "").trim()).filter(Boolean))];
    if (!normalizedNames.length) {
      return classes;
    }

    let nextClasses = [...classes];
    for (const className of normalizedNames) {
      if (nextClasses.some((item) => item.name.toLowerCase() === className.toLowerCase())) {
        continue;
      }
      if (lockAnnotationClasses) {
        continue;
      }

      const res = await fetch(`/api/projects/${projectId}/classes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: className }),
      });

      if (res.ok) {
        const data = await res.json();
        const serverClasses = Array.isArray(data.classes) ? data.classes : [];
        nextClasses = serverClasses.map((item, index) => ({
          name: item.name,
          color: item.color || COLORS[index % COLORS.length],
          attributes: item.attributes || [],
        }));
        setClasses(nextClasses);
      }
    }

    return nextClasses;
  }

  const getPos = (e) => {
    if (!containerRef.current) return {x:0, y:0};
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.min(Math.max(0, e.clientX - rect.left), rect.width);
    const y = Math.min(Math.max(0, e.clientY - rect.top), rect.height);
    return { x, y, rw: rect.width, rh: rect.height };
  };

  const showFeedback = (message, type = "error") => {
    setFeedback({ message, type });
  };

  const handleMouseDown = (e) => {
    if (e.target.closest('.annotation-toolbar')) return;
    if (isClassification) return; // Disallow drawing completely for classification
    
    const { x, y, rw, rh } = getPos(e);
    
    if (tool === 'box') {
      setStartPoint({ x, y });
      setIsDrawingBox(true);
    } else if (tool === 'polygon') {
      if (currentPolygon.length > 0) {
        const dist = Math.hypot(x - currentPolygon[0].x, y - currentPolygon[0].y);
        if (dist < 10) {
          finishPolygon();
          return;
        }
      }
      setCurrentPolygon([...currentPolygon, { x, y }]);
    } else if (tool === 'magic') {
      if (!activeClass) {
         showFeedback("Please add at least one project class first.");
         return;
      }
      // Pass normalized coordinate
      handleSmartClick(x / rw, y / rh, activeClass);
    }
  };

  const handleSmartClick = async (nx, ny, activeClass) => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/smart-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          url: currentAsset.url, 
          model: autoLabelModel,
          point: { x: nx, y: ny },
          query: activeClass.name
        })
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.detection) {
           const d = data.detection;
           const newAnnotation = {
             type: d.type || 'box',
             label: activeClass.name,
             color: activeClass.color,
             x_center: d.x_center,
             y_center: d.y_center,
             width: d.width,
             height: d.height,
             points: d.points
           };
           setAnnotations(prev => [...prev, newAnnotation]);
        }
      } else {
        showFeedback("Smart Click could not identify an object at this location.");
      }
    } catch (err) {
      console.error(err);
      showFeedback("Smart Click failed. Please retry or switch to manual annotation.");
    }
    setIsSaving(false);
  };

  const handleMouseMove = (e) => {
    if (isClassification) return;
    
    const { x, y } = getPos(e);
    setMousePos({ x, y });
    setCrosshair({ x, y });
    
    if (tool === 'box' && isDrawingBox && startPoint) {
      setCurrentBox({
        x: Math.min(startPoint.x, x),
        y: Math.min(startPoint.y, y),
        w: Math.abs(x - startPoint.x),
        h: Math.abs(y - startPoint.y)
      });
    }
  };

  const handleMouseUp = () => {
    if (isClassification) return;

    if (tool === 'box' && isDrawingBox) {
      if (currentBox && currentBox.w > 5 && currentBox.h > 5) {
        if (!activeClass && lockAnnotationClasses) {
           showFeedback("Please add at least one project class first.");
           setIsDrawingBox(false); setStartPoint(null); setCurrentBox(null);
           return;
        }
        const rect = containerRef.current.getBoundingClientRect();
        const draftAnnotation = {
          type: 'box',
          x_center: (currentBox.x + currentBox.w / 2) / rect.width,
          y_center: (currentBox.y + currentBox.h / 2) / rect.height,
          width: currentBox.w / rect.width,
          height: currentBox.h / rect.height,
        };
        setPendingAnnotation(draftAnnotation);
        setPendingClassName(activeClass?.name || "");
        setShowClassSelector(true);
      }
      setIsDrawingBox(false);
      setStartPoint(null);
      setCurrentBox(null);
    }
  };

  const handleMouseLeave = () => {
    if (isClassification) return;
    setCrosshair(null);
    handleMouseUp();
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    if (tool === 'polygon' && currentPolygon.length > 2) {
      finishPolygon();
    }
  };

  const finishPolygon = () => {
    if (currentPolygon.length > 2) {
      if (!activeClass && lockAnnotationClasses) {
         showFeedback("Please add at least one project class first.");
         setCurrentPolygon([]);
         return;
      }
      const rect = containerRef.current.getBoundingClientRect();
      
      const normalizedPoints = currentPolygon.map(p => ({
        x: p.x / rect.width,
        y: p.y / rect.height
      }));

      const draftAnnotation = {
        type: 'polygon',
        points: normalizedPoints
      };
      setPendingAnnotation(draftAnnotation);
      setPendingClassName(activeClass?.name || "");
      setShowClassSelector(true);
    }
    setCurrentPolygon([]);
  };

  const applyClassificationTag = () => {
    if (isClassification) {
      if (!activeClass) {
         showFeedback("Please add at least one project class first.");
         return;
      }
      const newTag = {
        type: 'tag',
        label: activeClass.name,
        color: activeClass.color
      };

      if (classificationType === "Single-Label") {
        setAnnotations([newTag]); // Replace everything since it's single label
      } else {
        if (!annotations.find(a => a.label === activeClass.name)) {
           setAnnotations([...annotations, newTag]);
        }
      }
    }
  };

  const addClass = () => {
    const name = newClassName.trim();
    if (!name) return;
    if (lockAnnotationClasses) {
      showFeedback("Class creation is locked for this project.");
      return;
    }
    if (classes.find(c => c.name.toLowerCase() === name.toLowerCase())) {
      setNewClassName("");
      return;
    }
    ensureProjectClasses([name])
      .then((nextClasses) => {
        setClasses(nextClasses);
        const nextIndex = nextClasses.findIndex((item) => item.name.toLowerCase() === name.toLowerCase());
        if (nextIndex >= 0) setActiveClassIdx(nextIndex);
        setNewClassName("");
      })
      .catch((error) => {
        console.error(error);
        showFeedback("Could not create that class.");
      });
  };

  const commitPendingAnnotation = async (classNameValue = pendingClassName) => {
    const finalClassName = String(classNameValue || "").trim();
    if (!pendingAnnotation) return;
    if (!finalClassName) {
      showFeedback("Choose or create a class before finishing the annotation.");
      return;
    }

    let nextClasses = classes;
    let classObject = classes.find((item) => item.name.toLowerCase() === finalClassName.toLowerCase());

    if (!classObject) {
      if (lockAnnotationClasses) {
        showFeedback("Class creation is locked for this project.");
        return;
      }
      nextClasses = await ensureProjectClasses([finalClassName]);
      classObject = nextClasses.find((item) => item.name.toLowerCase() === finalClassName.toLowerCase());
    }

    if (!classObject) {
      showFeedback("Could not find or create the selected class.");
      return;
    }

    setClasses(nextClasses);
    setActiveClassIdx(Math.max(nextClasses.findIndex((item) => item.name === classObject.name), 0));
    setAnnotations((prev) => [
      ...prev,
      {
        ...pendingAnnotation,
        label: classObject.name,
        color: classObject.color,
      },
    ]);
    setPendingAnnotation(null);
    setPendingClassName("");
    setShowClassSelector(false);
  };

  const saveAnnotations = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/assets/${currentAsset.id}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotations })
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to save annotations.");
      }
    } catch (err) {
      console.error(err);
      showFeedback(err.message || "Failed to save annotations.");
      setIsSaving(false);
      return false;
    }
    
    // Natively sync annotation metrics upwards
    if (typeof updateAsset === 'function') {
       updateAsset(currentAsset.id, annotations.length > 0);
    }
    
    setShowSaveToast(true);
    setTimeout(() => setShowSaveToast(false), 2000);
    setFeedback({ message: "Annotations saved.", type: "success" });
    setIsSaving(false);
    return true;
  };

  const handleAutoLabel = async () => {
    if (!autoLabelAll && classes.length === 0) {
      showFeedback("Please define project classes first, or enable Detect All for open-vocabulary detection.");
      return;
    }

    setIsSaving(true);
    try {
      const activeQueryList = autoLabelAll ? [] : classes.map(c => c.name);
      const endpoint = isClassification ? "/api/classify" : "/api/auto-label";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: currentAsset.url,
          model: autoLabelModel,
          queries: activeQueryList,
          auto_label_all: autoLabelAll,
          conf: confidenceThreshold
        })
      });

      if (!res.ok) {
        throw new Error("Backend auto-label failed");
      }

      const data = await res.json();

      if (isClassification) {
        if (data.success && Array.isArray(data.labels) && data.labels.length > 0) {
          const selectedLabels = classificationType === "Single-Label" ? [data.labels[0]] : data.labels;
          let updatedClasses = [...classes];
          const newAnnotations = [];
          const missingLabels = selectedLabels.filter(
            (label) => !updatedClasses.some((item) => item.name.toLowerCase() === label.toLowerCase())
          );

          if (missingLabels.length && !lockAnnotationClasses) {
            updatedClasses = await ensureProjectClasses(missingLabels);
          }

          selectedLabels.forEach(label => {
            let clObj = updatedClasses.find(c => c.name.toLowerCase() === label.toLowerCase());
            if (!clObj && !lockAnnotationClasses) {
              clObj = { name: label, color: COLORS[updatedClasses.length % COLORS.length] };
              updatedClasses.push(clObj);
            }
            if (clObj) {
              newAnnotations.push({ type: 'tag', label: clObj.name, color: clObj.color });
            }
          });

          setClasses(updatedClasses);
          setAnnotations(newAnnotations);
          setAutoLabelDetectedClasses(selectedLabels);
          showFeedback("Classification labels were suggested for this image.", "success");
        } else {
          showFeedback("Classification did not find any labels. Try adding explicit classes or adjust the model settings.");
        }
      } else {
        if (data.success && data.detections && data.detections.length > 0) {
          const newAnnotations = [...annotations];
          let updatedClasses = [...classes];
          const missingLabels = [];

          setAutoLabelDetectedClasses(data.classes || []);

          data.detections.forEach(pred => {
            const pLabel = pred.label.toLowerCase();
            let clObj = updatedClasses.find(c => c.name.toLowerCase() === pLabel);
            if (!clObj) {
              missingLabels.push(pred.label);
            }
          });

          if (missingLabels.length && !lockAnnotationClasses) {
            updatedClasses = await ensureProjectClasses(missingLabels);
          }

          data.detections.forEach(pred => {
            const pLabel = pred.label.toLowerCase();
            const clObj = updatedClasses.find(c => c.name.toLowerCase() === pLabel);
            if (!clObj) return;

            if (pred.type === 'polygon') {
              newAnnotations.push({
                type: 'polygon',
                label: clObj.name,
                color: clObj.color,
                points: pred.points
              });
            } else {
              newAnnotations.push({
                type: 'box',
                label: clObj.name,
                color: clObj.color,
                x_center: pred.x_center,
                y_center: pred.y_center,
                width: pred.width,
                height: pred.height
              });
            }
          });

          if (missingLabels.length && lockAnnotationClasses) {
            showFeedback("Some AI suggestions were skipped because class creation is locked.");
          }
          setClasses(updatedClasses);
          setAnnotations(newAnnotations);
          showFeedback(`AI labeling added ${data.detections.length} suggestion${data.detections.length === 1 ? "" : "s"}.`, "success");
        } else {
          showFeedback("VisionFlow AI could not confidently locate anything in this image. Try lowering the confidence threshold.");
        }
      }
    } catch (err) {
      console.error("Auto-Label error: ", err);
      if (!isClassification) {
        // fallback existing object detection pattern
        try {
          const imgObj = new Image();
          imgObj.src = currentAsset.url;
          await new Promise((resolve) => { imgObj.onload = resolve; });

          const model = await cocoSsd.load();
          const predictions = await model.detect(imgObj);

          if (predictions && predictions.length > 0) {
            const newAnnotations = [...annotations];
            let updatedClasses = [...classes];
            const natW = imgObj.width || imgObj.naturalWidth;
            const natH = imgObj.height || imgObj.naturalHeight;
            const missingLabels = [];

            predictions.forEach(pred => {
              const pLabel = pred.class.toLowerCase();
              if (!updatedClasses.find(c => c.name.toLowerCase() === pLabel)) {
                missingLabels.push(pred.class);
              }
            });

            if (missingLabels.length && !lockAnnotationClasses) {
              updatedClasses = await ensureProjectClasses(missingLabels);
            }

            predictions.forEach(pred => {
              const pLabel = pred.class.toLowerCase();
              const clObj = updatedClasses.find(c => c.name.toLowerCase() === pLabel);
              if (!clObj) return;
              const [x, y, w, h] = pred.bbox;
              newAnnotations.push({
                type: 'box',
                label: clObj.name,
                color: clObj.color,
                x_center: (x + w / 2) / natW,
                y_center: (y + h / 2) / natH,
                width: w / natW,
                height: h / natH
              });
            });

            if (missingLabels.length && lockAnnotationClasses) {
              showFeedback("Fallback suggestions that used unknown classes were skipped.");
            }
            setClasses(updatedClasses);
            setAnnotations(newAnnotations);
            showFeedback(`Fallback detection added ${predictions.length} suggestion${predictions.length === 1 ? "" : "s"}.`, "success");
          } else {
            showFeedback("Fallback AI could not locate anything.");
          }

        } catch (err2) {
          console.error("Final fallback failed", err2);
          showFeedback("AI labeling failed and the fallback model could not recover.");
        }
      } else {
        showFeedback("Classification auto-label failed. Verify your model and backend connection.");
      }
    }
    setIsSaving(false);
  };
  
  const navigateAsset = async (direction) => {
    const didSave = await saveAnnotations();
    if (!didSave) return;
    const newIdx = currentAssetIndex + direction;
    if (newIdx >= 0 && newIdx < assets.length) {
      setCurrentAssetIndex(newIdx);
    }
  };

  const removeAnnotation = (idx) => {
    setAnnotations(annotations.filter((_, i) => i !== idx));
  };

  if (!assets || assets.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-gray-50 border border-gray-200 rounded-2xl min-h-[500px]">
        <Edit3 size={48} className="mb-4 text-gray-300" />
        <p className="text-gray-500 text-lg">No assets found to annotate. Please upload images first.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm relative">
      {/* Toast Notification */}
      {showSaveToast && (
         <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-gray-900 border border-gray-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-xl z-50 animate-fade-in flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            Uploaded to Dataset Successfully!
         </div>
      )}

      {feedback && (
        <div
          className={`absolute top-16 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-xl font-semibold text-sm shadow-lg z-40 animate-fade-in ${
            feedback.type === "success"
              ? "bg-green-50 border border-green-200 text-green-700"
              : "bg-red-50 border border-red-200 text-red-700"
          }`}
        >
          {feedback.message}
        </div>
      )}

      <div className="flex flex-col bg-gray-50 border-b border-gray-200 p-4 gap-3">
        <div className="flex gap-4 items-center justify-between">
          <h3 className="font-bold text-gray-800">Annotate Image {currentAssetIndex + 1} of {assets.length}</h3>
          
          <div className="h-6 w-px bg-gray-300 mx-2"></div>
          
          {/* Tool Selector */}
          <div className="flex bg-white border border-gray-300 rounded-lg p-0.5 shadow-sm">
            {!isClassification && (
              <>
                <button 
                  onClick={() => setTool('box')} 
                  className={`p-1.5 rounded-md flex items-center justify-center transition-colors ${tool === 'box' ? 'bg-violet-100 text-violet-700' : 'text-gray-500 hover:text-gray-900'}`}
                  title="Bounding Box"
                >
                   <Square size={16} />
                </button>
                <button 
                  onClick={() => { setTool('polygon'); setCurrentPolygon([]); }} 
                  className={`p-1.5 rounded-md flex items-center justify-center transition-colors ${tool === 'polygon' ? 'bg-violet-100 text-violet-700' : 'text-gray-500 hover:text-gray-900'}`}
                  title="Polygon Tool"
                >
                   <Hexagon size={16} />
                </button>
                <button 
                  onClick={() => setTool('magic')} 
                  className={`p-1.5 rounded-md flex items-center justify-center transition-colors ml-0.5 ${tool === 'magic' ? 'bg-violet-100 text-violet-700' : 'text-gray-500 hover:text-gray-900'}`}
                  title="Smart Click (Prompt AI)"
                >
                   <Sparkles size={16} />
                </button>
              </>
            )}
            {isClassification && (
               <div className="px-3 py-1.5 text-xs font-bold text-violet-700 bg-violet-100 rounded-md flex items-center gap-1">
                 <Tag size={14} /> Tagging Mode
               </div>
            )}
          </div>

          <div className="flex gap-2 ml-auto">
            <button 
               onClick={() => navigateAsset(-1)}
               disabled={currentAssetIndex === 0 || isSaving}
               className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Prev
            </button>
            <button 
               onClick={() => navigateAsset(1)}
               disabled={currentAssetIndex === assets.length - 1 || isSaving}
               className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>

        {/* Second Row: Auto-Label Settings */}
        <div className="flex gap-3 items-center">
          <div className="flex items-center gap-2">
            <input
               id="autoLabelAll"
               type="checkbox"
               checked={autoLabelAll}
               onChange={(e) => setAutoLabelAll(e.target.checked)}
               className="h-4 w-4 text-violet-600 border-gray-300 rounded"
            />
            <label htmlFor="autoLabelAll" className="text-xs font-medium text-gray-600">Detect everything</label>
          </div>

          <select 
             value={autoLabelModel}
             onChange={(e) => setAutoLabelModel(e.target.value)}
             disabled={isSaving}
             className="px-2 py-1 text-[11px] font-bold text-gray-700 bg-white border border-gray-300 rounded-md outline-none focus:border-violet-500 shadow-sm"
             title="Select Detection Model"
          >
             <option value="yolov8x.pt">YOLOv8-X (Best for all objects - RECOMMENDED)</option>
             <option value="yolov8l.pt">YOLOv8-L (Large model)</option>
             <option value="yolov8m.pt">YOLOv8-M (Medium model)</option>
             <option value="yolov8s.pt">YOLOv8-S (Small/fast model)</option>
             <option value="yolov8x-world.pt">YOLOv8-World (Open vocabulary)</option>
             <option value="rf-detr">RF-DETR (Advanced detection)</option>
             <option value="sam3">SAM 3 (Segmentation)</option>
          </select>

          <div className="flex items-center gap-2 px-3 py-1 bg-white border border-gray-300 rounded-md shadow-sm">
            <label className="text-[10px] font-bold text-gray-600 whitespace-nowrap">Conf:</label>
            <input
               type="range"
               min="0.01"
               max="0.99"
               step="0.01"
               value={confidenceThreshold}
               onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
               disabled={isSaving}
               className="w-20 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
               title="Lower = catch smaller objects like headlights"
            />
            <span className="text-[10px] font-bold text-gray-700 w-7">{confidenceThreshold.toFixed(2)}</span>
          </div>

          <div className="flex-1"></div>

          <button 
             onClick={handleAutoLabel}
             disabled={isSaving}
             className="px-5 py-2 text-sm font-bold text-violet-700 bg-violet-100 hover:bg-violet-200 rounded-md focus:outline-none flex items-center gap-2 transition shadow-sm whitespace-nowrap"
          >
             {isSaving ? <Sparkles size={16} className="animate-spin" /> : "✨"} 
             {isSaving ? "Labeling..." : "Auto-Label"}
          </button>
          <button 
             onClick={saveAnnotations}
             disabled={isSaving}
             className="px-5 py-2 text-sm font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-md focus:outline-none flex items-center gap-2 whitespace-nowrap shadow-sm transition"
          >
            <Save size={16} /> {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {autoLabelDetectedClasses.length > 0 && (
        <div className="px-4 py-2 bg-green-50 border border-green-100 text-green-700 text-sm rounded-b-xl">
          <strong>Detected classes:</strong> {autoLabelDetectedClasses.join(', ')}
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Canvas Area */}
        <div className={`flex-1 relative bg-gray-100 p-8 flex items-center justify-center overflow-auto select-none ${!isClassification && 'cursor-crosshair'}`}>
          <div 
             ref={containerRef}
             className={`relative inline-block shadow-lg ${!isClassification && 'cursor-crosshair'}`}
             onMouseDown={handleMouseDown}
             onMouseMove={handleMouseMove}
             onMouseUp={handleMouseUp}
             onMouseLeave={handleMouseLeave}
             onContextMenu={handleContextMenu}
             style={{ touchAction: 'none' }}
          >
            {/* The Image */}
            <img 
               ref={imgRef}
               src={currentAsset.url} 
               alt="Annotate me" 
               className="max-h-[70vh] object-contain select-none shadow-md pointer-events-none block" 
               draggable="false"
            />
            
            {/* SVG Canvas Overlay */}
            {containerRef.current && (
              <svg 
                className="absolute inset-0 pointer-events-none w-full h-full"
                style={{ zIndex: 10 }}
              >
                {/* Tracking Crosshair */}
                {crosshair && !isSaving && !isClassification && (
                  <g className="opacity-60">
                    <line x1="0" y1={crosshair.y} x2="100%" y2={crosshair.y} stroke="#6b7280" strokeWidth="1.5" strokeDasharray="4,4" />
                    <line x1={crosshair.x} y1="0" x2={crosshair.x} y2="100%" stroke="#6b7280" strokeWidth="1.5" strokeDasharray="4,4" />
                  </g>
                )}

                {/* Render Finalized Annotations */}
                {annotations.map((ann, idx) => {
                   const c = classes.find(cl => cl.name === ann.label)?.color || ann.color || '#8b5cf6';
                   
                   if (ann.type === 'tag') {
                      // Tags just render in a flex container over the image
                      return null; 
                   }

                   const rect = containerRef.current.getBoundingClientRect();
                   
                   if ((ann.type === 'box' || (!ann.type && ann.width)) && !isClassification) {
                     const w = ann.width * rect.width;
                     const h = ann.height * rect.height;
                     const x = ann.x_center * rect.width - w / 2;
                     const y = ann.y_center * rect.height - h / 2;
                     return (
                        <g key={idx}>
                           <rect x={x} y={y} width={w} height={h} fill={`${c}33`} stroke={c} strokeWidth="2" />
                           <rect x={x} y={y - 20} width={Math.max(60, ann.label.length * 8)} height={20} fill={c} />
                           <text x={x + 4} y={y - 5} fill="white" fontSize="12" fontWeight="bold">{ann.label}</text>
                           <foreignObject x={x + w - 24} y={y - 24} width="24" height="24" className="pointer-events-auto">
                              <button onClick={(e) => { e.stopPropagation(); removeAnnotation(idx); }} className="bg-red-500 w-full h-full rounded text-white flex items-center justify-center hover:bg-red-600 transition annotation-toolbar">
                                <X size={14} />
                              </button>
                           </foreignObject>
                        </g>
                     );
                   } else if (ann.type === 'polygon' && ann.points && !isClassification) {
                     const pts = ann.points.map(p => `${p.x * rect.width},${p.y * rect.height}`).join(" ");
                     const firstPt = ann.points[0];
                     const px = firstPt.x * rect.width;
                     const py = firstPt.y * rect.height;
                     return (
                        <g key={idx}>
                           <polygon points={pts} fill={`${c}33`} stroke={c} strokeWidth="2" strokeLinejoin="round" />
                           <rect x={px} y={py - 20} width={Math.max(60, ann.label.length * 8)} height={20} fill={c} />
                           <text x={px + 4} y={py - 5} fill="white" fontSize="12" fontWeight="bold">{ann.label}</text>
                           <foreignObject x={px - 12} y={py - 24} width="24" height="24" className="pointer-events-auto">
                              <button onClick={(e) => { e.stopPropagation(); removeAnnotation(idx); }} className="bg-red-500 w-full h-full rounded-full border border-white text-white flex items-center justify-center hover:bg-red-600 transition annotation-toolbar shadow">
                                <X size={12} />
                              </button>
                           </foreignObject>
                        </g>
                     );
                   }
                   return null;
                })}

                {/* Render Current Drawing Box */}
                {isDrawingBox && currentBox && !isClassification && (
                   <rect x={currentBox.x} y={currentBox.y} width={currentBox.w} height={currentBox.h} fill={`${activeColor}33`} stroke={activeColor} strokeWidth="2" strokeDasharray="4" />
                )}

                {/* Render Current Polygon */}
                {currentPolygon.length > 0 && !isClassification && (
                   <g>
                     <polyline 
                       points={currentPolygon.map(p => `${p.x},${p.y}`).join(" ")} 
                       fill="none" 
                       stroke={activeColor} 
                       strokeWidth="2" 
                     />
                     {/* Preview Line to Mouse */}
                     {mousePos && (
                       <line 
                         x1={currentPolygon[currentPolygon.length-1].x} y1={currentPolygon[currentPolygon.length-1].y} 
                         x2={mousePos.x} y2={mousePos.y} 
                         stroke={activeColor} strokeWidth="2" strokeDasharray="4" opacity="0.6" 
                       />
                     )}
                     {/* Points */}
                     {currentPolygon.map((p, i) => (
                        <circle key={i} cx={p.x} cy={p.y} r="4" fill="white" stroke={activeColor} strokeWidth="2" />
                     ))}
                     {/* Highlight first point if close */}
                     {mousePos && Math.hypot(mousePos.x - currentPolygon[0].x, mousePos.y - currentPolygon[0].y) < 10 && (
                        <circle cx={currentPolygon[0].x} cy={currentPolygon[0].y} r="8" fill={`${activeColor}80`} />
                     )}
                   </g>
                )}
              </svg>
            )}

            {/* Render Image Level Tags over Image for Classification */}
            {isClassification && (
              <div className="absolute top-4 left-4 flex flex-wrap gap-2 pointer-events-none">
                 {annotations.filter(a => a.type === 'tag').map((ann, idx) => (
                    <div key={idx} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-white font-bold text-sm shadow-md pointer-events-auto" style={{ backgroundColor: ann.color || '#222' }}>
                       <Tag size={14} /> {ann.label}
                       <button onClick={() => removeAnnotation(idx)} className="hover:text-red-200 ml-1 bg-black/20 rounded p-0.5"><X size={12} /></button>
                    </div>
                 ))}
                 {annotations.filter(a => a.type === 'tag').length === 0 && (
                    <div className="bg-black/50 text-white/80 px-4 py-2 rounded-lg text-sm font-medium backdrop-blur-sm pointer-events-auto">
                       No class assigned. Click "Apply Class" on the right.
                    </div>
                 )}
              </div>
            )}
          </div>
        </div>

        {/* Classes Bar */}
        <div className="w-72 bg-white border-l border-gray-200 flex flex-col p-4 overflow-y-auto">
           <h4 className="font-bold text-gray-900 mb-4 border-b border-gray-100 pb-2 flex justify-between items-center">
             <span>Project Classes</span>
             {lockAnnotationClasses && (
               <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
                 Locked
               </span>
             )}
           </h4>
           
           <div className="flex flex-col gap-2 mb-6">
               {classes.map((cls, idx) => (
                 <div 
                   key={idx} 
                   onClick={() => setActiveClassIdx(idx)}
                   className={`flex flex-col gap-2 p-3 rounded-lg cursor-pointer border-2 transition-all ${activeClassIdx === idx ? 'border-violet-500 bg-violet-50' : 'border-gray-100 hover:bg-gray-50 hover:border-violet-200'}`}
                 >
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded-sm flex-shrink-0" style={{ backgroundColor: cls.color }}></div>
                      <span className="text-sm font-bold text-gray-800 flex-1 truncate">{cls.name}</span>
                      {activeClassIdx === idx && (
                        <span className="text-[10px] font-bold text-violet-600 uppercase tracking-widest bg-violet-100 px-1.5 py-0.5 rounded">Active</span>
                      )}
                    </div>
                    
                    {isClassification && activeClassIdx === idx && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); applyClassificationTag(); }}
                        className="mt-1 w-full bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold py-1.5 rounded flex items-center justify-center gap-1.5 transition active:scale-95"
                      >
                         <Plus size={14} /> Apply to Image
                      </button>
                    )}
                 </div>
               ))}

                {classes.length === 0 && (
                   <div className="text-gray-400 text-sm italic py-4 text-center border-2 border-dashed border-gray-100 rounded-lg">No classes created. Add one below!</div>
                )}
               {/* Add new class */}
               <div className="flex items-center gap-2 mt-2">
                 <input 
                   type="text" 
                   value={newClassName}
                   onChange={(e) => setNewClassName(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && addClass()}
                   placeholder="New class name..." 
                   disabled={lockAnnotationClasses}
                   className="flex-1 text-sm border border-gray-300 rounded-md px-3 py-2 outline-none focus:border-violet-500 shadow-sm disabled:cursor-not-allowed disabled:bg-gray-50"
                 />
                 <button onClick={addClass} disabled={!newClassName.trim() || lockAnnotationClasses} className="bg-gray-100 border border-gray-200 hover:bg-gray-200 text-gray-700 p-2 rounded-md transition disabled:opacity-50">
                    <Plus size={16} />
                 </button>
               </div>
           </div>
           
           <h4 className="font-bold text-gray-900 mb-4 mt-auto border-b border-gray-100 pb-2">Annotations ({annotations.length})</h4>
           <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
             {annotations.map((ann, idx) => (
                <div key={idx} className="flex justify-between items-center text-sm p-3 bg-gray-50 rounded-lg border border-gray-200 hover:border-gray-300 transition">
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 rounded-sm shadow-sm" style={{ backgroundColor: ann.color || classes.find(c => c.name === ann.label)?.color || '#666' }}></div>
                    <span className="font-medium text-gray-700 truncate max-w-[120px]" title={ann.label}>{ann.label}</span>
                  </div>
                  <button onClick={() => removeAnnotation(idx)} className="text-gray-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded transition">
                     <Trash size={14} />
                  </button>
                </div>
             ))}
             {annotations.length === 0 && (
               <div className="text-gray-400 text-sm italic py-6 text-center border-2 border-dashed border-gray-100 rounded-lg">No annotations on this image.</div>
             )}
           </div>
        </div>
      </div>

      {showClassSelector && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-gray-950/35 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-6 py-5">
              <h4 className="text-xl font-black text-gray-950">Choose a class</h4>
              <p className="mt-1 text-sm font-semibold text-gray-500">Pick an existing class or create a new one for this annotation.</p>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {classes.map((cls) => (
                  <button
                    key={cls.name}
                    type="button"
                    onClick={() => commitPendingAnnotation(cls.name)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-gray-200 px-4 py-3 text-left text-sm font-bold text-gray-800 transition hover:border-violet-200 hover:bg-violet-50"
                  >
                    <div className="h-4 w-4 rounded-sm" style={{ backgroundColor: cls.color }}></div>
                    <span>{cls.name}</span>
                  </button>
                ))}
                {!classes.length && (
                  <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm font-semibold text-gray-500">
                    No project classes yet. Create the first one below.
                  </div>
                )}
              </div>

              {!lockAnnotationClasses && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={pendingClassName}
                    onChange={(e) => setPendingClassName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && commitPendingAnnotation()}
                    placeholder="Create a new class..."
                    className="flex-1 rounded-2xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-800 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                  />
                  <button
                    type="button"
                    onClick={() => commitPendingAnnotation()}
                    className="rounded-2xl bg-violet-600 px-4 py-3 text-sm font-black text-white transition hover:bg-violet-700"
                  >
                    Save
                  </button>
                </div>
              )}

              {lockAnnotationClasses && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                  Class creation is locked for this project, so this annotation must use an existing class.
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-5">
              <button
                type="button"
                onClick={() => {
                  setShowClassSelector(false);
                  setPendingAnnotation(null);
                  setPendingClassName("");
                }}
                className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-black text-gray-700 transition hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
