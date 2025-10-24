import { useState, useEffect } from "react";
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
import { getInterface } from "@/lib/app/bridge";
import { PlatformSystem } from "@shared/types/os";
import { IPCEventType } from "@shared/types/ipcEvents";
import { getPlatformInfo } from "@/lib/renderApp";

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
    location: string;
    author: string;
    license: string;
    licenseCustom?: string;
    resolution: string;
    appId: string;
    versionControl: string;
}

export interface DirectoryValidationResult {
    isEmpty: boolean;
    exists: boolean;
    isDirectory: boolean;
    canWrite: boolean;
}

export interface ValidationErrors {
    location?: string;
    directory?: string;
}

export function ProjectWizardApp() {
    const [currentStep, setCurrentStep] = useState<WizardStep>("template");
    const [appIdManuallyEdited, setAppIdManuallyEdited] = useState(false);
    const [platformInfo, setPlatformInfo] = useState<any>(null);
    const [defaultLocation, setDefaultLocation] = useState<string>("");
    const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
    const [directoryValidation, setDirectoryValidation] = useState<DirectoryValidationResult | null>(null);
    const [isValidatingDirectory, setIsValidatingDirectory] = useState(false);
    const [isSelectingDirectory, setIsSelectingDirectory] = useState(false);
    const [locationInputDirty, setLocationInputDirty] = useState(false); // Input modified but not validated
    const [locationInputFocused, setLocationInputFocused] = useState(false); // Input currently has focus

    const [projectData, setProjectData] = useState<ProjectData>({
        name: "",
        description: "",
        template: "",
        location: "",
        author: "",
        license: "",
        licenseCustom: "",
        resolution: "1920x1080",
        appId: "",
        versionControl: "git"
    });


    // Fetch the appropriate default directory for the user's platform
    // This replaces the hard-coded "C:\Projects" with a user-specific directory
    useEffect(() => {
        const fetchDefaultDirectory = async () => {
            try {
                const interface_ = getInterface();
                const result = await interface_.getDefaultProjectDirectory();

                if (result && result.success && result.data) {
                    setDefaultLocation(result.data);
                } else {
                    // Fallback to ~/Projects if API fails
                    console.warn("Failed to get platform-specific directory, using fallback");
                    setDefaultLocation("~/Projects");
                }
            } catch (error) {
                console.error("Failed to get default project directory:", error);
                setDefaultLocation("~/Projects");
            }
        };

        fetchDefaultDirectory();
    }, []);

    // Update location with default value once platform info is available
    useEffect(() => {
        if (defaultLocation && !projectData.location) {
            setProjectData(prev => ({ ...prev, location: defaultLocation }));
            // Validate the default location immediately since it's from a trusted source
            setTimeout(async () => {
                if (defaultLocation) {
                    await validateProjectDirectory(defaultLocation);
                }
            }, 100);
        }
    }, [defaultLocation]); // Removed projectData.location dependency to avoid issues

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
    const updateProjectName = async (name: string) => {
        setProjectData(prevData => {
            const newData = { ...prevData, name };

            // Only auto-generate app ID if it wasn't manually edited
            if (!appIdManuallyEdited) {
                newData.appId = generateAppId(name);
            }

            return newData;
        });
    };

    /**
     * Update app ID and mark as manually edited
     */
    const updateAppId = async (appId: string) => {
        setProjectData(prevData => ({ ...prevData, appId }));
        setAppIdManuallyEdited(true);
    };

    const validateLocation = (location: string): string | undefined => {
        if (!location || location.trim() === "") {
            return "Project location is required";
        }
        return undefined;
    };

    /**
     * Validate if the path points to a valid drive/directory that exists
     * This checks basic path validity without requiring the directory to exist
     * Only validates that the drive/volume is accessible, not the specific directory
     */
    const validatePathDrive = async (path: string): Promise<{ success: boolean; error?: string }> => {
        try {
            const interface_ = getInterface();

            // For Windows, check if the drive exists
            if (platformInfo?.system === PlatformSystem.win32) {
                // Extract drive letter (e.g., "C:" from "C:\Projects")
                const driveMatch = path.match(/^([A-Za-z]):/);
                if (driveMatch) {
                    const drive = driveMatch[1];
                    const drivePath = `${drive}:\\`;

                    // Check if drive exists and is accessible
                    const driveExistsResult = await interface_.fs.isDirExists(drivePath);
                    if (!driveExistsResult.success) {
                        return { success: false, error: `Drive ${drive}: is not accessible` };
                    }
                }
            }

            // For Unix-like systems, check if we can access basic directories
            else {
                // Check if we can access the root directory (basic system validation)
                const rootResult = await interface_.fs.isDirExists("/");
                if (!rootResult.success) {
                    return { success: false, error: "Root directory is not accessible" };
                }
            }

            return { success: true };
        } catch (error) {
            return { success: false, error: "Path validation failed" };
        }
    };

    const validateDirectory = async (path: string): Promise<{ success: boolean; error?: string; data?: DirectoryValidationResult }> => {
        try {
            const interface_ = getInterface();

            // Check if directory exists
            const dirExistsResult = await interface_.fs.isDirExists(path);
            if (!dirExistsResult.success) {
                return { success: false, error: "Failed to check directory existence" };
            }

            // Check if it's actually a directory
            const isDirResult = await interface_.fs.isDir(path);
            if (!isDirResult.success) {
                return { success: false, error: "Failed to check if path is directory" };
            }

            const exists = dirExistsResult.success ? (dirExistsResult.data?.ok ? dirExistsResult.data.data : false) : false;
            const isDirectory = isDirResult.success ? (isDirResult.data?.ok ? isDirResult.data.data : false) : false;

            if (!exists) {
                return {
                    success: true,
                    data: {
                        exists: false,
                        isDirectory: false,
                        isEmpty: true,
                        canWrite: true
                    }
                };
            }

            if (!isDirectory) {
                return {
                    success: true,
                    data: {
                        exists: true,
                        isDirectory: false,
                        isEmpty: true,
                        canWrite: false
                    }
                };
            }

            // Check if directory is empty
            const listResult = await interface_.fs.list(path);
            if (!listResult.success) {
                return { success: false, error: "Failed to list directory contents" };
            }

            const isEmpty = listResult.success ? (listResult.data?.ok ? (listResult.data.data?.length === 0 || false) : false) : false;

            // For now, assume we can write if it exists and is a directory
            // In a real implementation, you might want to check write permissions
            const canWrite = exists && isDirectory;

            return {
                success: true,
                data: {
                    exists,
                    isDirectory,
                    isEmpty,
                    canWrite
                }
            };
        } catch (error) {
            return { success: false, error: "Failed to validate directory" };
        }
    };

    const validateProjectDirectory = async (path: string) => {
        // Clear previous validation errors
        setValidationErrors(prev => ({
            ...prev,
            location: undefined,
            directory: undefined
        }));
        setDirectoryValidation(null);

        const locationError = validateLocation(path);
        if (locationError) {
            setValidationErrors(prev => ({
                ...prev,
                location: locationError
            }));
            return;
        }

        // Validate directory asynchronously
        setIsValidatingDirectory(true);
        try {
            // First validate that the path points to a valid drive/location
            const driveValidation = await validatePathDrive(path);
            if (!driveValidation.success) {
                setValidationErrors(prev => ({
                    ...prev,
                    directory: driveValidation.error || "Invalid path"
                }));
                return;
            }

            const validationResult = await validateDirectory(path);

            if (validationResult.success && validationResult.data) {
                setDirectoryValidation(validationResult.data);

                // Check if directory is valid for project creation
                // Note: Directory not existing is OK since we will create it
                // Only show errors for actual problems (file exists, no write permission, not empty)
                if (validationResult.data.exists && !validationResult.data.isDirectory) {
                    setValidationErrors(prev => ({
                        ...prev,
                        directory: "Selected path exists but is not a directory. Please choose a directory or create a new one."
                    }));
                } else if (validationResult.data.exists && !validationResult.data.canWrite) {
                    setValidationErrors(prev => ({
                        ...prev,
                        directory: "Cannot write to the selected directory. Please check permissions or choose a different location."
                    }));
                } else if (validationResult.data.exists && !validationResult.data.isEmpty) {
                    setValidationErrors(prev => ({
                        ...prev,
                        directory: "Directory is not empty. Please choose an empty directory or create a new one."
                    }));
                }
                // If all checks pass or directory doesn't exist (which is OK), clear directory error
                else {
                    setValidationErrors(prev => ({
                        ...prev,
                        directory: undefined
                    }));
                }
            } else {
                setValidationErrors(prev => ({
                    ...prev,
                    directory: validationResult.error || "Directory validation failed"
                }));
            }
        } catch (error) {
            setValidationErrors(prev => ({
                ...prev,
                directory: "Failed to validate directory"
            }));
        } finally {
            setIsValidatingDirectory(false);
        }
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
                       projectData.resolution !== "" &&
                       projectData.appId.trim() !== "" &&
                       validateAppId(projectData.appId);
            case "settings":
                // UX: Prevent proceeding if input is focused (user is typing) or dirty (modified but not validated)
                return projectData.location !== undefined &&
                       projectData.location.trim() !== "" &&
                       projectData.versionControl !== "" &&
                       !validationErrors.location &&
                       !validationErrors.directory &&
                       !locationInputDirty &&
                       !locationInputFocused;
            case "review":
                return projectData.name.trim() !== "" &&
                       projectData.resolution !== "" &&
                       projectData.appId.trim() !== "" &&
                       validateAppId(projectData.appId) &&
                       projectData.location !== undefined &&
                       projectData.location.trim() !== "" &&
                       !validationErrors.location &&
                       !validationErrors.directory &&
                       !locationInputDirty &&
                       !locationInputFocused;
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

    const updateProjectData = async (updates: Partial<ProjectData>) => {
        setProjectData(prevData => {
            const newData = { ...prevData, ...updates };
            return newData;
        });

        // If location changed, mark input as dirty (will be validated on blur)
        // This prevents interrupting user while typing and allows them to finish their input
        if (updates.location) {
            setLocationInputDirty(true);
            // Clear any existing validation errors for location until blur validation
            setValidationErrors(prev => ({
                ...prev,
                location: undefined,
                directory: undefined
            }));
        }
    };

    const nextStep = () => {
        if (!canProceed()) {
            return; // Don't proceed if current step is not valid
        }
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
                return <SettingsStep
                    projectData={projectData}
                    updateProjectData={updateProjectData}
                    validationErrors={validationErrors}
                    directoryValidation={directoryValidation}
                    isValidatingDirectory={isValidatingDirectory}
                    onLocationChange={async (value) => await updateProjectData({ location: value })}
                    onLocationBlur={async () => {
                        setLocationInputFocused(false);
                        const error = validateLocation(projectData.location || "");
                        setValidationErrors(prev => ({
                            ...prev,
                            location: error
                        }));
                        if (!error && projectData.location) {
                            await validateProjectDirectory(projectData.location);
                        }
                        setLocationInputDirty(false);
                    }}
                    onLocationFocus={() => setLocationInputFocused(true)}
                    onSelectDirectory={async () => {
                        setIsSelectingDirectory(true);
                        try {
                            const interface_ = getInterface();
                            const result = await interface_.selectProjectDirectory();
                            if (result && result.success && result.data) {
                                updateProjectData({ location: result.data });
                                // Clear validation errors when a directory is selected
                                setValidationErrors(prev => ({
                                    ...prev,
                                    location: undefined,
                                    directory: undefined
                                }));
                                setDirectoryValidation(null);
                                setLocationInputDirty(false);
                                setLocationInputFocused(false);

                                // Validate the selected directory
                                await validateProjectDirectory(result.data);
                            }
                        } catch (error) {
                            console.error("Failed to select directory:", error);
                        } finally {
                            setIsSelectingDirectory(false);
                        }
                    }}
                    isSelectingDirectory={isSelectingDirectory}
                />;
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
