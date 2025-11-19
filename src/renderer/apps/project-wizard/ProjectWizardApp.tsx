import { AppLayout } from "@/lib/components/layout";
import { WizardHeader, WizardNavigation } from "./components";
import { useProjectWizard } from "./hooks/useProjectWizard";
import { DetailsStep } from "./steps/DetailsStep";
import { ReviewStep } from "./steps/ReviewStep";
import { SettingsStep } from "./steps/SettingsStep";
import { TemplateStep } from "./steps/TemplateStep";
import { StepConfig } from "./types";

/**
 * Main Project Wizard Application Component
 * Refactored to use decoupled architecture with services and custom hooks
 */
export function ProjectWizardApp() {
    // Use the custom hook for all wizard logic
    const {
        currentStep,
        projectData,
        validationErrors,
        directoryValidation,
        isValidatingDirectory,
        isSelectingDirectory,
        isCreatingProject,
        creationError,
        updateProjectName,
        updateAppId,
        updateProjectData,
        handleLocationChange,
        handleLocationBlur,
        handleLocationFocus,
        handleSelectDirectory,
        nextStep,
        prevStep,
        createProject,
        canProceed,
        clearCreationError,
    } = useProjectWizard();

    // Step configuration
    const steps: StepConfig[] = [
        { key: "template", label: "Template", description: "Choose a project template" },
        { key: "details", label: "Details", description: "Project information" },
        { key: "settings", label: "Settings", description: "Project configuration" },
        { key: "review", label: "Review", description: "Review and create" }
    ];

    /**
     * Handle project creation
     */
    const handleCreateProject = async () => {
        const result = await createProject();
        // If successful, closeWith() in projectService will handle window closing
        // If failed, error is already displayed via creationError state
        if (!result.success) {
            console.error("Failed to create project:", result.error);
        }
    };

    /**
     * Handle cancel action
     */
    const handleCancel = () => {
        window.close();
    };

    /**
     * Render the current step content
     */
    const renderStepContent = () => {
        switch (currentStep) {
            case "template":
                return <TemplateStep projectData={projectData} updateProjectData={updateProjectData} />;
            case "details":
                return (
                    <DetailsStep
                        projectData={projectData}
                        updateProjectData={updateProjectData}
                        updateProjectName={updateProjectName}
                        updateAppId={updateAppId}
                    />
                );
            case "settings":
                return (
                    <SettingsStep
                        projectData={projectData}
                        updateProjectData={updateProjectData}
                        validationErrors={validationErrors}
                        directoryValidation={directoryValidation}
                        isValidatingDirectory={isValidatingDirectory}
                        onLocationChange={handleLocationChange}
                        onLocationBlur={handleLocationBlur}
                        onLocationFocus={handleLocationFocus}
                        onSelectDirectory={handleSelectDirectory}
                        isSelectingDirectory={isSelectingDirectory}
                    />
                );
            case "review":
                return <ReviewStep projectData={projectData} />;
            default:
                return null;
        }
    };

    return (
        <AppLayout title="New Project" iconSrc="/favicon.ico">
            <div className="h-full flex flex-col">
                {/* Progress Header */}
                <WizardHeader steps={steps} currentStep={currentStep} />

                {/* Step Content */}
                <div className="flex-1 overflow-y-auto">
                    {renderStepContent()}
                    
                    {/* Error Message */}
                    {creationError && (
                        <div className="p-4 mx-6 mb-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                            <div className="flex items-start gap-3">
                                <div className="text-red-400 mt-0.5 flex-shrink-0">
                                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                    </svg>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-sm font-medium text-red-200">
                                        Failed to Create Project
                                    </h3>
                                    <p className="text-sm text-red-300 mt-1 break-words">
                                        {creationError}
                                    </p>
                                </div>
                                <button
                                    onClick={clearCreationError}
                                    className="text-red-400 hover:text-red-300 flex-shrink-0"
                                    aria-label="Close error"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Navigation Footer */}
                <WizardNavigation
                    currentStep={currentStep}
                    canProceed={canProceed()}
                    isCreatingProject={isCreatingProject}
                    onPrevStep={prevStep}
                    onNextStep={nextStep}
                    onCreateProject={handleCreateProject}
                    onCancel={handleCancel}
                />
            </div>
        </AppLayout>
    );
}

export default ProjectWizardApp;
