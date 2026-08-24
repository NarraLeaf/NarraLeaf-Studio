import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, ConfirmModal, ProgressCircle } from "@/lib/components/elements";
import { AppLayout } from "@/lib/components/layout";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { APP_DISPLAY_NAME } from "@shared/constants/app";
import type { TranslationKey } from "@shared/i18n";
import { WindowControlPolicy } from "@shared/types/window";
import { OnboardingPreferencesProvider } from "./onboardingPreferences";
import { OnboardingServersProvider } from "./onboardingServers";
import { StudioPreview, type PreviewSurfaceId } from "./preview/StudioPreview";
import { AppearanceStep } from "./steps/AppearanceStep";
import { DoneStep } from "./steps/DoneStep";
import { IdentityStep } from "./steps/IdentityStep";
import { LanguageStep } from "./steps/LanguageStep";
import { StoryStep } from "./steps/StoryStep";
import { TeamStep } from "./steps/TeamStep";
import { WelcomeStep } from "./steps/WelcomeStep";
import { ZoomStep } from "./steps/ZoomStep";

const STEPS = ["welcome", "language", "appearance", "zoom", "identity", "team", "story", "done"] as const;

/**
 * What the count counts: screens behind you, not the screen you are on.
 *
 * The welcome screen is the way in rather than a question, so it reads 0 - nothing has been
 * answered yet, and a run that says "1 of 8" before asking anything overstates itself. The last
 * screen reads 7 of 7, which is the one place a progress count should be full.
 */
const PROGRESS_TOTAL = STEPS.length - 1;

/**
 * How far a screen travels as it arrives and leaves, and how long it takes.
 *
 * Short and small on purpose: the two screens are the same shape in the same place, and what the
 * movement has to say is only which direction the run went. Anything longer puts a wait between a
 * press and the question it opens. Under `ui.reduceMotion` the window's own `MotionConfig` drops it
 * (see `renderApp`).
 */
const SCREEN_SHIFT_PX = 16;
const SCREEN_DURATION_S = 0.18;

type OnboardingStep = (typeof STEPS)[number];

/**
 * What each screen is called, what it asks, and which surface of the sample it is about.
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
    surface: PreviewSurfaceId;
}> = {
    welcome: {
        rail: "onboarding.steps.welcome",
        title: "onboarding.welcome.title",
        expectation: "onboarding.welcome.expectation",
        // Nothing on this screen changes a surface, so the sample shows what the screens without
        // one of their own show.
        surface: "dashboard",
    },
    language: {
        rail: "onboarding.steps.language",
        title: "onboarding.language.title",
        expectation: "onboarding.language.expectation",
        surface: "dashboard",
    },
    appearance: {
        rail: "onboarding.steps.appearance",
        title: "onboarding.appearance.title",
        expectation: "onboarding.appearance.expectation",
        surface: "dashboard",
    },
    zoom: {
        rail: "onboarding.steps.zoom",
        title: "onboarding.zoom.title",
        expectation: "onboarding.zoom.expectation",
        surface: "dashboard",
    },
    identity: {
        rail: "onboarding.steps.identity",
        title: "onboarding.identity.title",
        expectation: "onboarding.identity.expectation",
        surface: "versions",
    },
    team: {
        rail: "onboarding.steps.team",
        title: "onboarding.team.title",
        expectation: "onboarding.team.expectation",
        // The same column as the screen before it: a server is where the versions in it are kept,
        // and the row naming it is a row of this column.
        surface: "versions",
    },
    story: {
        rail: "onboarding.steps.story",
        title: "onboarding.story.title",
        expectation: "onboarding.story.expectation",
        surface: "story",
    },
    done: {
        rail: "onboarding.steps.done",
        title: "onboarding.done.title",
        expectation: "onboarding.done.expectation",
        // The page a project opens on: setup ends, a project opens, and this is what is in front
        // of the author next. Showing it is better than describing it.
        surface: "welcome",
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
 * the controls can be the thing itself rather than a picture of it: the corner of a Studio window
 * that re-localizes, re-themes, re-types and re-signs as the answers arrive. Two of the answers
 * (theme and zoom) reach it without anybody passing them anywhere, because the main process applies
 * them to this very window.
 *
 * **The rail is a map and a way through it.** Every screen applies its own answer as it is given and
 * none of them depends on the one before, so an entry is a button: whoever wants the story settings
 * on the way past the language question can have them, and whoever wants to look at an answer again
 * does not have to walk back through the screens between.
 *
 * **Deliberately not a gate.** Skipping is on every screen that asks something, and the last
 * screen's button is the same exit - so a screen that somehow fails to render costs two presses per
 * launch rather than making the app unusable. Two because Skip asks first: it is the one press here
 * that cannot be taken back, since the completion marker is written whichever way setup is left.
 *
 * **It degrades to one column.** `ui.zoomPercent` is answered inside this window, and at the top of
 * the range there is no longer room for two panes - so the sample and then the rail withdraw at
 * fixed widths rather than being squeezed into columns too narrow to read.
 */
