import { useEffect, useState } from "react";

export default function SystemMetricsWidget() {
  const [metrics, setMetrics] = useState(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("loading"); // loading | online | offline

  useEffect(() => {
    let alive = true;
    let eventSource = null;

    const connectStream = () => {
      try {
        eventSource = new EventSource("/api/system-metrics/stream");
      } catch (_err) {
        if (alive) setStatus("offline");
        return;
      }

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (alive) {
            setMetrics(data);
            setStatus("online");
          }
        } catch (_err) {
          // Ignore malformed events
        }
      };

      eventSource.onerror = () => {
        if (alive) setStatus("offline");
      };
    };

    connectStream();
    return () => {
      alive = false;
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  const cpuPercent = metrics?.cpu?.percent;
  const ramPercent = metrics?.ram?.percent;
  const diskPercent = metrics?.disk?.percent;
  const gpuPercent = metrics?.gpu?.percent;
  const gpuStatus = metrics?.gpu?.status;

  return (
    <div className="fixed bottom-12 right-3 z-[10000] font-sans">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="bg-gray-900 text-white rounded-full shadow-xl px-3 py-1.5 text-xs font-bold border border-gray-700 hover:bg-gray-800 transition"
      >
        System Metrics {status === "online" ? "" : status === "loading" ? "(...)" : "(Offline)"}
      </button>

      {open && (
        <div className="mt-2 w-[290px] bg-white border border-gray-200 rounded-xl shadow-2xl p-3 text-[12px]">
          <div className="font-bold text-gray-900 mb-2">Live Usage</div>
          {status === "offline" && (
            <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-700">
              Metrics API unavailable. Restart project service (port 5004).
            </div>
          )}
          <div className="flex justify-between text-gray-700 mb-1">
            <span>CPU</span>
            <span className="font-semibold">{Number.isFinite(cpuPercent) ? `${cpuPercent.toFixed(2)}%` : "--"}</span>
          </div>
          <div className="flex justify-between text-gray-700 mb-1">
            <span>GPU</span>
            <span className="font-semibold">
              {Number.isFinite(gpuPercent) ? `${gpuPercent.toFixed(2)}%` : "Not detected"}
            </span>
          </div>
          <div className="flex justify-between text-gray-700 mb-1">
            <span>RAM</span>
            <span className="font-semibold">{Number.isFinite(ramPercent) ? `${ramPercent.toFixed(2)}%` : "--"}</span>
          </div>
          <div className="flex justify-between text-gray-700 mb-1">
            <span>DISK</span>
            <span className="font-semibold">{Number.isFinite(diskPercent) ? `${diskPercent.toFixed(2)}%` : "--"}</span>
          </div>
          <div className="text-[11px] text-gray-500">{gpuStatus || "Detecting GPU vendor"}</div>
        </div>
      )}
    </div>
  );
}
