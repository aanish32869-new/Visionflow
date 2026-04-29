import React, { useEffect, useState } from "react";
import TestHost from "./TestHost";

function ResolutionWrapper({ children }) {
  const TARGET_WIDTH = 1920;
  const TARGET_HEIGHT = 1080;
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const handleResize = () => {
      const scaleX = window.innerWidth / TARGET_WIDTH;
      const scaleY = window.innerHeight / TARGET_HEIGHT;
      setScale(Math.min(scaleX, scaleY));
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        backgroundColor: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${TARGET_WIDTH}px`,
          height: `${TARGET_HEIGHT}px`,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          backgroundColor: "var(--bg)",
          position: "relative",
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function App() {
  return (
    <ResolutionWrapper>
      <TestHost />
    </ResolutionWrapper>
  );
}

export default App;
