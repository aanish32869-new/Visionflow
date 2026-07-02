import React, { useMemo, useState } from "react";
import { Bell, Check, Filter, Trash2, X } from "lucide-react";
import { statusIcon, useNotifications } from "./notificationContext";

const FILTERS = ["All", "Success", "Warning", "Error", "Information"];

export default function NotificationBell() {
  const {
    notifications,
    unreadCount,
    markRead,
    clearNotification,
    clearAll,
    openNotification,
  } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState("All");

  const filteredNotifications = useMemo(() => {
    if (filter === "All") return notifications;
    return notifications.filter((item) => item.status === filter);
  }, [filter, notifications]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="relative h-9 w-9 rounded-xl border border-gray-200 bg-white text-gray-600 hover:text-violet-700 hover:border-violet-200 hover:bg-violet-50 transition flex items-center justify-center"
        title="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center border-2 border-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-12 z-[220] w-[380px] max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-black text-gray-950">Notifications</h2>
              <p className="text-[11px] font-bold text-gray-400">{unreadCount} unread</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => notifications.forEach((item) => markRead(item.id, true))}
                className="p-2 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50"
                title="Mark all as read"
              >
                <Check size={15} />
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="p-2 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50"
                title="Clear all"
              >
                <Trash2 size={15} />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50"
                title="Close"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 overflow-x-auto">
            <Filter size={14} className="text-gray-400 shrink-0" />
            {FILTERS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-black border transition ${
                  filter === item
                    ? "bg-violet-50 border-violet-200 text-violet-700"
                    : "bg-white border-gray-100 text-gray-500 hover:bg-gray-50"
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {filteredNotifications.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="mx-auto h-11 w-11 rounded-xl bg-gray-50 text-gray-300 flex items-center justify-center">
                  <Bell size={20} />
                </div>
                <p className="mt-3 text-sm font-black text-gray-900">No notifications</p>
                <p className="mt-1 text-xs font-semibold text-gray-400">Background job updates will appear here.</p>
              </div>
            ) : (
              filteredNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`group px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition ${notification.read ? "bg-white" : "bg-violet-50/40"}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{statusIcon(notification.status)}</div>
                    <button
                      type="button"
                      onClick={() => openNotification(notification)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-black text-gray-950">{notification.title}</p>
                        {!notification.read && <span className="h-2 w-2 rounded-full bg-violet-600 shrink-0" />}
                      </div>
                      <p className="mt-1 text-xs font-semibold text-gray-500 line-clamp-2">{notification.description}</p>
                      <div className="mt-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-gray-400">
                        <span>{notification.status}</span>
                        <span>{new Date(notification.timestamp).toLocaleString()}</span>
                      </div>
                    </button>
                    <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button
                        type="button"
                        onClick={() => markRead(notification.id, !notification.read)}
                        className="p-1.5 rounded-md text-gray-400 hover:text-violet-700 hover:bg-white"
                        title={notification.read ? "Mark unread" : "Mark read"}
                      >
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => clearNotification(notification.id)}
                        className="p-1.5 rounded-md text-gray-400 hover:text-rose-600 hover:bg-white"
                        title="Clear"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
