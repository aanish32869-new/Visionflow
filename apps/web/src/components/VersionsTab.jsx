import React, { useState, useEffect, useCallback } from "react";
import {
  Layers,
  Zap,
  Download,
  Info,
  Trash2,
  Calendar,
  Image as ImageIcon,
  Clock,
  ArrowRight,
  Database,
  BarChart2,
  Search,
  Plus,
  Loader2,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import VersionDetailsModal from "./VersionDetailsModal";

export default function VersionsTab({ projectId, onTrainModel, onOpenGenerate }) {
  const [versions, setVersions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState(null);
  const [selectedVersion, setSelectedVersion] = useState(null);

  const fetchVersions = useCallback(async () => {
    setIsLoading(true);
    const pid = typeof projectId === 'object' && projectId !== null ? (projectId.id || projectId._id) : projectId;
    try {
      const response = await fetch(`/api/projects/${pid}/versions`);
      if (!response.ok) throw new Error("Failed to fetch versions");
      const data = await response.json();
      setVersions(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  // Polling for processing versions
  useEffect(() => {
    const hasProcessing = versions.some(v => v.status === "Processing" || v.status === "Queued");
    if (!hasProcessing) return;

    const interval = setInterval(fetchVersions, 3000);
    return () => clearInterval(interval);
  }, [versions, fetchVersions]);

  const handleDelete = async (versionId) => {
    if (!window.confirm("Are you sure you want to delete this version? This action cannot be undone.")) return;
    try {
      const response = await fetch(`/api/versions/${versionId}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setVersions(versions.filter(v => v.version_id !== versionId));
      }
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

  const filteredVersions = versions.filter(v => 
    v.name.toLowerCase().includes(search.toLowerCase()) || 
    v.display_id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-white animate-page-enter">
      {/* Header Section */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-black text-gray-950 flex items-center gap-3">
            <Layers className="text-violet-600" size={28} /> Dataset Versions
          </h2>
          <p className="text-sm font-semibold text-gray-500 mt-1">
            Immutable snapshots of your dataset for reproducible training.
          </p>
        </div>
        <button
          onClick={onOpenGenerate}
          className="btn-primary bg-violet-600 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-violet-700 transition shadow-lg shadow-violet-200"
        >
          <Plus size={18} /> Generate New Version
        </button>
      </div>

      {/* Search & Stats Bar */}
      <div className="flex flex-col md:flex-row gap-4 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search versions by name or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-semibold outline-none focus:border-violet-400 focus:bg-white transition"
          />
        </div>
        <div className="flex items-center gap-4">
          <div className="px-5 py-3 bg-gray-50 border border-gray-200 rounded-2xl flex items-center gap-3">
            <Database size={16} className="text-gray-400" />
            <div className="text-sm font-bold text-gray-700">{versions.length} Total Versions</div>
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 text-sm font-bold">
          <AlertCircle size={20} /> {error}
        </div>
      )}

      {/* Grid of Versions */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="animate-spin text-violet-600" size={40} />
            <p className="text-gray-400 font-bold">Loading your versions...</p>
          </div>
        </div>
      ) : filteredVersions.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center border-4 border-dashed border-gray-100 rounded-[40px] p-20 text-center">
          <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-6">
            <Layers size={40} className="text-gray-300" />
          </div>
          <h3 className="text-xl font-black text-gray-950 mb-2">No versions found</h3>
          <p className="text-sm font-semibold text-gray-500 max-w-sm mb-8">
            You haven't generated any dataset versions yet. Create your first version to start training models.
          </p>
          <button
            onClick={onOpenGenerate}
            className="px-6 py-3 bg-violet-600 text-white rounded-2xl font-black text-sm hover:bg-violet-700 transition"
          >
            Create Version v1
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 pb-10">
          {filteredVersions.map((version) => (
            <VersionCard 
              key={version.version_id} 
              version={version} 
              onTrain={() => onTrainModel(version)}
              onDelete={() => handleDelete(version.version_id)}
              onViewDetails={() => setSelectedVersion(version)}
            />
          ))}
        </div>
      )}

      <VersionDetailsModal 
        isOpen={!!selectedVersion}
        onClose={() => setSelectedVersion(null)}
        version={selectedVersion}
        onTrain={(v) => {
          setSelectedVersion(null);
          onTrainModel(v);
        }}
      />
    </div>
  );
}

function VersionCard({ version, onTrain, onDelete, onViewDetails }) {
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const isProcessing = version.status === "Processing" || version.status === "Queued";

  return (
    <div className="group bg-white border border-gray-200 rounded-[32px] p-6 shadow-sm hover:shadow-xl hover:shadow-violet-100/50 hover:border-violet-200 transition-all duration-300 relative overflow-hidden">
      {/* Processing Overlay */}
      {isProcessing && (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-[2px] z-10 flex flex-col items-center justify-center p-6 text-center">
          <div className="relative w-16 h-16 mb-4 flex items-center justify-center">
             <Loader2 className="animate-spin text-violet-600 absolute inset-0 w-full h-full" size={64} />
             <span className="text-[10px] font-black text-gray-900 z-20">
               {version.progress || 0}%
             </span>
          </div>
          <h4 className="text-lg font-black text-gray-900">Generating Version...</h4>
          <p className="text-sm font-semibold text-gray-500 mt-1">This may take a few minutes for large datasets.</p>
        </div>
      )}

      {/* Card Content */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-violet-50 rounded-2xl flex items-center justify-center text-violet-600">
            <Layers size={28} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 bg-gray-900 text-white text-[10px] font-black rounded uppercase tracking-wider">
                {version.display_id}
              </span>
              {version.status === "Ready" && (
                <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600">
                  <CheckCircle2 size={12} /> Immutable
                </span>
              )}
            </div>
            <h3 className="text-xl font-black text-gray-950">{version.name}</h3>
            <div className="flex items-center gap-3 text-[11px] font-bold text-gray-400 mt-1">
              <span className="flex items-center gap-1"><Calendar size={12} /> {formatDate(version.created_at)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
           <button onClick={onDelete} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition" title="Delete Version">
             <Trash2 size={18} />
           </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-50 rounded-2xl p-4 flex flex-col items-center justify-center">
          <div className="text-lg font-black text-gray-950">{version.images_count || 0}</div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Images</div>
        </div>
        <div className="bg-gray-50 rounded-2xl p-4 flex flex-col items-center justify-center">
          <div className="text-lg font-black text-gray-950">{version.annotations_count || 0}</div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Labels</div>
        </div>
        <div className="bg-gray-50 rounded-2xl p-4 flex flex-col items-center justify-center text-center">
          <div className="text-xs font-black text-gray-950 truncate w-full">{version.classes?.length || 0}</div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Classes</div>
        </div>
      </div>

      <div className="space-y-4">
        {/* Progressions/Applied Transforms */}
        <div className="space-y-2">
          <h4 className="text-[11px] font-black text-gray-400 uppercase tracking-wider px-1">Applied Pipeline</h4>
          <div className="flex flex-wrap gap-2">
            {version.options?.preprocessing?.resize?.enabled && (
              <span className="px-3 py-1 bg-violet-50 text-violet-700 text-xs font-bold rounded-lg border border-violet-100 flex items-center gap-1.5">
                <ImageIcon size={12} /> Resize {version.options.preprocessing.resize.width}x{version.options.preprocessing.resize.height}
              </span>
            )}
            {version.options?.augmentations?.length > 0 && (
              <span className="px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-lg border border-emerald-100 flex items-center gap-1.5">
                <Zap size={12} /> {version.options.augmentations.length} Augmentations
              </span>
            )}
            <span className="px-3 py-1 bg-amber-50 text-amber-700 text-xs font-bold rounded-lg border border-amber-100 flex items-center gap-1.5">
              <BarChart2 size={12} /> {version.options?.split?.train || 70}/{version.options?.split?.valid || 20}/{version.options?.split?.test || 10} Split
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-4 border-t border-gray-100 flex items-center gap-3">
          <button 
            onClick={onTrain}
            className="flex-1 bg-gray-950 text-white px-4 py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 hover:bg-violet-600 transition shadow-lg shadow-gray-200"
          >
            <Zap size={16} /> Train Model
          </button>
          <a 
            href={version.download_url}
            download
            className={`px-4 py-3 bg-white border border-gray-200 text-gray-700 rounded-2xl font-black text-sm flex items-center gap-2 hover:border-violet-300 hover:text-violet-600 transition ${!version.download_url ? 'pointer-events-none opacity-50' : ''}`}
          >
            <Download size={16} /> Download
          </a>
          <button 
            onClick={onViewDetails}
            className="p-3 bg-white border border-gray-200 text-gray-400 rounded-2xl hover:border-violet-300 hover:text-violet-600 transition"
          >
            <Info size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
