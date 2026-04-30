import React, { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  ChevronDown,
  Database,
  FileStack,
  FolderOpen,
  Globe,
  Layers,
  Loader2,
  Lock,
  Search,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import AssetLibrary from "../components/AssetLibrary";

const EMPTY_ARRAY = [];
const EMPTY_OBJECT = {};
const DEFAULT_WORKSPACE = { name: "VisionFlow Workspace" };

export default function Projects() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("projects");
  const [overview, setOverview] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFolderId, setSelectedFolderId] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("updated");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);

  const loadOverview = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/workspace-overview");
      const data = await res.json();
      setOverview(data);
    } catch (err) {
      console.error("Failed to fetch workspace overview", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const projects = overview?.projects || EMPTY_ARRAY;
  const folders = overview?.folders || EMPTY_ARRAY;
  const stats = overview?.stats || EMPTY_OBJECT;
  const workspace = overview?.workspace || DEFAULT_WORKSPACE;

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    let result = [...projects];

    if (selectedFolderId !== "all") {
      result = result.filter((project) => (project.folder_id || "") === selectedFolderId);
    }

    if (query) {
      result = result.filter((project) =>
        [project.name, project.project_type, project.annotation, project.folder_name]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query))
      );
    }

    result.sort((left, right) => {
      if (sortBy === "name") return left.name.localeCompare(right.name);
      return String(right.updated || "").localeCompare(String(left.updated || ""));
    });

    return result;
  }, [projects, search, selectedFolderId, sortBy]);

  const handleCreateFolder = async () => {
    if (!folderName.trim()) return;
    setIsCreatingFolder(true);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: folderName }),
      });
      const created = await res.json();
      setToastMessage({ title: "Folder Created", folderName: created.name || folderName });
      setFolderName("");
      setIsModalOpen(false);
      await loadOverview();
      setSelectedFolderId(created.id || "all");
      setTimeout(() => setToastMessage(null), 3500);
    } catch (err) {
      console.error("Failed to create folder", err);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const openDeleteDialog = (project, event) => {
    event.stopPropagation();
    setProjectToDelete(project);
  };

  const deleteProject = async () => {
    if (!projectToDelete || isDeletingProject) return;

    setIsDeletingProject(true);
    try {
      const res = await fetch(`/api/projects/${projectToDelete.id}`, { method: "DELETE" });
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(errorBody.error || "Failed to delete project");
      }
      await loadOverview();
      setProjectToDelete(null);
    } catch (err) {
      console.error("Failed to delete project", err);
      alert(err.message || "Failed to delete project.");
    } finally {
      setIsDeletingProject(false);
    }
  };

  const openProject = (project) => {
    navigate("/upload", {
      state: {
        projectId: project.id,
        projectName: project.name,
        visibility: project.visibility || (project.public ? "Public" : "Private"),
        projectType: project.project_type,
        classificationType: project.classification_type,
        activeTab: "upload",
      },
    });
  };

  return (
    <Layout>
      <div className="w-full max-w-[1450px] mx-auto pt-2 pb-12 flex flex-col min-h-full animate-page-enter relative">
        {toastMessage && (
          <div className="fixed top-28 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-40 bg-white rounded-[10px] shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-gray-100 p-5 animate-slide-up flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 text-gray-900 font-bold text-[15px]">
              <CheckCircle2 size={20} className="text-gray-600 stroke-[2px]" /> {toastMessage.title}
            </div>
            <div className="text-gray-600 text-[14px]">{toastMessage.folderName}</div>
            <button onClick={() => setToastMessage(null)} className="text-gray-400 hover:text-gray-600 transition">
              <X size={18} />
            </button>
          </div>
        )}

        {isModalOpen && (
          <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-[480px] rounded-[12px] shadow-2xl overflow-hidden animate-slide-up">
              <div className="flex items-center justify-between p-5 pb-4 border-b border-gray-100">
                <h3 className="font-bold text-[18px] text-gray-900">Create Project Folder</h3>
                <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 transition p-1">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6">
                <label className="block text-[13px] font-bold text-gray-900 mb-2">Folder Name</label>
                <input
                  type="text"
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && folderName.trim() && !isCreatingFolder) {
                      event.preventDefault();
                      handleCreateFolder();
                    }
                  }}
                  className="w-full px-4 py-2.5 border border-[#6B21A8] rounded-[6px] outline-none shadow-[0_0_0_2px_rgba(107,33,168,0.1)] text-[14px] text-gray-900 font-medium"
                  autoFocus
                />
              </div>
              <div className="p-5 flex items-center justify-end gap-3 pt-0 mt-2">
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 rounded-[6px] border border-gray-300 text-gray-700 font-semibold text-[13px] hover:bg-gray-50 transition shadow-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateFolder}
                  disabled={!folderName.trim() || isCreatingFolder}
                  className="px-6 py-2.5 rounded-[6px] bg-[#6B21A8] hover:bg-[#581c87] text-white font-semibold text-[13px] transition flex items-center gap-2 shadow-sm disabled:opacity-70"
                >
                  {isCreatingFolder && <Loader2 size={16} className="animate-spin" />}
                  Create Folder
                </button>
              </div>
            </div>
          </div>
        )}

        {projectToDelete && (
          <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-[460px] rounded-[12px] shadow-2xl overflow-hidden animate-slide-up">
              <div className="flex items-center justify-between p-5 pb-4 border-b border-gray-100">
                <h3 className="font-bold text-[18px] text-gray-900">Delete Project</h3>
                <button
                  onClick={() => !isDeletingProject && setProjectToDelete(null)}
                  className="text-gray-400 hover:text-gray-600 transition p-1"
                  disabled={isDeletingProject}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-6">
                <p className="text-[15px] font-semibold text-gray-900">Want to delete it permanently?</p>
                <p className="text-[13px] text-gray-500 mt-2">
                  {projectToDelete.name} and its stored files will be removed from both MongoDB and disk.
                </p>
              </div>
              <div className="p-5 flex items-center justify-end gap-3 pt-0">
                <button
                  onClick={() => setProjectToDelete(null)}
                  className="px-5 py-2.5 rounded-[6px] border border-gray-300 text-gray-700 font-semibold text-[13px] hover:bg-gray-50 transition shadow-sm"
                  disabled={isDeletingProject}
                >
                  Cancel
                </button>
                <button
                  onClick={deleteProject}
                  disabled={isDeletingProject}
                  className="px-6 py-2.5 rounded-[6px] bg-red-600 hover:bg-red-700 text-white font-semibold text-[13px] transition flex items-center gap-2 shadow-sm disabled:opacity-70"
                >
                  {isDeletingProject && <Loader2 size={16} className="animate-spin" />}
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6 mt-4">
          <div>
            <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-violet-600 mb-2">Workspace</div>
            <h1 className="text-[28px] font-bold text-gray-900 tracking-tight">{workspace.name}</h1>
            <p className="text-[14px] text-gray-500 mt-2 max-w-[760px]">
              Organize your computer vision work as Workspace → Projects → Dataset Versions → Models, with folders to group projects by team, client, or use case.
            </p>
          </div>

          <div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          <StatCard label="Projects" value={stats.projects || 0} note="Datasets inside this workspace" icon={<Database size={18} className="text-violet-600" />} />
          <StatCard label="Folders" value={stats.folders || 0} note="Organize projects by team or client" icon={<FolderOpen size={18} className="text-violet-600" />} />
          <StatCard label="Images" value={stats.images || 0} note="Assets uploaded across all projects" icon={<Layers size={18} className="text-violet-600" />} />
          <StatCard label="Versions" value={stats.versions || 0} note="Frozen dataset snapshots for reproducibility" icon={<FileStack size={18} className="text-violet-600" />} />
        </div>

        <div className="flex items-center gap-6 border-b border-gray-200 mb-8 px-1">
          <button
            onClick={() => setActiveTab("projects")}
            className={`font-bold pb-3.5 text-[14px] px-1 tracking-tight transition-colors ${activeTab === "projects" ? "text-[#6B21A8] border-b-2 border-[#6B21A8]" : "text-gray-500 hover:text-gray-800"}`}
          >
            Projects
          </button>
          <button
            onClick={() => setActiveTab("asset_library")}
            className={`font-bold pb-3.5 text-[14px] px-1 tracking-tight transition-colors ${activeTab === "asset_library" ? "text-[#6B21A8] border-b-2 border-[#6B21A8]" : "text-gray-500 hover:text-gray-800"}`}
          >
            Asset Library
          </button>
        </div>

        {activeTab === "asset_library" ? (
          <AssetLibrary />
        ) : (
          <>
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 w-full lg:w-auto">
                <div className="relative w-full sm:w-[320px]">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search projects, folders, or annotation groups"
                    className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-[6px] text-[13px] outline-none focus:border-[#6B21A8] focus:ring-1 focus:ring-[#6B21A8] transition shadow-sm bg-white font-medium placeholder-gray-400"
                  />
                </div>
                <button
                  onClick={() => setSortBy((prev) => (prev === "updated" ? "name" : "updated"))}
                  className="bg-white border text-gray-700 px-4 py-2.5 rounded-[6px] flex items-center justify-between font-bold gap-2 hover:bg-gray-50 transition shadow-sm border-gray-300 text-[13px]"
                >
                  Sort: {sortBy === "updated" ? "Date Edited" : "Name"} <ChevronDown size={14} className="text-gray-400" />
                </button>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="bg-white border text-gray-700 px-4 py-2.5 rounded-[6px] flex items-center justify-center font-bold gap-1.5 hover:bg-gray-50 transition shadow-sm border-gray-300 text-[13px]"
                >
                  <span className="text-gray-400 font-normal mr-0.5 text-[16px]">+</span> New Folder
                </button>
                <button
                  onClick={() => navigate("/create")}
                  className="bg-[#6B21A8] hover:bg-[#581c87] text-white px-5 py-2.5 rounded-[6px] font-bold text-[13px] flex items-center justify-center gap-1 transition shadow-sm"
                >
                  <span className="font-normal text-[15px]">+</span> New Project
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 mb-8">
              <FolderChip
                active={selectedFolderId === "all"}
                label={`All Projects (${projects.length})`}
                onClick={() => setSelectedFolderId("all")}
              />
              {folders.map((folder) => (
                <FolderChip
                  key={folder.id}
                  active={selectedFolderId === folder.id}
                  label={folder.name}
                  onClick={() => setSelectedFolderId(folder.id)}
                />
              ))}
            </div>

            {isLoading ? (
              <div className="rounded-2xl bg-gradient-to-b from-white to-gray-50 border border-gray-100 p-16 text-center shadow-sm">
                <div className="relative w-16 h-16 mx-auto mb-6">
                  <div className="absolute inset-0 border-4 border-violet-100 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-violet-600 rounded-full border-t-transparent animate-spin"></div>
                  <div className="absolute inset-0 m-auto w-2 h-2 bg-violet-400 rounded-full animate-pulse"></div>
                </div>
                <h3 className="text-[18px] font-bold text-gray-900 tracking-tight mb-2">Preparing Workspace</h3>
                <p className="text-[13px] text-gray-500 font-medium">Syncing projects and folders securely...</p>
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
                <div className="mx-auto w-16 h-16 rounded-full bg-violet-50 flex items-center justify-center mb-5">
                  <FolderOpen size={28} className="text-violet-600" />
                </div>
                <h3 className="text-[20px] font-bold text-gray-900 mb-3 tracking-tight">No projects match this view</h3>
                <p className="text-[14px] text-gray-500 mb-8 max-w-[620px] mx-auto">
                  Create a new project with a task type, annotation group, and visibility setting, or switch folders to browse the rest of your workspace.
                </p>
                <button
                  onClick={() => navigate("/create")}
                  className="px-5 py-2.5 rounded-[6px] bg-[#6B21A8] hover:bg-[#581c87] text-white font-bold text-[13px] transition shadow-sm"
                >
                  Create Project
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {filteredProjects.map((project) => (
                  <div
                    key={project.id}
                    onClick={() => openProject(project)}
                    className="bg-white border border-gray-200 rounded-[14px] overflow-hidden hover:border-[#6B21A8]/50 hover:shadow-[0_12px_30px_rgba(0,0,0,0.06)] cursor-pointer group relative transition-all"
                  >
                    <button
                      onClick={(event) => openDeleteDialog(project, event)}
                      className="absolute top-3 right-3 bg-white/90 shadow-sm border border-gray-200 p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 z-20 opacity-0 group-hover:opacity-100 transition-all"
                      disabled={isDeletingProject}
                    >
                      {isDeletingProject && projectToDelete?.id === project.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>

                    <div className="h-36 bg-gradient-to-br from-[#faf5ff] via-white to-[#eef2ff] flex items-center justify-center relative overflow-hidden border-b border-gray-100">
                      <div className="absolute left-4 top-4 flex items-center gap-2">
                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-white text-gray-500 border border-gray-200">
                          {project.project_type}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${project.public ? "bg-blue-50 text-blue-600 border-blue-200" : "bg-gray-50 text-gray-600 border-gray-200"}`}>
                          {project.public ? <Globe size={10} /> : <Lock size={10} />}
                          {project.public ? "Public" : "Private"}
                        </span>
                      </div>
                      <Database size={42} className="text-violet-300 group-hover:text-violet-500 transition-colors" />
                    </div>

                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-bold text-gray-900 text-[17px] tracking-tight group-hover:text-[#6B21A8] transition-colors">
                            {project.name}
                          </h3>
                          <p className="text-[12px] text-gray-500 mt-1">
                            Annotation Group: <span className="font-semibold text-gray-700">{project.annotation}</span>
                          </p>
                        </div>
                        {project.folder_name && (
                          <span className="text-[11px] font-bold text-violet-700 bg-violet-50 border border-violet-200 px-2 py-1 rounded-md">
                            {project.folder_name}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-3 mt-5">
                        <MetricPill label="Images" value={project.images || 0} />
                        <MetricPill label="Unannotated" value={project.unannotated || 0} />
                        <MetricPill label="Versions" value={project.versions_count || 0} />
                      </div>

                      <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between">
                        <div className="text-[12px] text-gray-500">
                          Updated {project.updated ? new Date(project.updated).toLocaleDateString() : "recently"}
                        </div>
                        <div className="text-[12px] font-bold text-violet-600">
                          Open Project
                        </div>
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

function StatCard({ label, value, note, icon }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
        {icon}
      </div>
      <h3 className="text-3xl font-bold text-gray-900 tracking-tight mt-3">{value}</h3>
      <p className="text-[12px] text-gray-500 mt-2">{note}</p>
    </div>
  );
}

function FolderChip({ active, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-full text-[12px] font-bold border transition ${active ? "bg-violet-600 text-white border-violet-600" : "bg-white text-gray-600 border-gray-200 hover:border-violet-200 hover:text-violet-700"}`}
    >
      {label}
    </button>
  );
}

function MetricPill({ label, value }) {
  return (
    <div className="rounded-xl bg-[#f8fafc] border border-gray-200 px-3 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-[16px] font-bold text-gray-900 mt-1">{value}</div>
    </div>
  );
}
