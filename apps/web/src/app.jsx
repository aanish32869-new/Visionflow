import React from "react";
import TestHost from "./TestHost";

function DesktopScaleWrapper({ children }) {
  return children;
}

function App() {
  return (
    <DesktopScaleWrapper>
      <TestHost />
    </DesktopScaleWrapper>
  );
}

export default App;
