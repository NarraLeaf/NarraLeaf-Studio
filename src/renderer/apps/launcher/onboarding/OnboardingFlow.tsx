import { useCallback, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, ProgressCircle } from "@/lib/components/elements";
import { AppLayout } from "@/lib/components/layout";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { APP_DISPLAY_NAME } from "@shared/constants/app";
import type { TranslationKey } from "@shared/i18n";
import { WindowControlPolicy } from "@shared/types/window";
import { OnboardingPreferencesProvider } from "./onboardingPreferences";
import { OnboardingServersProvider } from "./onboardingServers";
import { StudioPreview, type PreviewPanelId } from "./preview/StudioPreview";
import { AppearanceStep } from "./steps/AppearanceStep";
import { DoneStep } from "./steps/DoneStep";
import { IdentityStep } from "./steps/IdentityStep";
import { LanguageStep } from "./steps/LanguageStep";
import { StoryStep } from "./steps/StoryStep";
import { TeamStep } from "./steps/TeamStep";
import { WelcomeStep } from "./steps/WelcomeStep";
import { ZoomStep } from "./steps/ZoomStep";

const STEPS = ["welcome", "language", "appearance", "zoom", "identity", "team", "story", "done"] as const;

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
    welcome: {
        rail: "onboarding.steps.welcome",
        title: "onboarding.welcome.title",
        expectation: "onboarding.welcome.expectation",
        // Nothing on this screen changes a surface, so the sample shows what the screens without
        // one of their own show.
        panel: "dashboard",
    },
    language: {
        rail: "onboarding.steps.language",
        title: "onboarding.language.title",
        expectation: "onboarding.language.expectation",
        panel: "dashboard",
    },
    appearance: {
        rail: "onboarding.steps.appearance",
        title: "onboarding.appearance.title",
        expectation: "onboarding.appearance.expectation",
        panel: "dashboard",
    },
    zoom: {
        rail: "onboarding.steps.zoom",
        title: "onboarding.zoom.title",
        expectation: "onboarding.zoom.expectation",
        panel: "dashboard",
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
        // The page a project opens on: setup ends, a project opens, and this is what is in front
        // of the author next. Showing it is better than describing it.
        panel: "welcome",
    },
};

export interface OnboardingFlowProps {
    /**
     * Leave setup for good - reached by finishing, by skipping and by importing a settings file,
     * which mean the same thing to the marker. See `useOnboardingMode`.
     *
     * Takes nothing, so it can be wired to a click handler directly.
     */
    onFinish: () => void;
}

/**
 * First-run setup: eight screens inside the launcher window - a way in, six questions and a closing
 * screen.
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
 * launch rather than making the app unusable. Skipping leaves setup, though; it is not a way to step
 * over one question, and the rail is a map of what is coming rather than a set of shortcuts into it.
 *
 * **Every screen is built the same way**, including the first: a heading, one line under it, and its
 * own control beside a sample. There is no title card - a splash would be the one screen here that
 * is looked at rather than read, and the screen that opens a six-question flow is the one that can
 * least afford to say nothing.
 *
 * **It degrades to one column.** `ui.zoomPercent` is answered inside this window, and at the top of
 * the range there is no longer room for two panes - so the preview and then the rail withdraw at
 * fixed widths rather than being squeezed into columns too narrow to read.
 */
