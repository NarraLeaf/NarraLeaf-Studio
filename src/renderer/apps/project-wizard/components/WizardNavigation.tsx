import { useTranslation } from "@/lib/i18n";
import { Button } from "@/lib/components/elements";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ProjectFlow, StepConfig, WizardStep } from "../types";

/**
 * Props for WizardNavigation component
 */
interface WizardNavigationProps {
    /** The pages of the flow the author is in, in order. */
    steps: StepConfig[];
    currentStep: WizardStep;
    flow: ProjectFlow;
    canProceed: boolean;
    /** A project is being written or copied down. Nothing may move while it is. */
    isBusy: boolean;
    onPrevStep: () => void;
    onNextStep: () => void;
    /** The last page's action: create the project, or fetch it from its server. */
    onFinish: () => void;
    onCancel: () => void;
}

/**
 * Navigation component for the project wizard
 *
 * The page list is passed in rather than known here, because the two flows have different ones -
 * a hard-coded array would put the primary button on the wrong page of the clone flow, which is
 * the page that starts a network transfer.
 */
export function WizardNavigation({
    steps,
    currentStep,
    flow,
    canProceed,
    isBusy,
    onPrevStep,
    onNextStep,
    onFinish,
    onCancel
}: WizardNavigationProps) {
    const { t } = useTranslation();
    const currentStepIndex = steps.findIndex(step => step.key === currentStep);
    const isLastStep = currentStepIndex === steps.length - 1;

    // Each flow's last page does a different thing, and the button is the only place that says
    // which - "Create Project" over a page that is about to open a file dialog would be a lie.
    const finishLabels: Record<ProjectFlow, { idle: string; busy: string }> = {
        create: { idle: t("wizard.nav.createProject"), busy: t("wizard.nav.creating") },
        import: { idle: t("wizard.nav.importProject"), busy: t("wizard.nav.importing") },
        clone: { idle: t("wizard.nav.cloneProject"), busy: t("wizard.nav.cloning") },
    };
    const finishLabel = isBusy ? finishLabels[flow].busy : finishLabels[flow].idle;

    return (
        <div className="flex items-center justify-between p-6 border-t border-edge">
            {/* Locked while a project is being written or copied down: both leave a folder
                half-populated if abandoned, and the clone has a server on the other end. */}
            <Button
                variant="ghost"
                onClick={onPrevStep}
                disabled={currentStepIndex <= 0 || isBusy}
            >
                <ChevronLeft className="w-4 h-4 mr-2" />
                {t("common.back")}
            </Button>

            <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={onCancel} disabled={isBusy}>
                    {t("common.cancel")}
                </Button>
                {isLastStep ? (
                    <Button
                        onClick={onFinish}
                        disabled={!canProceed || isBusy}
                    >
                        {finishLabel}
                    </Button>
                ) : (
                    <Button
                        onClick={onNextStep}
                        disabled={!canProceed}
                    >
                        {t("common.next")}
                        <ChevronRight className="w-4 h-4 ml-2" />
                    </Button>
                )}
            </div>
        </div>
    );
}
