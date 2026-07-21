import React from 'react';
import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom';

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
import { NotificationProvider } from "./components/NotificationProvider";

function KpiToolRedirect() {
  React.useEffect(() => {
    window.location.replace("/kpi-tool/index.html");
  }, []);
  return null;
}

function RootShell() {
  return (
    <NotificationProvider>
      <Outlet />
    </NotificationProvider>
  );
}

// Define the global router configuration exactly once outside the React tree
const globalRouter = createBrowserRouter([
  {
    path: "/",
    element: <RootShell />,
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

function DesktopScaleWrapper({ children }) {
  return children;
}

function App() {
  return (
    <DesktopScaleWrapper>
      <RouterProvider router={globalRouter} />
      <SystemMetricsWidget />
    </DesktopScaleWrapper>
  );
}

export default App;