export function OnboardingFlow({ onFinish }: OnboardingFlowProps) {
    const { t } = useTranslation();
    const [index, setIndex] = useState(0);
    /**
     * Which surface the pane shows while the zoom screen is up.
     *
     * Only that screen offers the choice, and it is held here rather than inside the step because
     * the pane is the shell's. Every other screen shows what its own entry in {@link SCREENS} says.
     */
    const [zoomSurface, setZoomSurface] = useState<PreviewPanelId>("dashboard");

    const step = STEPS[index];
    const screen = SCREENS[step];
    const panel = step === "zoom" ? zoomSurface : screen.panel;
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
                            {/* What setup will ask, in the order it asks - a map, not a control.
                                The entries are not buttons: jumping ahead from here would land on a
                                screen without the Back button having anything to go back to, and it
                                would let the run be walked out of order for no gain, since every
                                screen is one question and none of them takes long. Forward is the
                                footer's job, on the one screen that is in front of the reader. */}
                            <div
                                aria-label={t("onboarding.windowTitle", { name: APP_DISPLAY_NAME })}
                                className="hidden w-32 shrink-0 flex-col border-r border-edge py-4 min-[600px]:flex"
                            >
                                <ol className="min-h-0 flex-1">
                                    {STEPS.map((entry, entryIndex) => {
                                        const done = entryIndex < index;
                                        const active = entryIndex === index;
                                        return (
                                            <li
                                                key={entry}
                                                aria-current={active ? "step" : undefined}
                                                className={cn(
                                                    "flex items-center gap-1.5 border-l-2 py-1.5 pl-3 pr-2 text-xs",
                                                    active ? "border-primary text-fg" : "border-transparent",
                                                    !active && (done ? "text-fg-muted" : "text-fg-subtle"),
                                                )}
                                            >
                                                {done ? <Check className="h-3 w-3 shrink-0" /> : null}
                                                <span className="truncate">{t(SCREENS[entry].rail)}</span>
                                            </li>
                                        );
                                    })}
                                </ol>

                                {/* How far in, under the list it is measuring - the ring says it at
                                    a glance, the count exactly. It sat above each screen's heading
                                    until it was pointed out that the thing it counts is right here:
                                    beside the list of steps it reads as a position in that list,
                                    while above the heading it read as a label on the question. */}
                                <div className="mt-4 flex items-center gap-1.5 border-l-2 border-transparent pl-3 pr-2">
                                    {/* Sized and spaced as the ticks above it, and sitting in their
                                        column: it is one more mark against one more line of the
                                        list, so anything larger would read as a heading over the
                                        list rather than the last entry of it. */}
                                    <ProgressCircle
                                        value={index + 1}
                                        max={STEPS.length}
                                        size={12}
                                        strokeWidth={2}
                                        className="shrink-0"
                                    />
                                    <span className="truncate text-xs tabular-nums text-fg-subtle">
                                        {t("onboarding.progress", { current: index + 1, total: STEPS.length })}
                                    </span>
                                </div>
                            </div>

                            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-7 py-6">
                                <h1 className="text-2xl font-semibold text-fg">{t(screen.title)}</h1>
                                <p className="mt-1.5 text-sm text-fg-muted">{t(screen.expectation)}</p>
                                <div className="mt-6">
                                    {step === "welcome" && <WelcomeStep onImported={() => onFinish()} />}
                                    {step === "language" && <LanguageStep />}
                                    {step === "appearance" && <AppearanceStep />}
                                    {step === "zoom" && <ZoomStep surface={zoomSurface} onSurfaceChange={setZoomSurface} />}
                                    {step === "identity" && <IdentityStep />}
                                    {step === "team" && <TeamStep />}
                                    {step === "story" && <StoryStep />}
                                    {step === "done" && <DoneStep />}
                                </div>
                            </div>

                            {/* A whole Studio window, of which this screen has room for the left
                                half.

                                Not a small window: one at a real width, laid against the right
                                edge and cut off by it. 960 is the narrow end of what Studio is
                                worked in, and it is chosen for what it does to the surfaces behind
                                the crop: the dashboard and the welcome page both centre a column of
                                fixed width, so on a wider window the only thing in the visible half
                                would be that column's margin. The difference is the whole point - a miniature
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
                                    <div className="absolute inset-y-0 left-0 flex w-[960px]">
                                        <StudioPreview panel={panel} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* The two ways through the run together on the right, in the order they
                            move: back, then on. The way OUT of it is the far left, as far from the
                            pair as the footer goes - it is not a third step of the same walk, and a
                            button that ends setup should not be a slip of the wrist away from the
                            button that advances it. */}
                        <div className="flex items-center justify-between gap-2 border-t border-edge px-6 py-4">
                            <div className="flex min-w-0 items-center gap-2">
                                {/* Absent on the last screen, where the only thing left to do is
                                    leave and the primary button already does it. */}
                                {!isLast && (
                                    <Button variant="ghost" onClick={() => onFinish()}>
                                        {t("onboarding.nav.skip")}
                                    </Button>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                {/* Present but dead on the cover rather than absent: the pair is
                                    the same two buttons in the same two places on every screen, and
                                    a Back that appears on the second screen moves Continue. */}
                                <Button variant="ghost" onClick={back} disabled={index === 0}>
                                    <ChevronLeft className="h-4 w-4" />
                                    {t("common.back")}
                                </Button>
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
