import { useRef } from 'react';
import { useAnnotation } from '../AnnotationContext';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const WHEEL_ZOOM_SENSITIVITY = 0.0025;

const clampZoom = (value) => Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM);

export function useCanvasInteraction() {
  const {
    containerRef, viewportRef, pan, zoom, setPan, setZoom, spacePressed, setIsPanning, setLastPanPos,
    isClassification, tool, annotations, selectedIdx, setIsResizing, setResizeHandle,
    setDragStartPos, setInitialAnnState, setSelectedIdx, setActiveClassIdx, classes,
    setIsMoving, setStartPoint, setIsDrawingBox, currentPolygon, setCurrentPolygon,
    finishPolygon, handleSmartClick, activeClass, setMousePos, setCrosshair,
    isPanning, lastPanPos, isMoving, dragStartPos, initialAnnState, setAnnotations,
    isResizing, resizeHandle, isDrawingBox, startPoint, setCurrentBox, currentBox,
    addManualAnnotation, showFeedback,
    lockAnnotationClasses
  } = useAnnotation();
  const touchGestureRef = useRef(null);

  const getViewport = () => viewportRef.current || containerRef.current?.parentElement || null;

  const getBaseOffset = () => {
    const viewport = getViewport();
    const canvas = containerRef.current;
    if (!viewport || !canvas) return { x: 0, y: 0 };

    const viewportRect = viewport.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return {
      x: canvasRect.left - viewportRect.left - pan.x,
      y: canvasRect.top - viewportRect.top - pan.y,
    };
  };

  const getPos = (e) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = rect.width / containerRef.current.offsetWidth || zoom;
    const scaleY = rect.height / containerRef.current.offsetHeight || zoom;
    const x = (e.clientX - rect.left) / scaleX;
    const y = (e.clientY - rect.top) / scaleY;
    return { x, y, rw: containerRef.current.offsetWidth, rh: containerRef.current.offsetHeight, cx: e.clientX, cy: e.clientY };
  };

  const performZoom = (requestedZoom, focalX, focalY) => {
    const viewport = getViewport();
    if (!viewport || !containerRef.current) return;

    const nextZoom = clampZoom(requestedZoom);
    if (Math.abs(nextZoom - zoom) < 0.0001) return;

    const base = getBaseOffset();
    const scaleChange = nextZoom / zoom;
    const nextPan = {
      x: focalX - base.x - (focalX - base.x - pan.x) * scaleChange,
      y: focalY - base.y - (focalY - base.y - pan.y) * scaleChange,
    };

    setZoom(nextZoom);
    setPan(nextPan);
  };

  const performZoomAtViewportCenter = (requestedZoom) => {
    const viewport = getViewport();
    if (!viewport) return;
    performZoom(requestedZoom, viewport.clientWidth / 2, viewport.clientHeight / 2);
  };

  const handleZoom = (e) => {
    const viewport = getViewport();
    if (!viewport) return;
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const focalX = e.clientX - rect.left;
    const focalY = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey) {
      const zoomFactor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
      performZoom(zoom * zoomFactor, focalX, focalY);
      return;
    }

    setPan((currentPan) => ({
      x: currentPan.x - e.deltaX,
      y: currentPan.y - e.deltaY,
    }));
  };

  const handleMouseDown = (e) => {
    if (e.target.closest('.annotation-toolbar')) return;
    if (spacePressed || e.button === 1 || tool === 'drag') {
      setIsPanning(true);
      setLastPanPos({ x: e.clientX, y: e.clientY });
      return;
    }
    if (isClassification) return;
    const { x: xMouse, y: yMouse, rw, rh } = getPos(e);
    
    if (tool === 'box') {
      if (selectedIdx !== -1) {
        const ann = annotations[selectedIdx];
        if (ann.type === 'box' || (!ann.type && ann.width)) {
          const rw_curr = containerRef.current.offsetWidth;
          const rh_curr = containerRef.current.offsetHeight;
          const w = ann.width * rw_curr;
          const h = ann.height * rh_curr;
          const x = ann.x_center * rw_curr - w / 2;
          const y = ann.y_center * rh_curr - h / 2;
          const handleSize = 8 / zoom;
          const handles = [
            { id: 'nw', x, y }, { id: 'ne', x: x + w, y },
            { id: 'sw', x, y: y + h }, { id: 'se', x: x + w, y: y + h },
          ];
          for (const hnd of handles) {
            if (Math.hypot(xMouse - hnd.x, yMouse - hnd.y) < handleSize * 2) {
              setIsResizing(true);
              setResizeHandle(hnd.id);
              setDragStartPos({ x: xMouse, y: yMouse });
              setInitialAnnState({ ...ann });
              return;
            }
          }
          if (xMouse >= x && xMouse <= x + w && yMouse >= y && yMouse <= y + h) {
            setIsMoving(true);
            setDragStartPos({ x: xMouse, y: yMouse });
            setInitialAnnState({ ...ann });
            return;
          }
        }
      }

      for (let i = annotations.length - 1; i >= 0; i--) {
        const ann = annotations[i];
        if (ann.type === 'box' || (!ann.type && ann.width)) {
          const rw_curr = containerRef.current.offsetWidth;
          const rh_curr = containerRef.current.offsetHeight;
          const w = ann.width * rw_curr;
          const h = ann.height * rh_curr;
          const x = ann.x_center * rw_curr - w / 2;
          const y = ann.y_center * rh_curr - h / 2;
          if (xMouse >= x && xMouse <= x + w && yMouse >= y && yMouse <= y + h) {
            setSelectedIdx(i);
            const clIdx = classes.findIndex(c => c.name === ann.label);
            if (clIdx !== -1) setActiveClassIdx(clIdx);
            setIsMoving(true);
            setDragStartPos({ x: xMouse, y: yMouse });
            setInitialAnnState({ ...ann });
            return;
          }
        }
      }
      setSelectedIdx(-1);
      setStartPoint({ x: xMouse, y: yMouse });
      setIsDrawingBox(true);
    } else if (tool === 'polygon') {
      if (currentPolygon.length > 0) {
        const dist = Math.hypot(xMouse - currentPolygon[0].x, yMouse - currentPolygon[0].y);
        if (dist < 10) {
          finishPolygon();
          return;
        }
      }
      setCurrentPolygon([...currentPolygon, { x: xMouse, y: yMouse }]);
    } else if (tool === 'magic') {
      if (!activeClass) {
         showFeedback("Please add at least one project class first.");
         return;
      }
      handleSmartClick(xMouse / rw, yMouse / rh, activeClass);
    }
  };

  const handleMouseMove = (e) => {
    const { x: xMouse, y: yMouse } = getPos(e);
    setMousePos({ x: xMouse, y: yMouse });
    setCrosshair({ x: xMouse, y: yMouse });
    if (isPanning) {
      const dx = e.clientX - lastPanPos.x;
      const dy = e.clientY - lastPanPos.y;
      setPan((currentPan) => ({ x: currentPan.x + dx, y: currentPan.y + dy }));
      setLastPanPos({ x: e.clientX, y: e.clientY });
      return;
    }
    if (isClassification) return;
    if (isMoving && dragStartPos && initialAnnState) {
      const dx = (xMouse - dragStartPos.x) / containerRef.current.offsetWidth;
      const dy = (yMouse - dragStartPos.y) / containerRef.current.offsetHeight;
      const updatedAnns = [...annotations];
      updatedAnns[selectedIdx] = {
        ...initialAnnState,
        x_center: initialAnnState.x_center + dx,
        y_center: initialAnnState.y_center + dy
      };
      setAnnotations(updatedAnns);
      return;
    }
    if (isResizing && dragStartPos && initialAnnState) {
      const rw = containerRef.current.offsetWidth;
      const rh = containerRef.current.offsetHeight;
      const dx = (xMouse - dragStartPos.x);
      const dy = (yMouse - dragStartPos.y);
      const ann = { ...initialAnnState };
      let w = ann.width * rw; let h = ann.height * rh;
      let xc = ann.x_center * rw; let yc = ann.y_center * rh;
      let x1 = xc - w / 2; let y1 = yc - h / 2;
      let x2 = xc + w / 2; let y2 = yc + h / 2;
      if (resizeHandle === 'nw') { x1 += dx; y1 += dy; }
      if (resizeHandle === 'ne') { x2 += dx; y1 += dy; }
      if (resizeHandle === 'sw') { x1 += dx; y2 += dy; }
      if (resizeHandle === 'se') { x2 += dx; y2 += dy; }
      ann.width = Math.abs(x2 - x1) / rw;
      ann.height = Math.abs(y2 - y1) / rh;
      ann.x_center = (x1 + x2) / 2 / rw;
      ann.y_center = (y1 + y2) / 2 / rh;
      const updatedAnns = [...annotations];
      updatedAnns[selectedIdx] = ann;
      setAnnotations(updatedAnns);
      return;
    }
    if (tool === 'box' && isDrawingBox && startPoint) {
      setCurrentBox({
        x: Math.min(startPoint.x, xMouse),
        y: Math.min(startPoint.y, yMouse),
        w: Math.abs(xMouse - startPoint.x),
        h: Math.abs(yMouse - startPoint.y)
      });
    }
  };

  const handleMouseUp = () => {
    const wasDrawingBox = isDrawingBox;
    const completedBox = currentBox;
    setIsPanning(false); setIsMoving(false); setIsResizing(false); setIsDrawingBox(false);
    setStartPoint(null); setCurrentBox(null);
    if (isClassification) return;
    if (tool === 'box' && wasDrawingBox) {
      if (completedBox && completedBox.w > 5 && completedBox.h > 5) {
        if (!activeClass && lockAnnotationClasses) {
           showFeedback("Please add at least one project class first.");
           return;
        }
        const rw = containerRef.current?.offsetWidth || 1;
        const rh = containerRef.current?.offsetHeight || 1;
        const draftAnnotation = {
          type: 'box',
          x_center: (completedBox.x + completedBox.w / 2) / rw,
          y_center: (completedBox.y + completedBox.h / 2) / rh,
          width: completedBox.w / rw,
          height: completedBox.h / rh,
        };
        addManualAnnotation(draftAnnotation);
      }
    }
  };

  const getTouchCenter = (touches) => ({
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  });

  const getTouchDistance = (touches) => Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY
  );

  const handleTouchStart = (e) => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const center = getTouchCenter(e.touches);
    const viewport = getViewport();
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    touchGestureRef.current = {
      distance: getTouchDistance(e.touches),
      zoom,
      pan,
      base: getBaseOffset(),
      focal: {
        x: center.x - rect.left,
        y: center.y - rect.top,
      },
    };
  };

  const handleTouchMove = (e) => {
    const gesture = touchGestureRef.current;
    if (e.touches.length !== 2 || !gesture?.distance) return;
    const viewport = getViewport();
    if (!viewport) return;
    e.preventDefault();

    const center = getTouchCenter(e.touches);
    const rect = viewport.getBoundingClientRect();
    const nextZoom = clampZoom(gesture.zoom * (getTouchDistance(e.touches) / gesture.distance));
    const scaleChange = nextZoom / gesture.zoom;
    const base = gesture.base;
    const focal = {
      x: center.x - rect.left,
      y: center.y - rect.top,
    };

    setZoom(nextZoom);
    setPan({
      x: focal.x - base.x - (gesture.focal.x - base.x - gesture.pan.x) * scaleChange,
      y: focal.y - base.y - (gesture.focal.y - base.y - gesture.pan.y) * scaleChange,
    });
  };

  const handleTouchEnd = (e) => {
    if (e.touches.length < 2) {
      touchGestureRef.current = null;
    }
  };

  return {
    getPos,
    handleZoom,
    performZoom,
    performZoomAtViewportCenter,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    MIN_ZOOM,
    MAX_ZOOM,
  };
}
