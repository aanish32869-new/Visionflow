import React, { createContext, useContext } from "react";
import { CheckCircle2, Info, TriangleAlert } from "lucide-react";

export const NotificationContext = createContext(null);

export function statusIcon(status) {
  if (status === "Success") return React.createElement(CheckCircle2, { size: 16, className: "text-emerald-600" });
  if (status === "Warning") return React.createElement(TriangleAlert, { size: 16, className: "text-amber-600" });
  if (status === "Error") return React.createElement(TriangleAlert, { size: 16, className: "text-rose-600" });
  return React.createElement(Info, { size: 16, className: "text-blue-600" });
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationProvider");
  }
  return context;
}
