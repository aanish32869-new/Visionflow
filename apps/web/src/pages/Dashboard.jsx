import React, { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import { KeyRound, FileText, Plus, Copy, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

function fmtPct(value) {
  const n = Number(value || 0);
  return `${Math.max(0, Math.min(100, Math.round(n)))}%`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [selected, setSelected] = useState(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/deployments/summary");
        if (!res.ok) return;
        const data = await res.json();
        setSummary(data);
      } catch {}
    };
    load();
  }, []);

  const deployments = useMemo(() => summary?.deployments || [], [summary]);
  const stats = summary?.stats || {};
  const successfulRuns = Number(stats.successful_runs || 0);
  const successfulScore = Number(stats.successful_runs_score || 0);

  const openDocs = (deployment) => setSelected({ type: "docs", deployment });
  const openApiKey = (deployment) => setSelected({ type: "api", deployment });
  const closePanel = () => setSelected(null);

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      setCopied("Copied");
      setTimeout(() => setCopied(""), 1200);
    } catch {
      setCopied("Copy failed");
      setTimeout(() => setCopied(""), 1200);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="card p-10 text-center">
          <div className="flex justify-center items-center gap-3 text-4xl font-semibold">
            <span>{fmtPct(successfulScore)}</span>
            <span>⚡</span>
          </div>
          <p className="mt-2 text-gray-600">successful runs</p>
          <p className="mt-2 text-sm text-gray-400">
            {successfulRuns} running deployment{successfulRuns === 1 ? "" : "s"}
          </p>
        </div>

        <div className="card">
          <div className="flex justify-between items-center px-5 py-4 border-b">
            <h2 className="font-semibold">Deployments</h2>
            <button onClick={() => navigate("/deploy")} className="btn-secondary inline-flex items-center gap-1">
              <Plus size={14} /> +
            </button>
          </div>

          <div className="p-5 space-y-3">
            {deployments.length === 0 ? (
              <p className="text-sm text-gray-500">No deployment batches yet.</p>
            ) : (
              deployments.map((d) => (
                <div key={d.id} className="rounded-xl border border-gray-200 p-4 bg-white">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-bold text-gray-900">{d.name}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        Model: {d.model_name || "N/A"} · Score: {fmtPct((Number(d.success_score || 0) * 100))}
                      </div>
                    </div>
                    <div className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">
                      {d.status}
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => openDocs(d)} className="btn-secondary inline-flex items-center gap-1">
                      <FileText size={14} /> Docs
                    </button>
                    <button onClick={() => openApiKey(d)} className="btn-secondary inline-flex items-center gap-1">
                      <KeyRound size={14} /> API Key
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {selected?.type === "docs" && (
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">Docs: {selected.deployment.name}</h3>
              <button onClick={closePanel} className="text-sm text-gray-500">Close</button>
            </div>
            <div className="mt-3 text-sm text-gray-700 space-y-2">
              <p>Endpoint: <span className="font-mono text-xs">{selected.deployment.endpoint_url}</span></p>
              <p>Model: {selected.deployment.model_name || "N/A"}</p>
              <p>Version: {selected.deployment.version_display_id || selected.deployment.version || "v1"}</p>
              <p>How to use: send `POST` multipart/form-data with `file` to the endpoint and parse `predictions` from response.</p>
            </div>
          </div>
        )}

        {selected?.type === "api" && (
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">API Key: {selected.deployment.name}</h3>
              <button onClick={closePanel} className="text-sm text-gray-500">Close</button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input
                readOnly
                value={selected.deployment.api_key || "No key available"}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono"
              />
              <button
                onClick={() => copy(selected.deployment.api_key || "")}
                className="btn-secondary inline-flex items-center gap-1"
              >
                {copied === "Copied" ? <CheckCircle2 size={14} /> : <Copy size={14} />} {copied || "Copy"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
