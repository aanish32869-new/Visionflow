import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";

export default function CreateProject() {
  const navigate = useNavigate();
  const [projectType, setProjectType] = useState("Object Detection");
  const [projectName, setProjectName] = useState("");
  const [annotationGroup, setAnnotationGroup] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const buttonText = "Create Project";

  const handleCreateProject = async () => {
    const trimmedName = projectName.trim();
    if (!trimmedName) {
      alert("Project name cannot be empty.");
      return;
    }

    setIsCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          project_type: projectType,
          annotation_group: annotationGroup,
        }),
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(errorBody.error || `Server returned ${res.status}`);
      }

      const data = await res.json();
      navigate((data.tool || "Rapid") === "Rapid" ? "/rapid-upload" : "/upload", {
        state: {
          visibility: data.visibility || (data.public ? "Public" : "Private") || "Public",
          projectName: trimmedName,
          projectId: data.id,
          projectType,
        },
      });
    } catch (err) {
      console.error("Failed to create project", err);
      alert(err.message || "Failed to create project. Please ensure the backend is running and you have connection.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="h-screen overflow-y-auto bg-white flex flex-col font-sans animate-page-enter">
      <header className="flex justify-between items-center px-6 py-3 border-b border-gray-100">
        <div className="text-[22px] font-bold flex items-center gap-2">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 17L12 22L22 17" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 12L12 17L22 12" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-violet-600 tracking-tight lowercase">VisionFlow</span>
        </div>
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-800 transition p-1 hover:bg-gray-100 rounded">
          <X size={20} />
        </button>
      </header>

      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-10 py-6 sm:py-10 flex flex-col pb-32">
        <h1 className="text-[28px] sm:text-[34px] font-bold text-gray-900 mb-2 tracking-tight">Let's create your project.</h1>
        <div className="flex flex-wrap items-center text-[12px] sm:text-sm text-gray-400 mb-8 sm:mb-10">
          <span>As Workspace</span>
          <span className="mx-2 text-gray-300">{">"}</span>
          <span className="font-medium text-gray-600">{projectName || "Untitled Project"}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5 mb-8">
          <div className="flex flex-col">
            <label className="text-[13px] font-bold text-gray-800 mb-2">Project Name</label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && projectName.trim() && !isCreating) {
                  e.preventDefault();
                  handleCreateProject();
                }
              }}
              className="border border-violet-400 rounded-md px-3 py-[9px] text-[13px] text-gray-900 focus:outline-none focus:border-violet-600 transition"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-[13px] font-bold text-gray-800 mb-2 flex items-center gap-1">
              Annotation Group <span className="text-gray-300 font-normal">i</span>
            </label>
            <input
              type="text"
              value={annotationGroup}
              onChange={(e) => setAnnotationGroup(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-[9px] text-[13px] text-gray-900 focus:border-violet-500 focus:outline-none transition"
            />
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8 flex-1 min-h-[440px]">
          <div className="w-full lg:w-[45%] flex flex-col gap-0">
            <h3 className="text-[13px] font-bold text-gray-900 mb-3">Project Type</h3>

            <div
              onClick={() => setProjectType("Object Detection")}
              className={`border rounded-lg p-5 cursor-pointer flex flex-col justify-center mb-1 relative transition ${projectType === "Object Detection" ? "border-violet-400 bg-violet-50/50 z-10" : "border-transparent border-b-gray-100 bg-white hover:bg-gray-50/50"}`}
            >
              <div className="flex justify-between items-center mb-2">
                <h4 className={`text-[14px] ${projectType === "Object Detection" ? "font-bold text-gray-900" : "font-semibold text-gray-800"}`}>Object Detection</h4>
                <div className={`flex gap-[6px] text-[10px] uppercase font-bold tracking-wider ${projectType === "Object Detection" ? "text-violet-600" : "text-gray-400"}`}>
                  <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded-sm ${projectType === "Object Detection" ? "bg-white border border-violet-100" : "bg-gray-50 border border-transparent"}`}>
                    <span className="border border-current w-2 h-2 rounded-[1px] inline-block" />
                    Bounding Boxes
                  </span>
                  <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded-sm ${projectType === "Object Detection" ? "bg-white border border-violet-100" : "bg-gray-50 border border-transparent"}`}># Counts</span>
                  <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded-sm ${projectType === "Object Detection" ? "bg-white border border-violet-100" : "bg-gray-50 border border-transparent"}`}>Tracking</span>
                </div>
              </div>
              <p className={`text-[13px] font-medium tracking-tight ${projectType === "Object Detection" ? "text-gray-600" : "text-gray-500"}`}>Identify objects and their positions with bounding boxes.</p>
            </div>

          </div>

          <div className="w-full lg:w-[55%] flex flex-col items-center justify-center p-8 bg-gray-50/50 rounded-xl relative overflow-hidden self-start sticky top-6">
            {projectType === "Object Detection" && (
              <div className="w-full max-w-[550px] aspect-[4/3] relative flex items-center justify-center rounded-[4px] overflow-hidden bg-gray-900 shadow-sm">
                <img
                  src="https://images.unsplash.com/photo-1546519638-68e109498ffc?q=80&w=1000&auto=format&fit=crop"
                  alt="Basketball player"
                  className="w-full h-full object-cover opacity-90"
                />
                <div className="absolute top-[25%] left-[30%] w-[40%] h-[40%] border-[2px] border-[#ff6600] bg-[#ff6600]/10 flex flex-col">
                  <div className="bg-[#ff6600] text-white text-[11px] font-bold px-1.5 py-0.5 inline-block self-start absolute top-0 -translate-y-[100%] left-[-2px]">
                    basketball <span className="font-normal opacity-70 ml-1">player</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 py-4 px-4 sm:px-10 flex justify-end items-center gap-4 sm:gap-6 z-50 shadow-[0_-2px_10px_rgba(0,0,0,0.02)]">
        <button onClick={() => navigate(-1)} className="text-gray-500 font-semibold hover:text-gray-800 transition-colors text-[13px]">
          Cancel
        </button>
        <button
          onClick={handleCreateProject}
          disabled={isCreating || !projectName.trim()}
          className="bg-violet-600 text-white px-5 py-2.5 rounded-[5px] text-[13px] font-bold tracking-wide hover:bg-violet-700 transition shadow-sm hover:shadow active:transform active:scale-95 disabled:opacity-70"
        >
          {isCreating ? "Creating..." : buttonText}
        </button>
      </footer>
    </div>
  );
}
