import { useAnnotation } from '../AnnotationContext';

export function useCanvasInteraction() {
  const {
    containerRef, pan, zoom, setPan, setZoom, spacePressed, setIsPanning, setLastPanPos,
    isClassification, tool, annotations, selectedIdx, setIsResizing, setResizeHandle,
    setDragStartPos, setInitialAnnState, setSelectedIdx, setActiveClassIdx, classes,
    setIsMoving, setStartPoint, setIsDrawingBox, currentPolygon, setCurrentPolygon,
    finishPolygon, handleSmartClick, activeClass, setMousePos, setCrosshair,
    isPanning, lastPanPos, isMoving, dragStartPos, initialAnnState, setAnnotations,
    isResizing, resizeHandle, isDrawingBox, startPoint, setCurrentBox, currentBox,
    setShowClassSelector, setPendingAnnotation, setPendingClassName, showFeedback,
    lockAnnotationClasses
  } = useAnnotation();

  const getPos = (e) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = rect.width / containerRef.current.offsetWidth;
    const scaleY = rect.height / containerRef.current.offsetHeight;
    const x = ((e.clientX - rect.left) / scaleX) / zoom;
    const y = ((e.clientY - rect.top) / scaleY) / zoom;
    return { x, y, rw: containerRef.current.offsetWidth, rh: containerRef.current.offsetHeight, cx: e.clientX, cy: e.clientY };
  };

  const performZoom = (newZoom, centerX, centerY) => {
    // centerX and centerY should be relative to the parent container's top-left
    const scaleChange = newZoom / zoom;
    const newPan = {
      x: centerX - (centerX - pan.x) * scaleChange,
      y: centerY - (centerY - pan.y) * scaleChange
    };
    setZoom(newZoom);
    setPan(newPan);
  };

  const handleZoom = (e) => {
    e.preventDefault();
    const rect = containerRef.current.parentElement.getBoundingClientRect();
    const scaleX = rect.width / containerRef.current.parentElement.offsetWidth;
    const scaleY = rect.height / containerRef.current.parentElement.offsetHeight;
    const delta = e.deltaY > 0 ? 0.85 : 1.15;
    const nextZoom = Math.min(Math.max(0.5, zoom * delta), 5);
    
    // Convert viewport clientX/Y to parent-relative CSS coordinates
    const rx = (e.clientX - rect.left) / scaleX;
    const ry = (e.clientY - rect.top) / scaleY;
    performZoom(nextZoom, rx, ry);
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
    const { x: xMouse, y: yMouse, cx, cy } = getPos(e);
    setMousePos({ x: xMouse, y: yMouse });
    setCrosshair({ x: xMouse, y: yMouse });
    if (isPanning) {
      const dx = e.clientX - lastPanPos.x;
      const dy = e.clientY - lastPanPos.y;
      setPan({ x: pan.x + dx, y: pan.y + dy });
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
    setIsPanning(false); setIsMoving(false); setIsResizing(false); setIsDrawingBox(false);
    setStartPoint(null); setCurrentBox(null);
    if (isClassification) return;
    if (tool === 'box' && isDrawingBox) {
      if (currentBox && currentBox.w > 5 && currentBox.h > 5) {
        if (!activeClass && lockAnnotationClasses) {
           showFeedback("Please add at least one project class first.");
           return;
        }
        const rw = containerRef.current?.offsetWidth || 1;
        const rh = containerRef.current?.offsetHeight || 1;
        const draftAnnotation = {
          type: 'box',
          x_center: (currentBox.x + currentBox.w / 2) / rw,
          y_center: (currentBox.y + currentBox.h / 2) / rh,
          width: currentBox.w / rw,
          height: currentBox.h / rh,
        };
        setPendingAnnotation(draftAnnotation);
        setPendingClassName(activeClass?.name || "");
        setShowClassSelector(true);
      }
    }
  };

  return { getPos, handleZoom, performZoom, handleMouseDown, handleMouseMove, handleMouseUp };
}
