import React, { useCallback, useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useAnnotation } from './AnnotationContext';
import { useCanvasInteraction } from './hooks/useCanvasInteraction';

export default function Canvas() {
  const {
    containerRef, viewportRef, imgRef, currentAsset, pan, zoom, isClassification, classificationType, tool,
    spacePressed, annotations, classes, selectedIdx, setSelectedIdx,
    isSaving, crosshair, activeColor, isDrawingBox, currentBox,
    currentPolygon, mousePos, removeAnnotation, setZoom, setPan
  } = useAnnotation();
  const canRenderBoxes = !isClassification || classificationType === "Multi-Label";

  const {
    handleMouseDown, handleMouseMove, handleMouseUp, handleZoom,
    performZoomAtViewportCenter, handleTouchStart, handleTouchMove, handleTouchEnd,
    MIN_ZOOM, MAX_ZOOM
  } = useCanvasInteraction();
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const updateCanvasSize = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    setCanvasSize({
      width: node.offsetWidth,
      height: node.offsetHeight,
    });
  }, [containerRef]);

  useEffect(() => {
    updateCanvasSize();
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateCanvasSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [containerRef, currentAsset?.url, updateCanvasSize]);

  return (
    <div
      ref={viewportRef}
      className={`flex-1 relative bg-gray-100 p-8 flex items-center justify-center overflow-hidden select-none ${canRenderBoxes && (tool === 'drag' ? 'cursor-grab' : 'cursor-crosshair')}`}
      onWheel={handleZoom}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      style={{ touchAction: 'none' }}
    >
       <div 
         ref={containerRef}
         className={`relative inline-block shadow-lg ${canRenderBoxes ? (spacePressed || tool === 'drag' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair') : ''}`}
         onMouseDown={handleMouseDown}
         onMouseMove={handleMouseMove}
         onMouseUp={handleMouseUp}
         onMouseLeave={handleMouseUp} // fallback to mouseUp on leave
         onContextMenu={(e) => e.preventDefault()}
         style={{ 
           touchAction: 'none',
           transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
           transformOrigin: '0 0',
           willChange: 'transform'
         }}
      >
        <img 
           ref={imgRef}
           src={currentAsset?.url} 
           alt="Annotate" 
           className="max-h-[70vh] object-contain select-none shadow-md pointer-events-none block" 
           draggable="false"
           onLoad={updateCanvasSize}
        />
        
        {canvasSize.width > 0 && canvasSize.height > 0 && (
          <svg className="absolute inset-0 pointer-events-none w-full h-full" style={{ zIndex: 10 }}>
            {crosshair && !isSaving && canRenderBoxes && (
              <g className="opacity-60">
                <line x1="0" y1={crosshair.y} x2="100%" y2={crosshair.y} stroke="#6b7280" strokeWidth="1.5" strokeDasharray="4,4" />
                <line x1={crosshair.x} y1="0" x2={crosshair.x} y2="100%" stroke="#6b7280" strokeWidth="1.5" strokeDasharray="4,4" />
              </g>
            )}
            
            {annotations.map((ann, idx) => {
               const c = classes.find(cl => cl.name === ann.label)?.color || ann.color || '#8b5cf6';
               const label = ann.label || ann.class_id || 'Unlabeled';
               const annotationKey = ann.id || ann._id || ann.annotation_id || `${ann.type || 'box'}-${idx}`;
               if (ann.type === 'tag') return null; 

               const rw = canvasSize.width;
               const rh = canvasSize.height;
               
               if ((ann.type === 'box' || (!ann.type && ann.width)) && canRenderBoxes) {
                  const w = ann.width * rw;
                  const h = ann.height * rh;
                  const x = ann.x_center * rw - w / 2;
                  const y = ann.y_center * rh - h / 2;
                  const isSelected = idx === selectedIdx;
                  return (
                     <g key={annotationKey}>
                         <rect 
                           x={x} y={y} width={w} height={h} 
                           fill={isSelected ? `${c}44` : `${c}33`} 
                           stroke={c} strokeWidth={isSelected ? "3" : "2"} 
                           className="pointer-events-auto cursor-move"
                           onClick={(e) => { e.stopPropagation(); setSelectedIdx(idx); }}
                         />
                        {isSelected && (
                           <g className="pointer-events-auto">
                              <circle cx={x} cy={y} r={4 / zoom} fill="white" stroke={c} strokeWidth="1" className="cursor-nw-resize" />
                              <circle cx={x + w} cy={y} r={4 / zoom} fill="white" stroke={c} strokeWidth="1" className="cursor-ne-resize" />
                              <circle cx={x} cy={y + h} r={4 / zoom} fill="white" stroke={c} strokeWidth="1" className="cursor-sw-resize" />
                              <circle cx={x + w} cy={y + h} r={4 / zoom} fill="white" stroke={c} strokeWidth="1" className="cursor-se-resize" />
                           </g>
                        )}
                        <rect x={x} y={y - 20} width={Math.max(60, label.length * 8)} height={20} fill={c} />
                        <text x={x + 4} y={y - 5} fill="white" fontSize={12} fontWeight="bold">{label}</text>
                        <foreignObject x={x + w - 24 / zoom} y={y - 24 / zoom} width={24 / zoom} height={24 / zoom} className="pointer-events-auto">
                           <button onClick={(e) => { e.stopPropagation(); removeAnnotation(idx); }} className="bg-red-500 w-full h-full rounded text-white flex items-center justify-center hover:bg-red-600 transition annotation-toolbar">
                             <X size={14 / zoom} />
                           </button>
                        </foreignObject>
                     </g>
                  );
               } else if (ann.type === 'polygon' && ann.points && !isClassification) {
                  const pts = ann.points.map(p => `${p.x * rw},${p.y * rh}`).join(" ");
                  const px = ann.points[0].x * rw;
                  const py = ann.points[0].y * rh;
                  const isSelected = idx === selectedIdx;
                 return (
                    <g key={annotationKey}>
                       <polygon
                         points={pts}
                         fill={isSelected ? `${c}44` : `${c}33`}
                         stroke={c}
                         strokeWidth={isSelected ? "3" : "2"}
                         strokeLinejoin="round"
                         className="pointer-events-auto cursor-pointer"
                         onClick={(e) => { e.stopPropagation(); setSelectedIdx(idx); }}
                       />
                       <rect x={px} y={py - 20} width={Math.max(60, label.length * 8)} height={20} fill={c} />
                       <text x={px + 4} y={py - 5} fill="white" fontSize={12} fontWeight="bold">{label}</text>
                    </g>
                 );
               }
               return null;
            })}

            {isDrawingBox && currentBox && (
               <rect x={currentBox.x} y={currentBox.y} width={currentBox.w} height={currentBox.h} fill={`${activeColor}33`} stroke={activeColor} strokeWidth="2" strokeDasharray="4" />
            )}

            {currentPolygon.length > 0 && (
               <g>
                 <polyline points={currentPolygon.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={activeColor} strokeWidth="2" />
                 {mousePos && (
                   <line x1={currentPolygon[currentPolygon.length-1].x} y1={currentPolygon[currentPolygon.length-1].y} x2={mousePos.x} y2={mousePos.y} stroke={activeColor} strokeWidth="2" strokeDasharray="4" opacity="0.6" />
                 )}
                 {currentPolygon.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r="4" fill="white" stroke={activeColor} strokeWidth="2" />
                 ))}
               </g>
            )}
          </svg>
        )}

        {isClassification && (
          <div className="absolute top-4 left-4 flex flex-wrap gap-2 pointer-events-none">
             {annotations.filter(a => a.type === 'tag').map((ann, idx) => (
                <div key={idx} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-white font-bold text-sm shadow-md pointer-events-auto" style={{ backgroundColor: ann.color || '#222' }}>
                   <span>{ann.label}</span>
                </div>
             ))}
          </div>
        )}

      </div>

      {/* Floating Zoom Controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2 pointer-events-auto bg-white/90 backdrop-blur-md p-1.5 rounded-xl border border-gray-200 shadow-xl z-20">
         <button
           onClick={() => performZoomAtViewportCenter(Math.min(zoom * 1.25, MAX_ZOOM))}
           className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-lg text-gray-700 transition"
           title="Zoom In"
         >
           <Plus size={18} />
         </button>
         <button
           onClick={() => performZoomAtViewportCenter(Math.max(zoom * 0.8, MIN_ZOOM))}
           className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-lg text-gray-700 transition"
           title="Zoom Out"
         >
           <X size={14} className="rotate-45" />
         </button>
         <button
           onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
           className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-lg text-gray-500 hover:text-violet-600 transition font-bold text-[10px]"
           title="Reset Zoom"
         >
           {Math.round(zoom * 100)}%
         </button>
      </div>
    </div>
  );
}
