import { Progress } from "@/lib/components/elements";
import { CheckCircle } from "lucide-react";
import { StepConfig, WizardStep } from "../types";

/**
 * Props for WizardHeader component
 */
interface WizardHeaderProps {
    steps: StepConfig[];
    currentStep: WizardStep;
}

/**
 * Header component for the project wizard showing progress and step navigation
 */
export function WizardHeader({ steps, currentStep }: WizardHeaderProps) {
    const currentStepIndex = steps.findIndex(step => step.key === currentStep);
    const progress = ((currentStepIndex + 1) / steps.length) * 100;

    return (
        <div className="p-6 border-b border-edge">
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h1 className="text-xl font-semibold text-fg">Create New Project</h1>
                    <span className="text-sm text-fg-muted">
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
                                        ? "text-primary"
                                        : "text-fg-subtle"
                                    }
                                `}>
                                    {index < currentStepIndex ? (
                                        <CheckCircle className="w-4 h-4" />
                                    ) : (
                                        <div className={`
                                            w-4 h-4 rounded-full border-2
                                            ${index === currentStepIndex
                                                ? "border-primary bg-primary/20"
                                                : "border-gray-500"
                                            }
                                        `}>
                                            {index === currentStepIndex && (
                                                <div className="w-full h-full rounded-full bg-primary scale-50" />
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
                                            ? "bg-primary"
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
    );
}
