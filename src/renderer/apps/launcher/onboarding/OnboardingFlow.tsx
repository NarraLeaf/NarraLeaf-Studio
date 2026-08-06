import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/lib/components/elements";
import { AppLayout } from "@/lib/components/layout";
import { useTranslation } from "@/lib/i18n";
import { APP_DISPLAY_NAME } from "@shared/constants/app";
import type { TranslationKey } from "@shared/i18n";
import { WindowControlPolicy } from "@shared/types/window";
import { AppearanceStep } from "./steps/AppearanceStep";
import { LanguageStep } from "./steps/LanguageStep";

const STEPS = ["language", "appearance", "done"] as const;

type OnboardingStep = (typeof STEPS)[number];

/**
 * The title and the one line under it, owned by the shell rather than by each screen.
 *
 * Structural, not tidiness: a screen that cannot render its own prose cannot grow a second
 * paragraph, and "one line beside the control" is the rule this flow has to hold to (see
 * docs/help-system.md §1 - anything longer is a help topic wearing a screen's clothes).
 */
const SCREEN_TEXT: Record<OnboardingStep, { title: TranslationKey; expectation: TranslationKey }> = {
    language: {
        title: "onboarding.language.title",
        expectation: "onboarding.language.expectation",
    },
    appearance: {
        title: "onboarding.appearance.title",
        expectation: "onboarding.appearance.expectation",
    },
    done: {
        title: "onboarding.done.title",
        expectation: "onboarding.done.expectation",
    },
};

export interface OnboardingFlowProps {
    /**
     * Leave setup for good - reached by finishing and by skipping, which mean the same thing to
     * the marker. See `useOnboardingMode`.
     */
    onFinish: () => void;
}

/**
 * First-run setup: two questions and a closing screen, inside the launcher window.
 *
 * Everything it sets applies the moment it is picked, so there is no commit step and Continue is
 * only ever navigation. That is also why the flow has no progress indicator: with two screens
 * that ask anything, a row of dots would be decoration on a journey nobody is worried about
 * finishing.
 *
 * Deliberately not a gate. Skipping is on every screen that asks something, and the last screen's
 * button is the same exit - so a screen that somehow fails to render costs one press per launch
 * rather than making the app unusable.
 */
export function OnboardingFlow({ onFinish }: OnboardingFlowProps) {
    const { t } = useTranslation();
    const [index, setIndex] = useState(0);

    const step = STEPS[index];
    const isLast = index === STEPS.length - 1;

    const back = useCallback(() => setIndex(current => Math.max(0, current - 1)), []);
    const next = useCallback(() => setIndex(current => Math.min(STEPS.length - 1, current + 1)), []);

    return (
        <AppLayout
            title={t("onboarding.windowTitle", { name: APP_DISPLAY_NAME })}
            iconSrc=""
            windowControlPolicy={WindowControlPolicy.Standard}
        >
            <div className="flex h-full min-h-0 flex-col">
                <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-10 py-8">
                    <div className="w-full max-w-md">
                        <h1 className="text-base font-medium text-fg">{t(SCREEN_TEXT[step].title)}</h1>
                        <p className="mt-1 text-sm text-fg-muted">{t(SCREEN_TEXT[step].expectation)}</p>
                        <div className="mt-6 empty:mt-0">
                            {step === "language" && <LanguageStep />}
                            {step === "appearance" && <AppearanceStep />}
                        </div>
                    </div>
                </div>

                {/* Back on the left, the way onward on the right - the shape the project wizard's
                    footer already has, so the two flows in this product do not disagree about
                    where a Back button lives. */}
                <div className="flex items-center justify-between border-t border-edge px-6 py-4">
                    <Button variant="ghost" onClick={back} disabled={index === 0}>
                        <ChevronLeft className="h-4 w-4" />
                        {t("common.back")}
                    </Button>

                    <div className="flex items-center gap-2">
                        {!isLast && (
                            <Button variant="ghost" onClick={onFinish}>
                                {t("onboarding.nav.skip")}
                            </Button>
                        )}
                        {isLast ? (
                            <Button variant="primary" onClick={onFinish}>
                                {t("onboarding.nav.finish")}
                            </Button>
                        ) : (
                            <Button variant="primary" onClick={next}>
                                {t("common.next")}
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
