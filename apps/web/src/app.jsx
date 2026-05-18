import React, { useEffect, useState } from "react";
import TestHost from "./TestHost";

function DesktopScaleWrapper({ children }) {
  const DESKTOP_SCALE = 0.67;
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1280);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!isDesktop) return children;

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#f6f7fb" }}>
      <div
        style={{
          width: `${100 / DESKTOP_SCALE}vw`,
          height: `${100 / DESKTOP_SCALE}vh`,
          transform: `scale(${DESKTOP_SCALE})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function App() {
  return (
    <DesktopScaleWrapper>
      <TestHost />
    </DesktopScaleWrapper>
  );
}

export default App;
