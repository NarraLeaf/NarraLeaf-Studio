import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/lib/components/elements";
import { ProjectData } from "../types";
import { projectTemplates } from "../constants";

interface ReviewStepProps {
    projectData: ProjectData;
}

/**
 * Project review step to confirm settings before creation
 */
export function ReviewStep({ projectData }: ReviewStepProps) {
    const selectedTemplate = projectTemplates.find(t => t.id === projectData.template);

    return (
        <div className="p-6">
            <div className="space-y-6">
                <div className="space-y-2">
                    <h2 className="text-lg font-semibold text-gray-200">Review Project</h2>
                    <p className="text-sm text-gray-400">
                        Review your project settings before creating it.
                    </p>
                </div>

                <div className="grid gap-6 max-w-2xl">
                    {/* Project Summary */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Project Summary</CardTitle>
                            <CardDescription>
                                Overview of your project configuration.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-400">Name</label>
                                    <p className="text-sm text-gray-200">{projectData.name || "Not specified"}</p>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-400">Author</label>
                                    <p className="text-sm text-gray-200">{projectData.author || "Not specified"}</p>
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-400">License</label>
                                <p className="text-sm text-gray-200">
                                    {projectData.license === "Other"
                                        ? (projectData.licenseCustom || "Custom")
                                        : (projectData.license || "Not specified")}
                                </p>
                            </div>

                            {projectData.description && (
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-400">Description</label>
                                    <p className="text-sm text-gray-200">{projectData.description}</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Template Information */}
                    {selectedTemplate && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Selected Template</CardTitle>
                                <CardDescription>
                                    Project template that will be used.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-start gap-3">
                                    <div className="text-2xl text-gray-400">
                                        <selectedTemplate.icon className="w-6 h-6" />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="text-sm font-medium text-gray-200">
                                            {selectedTemplate.name}
                                        </h3>
                                        <p className="text-sm text-gray-400 mt-1">
                                            {selectedTemplate.description}
                                        </p>
                                        <span className="text-xs text-gray-500 bg-white/10 px-2 py-1 rounded mt-2 inline-block">
                                            {selectedTemplate.category}
                                        </span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Project Settings */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Project Settings</CardTitle>
                            <CardDescription>
                                Configuration that will be applied to your project.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div className="space-y-1">
                                    <label className="font-medium text-gray-400">Location</label>
                                    <p className="text-gray-200">{projectData.location}</p>
                                </div>
                                <div className="space-y-1">
                                    <label className="font-medium text-gray-400">Version Control</label>
                                    <p className="text-gray-200">
                                        {projectData.versionControl === "git" ? "Git" :
                                         projectData.versionControl === "none" ? "None" :
                                         "Git"}
                                    </p>
                                </div>
                                <div className="space-y-1">
                                    <label className="font-medium text-gray-400">Resolution</label>
                                    <p className="text-gray-200">{projectData.resolution || "Not specified"}</p>
                                </div>
                                <div className="space-y-1">
                                    <label className="font-medium text-gray-400">App ID</label>
                                    <p className="text-gray-200">{projectData.appId || "Not specified"}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
