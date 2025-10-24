import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/lib/components/elements";
import { Button } from "@/lib/components/elements";
import { Progress } from "@/lib/components/elements";
import { ProjectData, projectTemplates } from "../ProjectWizardApp";

interface ReviewStepProps {
    projectData: ProjectData;
    onCreate: () => void;
}

/**
 * Project review step to confirm settings before creation
 */
export function ReviewStep({ projectData, onCreate }: ReviewStepProps) {
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
                                    <label className="text-sm font-medium text-gray-400">App ID</label>
                                    <p className="text-sm text-gray-200">{projectData.appId || "Not specified"}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-400">Author</label>
                                    <p className="text-sm text-gray-200">{projectData.author || "Not specified"}</p>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-400">License</label>
                                    <p className="text-sm text-gray-200">
                                        {projectData.license === "Other"
                                            ? (projectData.licenseCustom || "Custom")
                                            : (projectData.license || "Not specified")}
                                    </p>
                                </div>
                            </div>

                            {projectData.description && (
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-400">Description</label>
                                    <p className="text-sm text-gray-200">{projectData.description}</p>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-400">License</label>
                                    <p className="text-sm text-gray-200">
                                        {projectData.license === "Other"
                                            ? (projectData.licenseCustom || "Custom")
                                            : (projectData.license || "Not specified")}
                                    </p>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-400">Resolution</label>
                                    <p className="text-sm text-gray-200">{projectData.resolution || "Not specified"}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-400">Type</label>
                                    <p className="text-sm text-gray-200">{projectData.type || "Not specified"}</p>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-400">Language</label>
                                    <p className="text-sm text-gray-200">
                                        {projectData.language === "en" ? "English" :
                                         projectData.language === "zh" ? "Chinese" :
                                         projectData.language === "ja" ? "Japanese" :
                                         projectData.language === "ko" ? "Korean" :
                                         projectData.language === "fr" ? "French" :
                                         projectData.language === "de" ? "German" :
                                         projectData.language === "es" ? "Spanish" :
                                         projectData.language === "pt" ? "Portuguese" :
                                         projectData.language === "ru" ? "Russian" :
                                         projectData.language === "ar" ? "Arabic" :
                                         "Other"}
                                    </p>
                                </div>
                            </div>

                            {projectData.tags.length > 0 && (
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-400">Tags</label>
                                    <div className="flex flex-wrap gap-2">
                                        {projectData.tags.map((tag, index) => (
                                            <span
                                                key={index}
                                                className="px-2 py-1 text-xs bg-[#40a8c4]/20 text-[#40a8c4] rounded-full"
                                            >
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
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
                                    <p className="text-gray-200">{projectData.location || "~/Projects"}</p>
                                </div>
                                <div className="space-y-1">
                                    <label className="font-medium text-gray-400">App ID</label>
                                    <p className="text-gray-200">{projectData.appId || "Not specified"}</p>
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
                                    <label className="font-medium text-gray-400">Backup</label>
                                    <p className="text-gray-200">Daily</p>
                                </div>
                                <div className="space-y-1">
                                    <label className="font-medium text-gray-400">Resolution</label>
                                    <p className="text-gray-200">{projectData.resolution || "Not specified"}</p>
                                </div>
                                <div className="space-y-1">
                                    <label className="font-medium text-gray-400">Privacy</label>
                                    <p className="text-gray-200">Private</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Creation Progress Preview */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Project Creation</CardTitle>
                            <CardDescription>
                                What will happen when you create the project.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                    <span className="text-sm text-gray-200">Create project directory</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                    <span className="text-sm text-gray-200">Initialize version control</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                    <span className="text-sm text-gray-200">Apply template configuration</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                    <span className="text-sm text-gray-200">Set up project structure</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                                    <span className="text-sm text-gray-400">Open project in editor</span>
                                </div>
                            </div>

                            <div className="pt-2 border-t border-white/10">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-400">Estimated time:</span>
                                    <span className="text-gray-200">~30 seconds</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Action Buttons */}
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <h3 className="text-sm font-medium text-gray-200">
                                        Ready to create project?
                                    </h3>
                                    <p className="text-xs text-gray-400">
                                        Click "Create Project" to proceed with the configuration above.
                                    </p>
                                </div>
                                <Button
                                    onClick={onCreate}
                                    disabled={!projectData.name.trim() || !projectData.appId.trim() || !projectData.author.trim() || !projectData.resolution || !/^[a-z0-9-]+$/.test(projectData.appId)}
                                >
                                    Create Project
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
