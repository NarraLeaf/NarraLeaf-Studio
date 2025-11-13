import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/lib/components/elements";
import { Input, InputGroup } from "@/lib/components/elements";
import { Select } from "@/lib/components/elements";
import { ProjectData, ValidationErrors, DirectoryValidationResult } from "../types";
import { versionControlOptions } from "../constants";
import { FolderOpen } from "lucide-react";

interface SettingsStepProps {
    projectData: ProjectData;
    updateProjectData: (updates: Partial<ProjectData>) => void;
    validationErrors: ValidationErrors;
    directoryValidation: DirectoryValidationResult | null;
    isValidatingDirectory: boolean;
    onLocationChange: (value: string) => void;
    onLocationBlur: () => Promise<void>;
    onLocationFocus: () => void;
    onSelectDirectory: () => Promise<void>;
    isSelectingDirectory: boolean;
}

/**
 * Project settings step for configuration options
 */
export function SettingsStep({
    projectData,
    updateProjectData,
    validationErrors,
    directoryValidation,
    isValidatingDirectory,
    onLocationChange,
    onLocationBlur,
    onLocationFocus,
    onSelectDirectory,
    isSelectingDirectory
}: SettingsStepProps) {
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
                                Choose where to save your project.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <InputGroup
                                label="Project Location"
                                required
                                error={validationErrors.location || validationErrors.directory}
                            >
                                <div className="space-y-1">
                                    <div className="relative">
                                        <Input
                                            placeholder="Enter project location..."
                                            value={projectData.location}
                                            onChange={async (e) => await onLocationChange(e.target.value)}
                                            onBlur={onLocationBlur}
                                            onFocus={onLocationFocus}
                                            disabled={isValidatingDirectory}
                                        />
                                        <button
                                            type="button"
                                            onClick={onSelectDirectory}
                                            disabled={isSelectingDirectory || isValidatingDirectory}
                                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <FolderOpen className="w-4 h-4" />
                                        </button>
                                    </div>
                                    {isValidatingDirectory && (
                                        <p className="text-sm text-gray-400">Validating directory...</p>
                                    )}

                                    {/* Show informational message when directory doesn't exist */}
                                    {directoryValidation && !directoryValidation.exists && !validationErrors.directory && (
                                        <div className="text-xs text-primary mt-1">
                                            ✓ This directory will be created automatically when you create the project
                                        </div>
                                    )}
                                </div>
                            </InputGroup>
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
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
