import { useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Play, RotateCw } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { InspectOnlyButton } from "@/lib/components/elements/InspectOnlyButton";
import { Select } from "@/lib/components/elements/Select";
import { Switch } from "@/lib/components/elements/Switch";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { IconButtonSegGroup } from "@/apps/workspace/modules/properties/framework/fields/IconButtonSegGroup";
import type { IconButtonSelection } from "@/apps/workspace/modules/properties/framework/types";
import {
    normalizeUIPageAnimationSettings,
    type UIPageAnimationDirection,
    type UIPageAnimationPreset,
    type UIPageAnimationSettings,
} from "@shared/types/ui-editor/pageAnimation";
import { resolvePageAnimationMotion } from "@/lib/ui-editor/runtime/pageAnimation";
import { useTranslation } from "@/lib/i18n";

const MIN_DURATION_SECONDS = 0;
const MAX_DURATION_SECONDS = 10;
const DURATION_STEP_SECONDS = 0.05;
const ANGLE_STEP_DEGREES = 15;

type PageAnimationEditorProps = {
    settings: UIPageAnimationSettings | null | undefined;
    inherited?: boolean;
    inheritedSettings?: UIPageAnimationSettings | null | undefined;
    inheritLabel?: string;
    /**
     * Offer the switch that holds the incoming Page until this one has left. Surfaces and Page
     * components have somewhere to hold; an element's departure is already awaited by whatever
     * contains it, so it is not asked.
     */
    showExitBlocking?: boolean;
    /** Offer the child timings. Set for Surfaces and for elements that can hold children. */
    showChildTiming?: boolean;
    onChange: (next: UIPageAnimationSettings) => void;
    onInheritedChange?: (inherited: boolean, seed: UIPageAnimationSettings) => void;
};

function normalizeDurationInput(value: number): number {
    return Math.round(Math.min(MAX_DURATION_SECONDS, Math.max(MIN_DURATION_SECONDS, value)) * 100) / 100;
}

function formatDurationSeconds(value: number): string {
    return normalizeDurationInput(value).toFixed(2);
}

function normalizeAngleInput(value: number): number {
    return Math.round((((value % 360) + 360) % 360) * 100) / 100;
}

function formatAngleDegrees(value: number): string {
    return String(normalizeAngleInput(value));
}

function visibleDirection(
    direction: UIPageAnimationDirection,
    fallback: Exclude<UIPageAnimationDirection, "auto">,
): Exclude<UIPageAnimationDirection, "auto"> {
    return direction === "auto" ? fallback : direction;
}

/**
 * Replay the little box beside it. It restarts a local animation and touches no settings at all,
 * which makes it the plainest kind of looking there is.
 *
 * An {@link InspectOnlyButton} because this editor is mounted inside inspector fields, and a frozen
 * workspace clamps those in a `disabled` `<fieldset>`: as a `<button>` both replay buttons went
 * dead, so an author reading a past version could see which preset an animation used but could not
 * watch it once.
 */
function PreviewButton({ label, ariaLabel, onClick }: { label: string; ariaLabel: string; onClick: () => void }) {
    return (
        <InspectOnlyButton
            className="inline-flex h-7 min-w-0 items-center justify-center gap-1 rounded-md border border-edge bg-fill-subtle px-2 text-2xs text-fg-muted transition hover:bg-fill hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 cursor-default"
            onClick={onClick}
            data-tip={ariaLabel}
            aria-label={ariaLabel}
        >
            <Play className="h-3.5 w-3.5" />
            <span className="truncate">{label}</span>
        </InspectOnlyButton>
    );
}

function PageAnimationPreview({
    settings,
    phase,
    tick,
}: {
    settings: UIPageAnimationSettings;
    phase: "enter" | "exit";
    tick: number;
}) {
    const prefersReducedMotion = useReducedMotion();
    const motionProps = useMemo(
        () => resolvePageAnimationMotion({
            settings,
            reducedMotion: prefersReducedMotion === true,
            // The host's own delay only. What it waits for beyond that - its children leaving - is
            // not in this box, and pretending to time it here would be a guess.
            delays: {
                enterMs: settings.enterDelaySeconds * 1000,
                exitMs: settings.exitDelaySeconds * 1000,
            },
        }),
        [prefersReducedMotion, settings],
    );
    const initial = phase === "enter" ? motionProps.initial : motionProps.animate;
    const animate = phase === "enter" ? motionProps.animate : motionProps.exit;

    return (
        <div className="relative h-[68px] overflow-hidden rounded-md border border-edge bg-[#080a0d]">
            <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:16px_16px]" />
            <div className="absolute inset-0 flex items-center justify-center">
                <motion.div
                    key={[
                        phase,
                        tick,
                        settings.enter,
                        settings.exit,
                        settings.enterDirection,
                        settings.exitDirection,
                        settings.enterAngleDegrees,
                        settings.exitAngleDegrees,
                        settings.enterDurationSeconds,
                        settings.exitDurationSeconds,
                        settings.enterDelaySeconds,
                        settings.exitDelaySeconds,
                        settings.exitBlocking,
                    ].join(":")}
                    className="h-9 w-14 rounded-md border border-primary/40 bg-primary/20 shadow-[0_0_24px_rgba(64,168,196,0.18)]"
                    initial={initial}
                    animate={animate}
                />
            </div>
        </div>
    );
}

