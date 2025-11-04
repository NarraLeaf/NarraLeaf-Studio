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
        if (result.success) {
            window.close();
        } else {
            console.error("Failed to create project:", result.error);
            // TODO: Show error to user
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
