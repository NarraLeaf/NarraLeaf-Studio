import { useState } from "react";
import { LucideIcon } from "lucide-react";
import { transliterate } from "transliteration";
import { AppLayout } from "@/lib/components/layout";
import { Button } from "@/lib/components/elements";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/lib/components/elements";
import { Input, InputGroup } from "@/lib/components/elements";
import { Select } from "@/lib/components/elements";
import { Progress } from "@/lib/components/elements";
import { ChevronLeft, ChevronRight, CheckCircle, Zap, FileText, Package } from "lucide-react";
import { DetailsStep } from "./steps/DetailsStep";
import { ReviewStep } from "./steps/ReviewStep";
import { SettingsStep } from "./steps/SettingsStep";
import { TemplateStep } from "./steps/TemplateStep";

export interface ProjectTemplate {
    id: string;
    name: string;
    description: string;
    icon: LucideIcon;
    category: string;
}

export const projectTemplates: ProjectTemplate[] = [
    {
        id: "starter",
        name: "Starter",
        description: "Pre-configured project with basic structure and templates",
        icon: Zap,
        category: "Quick Start"
    },
    {
        id: "skeleton",
        name: "Skeleton",
        description: "Minimal project structure with essential files and folders",
        icon: Package,
        category: "Framework"
    },
    {
        id: "empty",
        name: "Empty",
        description: "Start with a blank project and build from scratch",
        icon: FileText,
        category: "Custom"
    }
];

export const projectTypes = [
    { value: "starter", label: "Starter" },
    { value: "skeleton", label: "Skeleton" },
    { value: "empty", label: "Empty" },
];

type WizardStep = "template" | "details" | "settings" | "review";

export interface ProjectData {
    name: string;
    description: string;
    template: string;
    type: string;
    location: string;
    author: string;
    language: string;
    tags: string[];
    license: string;
    licenseCustom?: string;
    resolution: string;
    appId: string;
    versionControl: string;
}

