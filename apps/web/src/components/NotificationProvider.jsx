import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, ShieldCheck, X } from "lucide-react";
import { areVisionFlowNotificationsEnabled, NOTIFICATION_EVENT } from "../utils/notifications";
import { NotificationContext } from "./notificationContext";

const STORAGE_KEY = "visionflow_notifications";
const PREFERENCE_KEY = "visionflow_notifications_preference";
const MAX_HISTORY = 100;

function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeStatus(status) {
  const normalized = String(status || "Information").toLowerCase();
  if (["success", "warning", "error", "information"].includes(normalized)) {
    return normalized[0].toUpperCase() + normalized.slice(1);
  }
  if (normalized === "info") return "Information";
  return "Information";
}

export function NotificationProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [notifications, setNotifications] = useState(() => readJson(STORAGE_KEY, []));
  const [preference, setPreference] = useState(() => localStorage.getItem(PREFERENCE_KEY) || "unset");
  const [showPrompt, setShowPrompt] = useState(false);
  const [featureEnabled] = useState(() => areVisionFlowNotificationsEnabled());
  const streamErrorShownRef = useRef(false);

  const nativeAllowed = typeof Notification !== "undefined" && Notification.permission === "granted";

  const persistNotifications = useCallback((next) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(0, MAX_HISTORY)));
  }, []);

  const pushNotification = useCallback((raw) => {
    if (!featureEnabled) return;

    const nextNotification = {
      ...raw,
      id: raw.id || `${raw.title}-${raw.timestamp || Date.now()}`,
      status: normalizeStatus(raw.status || raw.type),
      timestamp: raw.timestamp || new Date().toISOString(),
      read: Boolean(raw.read),
    };

    setNotifications((current) => {
      if (current.some((item) => item.id === nextNotification.id)) return current;
      const next = [nextNotification, ...current].slice(0, MAX_HISTORY);
      persistNotifications(next);
      return next;
    });

    if (nativeAllowed && document.visibilityState !== "visible") {
      try {
        const body = [
          nextNotification.description,
          `${nextNotification.status} - ${new Date(nextNotification.timestamp).toLocaleString()}`,
        ].filter(Boolean).join("\n");
        const nativeNotification = new Notification(nextNotification.title, {
          body,
          icon: "/favicon.svg",
          badge: "/favicon.svg",
          tag: nextNotification.id,
        });
        nativeNotification.onclick = () => {
          window.focus();
          if (nextNotification.route) navigate(nextNotification.route);
          nativeNotification.close();
        };
      } catch {
        // Browser support and OS policy vary; in-app history remains authoritative.
      }
    }
  }, [featureEnabled, nativeAllowed, navigate, persistNotifications]);

  useEffect(() => {
    if (!featureEnabled) return undefined;
    const listener = (event) => pushNotification(event.detail || {});
    window.addEventListener(NOTIFICATION_EVENT, listener);
    return () => window.removeEventListener(NOTIFICATION_EVENT, listener);
  }, [featureEnabled, pushNotification]);

  useEffect(() => {
    if (!featureEnabled) return undefined;
    const handleOffline = () => pushNotification({
      id: `network-disconnected-${Date.now()}`,
      status: "Error",
      title: "Network disconnected",
      description: "VisionFlow lost network connectivity. Background updates may pause.",
      route: location.pathname,
      source: "network",
    });
    window.addEventListener("offline", handleOffline);
    return () => window.removeEventListener("offline", handleOffline);
  }, [featureEnabled, location.pathname, pushNotification]);

  useEffect(() => {
    if (!featureEnabled) return undefined;
    let source;
    try {
      source = new EventSource("/api/notifications/stream");
      source.addEventListener("notification", (event) => {
        try {
          pushNotification(JSON.parse(event.data));
        } catch {
          // Ignore malformed notification events.
        }
      });
      source.onerror = () => {
        if (streamErrorShownRef.current) return;
        streamErrorShownRef.current = true;
        pushNotification({
          id: "notification-stream-unavailable",
          status: "Warning",
          title: "Server unavailable",
          description: "Live notification updates are temporarily unavailable.",
          route: location.pathname,
          source: "notifications",
        });
      };
    } catch {
      // The app still works with local events if the notification service is unavailable.
    }
    return () => source?.close();
  }, [featureEnabled, location.pathname, pushNotification]);

  useEffect(() => {
    if (!featureEnabled || preference !== "unset" || typeof Notification === "undefined") return undefined;
    const showAfterInteraction = () => setShowPrompt(true);
    window.addEventListener("pointerdown", showAfterInteraction, { once: true });
    window.addEventListener("keydown", showAfterInteraction, { once: true });
    return () => {
      window.removeEventListener("pointerdown", showAfterInteraction);
      window.removeEventListener("keydown", showAfterInteraction);
    };
  }, [featureEnabled, preference]);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") {
      localStorage.setItem(PREFERENCE_KEY, "unsupported");
      setPreference("unsupported");
      setShowPrompt(false);
      return "unsupported";
    }

    const result = await Notification.requestPermission();
    const nextPreference = result === "granted" ? "enabled" : "blocked";
    localStorage.setItem(PREFERENCE_KEY, nextPreference);
    setPreference(nextPreference);
    setShowPrompt(false);
    return nextPreference;
  }, []);

  const disableNotifications = useCallback(() => {
    localStorage.setItem(PREFERENCE_KEY, "disabled");
    setPreference("disabled");
    setShowPrompt(false);
  }, []);

  const markRead = useCallback((id, read = true) => {
    setNotifications((current) => {
      const next = current.map((item) => item.id === id ? { ...item, read } : item);
      persistNotifications(next);
      return next;
    });
  }, [persistNotifications]);

  const clearNotification = useCallback((id) => {
    setNotifications((current) => {
      const next = current.filter((item) => item.id !== id);
      persistNotifications(next);
      return next;
    });
  }, [persistNotifications]);

  const clearAll = useCallback(() => {
    setNotifications([]);
    persistNotifications([]);
  }, [persistNotifications]);

  const openNotification = useCallback((notification) => {
    markRead(notification.id, true);
    if (notification.route && notification.route !== location.pathname) {
      navigate(notification.route);
    }
  }, [location.pathname, markRead, navigate]);

  const value = useMemo(() => ({
    featureEnabled,
    notifications,
    unreadCount: notifications.filter((item) => !item.read).length,
    preference,
    requestPermission,
    disableNotifications,
    markRead,
    clearNotification,
    clearAll,
    openNotification,
  }), [clearAll, clearNotification, disableNotifications, featureEnabled, markRead, notifications, openNotification, preference, requestPermission]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      {featureEnabled && showPrompt && preference === "unset" && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-gray-950/40 p-4">
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-gray-100">
            <div className="flex items-start gap-4">
              <div className="h-11 w-11 rounded-xl bg-violet-50 text-violet-700 flex items-center justify-center shrink-0">
                <Bell size={22} />
              </div>
              <div>
                <h2 className="text-lg font-black text-gray-950">Enable VisionFlow notifications?</h2>
                <p className="mt-2 text-sm font-semibold text-gray-600">
                  Get a system notification when training, exports, imports, uploads, and annotation jobs finish.
                </p>
              </div>
            </div>
            <div className="mt-5 rounded-xl bg-gray-50 border border-gray-100 p-3 flex items-start gap-2 text-xs font-bold text-gray-600">
              <ShieldCheck size={16} className="text-emerald-600 shrink-0" />
              You can change this later from Settings. VisionFlow will not ask again if you decline.
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={disableNotifications} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50">
                Not now
              </button>
              <button onClick={requestPermission} className="px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-black hover:bg-violet-700">
                Allow notifications
              </button>
            </div>
            <button onClick={disableNotifications} className="absolute right-4 top-4 text-gray-400 hover:text-gray-700">
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </NotificationContext.Provider>
  );
}
