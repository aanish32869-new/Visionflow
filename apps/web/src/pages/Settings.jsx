import React, { useState } from "react";
import Layout from "../components/Layout";
import { Bell } from "lucide-react";
import { useNotifications } from "../components/notificationContext";
import { getActiveTheme, getThemePreference, saveAndApplyTheme, setThemePreference } from "../utils/theme";

export default function Settings() {
  const [theme, setTheme] = useState(getThemePreference());
  const [message, setMessage] = useState("");
  const { featureEnabled, preference, requestPermission, disableNotifications } = useNotifications();
  const browserPermission = typeof Notification === "undefined" ? "unsupported" : Notification.permission;

  const onApply = () => {
    setThemePreference(theme);
    setMessage("Preference applied. Click Save to update UI theme.");
  };

  const onSave = () => {
    saveAndApplyTheme(theme);
    setMessage(`Theme saved and switched to ${theme}.`);
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="card p-6">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-2">
            Manage VisionFlow preferences.
          </p>
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-900">Theme</h2>
          <p className="text-sm text-gray-600 mt-2">Choose and save your UI theme.</p>
          <div className="mt-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">Theme Mode</label>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="w-full max-w-xs border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-800"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
          <div className="mt-4 flex gap-3">
            <button onClick={onApply} className="btn-secondary">Apply</button>
            <button onClick={onSave} className="btn-primary">Save</button>
          </div>
          <div className="mt-3 text-sm text-gray-600">
            Active theme: <span className="font-semibold">{getActiveTheme()}</span>
          </div>
          <div className="mt-2 text-sm text-violet-700 min-h-5">
            {message}
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-violet-50 text-violet-700 flex items-center justify-center">
              <Bell size={20} />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-gray-900">Notifications</h2>
              <p className="text-sm text-gray-600 mt-2">
                Receive browser and system notifications when background jobs finish.
              </p>
              <div className="mt-3 text-sm text-gray-600">
                Preference: <span className="font-semibold">{preference}</span>
                <span className="mx-2 text-gray-300">|</span>
                Browser permission: <span className="font-semibold">{browserPermission}</span>
                <span className="mx-2 text-gray-300">|</span>
                Config: <span className="font-semibold">{featureEnabled ? "enabled" : "disabled"}</span>
              </div>
              <div className="mt-4 flex gap-3">
                <button onClick={requestPermission} disabled={!featureEnabled} className="btn-primary disabled:opacity-50">
                  Enable Notifications
                </button>
                <button onClick={disableNotifications} className="btn-secondary">
                  Disable
                </button>
              </div>
              {!featureEnabled && (
                <p className="mt-3 text-sm font-semibold text-gray-600">
                  Notifications are turned off in visionflow.conf. Set NOTIFICATIONS_ENABLED = true and restart the web app to enable them.
                </p>
              )}
              {browserPermission === "denied" && (
                <p className="mt-3 text-sm font-semibold text-amber-700">
                  Browser permission is blocked. Re-enable notifications from your browser site settings, then return here.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
