import React, { useState, useRef, useEffect } from "react";
import { Layout } from "lucide-react";

/**
 * A reusable thumbnail component that renders an image with its bounding box overlays.
 * It automatically scales annotations based on the rendered dimensions of the image.
 */
export default function AnnotatedThumbnail({ asset, showAnnotations = true, onClick }) {
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const handleLoad = (e) => {
    const { offsetWidth, offsetHeight } = e.target;
    setDimensions({ width: offsetWidth, height: offsetHeight });
  };

  // Re-calculate on window resize if needed
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const img = containerRef.current.querySelector('img');
        if (img && img.complete) {
          setDimensions({ width: img.offsetWidth, height: img.offsetHeight });
        }
      }
    };
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  return (
    <div 
      ref={containerRef}
      onClick={onClick}
      className={`relative group bg-gray-100 rounded-xl overflow-hidden h-44 flex items-center justify-center border border-gray-100 shadow-sm transition-all hover:shadow-md ${onClick ? 'cursor-pointer active:scale-[0.98]' : ''}`}
    >
      <img 
        src={asset.url} 
        alt={asset.filename}
        onLoad={handleLoad}
        className="max-h-full max-w-full object-contain pointer-events-none"
      />
      
      {/* SVG Overlay for Boxes */}
      {showAnnotations && dimensions.width > 0 && asset.annotations && (
        <svg 
          className="absolute pointer-events-none" 
          style={{ 
            width: dimensions.width, 
            height: dimensions.height,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)'
          }}
        >
          {asset.annotations.map((ann, idx) => {
            // Support both normalized coordinates from YOLO/Tool
            if (ann.type === 'box' || (!ann.type && ann.width)) {
              const w = ann.width * dimensions.width;
              const h = ann.height * dimensions.height;
              const x = ann.x_center * dimensions.width - w / 2;
              const y = ann.y_center * dimensions.height - h / 2;
              const color = ann.color || "#8b5cf6";
              
              return (
                <rect 
                  key={idx} 
                  x={x} 
                  y={y} 
                  width={w} 
                  height={h} 
                  fill="transparent" 
                  stroke={color} 
                  strokeWidth="1.5"
                />
              );
            }
            return null;
          })}
        </svg>
      )}

      {/* Badge for class counts (Only on hover if annotations are enabled) */}
      {showAnnotations && (
        <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[9px] font-bold text-white opacity-0 group-hover:opacity-100 transition shadow-sm border border-white/10">
          {asset.annotations?.length || 0} Boxes
        </div>
      )}
      
      {/* Split Badge for Dataset Page */}
      {asset.dataset_split && (
        <div className={`absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider shadow-sm border ${
          asset.dataset_split === 'train' ? 'bg-violet-600 text-white border-violet-400' :
          asset.dataset_split === 'valid' ? 'bg-amber-500 text-white border-amber-300' :
          'bg-emerald-500 text-white border-emerald-300'
        }`}>
          {asset.dataset_split}
        </div>
      )}
    </div>
  );
}
