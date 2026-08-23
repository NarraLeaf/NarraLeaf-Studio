import { useCallback, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, ProgressCircle } from "@/lib/components/elements";
import { AppLayout } from "@/lib/components/layout";
import type { HelpTopicId } from "@/lib/help";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { APP_DISPLAY_NAME } from "@shared/constants/app";
import type { TranslationKey } from "@shared/i18n";
import { WindowControlPolicy } from "@shared/types/window";
import { ImportSettingsAction } from "./ImportSettingsAction";
import { OnboardingPreferencesProvider } from "./onboardingPreferences";
import { OnboardingServersProvider } from "./onboardingServers";
import { StudioPreview, type PreviewPanelId } from "./preview/StudioPreview";
import { AppearanceStep } from "./steps/AppearanceStep";
import { DoneStep } from "./steps/DoneStep";
import { IdentityStep } from "./steps/IdentityStep";
import { LanguageStep } from "./steps/LanguageStep";
import { StoryStep } from "./steps/StoryStep";
import { TeamStep } from "./steps/TeamStep";
import { ZoomStep } from "./steps/ZoomStep";

const STEPS = ["language", "appearance", "zoom", "identity", "team", "story", "done"] as const;

type OnboardingStep = (typeof STEPS)[number];

/**
 * What each screen is called, what it asks, and which panel of the sample it is about.
 *
 * Owned by the shell rather than by each screen. Structural, not tidiness: a screen that cannot
 * render its own prose cannot grow a second paragraph, and "one line beside the control" is the rule
 * this flow has to hold to (see docs/help-system.md §1 - anything longer is a help topic wearing a
 * screen's clothes).
 */
const SCREENS: Record<OnboardingStep, {
    rail: TranslationKey;
    title: TranslationKey;
    expectation: TranslationKey;
    panel: PreviewPanelId;
}> = {
    language: {
        rail: "onboarding.steps.language",
        title: "onboarding.language.title",
        expectation: "onboarding.language.expectation",
        panel: "story",
    },
    appearance: {
        rail: "onboarding.steps.appearance",
        title: "onboarding.appearance.title",
        expectation: "onboarding.appearance.expectation",
        panel: "story",
    },
    zoom: {
        rail: "onboarding.steps.zoom",
        title: "onboarding.zoom.title",
        expectation: "onboarding.zoom.expectation",
        panel: "story",
    },
    identity: {
        rail: "onboarding.steps.identity",
        title: "onboarding.identity.title",
        expectation: "onboarding.identity.expectation",
        panel: "versions",
    },
    team: {
        rail: "onboarding.steps.team",
        title: "onboarding.team.title",
        expectation: "onboarding.team.expectation",
        panel: "team",
    },
    story: {
        rail: "onboarding.steps.story",
        title: "onboarding.story.title",
        expectation: "onboarding.story.expectation",
        panel: "story",
    },
    done: {
        rail: "onboarding.steps.done",
        title: "onboarding.done.title",
        expectation: "onboarding.done.expectation",
        panel: "story",
    },
};

export interface OnboardingFlowProps {
    /**
     * Leave setup for good - reached by finishing and by skipping, which mean the same thing to the
     * marker. See `useOnboardingMode`.
     *
     * The optional topic is the last screen's three links: leaving is leaving either way, and the
     * topic only says where to put the author down. Every call site that is a plain exit passes
     * nothing, so a click handler must never be wired to this directly - a `MouseEvent` would arrive
     * as the topic.
     */
    onFinish: (topic?: HelpTopicId) => void;
}

/**
 * First-run setup: six questions and a closing screen, inside the launcher window.
 *
 * **The question on the left, what it does on the right.** Everything setup sets applies the moment
 * it is picked - there is no commit step and Continue is only ever navigation - so the pane beside
 * the controls can be the thing itself rather than a picture of it: a small, live, clickable Studio
 * that re-localizes, re-themes, re-types and re-signs as the answers arrive. Two of the answers
 * (theme and zoom) reach it without anybody passing them anywhere, because the main process applies
 * them to this very window.
 *
 * **Deliberately not a gate.** Skipping is on every screen that asks something, and the last
 * screen's button is the same exit - so a screen that somehow fails to render costs one press per
 * launch rather than making the app unusable. Nothing here gates anything either, which is why the
 * rail can be clicked (the project wizard's cannot: its pages genuinely depend on each other).
 *
 * **It degrades to one column.** `ui.zoomPercent` is answered inside this window, and at the top of
 * the range there is no longer room for two panes - so the preview and then the rail withdraw at
 * fixed widths rather than being squeezed into columns too narrow to read.
 */
