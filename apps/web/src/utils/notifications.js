export const NOTIFICATION_EVENT = "visionflow_notification";

export function areVisionFlowNotificationsEnabled() {
  return String(import.meta.env.VITE_NOTIFICATIONS_ENABLED ?? "true").toLowerCase() !== "false";
}

export function emitVisionFlowNotification(notification) {
  if (!areVisionFlowNotificationsEnabled()) return;

  const event = {
    id: notification.id || `${notification.type || "info"}-${notification.title || "notification"}-${Date.now()}`,
    type: notification.type || "info",
    status: notification.status || notification.type || "Information",
    title: notification.title || "VisionFlow notification",
    description: notification.description || "",
    route: notification.route || "/",
    projectId: notification.projectId || null,
    timestamp: notification.timestamp || new Date().toISOString(),
    source: notification.source || "frontend",
  };

  window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, { detail: event }));

  fetch("/api/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  }).catch(() => {
    // Local notification history still receives the event if the service is down.
  });
}
