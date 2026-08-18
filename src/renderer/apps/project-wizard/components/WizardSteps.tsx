import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { StepConfig, WizardStep } from "../types";

interface WizardStepsProps {
  steps: StepConfig[];
  currentStep: WizardStep;
}

/**
 * Where the author is, said once.
 *
 * This replaced a header that said it three times over - a percentage bar, a row of numbered dots
 * joined by rules, and "Step 2 of 4" - stacked above every page and costing a fifth of a window
 * that cannot be resized. A vertical rail says the same thing in the margin, and it says the part
 * the bar could not: what the remaining pages are called.
 *
 * Not clickable. The pages gate each other (there is no location to validate before there is an
 * app id to derive one from), so a rail that looked navigable would be a row of dead targets.
 */
export function WizardSteps({ steps, currentStep }: WizardStepsProps) {
  const currentIndex = steps.findIndex((step) => step.key === currentStep);

  return (
    <nav className="w-36 shrink-0 border-r border-edge py-3">
      {steps.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <div
            key={step.key}
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex items-center gap-1.5 border-l-2 py-1.5 pl-3 pr-2 text-xs",
              active ? "border-primary text-fg" : "border-transparent",
              !active && (done ? "text-fg-muted" : "text-fg-subtle")
            )}
          >
            {done ? <Check className="h-3 w-3 shrink-0" /> : null}
            <span className="truncate">{step.label}</span>
          </div>
        );
      })}
    </nav>
  );
}
