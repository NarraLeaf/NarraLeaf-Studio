
import { getInterface } from "@/lib/app/bridge";
import { RecentlyOpenedProject } from "@shared/types/state/appStateTypes";
import { FolderOpen, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

export function ProjectsTab() {
    const [isOpening, setIsOpening] = useState(false);
    const [recentProjects, setRecentProjects] = useState<RecentlyOpenedProject[]>([]);

    useEffect(() => {
        const loadRecentProjects = async () => {
            try {
                const result = await getInterface().app.state.getGlobalState("app.recentProjects");
                if (result.success) {
                    setRecentProjects(result.data.value || []);
                }
                console.log(result.data);
            } catch (error) {
                console.error("Failed to load recent projects:", error);
            }
        };

        loadRecentProjects();
    }, []);

    const handleOpenRecentProject = async (project: RecentlyOpenedProject) => {
        if (isOpening) return;

        setIsOpening(true);
        try {
            // Open workspace with the project path
            await getInterface().workspace.launch(
                { projectPath: project.path },
                true // Close launcher window after opening workspace
            );
        } catch (error) {
            console.error("Error opening recent project:", error);
        } finally {
            setIsOpening(false);
        }
    };

    const handleRemoveRecentProject = async (project: RecentlyOpenedProject) => {
        const next = recentProjects.filter((p) => p.path !== project.path);
        setRecentProjects(next);
        try {
            const result = await getInterface().app.state.setGlobalState("app.recentProjects", next);
            if (!result.success) {
                const reload = await getInterface().app.state.getGlobalState("app.recentProjects");
                if (reload.success) {
                    setRecentProjects(reload.data.value || []);
                }
            }
        } catch (error) {
            console.error("Failed to remove recent project:", error);
            try {
                const reload = await getInterface().app.state.getGlobalState("app.recentProjects");
                if (reload.success) {
                    setRecentProjects(reload.data.value || []);
                }
            } catch {
                /* ignore */
            }
        }
    };

    const handleNewProject = async () => {
        const result = await getInterface().app.launchProjectWizard({});
        if (result.success && result.data?.created) {
            // Open workspace with the selected folder
            await getInterface().workspace.launch(
                { projectPath: result.data.projectPath },
                true // Close launcher window after opening workspace
            );
        }
    };

    const handleOpenFolder = async () => {
        if (isOpening) return;
        
        setIsOpening(true);
        try {
            // Select folder
            const result = await getInterface().selectFolder();
            
            if (!result.success) {
                console.error("Failed to select folder:", result.error);
                return;
            }

            if (!result.data.path) {
                // User cancelled
                return;
            }

            // Open workspace with the selected folder
            await getInterface().workspace.launch(
                { projectPath: result.data.path },
                true // Close launcher window after opening workspace
            );
        } catch (error) {
            console.error("Error opening folder:", error);
        } finally {
            setIsOpening(false);
        }
    };

    return (
        <div className="h-full w-full pt-6 px-8 pb-8 text-gray-200">
            <div className="flex items-center justify-between mb-6">
                <div className="text-lg font-semibold">Projects</div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleOpenFolder}
                        disabled={isOpening}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-white/10 hover:text-white rounded-md transition-colors cursor-default disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Open Folder"
                    >
                        <FolderOpen className="w-4 h-4" />
                        <span>{isOpening ? "Opening..." : "Open Folder"}</span>
                    </button>
                    <button
                        onClick={handleNewProject}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-white/10 hover:text-white rounded-md transition-colors cursor-default"
                        title="New Project"
                    >
                        <Plus className="w-4 h-4" />
                        <span>New Project</span>
                    </button>
                </div>
            </div>

            {recentProjects.length > 0 && (
                <div className="mb-6">
                    {/* <div className="flex items-center gap-2 mb-3 text-sm text-gray-400">
                        <Clock className="w-4 h-4" />
                        <span>Recent Projects</span>
                    </div> */}
                    <div className="space-y-2">
                        {recentProjects.map((project, index) => (
                            <div
                                key={`${project.path}-${index}`}
                                className="relative group rounded-md bg-white/5 hover:bg-white/10 transition-colors"
                            >
                                <button
                                    type="button"
                                    onClick={() => handleOpenRecentProject(project)}
                                    disabled={isOpening}
                                    className="w-full p-3 pr-11 text-left rounded-md transition-colors cursor-default disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={`Open ${project.name}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="flex-shrink-0 w-8 h-8 bg-white/10 rounded-md flex items-center justify-center">
                                            {project.icon ? (
                                                <img
                                                    src={project.icon}
                                                    alt=""
                                                    className="w-5 h-5 object-contain"
                                                />
                                            ) : (
                                                <FolderOpen className="w-4 h-4 text-gray-400" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium text-gray-200 truncate">
                                                {project.name}
                                            </div>
                                            <div className="text-xs text-gray-500 truncate">
                                                {project.path}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void handleRemoveRecentProject(project);
                                    }}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-gray-400 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 transition-opacity cursor-default"
                                    title="Remove from recent"
                                    aria-label={`Remove ${project.name} from recent projects`}
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}


