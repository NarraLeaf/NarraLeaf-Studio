import { useTranslation } from "@/lib/i18n";
import { AppLayout } from "@/lib/components/layout";
import { WizardHeader, WizardNavigation } from "./components";
import { useProjectWizard } from "./hooks/useProjectWizard";
import { CloneStep } from "./steps/CloneStep";
import { DetailsStep } from "./steps/DetailsStep";
import { ReviewStep } from "./steps/ReviewStep";
import { SettingsStep } from "./steps/SettingsStep";
import { SourceStep } from "./steps/SourceStep";
import { TemplateStep } from "./steps/TemplateStep";
import { StepConfig, WizardStep } from "./types";
import type { TranslationKey } from "@shared/i18n";

/**
 * The label and one-line description each page carries in the header, keyed by page.
 *
 * Every page in every flow is described here rather than per flow: a page belongs to whichever
 * flows list it, and describing it twice is how the same step ends up named two things.
 */
const STEP_LABEL_KEYS: Record<WizardStep, { label: TranslationKey; description: TranslationKey }> = {
    template: { label: "wizard.steps.template.label", description: "wizard.steps.template.description" },
    details: { label: "wizard.steps.details.label", description: "wizard.steps.details.description" },
    settings: { label: "wizard.steps.settings.label", description: "wizard.steps.settings.description" },
    review: { label: "wizard.steps.review.label", description: "wizard.steps.review.description" },
    source: { label: "wizard.steps.source.label", description: "wizard.steps.source.description" },
    clone: { label: "wizard.steps.clone.label", description: "wizard.steps.clone.description" },
};

/**
 * Main Project Wizard Application Component
 * Refactored to use decoupled architecture with services and custom hooks
 */
export function ProjectWizardApp() {
    const { t } = useTranslation();

    // Use the custom hook for all wizard logic
    const {
        currentStep,
        steps: stepKeys,
        flow,
        remote,
        projectData,
        validationErrors,
        directoryValidation,
        isValidatingDirectory,
        isSelectingDirectory,
        isCreatingProject,
        creationError,
        cloneStatus,
        cloneFailure,
        updateProjectName,
        updateAppId,
        updateProjectData,
        updateRemoteUrl,
        handleLocationChange,
        handleLocationBlur,
        handleLocationFocus,
        handleSelectDirectory,
        cloneProject,
        nextStep,
        prevStep,
        createProject,
        canProceed,
        clearCreationError,
    } = useProjectWizard();

    // Step configuration - which pages exist depends on the flow the first page started.
    const steps: StepConfig[] = stepKeys.map(key => ({
        key,
        label: t(STEP_LABEL_KEYS[key].label),
        description: t(STEP_LABEL_KEYS[key].description),
    }));

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
     * The last page's action, whichever flow it belongs to.
     *
     * A clone reports into `CloneStep` rather than into the shared error panel below: its two
     * failures need the destination path alongside them, and that is the page that has it.
     */
    const handleFinish = () => {
        if (flow === "clone") {
            void cloneProject();
            return;
        }
        void handleCreateProject();
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
            case "source":
                return (
                    <SourceStep
                        projectData={projectData}
                        remote={remote}
                        updateRemoteUrl={updateRemoteUrl}
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
            case "clone":
                return (
                    <CloneStep
                        projectData={projectData}
                        remote={remote}
                        cloneStatus={cloneStatus}
                        cloneFailure={cloneFailure}
                    />
                );
            default:
                return null;
        }
    };

    return (
        <AppLayout title={t("wizard.appTitle")} iconSrc="/favicon.ico">
            <div className="h-full flex flex-col">
                {/* Progress Header */}
                <WizardHeader steps={steps} currentStep={currentStep} />

                {/* Step Content */}
                <div className="flex-1 overflow-y-auto">
                    {renderStepContent()}
                    
                    {/* Error Message */}
                    {creationError && (
                        <div className="p-4 mx-6 mb-4 bg-danger/10 border border-danger/20 rounded-lg">
                            <div className="flex items-start gap-3">
                                <div className="text-danger mt-0.5 flex-shrink-0">
                                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                    </svg>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-sm font-medium text-danger">
                                        {t("wizard.error.createFailedTitle")}
                                    </h3>
                                    <p className="text-sm text-danger mt-1 break-words">
                                        {creationError}
                                    </p>
                                </div>
                                <button
                                    onClick={clearCreationError}
                                    className="text-danger/70 hover:text-danger flex-shrink-0"
                                    aria-label={t("wizard.error.closeError")}
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
                    steps={steps}
                    currentStep={currentStep}
                    flow={flow}
                    canProceed={canProceed()}
                    isBusy={isCreatingProject || cloneStatus !== "idle"}
                    onPrevStep={prevStep}
                    onNextStep={nextStep}
                    onFinish={handleFinish}
                    onCancel={handleCancel}
                />
            </div>
        </AppLayout>
    );
}

export default ProjectWizardApp;
