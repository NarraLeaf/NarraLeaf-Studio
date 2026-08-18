import { useMemo } from "react";
import { AlertCircle, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { AppLayout } from "@/lib/components/layout";
import { IconButton } from "@/lib/components/elements";
import { WizardNavigation, WizardSteps } from "./components";
import { useProjectWizard } from "./hooks/useProjectWizard";
import { useProjectTemplates } from "./bundledProjectTemplates";
import { CloneStep } from "./steps/CloneStep";
import { ImportStep } from "./steps/ImportStep";
import { OriginStep } from "./steps/OriginStep";
import { ProjectStep } from "./steps/ProjectStep";
import { ReviewStep } from "./steps/ReviewStep";
import { SourceStep } from "./steps/SourceStep";
import { StageStep } from "./steps/StageStep";
import { StepConfig, WizardStep } from "./types";
import type { TranslationKey } from "@shared/i18n";

/**
 * The rail label each page carries, keyed by page.
 *
 * Every page of every flow is named here rather than per flow: a page belongs to whichever flows
 * list it, and naming it twice is how the same step ends up called two things.
 */
const STEP_LABEL_KEYS: Record<WizardStep, TranslationKey> = {
  origin: "wizard.steps.origin",
  project: "wizard.steps.project",
  stage: "wizard.steps.stage",
  review: "wizard.steps.review",
  source: "wizard.steps.source",
  clone: "wizard.steps.clone",
  import: "wizard.steps.import"
};

/**
 * Main Project Wizard Application Component
 */
export function ProjectWizardApp() {
  const { t } = useTranslation();
  const templates = useProjectTemplates();

  const {
    currentStep,
    steps: stepKeys,
    flow,
    setFlow,
    remote,
    projectData,
    validationErrors,
    directoryValidation,
    isValidatingDirectory,
    isSelectingDirectory,
    isSelectingPackage,
    isCreatingProject,
    creationError,
    cloneStatus,
    cloneFailure,
    importStatus,
    importFailure,
    updateProjectName,
    updateAppId,
    updateProjectData,
    updateRemoteUrl,
    handleLocationChange,
    handleLocationBlur,
    handleLocationFocus,
    handleSelectDirectory,
    cloneProject,
    importProject,
    selectPackage,
    nextStep,
    prevStep,
    createProject,
    canProceed,
    clearCreationError
  } = useProjectWizard();

  const steps: StepConfig[] = stepKeys.map((key) => ({ key, label: t(STEP_LABEL_KEYS[key]) }));

  /**
   * The template the author picked, once the list has arrived.
   *
   * Resolved here rather than in each page because two of them need it for different reasons -
   * the stage page needs the sizes it allows, the review page needs its name - and a second
   * lookup is a second chance to disagree about what "picked" means.
   */
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === projectData.template) ?? null,
    [templates, projectData.template]
  );

  const handleCreateProject = async () => {
    const result = await createProject();
    // On success `closeWith()` in projectService closes the window; on failure the message is
    // already on screen through `creationError`.
    if (!result.success) {
      console.error("Failed to create project:", result.error);
    }
  };

  /**
   * The last page's action, whichever flow it belongs to.
   *
   * Clone and import report into their own pages rather than into the shared error panel below:
   * both have a "this is not a Studio project" failure that needs the destination path beside
   * it, and those are the pages that have it.
   */
  const handleFinish = () => {
    if (flow === "clone") {
      void cloneProject();
      return;
    }
    if (flow === "import") {
      void importProject();
      return;
    }
    void handleCreateProject();
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case "origin":
        return (
          <OriginStep
            projectData={projectData}
            updateProjectData={updateProjectData}
            flow={flow}
            onFlowChange={setFlow}
            templates={templates}
          />
        );
      case "project":
        return (
          <ProjectStep
            projectData={projectData}
            updateProjectData={updateProjectData}
            updateProjectName={updateProjectName}
            updateAppId={updateAppId}
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
      case "stage":
        return (
          <StageStep
            projectData={projectData}
            updateProjectData={updateProjectData}
            templateStageSizes={selectedTemplate?.stageSizes ?? []}
          />
        );
      case "review":
        return <ReviewStep projectData={projectData} template={selectedTemplate} />;
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
      case "import":
        return (
          <ImportStep
            projectData={projectData}
            importStatus={importStatus}
            importFailure={importFailure}
            validationErrors={validationErrors}
            directoryValidation={directoryValidation}
            isValidatingDirectory={isValidatingDirectory}
            onSelectPackage={selectPackage}
            isSelectingPackage={isSelectingPackage}
            onSelectDirectory={handleSelectDirectory}
            isSelectingDirectory={isSelectingDirectory}
          />
        );
      default:
        return null;
    }
  };

  return (
    <AppLayout title={t("wizard.appTitle")} iconSrc="/favicon.ico">
      <div className="flex h-full flex-col">
        <div className="flex min-h-0 flex-1">
          <WizardSteps steps={steps} currentStep={currentStep} />
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">{renderStepContent()}</div>

            {creationError && (
              <div className="mx-5 mb-3 flex items-start gap-2 rounded-md border border-danger/20 bg-danger/10 p-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                <p className="min-w-0 flex-1 break-words text-xs text-danger">{creationError}</p>
                <IconButton
                  size="sm"
                  variant="ghost"
                  onClick={clearCreationError}
                  aria-label={t("wizard.error.closeError")}
                >
                  <X className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            )}
          </div>
        </div>

        <WizardNavigation
          steps={steps}
          currentStep={currentStep}
          flow={flow}
          canProceed={canProceed()}
          isBusy={isCreatingProject || cloneStatus !== "idle" || importStatus !== "idle"}
          onPrevStep={prevStep}
          onNextStep={nextStep}
          onFinish={handleFinish}
          onCancel={() => window.close()}
        />
      </div>
    </AppLayout>
  );
}

export default ProjectWizardApp;
