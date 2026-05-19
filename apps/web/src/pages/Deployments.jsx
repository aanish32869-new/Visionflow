import React, { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import {
  Cloud,
  Cpu,
  FileText,
  Loader2,
  Plus,
  Play,
  Rocket,
  Workflow,
  X,
} from "lucide-react";

const EMPTY_ARRAY = [];

const backendStages = [
  {
    title: "Provisioning",
    description:
      "Managed deployments reserve the compute they need first, whether that means lightweight hosted capacity or dedicated GPU-backed runtime.",
    icon: Rocket,
  },
  {
    title: "Inference Engine",
    description:
      "Each deployment routes through the shared inference runtime for model loading, preprocessing, and workflow prediction output.",
    icon: Workflow,
  },
  {
    title: "Managed APIs",
    description:
      "Production endpoints stay accessible over HTTPS so applications can trigger inference runs without operating the infrastructure directly.",
    icon: Cloud,
  },
];

const deploymentPaths = [
  {
    title: "Managed Dedicated Deployments",
    description:
      "Best for larger models, private endpoints, and steady production traffic where you want capacity ready on demand.",
    icon: Cpu,
  },
  {
    title: "Batch Processing",
    description:
      "Queue long videos or large image sets for asynchronous execution, then collect structured output after the run finishes.",
    icon: FileText,
  },
  {
    title: "Hosted Workflow APIs",
    description:
      "Ship quickly with a hosted endpoint that can execute a workflow-backed inference path from your product or internal tooling.",
    icon: Cloud,
  },
];

const templateNotes = [
  {
    title: "Low-Code Templates",
    description:
      "Start from deployment patterns like detect, count, and visualize so the workflow scaffolding is already in place.",
  },
  {
    title: "Visualization Themes",
    description:
      "Tune the operator experience by layering boxes, labels, and output-oriented visualization blocks onto the workflow.",
  },
];

function getTemplateIcon(template) {
  const label = `${template?.deployment_key || ""} ${template?.name || ""}`.toLowerCase();

  if (label.includes("dedicated") || label.includes("gpu")) {
    return Cpu;
  }

  if (label.includes("batch")) {
    return FileText;
  }

  if (label.includes("workflow")) {
    return Workflow;
  }

  return Cloud;
}

export default function Deployments() {
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({
    deployment_key: "hosted_api",
    name: "",
    project_id: "",
    workflow_id: "",
    config: {},
  });

  const loadSummary = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/deployments/summary");
      if (!res.ok) {
        throw new Error(`HTTP Error: ${res.status} - Route might not be implemented`);
      }
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Expected JSON, got HTML or other format");
      }
      const data = await res.json();
      setSummary(data);
      if (data?.projects?.[0] || data?.workflows?.[0]) {
        setForm((prev) => ({
          ...prev,
          project_id: prev.project_id || data.projects?.[0]?.id || "",
          workflow_id: prev.workflow_id || data.workflows?.[0]?.id || "",
        }));
      }
    } catch (err) {
      console.error("Failed to load deployments", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, []);

  const templates = summary?.templates || EMPTY_ARRAY;
  const deployments = summary?.deployments || EMPTY_ARRAY;
  const projects = summary?.projects || EMPTY_ARRAY;
  const workflows = summary?.workflows || EMPTY_ARRAY;

  const visibleTemplates = useMemo(
    () => templates.filter((template) => template.environment !== "edge"),
    [templates]
  );

  const visibleDeployments = useMemo(
    () => deployments.filter((deployment) => deployment.environment !== "edge"),
    [deployments]
  );

  const selectedTemplate = useMemo(
    () =>
      visibleTemplates.find((template) => template.deployment_key === form.deployment_key) ||
      visibleTemplates[0] ||
      null,
    [visibleTemplates, form.deployment_key]
  );

  const openCreateModal = (template) => {
    const fallbackTemplate = template || visibleTemplates[0] || null;
    if (!fallbackTemplate) {
      return;
    }

    setForm({
      deployment_key: fallbackTemplate.deployment_key || "hosted_api",
      name: "",
      project_id: projects[0]?.id || "",
      workflow_id: workflows[0]?.id || "",
      config: { ...(fallbackTemplate.default_config || {}) },
    });
    setIsModalOpen(true);
  };

  const createDeployment = async () => {
    setIsCreating(true);
    try {
      const template =
        visibleTemplates.find((item) => item.deployment_key === form.deployment_key) ||
        templates.find((item) => item.deployment_key === form.deployment_key);
      const project = projects.find((item) => item.id === form.project_id);
      const workflow = workflows.find((item) => item.id === form.workflow_id);
      await fetch("/api/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deployment_key: form.deployment_key,
          name: form.name || template?.name,
          environment: template?.environment,
          project_id: project?.id,
          project_name: project?.name,
          workflow_id: workflow?.id,
          workflow_name: workflow?.name,
          config: form.config,
        }),
      });
      setIsModalOpen(false);
      loadSummary();
    } catch (err) {
      console.error("Failed to create deployment", err);
    } finally {
      setIsCreating(false);
    }
  };

  const activateDeployment = async (deploymentId) => {
    try {
      await fetch(`/api/deployments/${deploymentId}/activate`, { method: "POST" });
      loadSummary();
    } catch (err) {
      console.error("Failed to activate deployment", err);
    }
  };

  const deleteDeployment = async (deploymentId) => {
    try {
      await fetch(`/api/deployments/${deploymentId}`, { method: "DELETE" });
      loadSummary();
    } catch (err) {
      console.error("Failed to delete deployment", err);
    }
  };

  return (
    <Layout>
      <div className="flex-1 w-full bg-white h-full flex flex-col pt-8 px-8 animate-page-enter overflow-y-auto pb-12">
        <div className="mb-6 w-full max-w-[1300px]">
          <h1 className="text-3xl font-black text-gray-950 tracking-tight">Deployments</h1>
        </div>

        {isModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
            <div className="w-full max-w-[720px] rounded-3xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
                <div>
                  <div className="text-lg font-bold text-gray-900">New Deployment</div>
                  <div className="text-sm text-gray-500 mt-1">
                    Create a hosted API, dedicated runtime, or batch deployment.
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-700">
                  <X size={18} />
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Deployment Template</label>
                  <select
                    value={form.deployment_key}
                    onChange={(event) => {
                      const template = visibleTemplates.find(
                        (item) => item.deployment_key === event.target.value
                      );
                      setForm((prev) => ({
                        ...prev,
                        deployment_key: event.target.value,
                        config: { ...(template?.default_config || {}) },
                      }));
                    }}
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-violet-500"
                  >
                    {visibleTemplates.map((template) => (
                      <option key={template.deployment_key} value={template.deployment_key}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">Deployment Name</label>
                    <input
                      value={form.name}
                      onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                      className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-violet-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">Project</label>
                    <select
                      value={form.project_id}
                      onChange={(event) => setForm((prev) => ({ ...prev, project_id: event.target.value }))}
                      className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-violet-500"
                    >
                      <option value="">No project</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Pipeline</label>
                  <select
                    value={form.workflow_id}
                    onChange={(event) => setForm((prev) => ({ ...prev, workflow_id: event.target.value }))}
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-violet-500"
                  >
                    <option value="">No pipeline</option>
                    {workflows.map((workflow) => (
                      <option key={workflow.id} value={workflow.id}>
                        {workflow.name}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedTemplate && (
                  <div className="rounded-2xl bg-[#f8fafc] border border-gray-200 p-4">
                    <div className="text-sm font-bold text-gray-900">{selectedTemplate.name}</div>
                    <div className="mt-2 text-sm text-gray-600">{selectedTemplate.description}</div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 px-6 py-5 border-t border-gray-100 bg-gray-50">
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-sm font-bold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={createDeployment}
                  disabled={isCreating || !selectedTemplate}
                  className="px-4 py-2.5 rounded-lg bg-violet-600 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60 inline-flex items-center gap-2"
                >
                  {isCreating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  Create Deployment
                </button>
              </div>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="w-full max-w-[1300px] rounded-2xl border border-gray-200 bg-white p-12 text-center text-gray-500">
            <Loader2 size={24} className="animate-spin mx-auto mb-4 text-violet-600" />
            Loading deployments...
          </div>
        )}

        {!isLoading && (
          <>
            <div className="border border-gray-200 rounded-xl w-full max-w-[1300px] bg-white shadow-sm overflow-hidden flex flex-col min-h-[320px]">
              <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50 text-[11px] font-bold text-gray-400 uppercase tracking-widest px-6 py-3">
                <div>Status</div>
                <div>Name</div>
                <div>Project</div>
                <div>Pipeline</div>
                <div>Runtime</div>
                <div>Version</div>
                <div>Actions</div>
              </div>

              {visibleDeployments.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-10 py-16 text-center">
                  <div className="w-[140px] h-[140px] bg-gray-50 rounded-full flex items-center justify-center mb-6 text-gray-300">
                    <Cloud size={64} strokeWidth={1.2} />
                  </div>
                  <h3 className="text-[16px] font-bold text-gray-800 tracking-tight mb-4">No cloud deployments yet</h3>
                  <button
                    onClick={() => openCreateModal(visibleTemplates[0])}
                    disabled={!visibleTemplates.length}
                    className="flex items-center gap-2 bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 hover:text-gray-900 px-5 py-2.5 rounded-lg text-[13px] font-bold transition shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus size={16} className="text-gray-400" />
                    Create Deployment
                  </button>
                </div>
              ) : (
                visibleDeployments.map((deployment) => (
                  <div
                    key={deployment.id}
                    className="grid grid-cols-7 border-b border-gray-100 items-center px-6 py-4 hover:bg-gray-50 transition"
                  >
                    <div>
                      <span
                        className={`flex items-center gap-1.5 font-bold text-[11px] uppercase tracking-wider px-2 py-0.5 rounded w-max border ${
                          deployment.status === "Running"
                            ? "bg-green-50 text-green-700 border-green-100"
                            : deployment.status === "Provisioning"
                              ? "bg-amber-50 text-amber-700 border-amber-100"
                              : "bg-gray-50 text-gray-700 border-gray-200"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            deployment.status === "Running"
                              ? "bg-green-500"
                              : deployment.status === "Provisioning"
                                ? "bg-amber-500"
                                : "bg-gray-400"
                          }`}
                        ></span>
                        {deployment.status}
                      </span>
                    </div>
                    <div className="font-bold text-[13px] text-gray-900">{deployment.name}</div>
                    <div className="text-[13px] text-gray-600 font-medium">{deployment.project_name}</div>
                    <div className="text-[13px] text-gray-600 font-medium">{deployment.workflow_name}</div>
                    <div className="text-[12px] text-gray-500 font-mono">{deployment.runtime}</div>
                    <div className="text-[12px] text-gray-500 font-mono">{deployment.version}</div>
                    <div className="flex gap-3 text-[12px] font-bold">
                      <button
                        onClick={() => activateDeployment(deployment.id)}
                        className="text-violet-600 hover:underline flex items-center gap-1"
                      >
                        <Play size={13} /> Activate
                      </button>
                      <button onClick={() => deleteDeployment(deployment.id)} className="text-red-600 hover:underline">
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {visibleDeployments.length > 0 && (
              <div className="mt-8 grid grid-cols-1 xl:grid-cols-2 gap-6 w-full max-w-[1300px]">
                {visibleDeployments.map((deployment) => (
                  <div key={`${deployment.id}-detail`} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-lg font-bold text-gray-900">{deployment.name}</div>
                        <div className="text-sm text-gray-500 mt-1">{deployment.description}</div>
                      </div>
                      <span className="rounded-full bg-violet-50 text-violet-700 px-3 py-1 text-xs font-bold uppercase tracking-wider">
                        {deployment.mode}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
                      <div className="rounded-xl bg-[#f8fafc] border border-gray-200 p-4">
                        <div className="text-sm font-bold text-gray-900">Endpoint URL</div>
                        <div className="mt-2 text-xs font-mono text-gray-600 break-all">{deployment.endpoint_url}</div>
                      </div>
                      <div className="rounded-xl bg-[#f8fafc] border border-gray-200 p-4">
                        <div className="text-sm font-bold text-gray-900">Pipeline API</div>
                        <div className="mt-2 text-xs font-mono text-gray-600">
                          /api/workflows/{deployment.workflow_id || "workflow-id"}/run
                        </div>
                      </div>
                      <div className="rounded-xl bg-[#0f172a] p-4 text-slate-100">
                        <div className="text-sm font-bold">CLI</div>
                        <pre className="mt-2 text-xs overflow-x-auto">{deployment.cli_command}</pre>
                      </div>
                      <div className="rounded-xl bg-[#0f172a] p-4 text-slate-100">
                        <div className="text-sm font-bold">SDK</div>
                        <pre className="mt-2 text-xs overflow-x-auto">{deployment.sdk_snippet}</pre>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