function AnimationPhaseBlock({
    label,
    preset,
    direction,
    autoFallbackDirection,
    angleDegrees,
    durationSeconds,
    delaySeconds,
    exitBlocking,
    showExitBlocking = false,
    onPresetChange,
    onDirectionChange,
    onAngleChange,
    onDurationChange,
    onDelayChange,
    onExitBlockingChange,
}: {
    label: string;
    preset: UIPageAnimationPreset;
    direction: UIPageAnimationDirection;
    autoFallbackDirection: Exclude<UIPageAnimationDirection, "auto">;
    angleDegrees: number;
    durationSeconds: number;
    delaySeconds: number;
    exitBlocking?: boolean;
    showExitBlocking?: boolean;
    onPresetChange: (next: UIPageAnimationPreset) => void;
    onDirectionChange: (next: UIPageAnimationDirection) => void;
    onAngleChange: (next: number) => void;
    onDurationChange: (next: number) => void;
    onDelayChange: (next: number) => void;
    onExitBlockingChange?: (next: boolean) => void;
}) {
    const { t } = useTranslation();
    const presetOptions = useMemo<{ value: UIPageAnimationPreset; label: string }[]>(
        () => [
            { value: "none", label: t("common.none") },
            { value: "fade", label: t("widgetChrome.pageAnimation.presetFade") },
            { value: "slide", label: t("widgetChrome.pageAnimation.presetSlide") },
            { value: "push", label: t("widgetChrome.pageAnimation.presetPush") },
            { value: "zoom", label: t("widgetChrome.pageAnimation.presetZoom") },
            { value: "pop", label: t("widgetChrome.pageAnimation.presetPop") },
            { value: "blur", label: t("widgetChrome.pageAnimation.presetBlur") },
        ],
        [t],
    );
    const directionOptions = useMemo(
        () => [
            { id: "left", label: t("widgetChrome.pageAnimation.directionLeft"), icon: <ArrowLeft className="h-4 w-4" /> },
            { id: "right", label: t("widgetChrome.pageAnimation.directionRight"), icon: <ArrowRight className="h-4 w-4" /> },
            { id: "up", label: t("widgetChrome.pageAnimation.directionUp"), icon: <ArrowUp className="h-4 w-4" /> },
            { id: "down", label: t("widgetChrome.pageAnimation.directionDown"), icon: <ArrowDown className="h-4 w-4" /> },
            { id: "angle", label: t("widgetChrome.pageAnimation.angle"), icon: <RotateCw className="h-4 w-4" /> },
        ],
        [t],
    );
    const shownDirection = visibleDirection(direction, autoFallbackDirection);
    const isAngle = shownDirection === "angle";

    return (
        <div className="space-y-2 rounded-md border border-edge bg-fill-subtle p-2">
            <div className="flex min-h-7 items-center justify-between gap-2">
                <span className="text-2xs font-semibold tracking-wide text-fg-muted">{label}</span>
                {showExitBlocking ? (
                    <label className="flex min-w-0 items-center gap-2 text-2xs text-fg-muted">
                        <span>{t("widgetChrome.pageAnimation.wait")}</span>
                        <Switch
                            checked={exitBlocking === true}
                            size="sm"
                            onCheckedChange={checked => onExitBlockingChange?.(checked)}
                        />
                    </label>
                ) : null}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_92px] gap-2">
                <label className="min-w-0 space-y-1">
                    <span className="block text-2xs font-medium tracking-wide text-fg-subtle">{t("widgetChrome.pageAnimation.preset")}</span>
                    <Select
                        fullWidth
                        options={presetOptions}
                        value={preset}
                        onChange={value => onPresetChange(value as UIPageAnimationPreset)}
                        portalMenu
                    />
                </label>
                <label className="min-w-0 space-y-1">
                    <span className="block text-2xs font-medium tracking-wide text-fg-subtle">{t("widgetChrome.pageAnimation.seconds")}</span>
                    <NumericDraftEnhancedInput
                        committedDisplay={formatDurationSeconds(durationSeconds)}
                        onFiniteNumber={value => onDurationChange(normalizeDurationInput(value))}
                        inputMode="decimal"
                        type="number"
                        min={MIN_DURATION_SECONDS}
                        max={MAX_DURATION_SECONDS}
                        step={DURATION_STEP_SECONDS}
                        unit="s"
                        className="w-full min-w-0"
                        popoverThreshold={128}
                    />
                </label>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_76px] gap-2">
                <div className="min-w-0 space-y-1">
                    <span className="block text-2xs font-medium tracking-wide text-fg-subtle">{t("widgetChrome.pageAnimation.direction")}</span>
                    <IconButtonSegGroup
                        options={directionOptions}
                        mode="single"
                        value={shownDirection as IconButtonSelection}
                        onChange={value => onDirectionChange(String(value) as UIPageAnimationDirection)}
                        showLabels={false}
                        density="compact"
                        className="h-9"
                    />
                </div>
                <label className="min-w-0 space-y-1">
                    <span className="block text-2xs font-medium tracking-wide text-fg-subtle">{t("widgetChrome.pageAnimation.angle")}</span>
                    <NumericDraftEnhancedInput
                        committedDisplay={formatAngleDegrees(angleDegrees)}
                        onFiniteNumber={value => onAngleChange(normalizeAngleInput(value))}
                        inputMode="decimal"
                        type="number"
                        min={0}
                        max={359}
                        step={ANGLE_STEP_DEGREES}
                        unit="deg"
                        disabled={!isAngle}
                        className={`w-full min-w-0 ${isAngle ? "" : "opacity-55"}`}
                        popoverThreshold={112}
                    />
                </label>
            </div>
            {/* Its own labelled row rather than a third column beside the seconds: the inspector is
                narrow enough that a third column truncates the preset name to one character. */}
            <label className="grid grid-cols-[minmax(0,1fr)_92px] items-center gap-2">
                <span className="min-w-0 text-2xs font-medium tracking-wide text-fg-subtle">
                    {t("widgetChrome.pageAnimation.delay")}
                </span>
                <NumericDraftEnhancedInput
                    committedDisplay={formatDurationSeconds(delaySeconds)}
                    onFiniteNumber={value => onDelayChange(normalizeDurationInput(value))}
                    inputMode="decimal"
                    type="number"
                    min={MIN_DURATION_SECONDS}
                    max={MAX_DURATION_SECONDS}
                    step={DURATION_STEP_SECONDS}
                    unit="s"
                    className="w-full min-w-0"
                    popoverThreshold={128}
                />
            </label>
        </div>
    );
}

