import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/lib/components/elements";
import { Input, InputGroup } from "@/lib/components/elements";
import { Select } from "@/lib/components/elements";
import { ProjectData } from "../ProjectWizardApp";
import { IPCEventType } from "@shared/types/ipcEvents";
import { FolderOpen } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";

interface SettingsStepProps {
    projectData: ProjectData;
    updateProjectData: (updates: Partial<ProjectData>) => void;
}


const backupOptions = [
    { value: "none", label: "No backups" },
    { value: "hourly", label: "Hourly" },
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
];

const versionControlOptions = [
    { value: "git", label: "Git" },
    { value: "none", label: "None" },
];

/**
 * Project settings step for configuration options
 */
export function SettingsStep({ projectData, updateProjectData }: SettingsStepProps) {
    const [isSelectingDirectory, setIsSelectingDirectory] = useState(false);

    const handleSelectDirectory = async () => {
        setIsSelectingDirectory(true);
        try {
            const interface_ = getInterface();
            const result = await interface_.selectProjectDirectory();
            if (result && result.success && result.data) {
                updateProjectData({ location: result.data });
            }
        } catch (error) {
            console.error("Failed to select directory:", error);
        } finally {
            setIsSelectingDirectory(false);
        }
    };
    return (
        <div className="p-6">
            <div className="space-y-6">
                <div className="space-y-2">
                    <h2 className="text-lg font-semibold text-gray-200">Project Settings</h2>
                    <p className="text-sm text-gray-400">
                        Configure project location, backup, and version control settings.
                    </p>
                </div>

                <div className="grid gap-6 max-w-2xl">
                    <Card>
                        <CardHeader>
                            <CardTitle>Location</CardTitle>
                            <CardDescription>
                                Choose where to save your project files.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <InputGroup label="Project Location">
                                <div className="relative">
                                    <Input
                                        placeholder="Enter project location..."
                                        value={projectData.location || "~/Projects"}
                                        onChange={(e) => updateProjectData({ location: e.target.value })}
                                    />
                                    <button
                                        type="button"
                                        onClick={handleSelectDirectory}
                                        disabled={isSelectingDirectory}
                                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <FolderOpen className="w-4 h-4" />
                                    </button>
                                </div>
                            </InputGroup>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Backup & Sync</CardTitle>
                            <CardDescription>
                                Configure automatic backup and synchronization.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <InputGroup label="Auto Backup">
                                <Select
                                    options={backupOptions}
                                    value="daily"
                                    placeholder="Select backup frequency..."
                                />
                            </InputGroup>

                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-200">
                                        Cloud sync
                                    </label>
                                    <p className="text-xs text-gray-400">
                                        Sync project with cloud storage
                                    </p>
                                </div>
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-white/20 bg-white/5"
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-200">
                                        Auto-save
                                    </label>
                                    <p className="text-xs text-gray-400">
                                        Automatically save changes as you work
                                    </p>
                                </div>
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-white/20 bg-white/5"
                                    defaultChecked
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Version Control</CardTitle>
                            <CardDescription>
                                Set up version control for your project.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <InputGroup label="Version Control System">
                                <Select
                                    options={versionControlOptions}
                                    value={projectData.versionControl || "git"}
                                    onChange={(value) => updateProjectData({ versionControl: String(value) })}
                                    placeholder="Select version control..."
                                />
                            </InputGroup>

                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-200">
                                        Initialize repository
                                    </label>
                                    <p className="text-xs text-gray-400">
                                        Create a new repository for this project
                                    </p>
                                </div>
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-white/20 bg-white/5"
                                    defaultChecked
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-200">
                                        Create .gitignore
                                    </label>
                                    <p className="text-xs text-gray-400">
                                        Generate appropriate .gitignore file
                                    </p>
                                </div>
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-white/20 bg-white/5"
                                    defaultChecked
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Privacy</CardTitle>
                            <CardDescription>
                                Control project visibility and access.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-200">
                                        Private project
                                    </label>
                                    <p className="text-xs text-gray-400">
                                        Hide project from public discovery
                                    </p>
                                </div>
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-white/20 bg-white/5"
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-200">
                                        Allow collaboration
                                    </label>
                                    <p className="text-xs text-gray-400">
                                        Allow others to collaborate on this project
                                    </p>
                                </div>
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-white/20 bg-white/5"
                                />
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