export function OnboardingFlow({ onFinish }: OnboardingFlowProps) {
    const { t } = useTranslation();
    const [index, setIndex] = useState(0);

    const step = STEPS[index];
    const screen = SCREENS[step];
    const isLast = index === STEPS.length - 1;

    const back = useCallback(() => setIndex(current => Math.max(0, current - 1)), []);
    const next = useCallback(() => setIndex(current => Math.min(STEPS.length - 1, current + 1)), []);

    return (
        <AppLayout
            title={t("onboarding.windowTitle", { name: APP_DISPLAY_NAME })}
            iconSrc=""
            windowControlPolicy={WindowControlPolicy.Standard}
        >
            <OnboardingPreferencesProvider>
                <OnboardingServersProvider>
                    <div className="flex h-full min-h-0 flex-col">
                        <div className="flex min-h-0 flex-1">
                            <nav
                                aria-label={t("onboarding.windowTitle", { name: APP_DISPLAY_NAME })}
                                className="hidden w-32 shrink-0 flex-col border-r border-edge py-4 min-[600px]:flex"
                            >
                                {STEPS.map((entry, entryIndex) => {
                                    const done = entryIndex < index;
                                    const active = entryIndex === index;
                                    return (
                                        <button
                                            key={entry}
                                            type="button"
                                            aria-current={active ? "step" : undefined}
                                            onClick={() => setIndex(entryIndex)}
                                            className={cn(
                                                "nl-focus-ring flex items-center gap-1.5 border-l-2 py-1.5 pl-3 pr-2 text-left text-xs transition-colors duration-150",
                                                active ? "border-primary text-fg" : "border-transparent hover:bg-fill",
                                                !active && (done ? "text-fg-muted" : "text-fg-subtle"),
                                            )}
                                        >
                                            {done ? <Check className="h-3 w-3 shrink-0" /> : null}
                                            <span className="truncate">{t(SCREENS[entry].rail)}</span>
                                        </button>
                                    );
                                })}
                            </nav>

                            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-7 py-6">
                                {/* How far in, above every screen's heading. It replaced the
                                    product's own mark and the line beside it: this is the first
                                    window anyone sees, the title bar already names the product, and
                                    what a seven-screen flow owes the reader is how much of it is
                                    left. The ring says it at a glance, the count exactly. */}
                                <div className="flex items-center gap-2">
                                    <ProgressCircle value={index + 1} max={STEPS.length} size={20} strokeWidth={2.5} />
                                    <span className="truncate text-xs tabular-nums text-fg-subtle">
                                        {t("onboarding.progress", { current: index + 1, total: STEPS.length })}
                                    </span>
                                </div>
                                <h1 className="mt-5 text-2xl font-semibold text-fg">{t(screen.title)}</h1>
                                <p className="mt-1.5 text-sm text-fg-muted">{t(screen.expectation)}</p>
                                <div className="mt-6">
                                    {step === "language" && <LanguageStep />}
                                    {step === "appearance" && <AppearanceStep />}
                                    {step === "zoom" && <ZoomStep />}
                                    {step === "identity" && <IdentityStep />}
                                    {step === "team" && <TeamStep />}
                                    {step === "story" && <StoryStep />}
                                    {step === "done" && <DoneStep onOpenTopic={onFinish} />}
                                </div>
                            </div>

                            {/* A whole Studio window, of which this screen has room for the left
                                quarter.

                                Not a small window: a full-sized one, laid against the right edge
                                and cut off by it. The difference is the whole point - a miniature
                                is a picture of the product, while a window running off the edge is
                                the product, seen from where the author is standing. It costs the
                                far side of every row (a line of dialogue ends off-screen, as it
                                does on a narrow editor), and buys back the two things a miniature
                                cannot have: type at its real size, and a layout at its real
                                proportions.

                                No frame of its own either - no divider, no plate, no "Preview"
                                eyebrow. The only lines drawn here are the window's own edges, and
                                the right one is missing because it is past the crop. */}
                            {/* `overflow-clip`, not `overflow-hidden`: a hidden box is still a scroll container, and
                                the browser scrolls one to reveal a focused element - so putting the
                                caret in the sample's insert slot slid the whole window sideways and
                                took the rail off the screen. A clipped box has nothing to scroll. */}
                            <div className="hidden w-[420px] shrink-0 overflow-clip py-6 min-[780px]:flex">
                                <div className="relative min-h-0 flex-1">
                                    <div className="absolute inset-y-0 left-0 flex w-[1680px]">
                                        <StudioPreview panel={screen.panel} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Back on the left, the way onward on the right - the shape the project
                            wizard's footer already has, so the two flows in this product do not
                            disagree about where a Back button lives. */}
                        <div className="flex items-center justify-between gap-2 border-t border-edge px-6 py-4">
                            <div className="flex min-w-0 items-center gap-2">
                                <Button variant="ghost" onClick={back} disabled={index === 0}>
                                    <ChevronLeft className="h-4 w-4" />
                                    {t("common.back")}
                                </Button>
                                {/* Beside Back rather than beside Next: it is a way out of the
                                    questions, not the way through them. Absent on the last screen,
                                    where the only thing left to do is leave. */}
                                {!isLast && <ImportSettingsAction onImported={() => onFinish()} />}
                            </div>

                            <div className="flex items-center gap-2">
                                {!isLast && (
                                    <Button variant="ghost" onClick={() => onFinish()}>
                                        {t("onboarding.nav.skip")}
                                    </Button>
                                )}
                                {isLast ? (
                                    <Button variant="primary" onClick={() => onFinish()}>
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
                </OnboardingServersProvider>
            </OnboardingPreferencesProvider>
        </AppLayout>
    );
}
