
import { Plus } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";

export function ProjectsTab() {
    const handleNewProject = () => {
        getInterface().launchProjectWizard({});
    };

    return (
        <div className="h-full w-full p-8 text-gray-200">
            <div className="flex items-center justify-between mb-4">
                <div className="text-lg font-semibold">Projects</div>
                <button
                    onClick={handleNewProject}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-white/10 hover:text-white rounded-md transition-colors cursor-default"
                    title="New Project"
                >
                    <Plus className="w-4 h-4" />
                    <span>New Project</span>
                </button>
            </div>
            <div className="text-sm text-gray-400">Here will show recent projects and open/new entry (placeholder).</div>
        </div>
    );
}