export function OnboardingFlow({ onFinish }: OnboardingFlowProps) {
    const { t } = useTranslation();
    const [index, setIndex] = useState(0);
    /**
     * Which way the last move went, so a screen arrives from the side it was reached from. A ref
     * rather than state: it is read while rendering the move it describes and never on its own.
     */
    const direction = useRef(1);
    /**
     * Which surface the sample shows while the zoom screen is up.
     *
     * Only that screen offers the choice, and it is held here rather than inside the step because
     * the sample is the shell's. Every other screen shows what its own entry in {@link SCREENS}
     * says.
     */
    const [zoomSurface, setZoomSurface] = useState<PreviewSurfaceId>("dashboard");
    /**
     * Whether Skip has been pressed and not yet answered.
     *
     * Skip is the one button here that cannot be taken back: the completion marker is written
     * either way, so setup is never offered again. Continue and Back are free, and a press that
     * ends the run for good should not cost what a press that advances it costs.
     */
    const [confirmingSkip, setConfirmingSkip] = useState(false);

    const step = STEPS[index];
    const screen = SCREENS[step];
    const surface = step === "zoom" ? zoomSurface : screen.surface;
    const isLast = index === STEPS.length - 1;

    const goTo = useCallback((target: number) => {
        const clamped = Math.min(STEPS.length - 1, Math.max(0, target));
        if (clamped === index) {
            return;
        }
        direction.current = clamped > index ? 1 : -1;
        setIndex(clamped);
    }, [index]);
    const back = useCallback(() => goTo(index - 1), [goTo, index]);
    const next = useCallback(() => goTo(index + 1), [goTo, index]);

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
                            {/* What setup asks, in the order it asks it, and the way to any of it.
                                Forward is still the footer's job on the screen in front of the
                                reader; this is for the reader who wants a different one. */}
                            <nav
                                aria-label={t("onboarding.windowTitle", { name: APP_DISPLAY_NAME })}
                                className="hidden w-32 shrink-0 flex-col border-r border-edge py-4 min-[600px]:flex"
                            >
                                <ol className="min-h-0 flex-1">
                                    {STEPS.map((entry, entryIndex) => {
                                        const done = entryIndex < index;
                                        const active = entryIndex === index;
                                        return (
                                            <li key={entry}>
                                                <button
                                                    type="button"
                                                    onClick={() => goTo(entryIndex)}
                                                    aria-current={active ? "step" : undefined}
                                                    className={cn(
                                                        "nl-focus-ring flex w-full items-center gap-1.5 border-l-2 py-1.5 pl-3 pr-2 text-left text-xs transition-colors cursor-default",
                                                        active ? "border-primary text-fg" : "border-transparent hover:bg-fill hover:text-fg",
                                                        !active && (done ? "text-fg-muted" : "text-fg-subtle"),
                                                    )}
                                                >
                                                    {done ? <Check className="h-3 w-3 shrink-0" /> : null}
                                                    <span className="truncate">{t(SCREENS[entry].rail)}</span>
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ol>

                                {/* How far in, under the list it is measuring - the ring says it at
                                    a glance, the count exactly. Here rather than above the screen's
                                    heading: beside the list of steps it reads as a position in that
                                    list, while above the heading it reads as a label on the
                                    question. */}
                                <div className="mt-4 flex items-center gap-1.5 border-l-2 border-transparent pl-3 pr-2">
                                    {/* Sized and spaced as the ticks above it, and sitting in their
                                        column: it is one more mark against one more line of the
                                        list, so anything larger would read as a heading over the
                                        list rather than the last entry of it. */}
                                    <ProgressCircle
                                        value={index}
                                        max={PROGRESS_TOTAL}
                                        size={12}
                                        strokeWidth={2}
                                        className="shrink-0"
                                    />
                                    <span className="truncate text-xs tabular-nums text-fg-subtle">
                                        {t("onboarding.progress", { current: index, total: PROGRESS_TOTAL })}
                                    </span>
                                </div>
                            </nav>

                            <div className="min-w-0 flex-1 overflow-y-auto px-7 py-6">
                                {/* `mode="wait"`, so the arriving screen never sits on top of the
                                    leaving one: the two are the same shape in the same place, and
                                    overlapping them reads as a double exposure rather than as a
                                    move. */}
                                <AnimatePresence mode="wait" initial={false}>
                                    <motion.div
                                        key={step}
                                        initial={{ opacity: 0, x: direction.current * SCREEN_SHIFT_PX }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: direction.current * -SCREEN_SHIFT_PX }}
                                        transition={{ duration: SCREEN_DURATION_S, ease: "easeOut" }}
                                    >
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
                                    </motion.div>
                                </AnimatePresence>
                            </div>

                            {/* The corner of a Studio window: the top of it aligned with the
                                question beside it, and the rest of it running off the right edge of
                                the screen and off the bottom.

                                Cut on two sides rather than framed on four, and that is the whole
                                difference between this and a thumbnail. A window with all four of
                                its edges in view is a picture of the product at a size the product
                                is never used at; a corner is the product, at the size it is used at,
                                seen from where the author is standing. It costs the far side of
                                every row - a line of dialogue ends off-screen, as it does on a
                                narrow editor - and buys back type at its real size and a layout at
                                its real proportions.

                                No frame of its own either: no divider, no plate, no "Preview"
                                eyebrow. The only lines drawn here are the window's own top and left
                                edges, and the other two are past the crop. Those two edges carry
                                the shadow, which is why they are inset rather than flush - a window
                                raised off what is behind it needs somewhere for the shadow to fall,
                                and the two cropped edges have nowhere.

                                `overflow-clip`, not `overflow-hidden`: a hidden box is still a
                                scroll container, and the browser scrolls one to reveal a focused
                                element - so putting the caret in the sample's insert slot slid the
                                whole window sideways and took the rail off the screen. A clipped box
                                has nothing to scroll. */}
                            <div className="hidden w-[444px] shrink-0 overflow-clip bg-surface-canvas pl-6 pt-6 min-[780px]:flex">
                                <div className="relative min-h-0 flex-1">
                                    {/* Taller than the space it is given, always, so the bottom edge
                                        is never the thing that ends it. */}
                                    <div className="absolute left-0 top-0 h-[calc(100%+96px)]">
                                        <StudioPreview surface={surface} />
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
                                    <Button variant="ghost" onClick={() => setConfirmingSkip(true)}>
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

                        {/* Not danger-coloured: nothing is destroyed by leaving, and setup answers
                            nothing that Settings cannot answer later. What it is is one-way, which
                            is what the message says. */}
                        <ConfirmModal
                            isOpen={confirmingSkip}
                            onClose={() => setConfirmingSkip(false)}
                            onConfirm={() => {
                                setConfirmingSkip(false);
                                onFinish();
                            }}
                            variant="primary"
                            title={t("onboarding.skipConfirm.title")}
                            message={t("onboarding.skipConfirm.message")}
                            confirmText={t("onboarding.nav.skip")}
                        />
                    </div>
                </OnboardingServersProvider>
            </OnboardingPreferencesProvider>
        </AppLayout>
    );
}
