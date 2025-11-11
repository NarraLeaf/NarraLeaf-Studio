
import { Plus, FolderOpen } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { useState } from "react";

export function ProjectsTab() {
    const [isOpening, setIsOpening] = useState(false);

    const handleNewProject = () => {
        getInterface().launchProjectWizard({});
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
            <div className="flex items-center justify-between mb-4">
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
        </div>
    );
}