export function ProjectWizardApp() {
    const [currentStep, setCurrentStep] = useState<WizardStep>("template");
    const [appIdManuallyEdited, setAppIdManuallyEdited] = useState(false);
    const [projectData, setProjectData] = useState<ProjectData>({
        name: "",
        description: "",
        template: "",
        type: "",
        location: "~/Projects",
        author: "",
        language: "en",
        tags: [],
        license: "",
        licenseCustom: "",
        resolution: "",
        appId: "",
        versionControl: "git"
    });

    /**
     * Generate a valid app ID from project name with transliteration
     */
    const generateAppId = (name: string): string => {
        // Use transliteration library to convert non-English characters
        const transliterated = transliterate(name);

        return transliterated
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
            .replace(/\s+/g, '-') // Replace spaces with hyphens
            .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
            .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
            .substring(0, 50); // Limit length
    };

    /**
     * Validate if app ID contains only allowed characters
     */
    const validateAppId = (appId: string): boolean => {
        return /^[a-z0-9-]+$/.test(appId);
    };

    /**
     * Update project name and auto-generate app ID if not manually edited
     */
    const updateProjectName = (name: string) => {
        updateProjectData({ name });
        if (!appIdManuallyEdited || !projectData.appId) {
            updateProjectData({ appId: generateAppId(name) });
        }
    };

    /**
     * Update app ID and mark as manually edited
     */
    const updateAppId = (appId: string) => {
        updateProjectData({ appId });
        setAppIdManuallyEdited(true);
    };

    /**
     * Check if all validation passes for current step
     */
    const isStepValid = () => {
        switch (currentStep) {
            case "template":
                return projectData.template !== "";
            case "details":
                return projectData.name.trim() !== "" &&
                       projectData.author.trim() !== "" &&
                       projectData.resolution !== "" &&
                       projectData.appId.trim() !== "" &&
                       validateAppId(projectData.appId);
            case "settings":
                return true;
            case "review":
                return projectData.name.trim() !== "" &&
                       projectData.author.trim() !== "" &&
                       projectData.resolution !== "" &&
                       projectData.appId.trim() !== "" &&
                       validateAppId(projectData.appId);
            default:
                return false;
        }
    };

    const steps = [
        { key: "template", label: "Template", description: "Choose a project template" },
        { key: "details", label: "Details", description: "Project information" },
        { key: "settings", label: "Settings", description: "Project configuration" },
        { key: "review", label: "Review", description: "Review and create" }
    ];

    const currentStepIndex = steps.findIndex(step => step.key === currentStep);
    const progress = ((currentStepIndex + 1) / steps.length) * 100;

    const updateProjectData = (updates: Partial<ProjectData>) => {
        setProjectData(prev => ({ ...prev, ...updates }));
    };

    const nextStep = () => {
        const stepKeys: WizardStep[] = ["template", "details", "settings", "review"];
        const currentIndex = stepKeys.indexOf(currentStep);
        if (currentIndex < stepKeys.length - 1) {
            setCurrentStep(stepKeys[currentIndex + 1]);
        }
    };

    const prevStep = () => {
        const stepKeys: WizardStep[] = ["template", "details", "settings", "review"];
        const currentIndex = stepKeys.indexOf(currentStep);
        if (currentIndex > 0) {
            setCurrentStep(stepKeys[currentIndex - 1]);
        }
    };

    const canProceed = () => {
        return isStepValid();
    };

    const handleCreateProject = () => {
        // TODO: Implement project creation logic
        console.log("Creating project:", projectData);
    };

    const renderStepContent = () => {
        switch (currentStep) {
            case "template":
                return <TemplateStep projectData={projectData} updateProjectData={updateProjectData} />;
            case "details":
                return <DetailsStep
                    projectData={projectData}
                    updateProjectData={updateProjectData}
                    updateProjectName={updateProjectName}
                    updateAppId={updateAppId}
                />;
            case "settings":
                return <SettingsStep projectData={projectData} updateProjectData={updateProjectData} />;
            case "review":
                return <ReviewStep projectData={projectData} onCreate={handleCreateProject} />;
            default:
                return null;
        }
    };

    return (
        <AppLayout title="New Project" iconSrc="/favicon.ico">
            <div className="h-full flex flex-col">
                {/* Progress Header */}
                <div className="p-6 border-b border-white/10">
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h1 className="text-xl font-semibold text-gray-200">Create New Project</h1>
                            <span className="text-sm text-gray-400">
                                Step {currentStepIndex + 1} of {steps.length}
                            </span>
                        </div>

                        <Progress value={progress} className="mb-4" animated={false} />

                        <div className="flex items-center px-4">
                            {steps.map((step, index) => (
                                <div key={step.key} className="flex items-center flex-1">
                                    {/* Step content */}
                                    <div className="flex items-center justify-center flex-1 px-2">
                                        <div className={`
                                            flex items-center gap-2 text-sm flex-shrink-0
                                            ${index <= currentStepIndex
                                                ? "text-[#40a8c4]"
                                                : "text-gray-500"
                                            }
                                        `}>
                                            {index < currentStepIndex ? (
                                                <CheckCircle className="w-4 h-4" />
                                            ) : (
                                                <div className={`
                                                    w-4 h-4 rounded-full border-2
                                                    ${index === currentStepIndex
                                                        ? "border-[#40a8c4] bg-[#40a8c4]/20"
                                                        : "border-gray-500"
                                                    }
                                                `}>
                                                    {index === currentStepIndex && (
                                                        <div className="w-full h-full rounded-full bg-[#40a8c4] scale-50" />
                                                    )}
                                                </div>
                                            )}
                                            <span className="whitespace-nowrap">{step.label}</span>
                                        </div>
                                    </div>

                                    {/* Connection line */}
                                    {index < steps.length - 1 && (
                                        <div className="flex-shrink-0 px-2">
                                            <div className={`
                                                w-8 h-px transition-colors duration-150
                                                ${index < currentStepIndex
                                                    ? "bg-[#40a8c4]"
                                                    : "bg-gray-600"
                                                }
                                            `} />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Step Content */}
                <div className="flex-1 overflow-y-auto">
                    {renderStepContent()}
                </div>

                {/* Navigation Footer */}
                <div className="flex items-center justify-between p-6 border-t border-white/10">
                    <Button
                        variant="ghost"
                        onClick={prevStep}
                        disabled={currentStepIndex === 0}
                    >
                        <ChevronLeft className="w-4 h-4 mr-2" />
                        Back
                    </Button>

                    <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={() => window.close()}>
                            Cancel
                        </Button>
                        {currentStep === "review" ? (
                            <Button
                                onClick={handleCreateProject}
                                disabled={!canProceed()}
                            >
                                Create Project
                            </Button>
                        ) : (
                            <Button
                                onClick={nextStep}
                                disabled={!canProceed()}
                            >
                                Next
                                <ChevronRight className="w-4 h-4 ml-2" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