/**
 * The half of the record that is about what this host's children do, rather than about the host.
 *
 * Kept out of the two phase blocks because it is not per-phase: the stagger spaces the children out
 * both on the way in and on the way out, and the wait is what makes those two facts one behaviour -
 * a container that waits, inside a Page that waits, leaves last.
 */
function ChildTimingBlock({
    staggerSeconds,
    waitsForChildren,
    onStaggerChange,
    onWaitsForChildrenChange,
}: {
    staggerSeconds: number;
    waitsForChildren: boolean;
    onStaggerChange: (next: number) => void;
    onWaitsForChildrenChange: (next: boolean) => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="space-y-2 rounded-md border border-edge bg-fill-subtle p-2">
            <div className="flex min-h-7 items-center justify-between gap-2">
                <span className="text-2xs font-semibold tracking-wide text-fg-muted">
                    {t("widgetChrome.pageAnimation.children")}
                </span>
                <label className="flex min-w-0 items-center gap-2 text-2xs text-fg-muted">
                    <span>{t("widgetChrome.pageAnimation.waitForChildren")}</span>
                    <Switch
                        checked={waitsForChildren}
                        size="sm"
                        onCheckedChange={onWaitsForChildrenChange}
                    />
                </label>
            </div>
            <label className="grid grid-cols-[minmax(0,1fr)_92px] items-center gap-2">
                <span className="min-w-0 text-2xs font-medium tracking-wide text-fg-subtle">
                    {t("widgetChrome.pageAnimation.stagger")}
                </span>
                <NumericDraftEnhancedInput
                    committedDisplay={formatDurationSeconds(staggerSeconds)}
                    onFiniteNumber={value => onStaggerChange(normalizeDurationInput(value))}
                    inputMode="decimal"
                    type="number"
                    min={MIN_DURATION_SECONDS}
                    max={MAX_DURATION_SECONDS}
                    step={DURATION_STEP_SECONDS}
                    unit="s"
                    className="w-full min-w-0"
                    popoverThreshold={128}
                />
            </label>
        </div>
    );
}

