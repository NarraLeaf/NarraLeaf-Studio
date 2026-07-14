import { useTranslation } from "@/lib/i18n";
import { Button } from "@/lib/components/elements";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { WizardStep } from "../types";

/**
 * Props for WizardNavigation component
 */
interface WizardNavigationProps {
    currentStep: WizardStep;
    canProceed: boolean;
    isCreatingProject: boolean;
    onPrevStep: () => void;
    onNextStep: () => void;
    onCreateProject: () => void;
    onCancel: () => void;
}

/**
 * Navigation component for the project wizard
 */
export function WizardNavigation({
    currentStep,
    canProceed,
    isCreatingProject,
    onPrevStep,
    onNextStep,
    onCreateProject,
    onCancel
}: WizardNavigationProps) {
    const { t } = useTranslation();
    const isLastStep = currentStep === "review";
    const currentStepIndex = ["template", "details", "settings", "review"].indexOf(currentStep);

    return (
        <div className="flex items-center justify-between p-6 border-t border-edge">
            <Button
                variant="ghost"
                onClick={onPrevStep}
                disabled={currentStepIndex === 0}
            >
                <ChevronLeft className="w-4 h-4 mr-2" />
                {t("common.back")}
            </Button>

            <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={onCancel}>
                    {t("common.cancel")}
                </Button>
                {isLastStep ? (
                    <Button
                        onClick={onCreateProject}
                        disabled={!canProceed || isCreatingProject}
                    >
                        {isCreatingProject ? t("wizard.nav.creating") : t("wizard.nav.createProject")}
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
