import React from "react";
import ReactDOM from "react-dom/client";
import TestHost from "./TestHost.jsx";
import "./index.css";
import { initTheme } from "./utils/theme";

initTheme();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <TestHost />
  </React.StrictMode>
);
