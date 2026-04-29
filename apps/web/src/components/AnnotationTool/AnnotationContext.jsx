import React, { createContext, useContext, useState, useRef, useEffect, useMemo } from 'react';
import logger from '../../utils/logger';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

const AnnotationContext = createContext();

export const COLORS = ['#8b5cf6', '#ef4444', '#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#14b8a6'];

export function AnnotationProvider({ assets, initialAssetId, projectId, projectType, classificationType, updateAsset, onBack, onBatchComplete, children }) {
  const [currentAssetIndex, setCurrentAssetIndex] = useState(0);
  const [annotations, setAnnotations] = useState([]);
  const [autoLabelModel, setAutoLabelModel] = useState("yolov8x.pt");
  
  const isClassification = projectType === "Classification";
  const isSegmentation = projectType.includes("Segmentation");
  
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
  
  const currentAsset = assets[currentAssetIndex];
  const [assetState, setAssetState] = useState(currentAsset?.state || "unannotated");
  const [reviewComment, setReviewComment] = useState("");
  const [showRejectModal, setShowRejectModal] = useState(false);
  
  // Zoom & Pan State
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 });
  const [spacePressed, setSpacePressed] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [isMoving, setIsMoving] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState(null);
  const [dragStartPos, setDragStartPos] = useState(null);
  const [initialAnnState, setInitialAnnState] = useState(null);
  
  const [showAutoLabelConflict, setShowAutoLabelConflict] = useState(false);
  const [pendingAutoLabelData, setPendingAutoLabelData] = useState(null);
  
  const [activeTab, setActiveTab] = useState('classes'); 
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Reset state on asset change
  useEffect(() => {
     if (currentAsset) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setSelectedIdx(-1);
        setAssetState(currentAsset.state || "unannotated");
     }
  }, [currentAssetIndex, currentAsset]);

  
  const imgRef = useRef(null);
  const containerRef = useRef(null);

  const activeClass = classes[activeClassIdx] || classes[0] || null;
  const activeColor = activeClass?.color || COLORS[0];

  // Logic functions (will be migrated here or shared via context)
  const showFeedback = (message, type = "error") => {
    setFeedback({ message, type });
  };

  const removeAnnotation = (idx) => {
    setAnnotations(prev => prev.filter((_, i) => i !== idx));
    if (selectedIdx === idx) setSelectedIdx(-1);
    else if (selectedIdx > idx) setSelectedIdx(prev => prev - 1);
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
        showFeedback("Smart Click could not identify an object.");
      }
    } catch (err) {
      console.error(err);
      showFeedback("Smart Click failed.");
    }
    setIsSaving(false);
  };

  const commitPendingAnnotation = async (classNameValue = pendingClassName) => {
    const finalClassName = String(classNameValue || "").trim();
    if (!pendingAnnotation) return;
    if (!finalClassName) {
      showFeedback("Choose or create a class first.");
      return;
    }

    let nextClasses = classes;
    let classObject = classes.find((item) => item.name.toLowerCase() === finalClassName.toLowerCase());

    if (!classObject) {
      if (lockAnnotationClasses) {
        showFeedback("Class creation is locked.");
        return;
      }
      // Simplified ensure here, or assume it's handled in Sidebar
      const res = await fetch(`/api/projects/${projectId}/classes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: finalClassName }),
      });
      if (res.ok) {
         const data = await res.json();
         nextClasses = data.classes.map((item, idx) => ({
            name: item.name,
            color: item.color || COLORS[idx % COLORS.length]
         }));
         setClasses(nextClasses);
         classObject = nextClasses.find(c => c.name.toLowerCase() === finalClassName.toLowerCase());
      }
    }

    if (!classObject) return;

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

  const value = {
    assets, currentAssetIndex, setCurrentAssetIndex, currentAsset,
    annotations, setAnnotations,
    autoLabelModel, setAutoLabelModel,
    isClassification, isSegmentation,
    tool, setTool,
    classes, setClasses,
    activeClassIdx, setActiveClassIdx,
    newClassName, setNewClassName,
    lockAnnotationClasses, setLockAnnotationClasses,
    pendingAnnotation, setPendingAnnotation,
    showClassSelector, setShowClassSelector,
    pendingClassName, setPendingClassName,
    autoLabelAll, setAutoLabelAll,
    autoLabelDetectedClasses, setAutoLabelDetectedClasses,
    confidenceThreshold, setConfidenceThreshold,
    isDrawingBox, setIsDrawingBox,
    startPoint, setStartPoint,
    currentBox, setCurrentBox,
    currentPolygon, setCurrentPolygon,
    mousePos, setMousePos,
    crosshair, setCrosshair,
    isSaving, setIsSaving,
    showSaveToast, setShowSaveToast,
    feedback, setFeedback, showFeedback,
    assetState, setAssetState,
    reviewComment, setReviewComment,
    showRejectModal, setShowRejectModal,
    zoom, setZoom,
    pan, setPan,
    isPanning, setIsPanning,
    lastPanPos, setLastPanPos,
    spacePressed, setSpacePressed,
    selectedIdx, setSelectedIdx,
    isMoving, setIsMoving,
    isResizing, setIsResizing,
    resizeHandle, setResizeHandle,
    dragStartPos, setDragStartPos,
    initialAnnState, setInitialAnnState,
    showAutoLabelConflict, setShowAutoLabelConflict,
    pendingAutoLabelData, setPendingAutoLabelData,
    activeTab, setActiveTab,
    isSidebarOpen, setIsSidebarOpen,
    imgRef, containerRef,
    activeClass, activeColor,
    projectId, projectType, classificationType, updateAsset, onBack, onBatchComplete,
    removeAnnotation, finishPolygon, handleSmartClick, commitPendingAnnotation
  };

  return (
    <AnnotationContext.Provider value={value}>
      {children}
    </AnnotationContext.Provider>
  );
}

export function useAnnotation() {
  const context = useContext(AnnotationContext);
  if (!context) {
    throw new Error('useAnnotation must be used within an AnnotationProvider');
  }
  return context;
}
