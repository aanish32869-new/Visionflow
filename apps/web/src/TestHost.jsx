import React from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';

// Import all application pages
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import Deployments from "./pages/Deployments";
import CreateProject from "./pages/CreateProject";
import RapidUpload from "./pages/RapidUpload";
import ProjectUpload from "./pages/ProjectUpload";
import Uploads from "./pages/Uploads";
import BatchPreview from "./pages/BatchPreview";
import Settings from "./pages/Settings";
import ErrorBoundary from "./components/ErrorBoundary";
import SystemMetricsWidget from "./components/SystemMetricsWidget";

function KpiToolRedirect() {
  React.useEffect(() => {
    window.location.replace("/kpi-tool/index.html");
  }, []);
  return null;
}

// Define the global router configuration exactly once outside the React tree
const globalRouter = createBrowserRouter([
  {
    path: "/",
    errorElement: <ErrorBoundary />,
    children: [
      { path: "/", element: <Dashboard /> },
      { path: "/projects", element: <Projects /> },
      { path: "/deploy", element: <Deployments /> },
      { path: "/create", element: <CreateProject /> },
      { path: "/rapid-upload", element: <RapidUpload /> },
      { path: "/upload", element: <ProjectUpload /> },
      { path: "/uploads", element: <Uploads /> },
      { path: "/settings", element: <Settings /> },
      { path: "/annotate/batch/:batchId", element: <BatchPreview /> },
      { path: "/kpi-tool", element: <KpiToolRedirect /> },
      { path: "/kpi-tool/", element: <KpiToolRedirect /> },
      { path: "/kpi-metrics", element: <KpiToolRedirect /> },
      { path: "/kpi-metrics/", element: <KpiToolRedirect /> },
      { path: "*", element: <Navigate to="/" replace /> }
    ]
  }
]);

export default function TestHost() {
  return (
    <>
      {/* Subtle indicator that you are using the testing host */}
      <div className="fixed bottom-2 right-2 z-[9999] bg-purple-600/90 text-white text-xs px-3 py-1 rounded-full shadow-lg font-bold pointer-events-none">
        Global Test Route Active
      </div>
      
      {/* Use the new Data Router which evaluates routes only 1 time intrinsically */}
      <RouterProvider router={globalRouter} />
      <SystemMetricsWidget />
    </>
  );
}
