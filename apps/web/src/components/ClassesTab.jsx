import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Edit,
  HelpCircle,
  Info,
  List,
  Lock,
  Plus,
  Search,
  Tags as TagsIcon,
} from "lucide-react";


function FeedbackBanner({ feedback }) {
  if (!feedback) return null;
  return (
    <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-bold ${
      feedback.type === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-red-200 bg-red-50 text-red-700"
    }`}>
      {feedback.type === "success" ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
      {feedback.message}
    </div>
  );
}

function ModalShell({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-[28px] border border-white/70 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-gray-100 px-6 py-5">
          <div>
            <h3 className="text-2xl font-black tracking-tight text-gray-950">{title}</h3>
            <p className="mt-1 text-sm font-semibold text-gray-500">{subtitle}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700">
            ×
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export default function ClassesTab({ projectId, projectType = "Object Detection" }) {
  const [activeTab, setActiveTab] = useState("classes");
  const [classes, setClasses] = useState([]);
  const [tags, setTags] = useState([]);
  const [assets, setAssets] = useState([]);
  const [settings, setSettings] = useState({ lock_annotation_classes: false, keypoint_definition: { points: [], edges: [] } });
  const [search, setSearch] = useState("");
  const [selectedClassName, setSelectedClassName] = useState("");
  const [selectedTagName, setSelectedTagName] = useState("");
  const [selectedAssetIds, setSelectedAssetIds] = useState([]);
  const [bulkTagsInput, setBulkTagsInput] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showModifyModal, setShowModifyModal] = useState(false);
  const [showAttributeModal, setShowAttributeModal] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [modifyAction, setModifyAction] = useState("rename");
  const [replacementName, setReplacementName] = useState("");
  const [targetName, setTargetName] = useState("");
  const [attributeClassName, setAttributeClassName] = useState("");
  const [attributeName, setAttributeName] = useState("");

  const loadData = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/classes-tags`);
      const data = response.ok ? await response.json() : null;
      if (!response.ok || !data) {
        throw new Error("Could not load classes and tags.");
      }

      setClasses(Array.isArray(data.classes) ? data.classes : []);
      setTags(Array.isArray(data.tags) ? data.tags : []);
      setAssets(Array.isArray(data.assets) ? data.assets : []);
      setSettings(data.settings || { lock_annotation_classes: false, keypoint_definition: { points: [], edges: [] } });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: error.message || "Could not load classes and tags." });
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (classes.length && !selectedClassName) {
      setSelectedClassName(classes[0].name);
    }
  }, [classes, selectedClassName]);

  useEffect(() => {
    if (tags.length && !selectedTagName) {
      setSelectedTagName(tags[0].name);
    }
  }, [selectedTagName, tags]);

  const filteredClasses = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return classes;
    return classes.filter((item) => item.name.toLowerCase().includes(query));
  }, [classes, search]);

  const filteredTags = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return tags;
    return tags.filter((item) => item.name.toLowerCase().includes(query));
  }, [search, tags]);

  const toggleAssetSelection = (assetId) => {
    setSelectedAssetIds((current) =>
      current.includes(assetId)
        ? current.filter((item) => item !== assetId)
        : [...current, assetId]
    );
  };

  const handleLockToggle = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/classes-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lock_annotation_classes: !settings.lock_annotation_classes }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Could not update lock state.");
      }
      setSettings((current) => ({ ...current, lock_annotation_classes: data.settings.lock_annotation_classes }));
      setFeedback({
        type: "success",
        message: data.settings.lock_annotation_classes ? "Annotation class creation is now locked." : "Annotators can create new classes again.",
      });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: error.message || "Could not update lock state." });
    }
  };

  const handleAddItem = async () => {
    const name = newItemName.trim();
    if (!name) return;

    try {
      const route = activeTab === "classes" ? "classes" : "tags";
      const response = await fetch(`/api/projects/${projectId}/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Could not add ${activeTab.slice(0, -1)}.`);
      }
      setFeedback({ type: "success", message: `Added ${name} to project ${activeTab}.` });
      setNewItemName("");
      setShowAddModal(false);
      await loadData();
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: error.message || `Could not add ${activeTab.slice(0, -1)}.` });
    }
  };

  const handleModify = async () => {
    try {
      const route = activeTab === "classes" ? "classes/modify" : "tags/modify";
      const sourceName = activeTab === "classes" ? selectedClassName : selectedTagName;
      const payload = {
        action: modifyAction,
        source_name: sourceName,
        replacement_name: replacementName.trim() || undefined,
        target_name: targetName.trim() || undefined,
      };
      const response = await fetch(`/api/projects/${projectId}/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Could not modify ${activeTab.slice(0, -1)}.`);
      }
      setFeedback({ type: "success", message: `${activeTab === "classes" ? "Class" : "Tag"} changes were applied project-wide.` });
      setShowModifyModal(false);
      setReplacementName("");
      setTargetName("");
      await loadData();
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: error.message || `Could not modify ${activeTab.slice(0, -1)}.` });
    }
  };

  const handleAddAttribute = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/classes/attributes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_name: attributeClassName,
          attribute_name: attributeName.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Could not add class attribute.");
      }
      setFeedback({ type: "success", message: `Added attribute to ${attributeClassName}.` });
      setShowAttributeModal(false);
      setAttributeName("");
      setAttributeClassName("");
      await loadData();
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: error.message || "Could not add class attribute." });
    }
  };

  const handleApplyTags = async () => {
    const parsedTags = bulkTagsInput
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (!selectedAssetIds.length || !parsedTags.length) {
      setFeedback({ type: "error", message: "Select at least one image and one tag before applying tags." });
      return;
    }

    try {
      const response = await fetch(`/api/projects/${projectId}/tags/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_ids: selectedAssetIds,
          tags: parsedTags,
          mode: "add",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Could not apply tags.");
      }
      setFeedback({ type: "success", message: `Applied tags to ${data.updated_assets} image${data.updated_assets === 1 ? "" : "s"}.` });
      setBulkTagsInput("");
      setSelectedAssetIds([]);
      await loadData();
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: error.message || "Could not apply tags." });
    }
  };

  const selectedClass = classes.find((item) => item.name === selectedClassName) || classes[0] || null;
  const selectedTag = tags.find((item) => item.name === selectedTagName) || tags[0] || null;

  return (
    <div className="w-full animate-page-enter space-y-6 pb-10">
      <section className="overflow-hidden rounded-[32px] border border-gray-200 bg-gradient-to-br from-white via-white to-violet-50/70 p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-100 bg-white px-3 py-1 text-xs font-black text-violet-700 shadow-sm">
              <List size={14} /> Classes & Tags
            </div>
            <h1 className="text-3xl font-black tracking-tight text-gray-950">Project labels and metadata</h1>
            <p className="mt-2 text-base font-semibold text-gray-500">
              Classes define what the model learns to detect. Tags organize images so you can search, filter, and curate exactly what enters a version.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-700 shadow-sm">
              <input
                type="checkbox"
                checked={settings.lock_annotation_classes}
                onChange={handleLockToggle}
                className="h-4 w-4 rounded border-gray-300 text-violet-600"
              />
              Lock Annotation Classes
            </label>
            <button
              type="button"
              disabled={!String(projectType).toLowerCase().includes("keypoint")}
              className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
              title={String(projectType).toLowerCase().includes("keypoint") ? "Edit keypoints" : "Only available on keypoint projects"}
            >
              <Lock size={15} /> Edit Keypoints
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-2xl font-black text-gray-950">{classes.length}</div>
            <div className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Classes</div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-2xl font-black text-gray-950">{tags.length}</div>
            <div className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Tags</div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-2xl font-black text-gray-950">{assets.length}</div>
            <div className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Project Images</div>
          </div>
        </div>
      </section>

      <FeedbackBanner feedback={feedback} />

      <section className="rounded-[32px] border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="flex items-center gap-4 border-b border-gray-200 lg:border-none">
            <button
              type="button"
              onClick={() => setActiveTab("classes")}
              className={`border-b-2 pb-3 text-sm font-black transition ${
                activeTab === "classes" ? "border-violet-600 text-violet-700" : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              Classes <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[11px]">{classes.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("tags")}
              className={`border-b-2 pb-3 text-sm font-black transition ${
                activeTab === "tags" ? "border-violet-600 text-violet-700" : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              Tags <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px]">{tags.length}</span>
            </button>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="relative block w-full sm:w-[280px]">
              <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${activeTab}...`}
                className="w-full rounded-2xl border border-gray-200 py-3 pl-11 pr-4 text-sm font-semibold text-gray-800 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
              />
            </label>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-black text-gray-700 shadow-sm transition hover:border-violet-200 hover:text-violet-700"
            >
              <Plus size={15} /> Add
            </button>
            <button
              type="button"
              onClick={() => setShowModifyModal(true)}
              disabled={activeTab === "classes" ? !selectedClass : !selectedTag}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Edit size={15} /> {activeTab === "classes" ? "Modify Classes" : "Modify Tags"}
            </button>
          </div>
        </div>
      </section>

      {isLoading ? (
        <div className="h-80 animate-pulse rounded-[32px] border border-gray-200 bg-gray-50" />
      ) : activeTab === "classes" ? (
        <section className="rounded-[32px] border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2 text-sm font-bold text-gray-500">
            <HelpCircle size={15} /> Classes are project-wide labels. Renames, merges, and deletes affect every annotation in the project.
          </div>
          <div className="overflow-hidden rounded-3xl border border-gray-200">
            <div className="grid grid-cols-[100px_1.3fr_0.9fr_0.8fr] bg-gray-50 text-xs font-black uppercase tracking-widest text-gray-400">
              <div className="px-5 py-4">Color</div>
              <div className="px-5 py-4">Class Name</div>
              <div className="px-5 py-4">Attributes</div>
              <div className="px-5 py-4 text-right">Count</div>
            </div>
            {filteredClasses.map((item) => (
              <button
                key={item.name}
                type="button"
                onClick={() => setSelectedClassName(item.name)}
                className={`grid w-full grid-cols-[100px_1.3fr_0.9fr_0.8fr] border-t border-gray-100 px-5 py-4 text-left transition ${
                  selectedClassName === item.name ? "bg-violet-50/60" : "hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center">
                  <div className="h-4 w-4 rounded-full ring-2 ring-white shadow-sm" style={{ backgroundColor: item.color }} />
                </div>
                <div className="font-mono text-sm font-bold text-gray-800">{item.name}</div>
                <div className="flex items-center gap-2">
                  <div className="flex flex-wrap gap-1">
                    {(item.attributes || []).slice(0, 2).map((attribute) => (
                      <span key={attribute} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">
                        {attribute}
                      </span>
                    ))}
                    {!item.attributes?.length && <span className="text-sm font-semibold text-gray-400">None</span>}
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setAttributeClassName(item.name);
                      setShowAttributeModal(true);
                    }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition hover:border-violet-200 hover:text-violet-700"
                    title="Add attribute"
                  >
                    <Plus size={13} />
                  </button>
                </div>
                <div className="text-right text-sm font-black text-gray-700">{item.count || 0}</div>
              </button>
            ))}
            {!filteredClasses.length && (
              <div className="px-5 py-12 text-center text-sm font-semibold text-gray-500">No classes match your search.</div>
            )}
          </div>
        </section>
      ) : (
        <div className="space-y-6">
          <section className="rounded-[32px] border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-sm font-bold text-gray-500">
              <HelpCircle size={15} /> Tags are image-level metadata. Use them to search, curate, and control what goes into a version.
            </div>
            <div className="overflow-hidden rounded-3xl border border-gray-200">
              <div className="grid grid-cols-[100px_1.4fr_0.8fr] bg-gray-50 text-xs font-black uppercase tracking-widest text-gray-400">
                <div className="px-5 py-4">Color</div>
                <div className="px-5 py-4">Tag Name</div>
                <div className="px-5 py-4 text-right">Images</div>
              </div>
              {filteredTags.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => setSelectedTagName(item.name)}
                  className={`grid w-full grid-cols-[100px_1.4fr_0.8fr] border-t border-gray-100 px-5 py-4 text-left transition ${
                    selectedTagName === item.name ? "bg-violet-50/60" : "hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center">
                    <div className="h-4 w-4 rounded-full ring-2 ring-white shadow-sm" style={{ backgroundColor: item.color }} />
                  </div>
                  <div className="font-mono text-sm font-bold text-gray-800">{item.name}</div>
                  <div className="text-right text-sm font-black text-gray-700">{item.count || 0}</div>
                </button>
              ))}
              {!filteredTags.length && (
                <div className="px-5 py-12 text-center text-sm font-semibold text-gray-500">No tags match your search.</div>
              )}
            </div>
          </section>

          <section className="rounded-[32px] border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-700 ring-1 ring-violet-100">
                  <TagsIcon size={14} /> Apply Tags
                </div>
                <h2 className="text-xl font-black text-gray-950">Bulk tag selected images</h2>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  value={bulkTagsInput}
                  onChange={(event) => setBulkTagsInput(event.target.value)}
                  placeholder="factory, night-shift, qa"
                  className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-800 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                />
                <button
                  type="button"
                  onClick={handleApplyTags}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gray-950 px-5 py-3 text-sm font-black text-white transition hover:bg-violet-700"
                >
                  <TagsIcon size={15} /> Apply Tags
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => toggleAssetSelection(asset.id)}
                  className={`overflow-hidden rounded-3xl border text-left shadow-sm transition ${
                    selectedAssetIds.includes(asset.id)
                      ? "border-violet-300 ring-2 ring-violet-100"
                      : "border-gray-200 hover:border-violet-200"
                  }`}
                >
                  <div className="aspect-[4/3] bg-gray-100">
                    <img src={asset.url} alt={asset.filename} className="h-full w-full object-cover" />
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="text-sm font-black text-gray-950">{asset.filename}</div>
                    <div className="flex flex-wrap gap-1">
                      {(asset.batch_tags || []).map((tag) => (
                        <span key={`${asset.id}-${tag}`} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">
                          {tag}
                        </span>
                      ))}
                      {!asset.batch_tags?.length && <span className="text-xs font-semibold text-gray-400">No tags yet</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {showAddModal && (
        <ModalShell
          title={`Add ${activeTab === "classes" ? "Class" : "Tag"}`}
          subtitle={`Create a new project ${activeTab === "classes" ? "class" : "tag"} that can be reused across the dataset.`}
          onClose={() => setShowAddModal(false)}
        >
          <div className="space-y-4">
            <input
              type="text"
              value={newItemName}
              onChange={(event) => setNewItemName(event.target.value)}
              placeholder={activeTab === "classes" ? "e.g. hard_hat" : "e.g. factory"}
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-800 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowAddModal(false)} className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-black text-gray-700">
                Cancel
              </button>
              <button onClick={handleAddItem} className="rounded-2xl bg-violet-600 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-violet-700">
                Add
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {showModifyModal && (
        <ModalShell
          title={activeTab === "classes" ? "Modify Classes" : "Modify Tags"}
          subtitle="Project-wide changes are applied across existing data, so use rename, merge, and delete carefully."
          onClose={() => setShowModifyModal(false)}
        >
          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-black uppercase tracking-widest text-gray-400">Selected</span>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-black text-gray-800">
                {activeTab === "classes" ? selectedClass?.name : selectedTag?.name}
              </div>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-black uppercase tracking-widest text-gray-400">Action</span>
              <select
                value={modifyAction}
                onChange={(event) => setModifyAction(event.target.value)}
                className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-800 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
              >
                <option value="rename">Rename</option>
                {activeTab === "classes" && <option value="merge">Merge</option>}
                <option value="delete">Delete</option>
              </select>
            </label>
            {modifyAction === "rename" && (
              <input
                type="text"
                value={replacementName}
                onChange={(event) => setReplacementName(event.target.value)}
                placeholder="New name"
                className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-800 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
              />
            )}
            {modifyAction === "merge" && (
              <input
                type="text"
                value={targetName}
                onChange={(event) => setTargetName(event.target.value)}
                placeholder="Merge into class"
                className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-800 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
              />
            )}
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowModifyModal(false)} className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-black text-gray-700">
                Cancel
              </button>
              <button onClick={handleModify} className="rounded-2xl bg-violet-600 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-violet-700">
                Apply
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {showAttributeModal && (
        <ModalShell
          title="Add Attribute"
          subtitle="Attributes let you attach deeper metadata to a class, like color or condition."
          onClose={() => setShowAttributeModal(false)}
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-black text-gray-800">
              {attributeClassName}
            </div>
            <input
              type="text"
              value={attributeName}
              onChange={(event) => setAttributeName(event.target.value)}
              placeholder="e.g. color"
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-800 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowAttributeModal(false)} className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-black text-gray-700">
                Cancel
              </button>
              <button onClick={handleAddAttribute} className="rounded-2xl bg-violet-600 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-violet-700">
                Save Attribute
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