export function PageAnimationEditor({
    settings,
    inherited = false,
    inheritedSettings,
    inheritLabel,
    showExitBlocking = true,
    showChildTiming = false,
    onChange,
    onInheritedChange,
}: PageAnimationEditorProps) {
    const { t } = useTranslation();
    const resolvedInheritLabel = inheritLabel ?? t("widgetChrome.pageAnimation.usePageAnimation");
    const ownSettings = normalizeUIPageAnimationSettings(settings);
    const effectiveSettings = inherited
        ? normalizeUIPageAnimationSettings(inheritedSettings)
        : ownSettings;
    const [preview, setPreview] = useState<{ phase: "enter" | "exit"; tick: number }>({ phase: "enter", tick: 0 });

    const materializedOwnSettings = {
        ...ownSettings,
        enterDirection: visibleDirection(ownSettings.enterDirection, "right"),
        exitDirection: visibleDirection(ownSettings.exitDirection, "left"),
    };

    const patch = (partial: Partial<UIPageAnimationSettings>) => {
        onChange(normalizeUIPageAnimationSettings({ ...materializedOwnSettings, ...partial }));
    };

    return (
        <div className="space-y-2.5">
            {onInheritedChange ? (
                <div className="flex min-h-9 items-center justify-between gap-3 rounded-md border border-edge bg-fill-subtle px-3 py-1.5">
                    <span className="min-w-0 text-xs font-medium text-fg-muted">{resolvedInheritLabel}</span>
                    <Switch
                        checked={inherited}
                        size="sm"
                        onCheckedChange={checked => {
                            onInheritedChange(checked, effectiveSettings);
                        }}
                    />
                </div>
            ) : null}

            {!inherited ? (
                <>
                    <AnimationPhaseBlock
                        label={t("widgetChrome.pageAnimation.enter")}
                        preset={ownSettings.enter}
                        direction={ownSettings.enterDirection}
                        autoFallbackDirection="right"
                        angleDegrees={ownSettings.enterAngleDegrees}
                        durationSeconds={ownSettings.enterDurationSeconds}
                        delaySeconds={ownSettings.enterDelaySeconds}
                        onPresetChange={value => patch({ enter: value })}
                        onDirectionChange={value => patch({ enterDirection: value })}
                        onAngleChange={value => patch({ enterAngleDegrees: value })}
                        onDurationChange={value => patch({ enterDurationSeconds: value })}
                        onDelayChange={value => patch({ enterDelaySeconds: value })}
                    />
                    <AnimationPhaseBlock
                        label={t("widgetChrome.pageAnimation.exit")}
                        preset={ownSettings.exit}
                        direction={ownSettings.exitDirection}
                        autoFallbackDirection="left"
                        angleDegrees={ownSettings.exitAngleDegrees}
                        durationSeconds={ownSettings.exitDurationSeconds}
                        delaySeconds={ownSettings.exitDelaySeconds}
                        exitBlocking={ownSettings.exitBlocking}
                        showExitBlocking={showExitBlocking}
                        onPresetChange={value => patch({ exit: value })}
                        onDirectionChange={value => patch({ exitDirection: value })}
                        onAngleChange={value => patch({ exitAngleDegrees: value })}
                        onDurationChange={value => patch({ exitDurationSeconds: value })}
                        onDelayChange={value => patch({ exitDelaySeconds: value })}
                        onExitBlockingChange={value => patch({ exitBlocking: value })}
                    />
                    {showChildTiming ? (
                        <ChildTimingBlock
                            staggerSeconds={ownSettings.childStaggerSeconds}
                            waitsForChildren={ownSettings.exitWaitsForChildren}
                            onStaggerChange={value => patch({ childStaggerSeconds: value })}
                            onWaitsForChildrenChange={value => patch({ exitWaitsForChildren: value })}
                        />
                    ) : null}
                </>
            ) : null}

            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_72px] gap-2">
                <PageAnimationPreview settings={effectiveSettings} phase={preview.phase} tick={preview.tick} />
                <div className="flex min-w-0 flex-col justify-center gap-2">
                    <PreviewButton
                        label={t("widgetChrome.pageAnimation.enter")}
                        ariaLabel={t("widgetChrome.pageAnimation.previewEnter")}
                        onClick={() => setPreview(prev => ({ phase: "enter", tick: prev.tick + 1 }))}
                    />
                    <PreviewButton
                        label={t("widgetChrome.pageAnimation.exit")}
                        ariaLabel={t("widgetChrome.pageAnimation.previewExit")}
                        onClick={() => setPreview(prev => ({ phase: "exit", tick: prev.tick + 1 }))}
                    />
                </div>
            </div>
        </div>
    );
}
