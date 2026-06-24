import { useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Play, RotateCw } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
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

const PRESET_OPTIONS: { value: UIPageAnimationPreset; label: string }[] = [
    { value: "none", label: "None" },
    { value: "fade", label: "Fade" },
    { value: "slide", label: "Slide" },
    { value: "push", label: "Push" },
    { value: "zoom", label: "Zoom" },
    { value: "pop", label: "Pop" },
    { value: "blur", label: "Blur" },
];

const DIRECTION_OPTIONS = [
    { id: "left", label: "Left", icon: <ArrowLeft className="h-4 w-4" /> },
    { id: "right", label: "Right", icon: <ArrowRight className="h-4 w-4" /> },
    { id: "up", label: "Up", icon: <ArrowUp className="h-4 w-4" /> },
    { id: "down", label: "Down", icon: <ArrowDown className="h-4 w-4" /> },
    { id: "angle", label: "Angle", icon: <RotateCw className="h-4 w-4" /> },
];

const MIN_DURATION_SECONDS = 0;
const MAX_DURATION_SECONDS = 10;
const DURATION_STEP_SECONDS = 0.05;
const ANGLE_STEP_DEGREES = 15;

type PageAnimationEditorProps = {
    settings: UIPageAnimationSettings | null | undefined;
    inherited?: boolean;
    inheritedSettings?: UIPageAnimationSettings | null | undefined;
    inheritLabel?: string;
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

function PreviewButton({ label, ariaLabel, onClick }: { label: string; ariaLabel: string; onClick: () => void }) {
    return (
        <button
            type="button"
            className="inline-flex h-7 min-w-0 items-center justify-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 text-[11px] text-gray-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            onClick={onClick}
            title={ariaLabel}
            aria-label={ariaLabel}
        >
            <Play className="h-3.5 w-3.5" />
            <span className="truncate">{label}</span>
        </button>
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
        () => resolvePageAnimationMotion({ settings, reducedMotion: prefersReducedMotion === true }),
        [prefersReducedMotion, settings],
    );
    const initial = phase === "enter" ? motionProps.initial : motionProps.animate;
    const animate = phase === "enter" ? motionProps.animate : motionProps.exit;

    return (
        <div className="relative h-[68px] overflow-hidden rounded-md border border-white/10 bg-[#080a0d]">
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
                        settings.exitBlocking,
                    ].join(":")}
                    className="h-9 w-14 rounded border border-cyan-300/40 bg-cyan-400/20 shadow-[0_0_24px_rgba(34,211,238,0.18)]"
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
    exitBlocking,
    showExitBlocking = false,
    onPresetChange,
    onDirectionChange,
    onAngleChange,
    onDurationChange,
    onExitBlockingChange,
}: {
    label: string;
    preset: UIPageAnimationPreset;
    direction: UIPageAnimationDirection;
    autoFallbackDirection: Exclude<UIPageAnimationDirection, "auto">;
    angleDegrees: number;
    durationSeconds: number;
    exitBlocking?: boolean;
    showExitBlocking?: boolean;
    onPresetChange: (next: UIPageAnimationPreset) => void;
    onDirectionChange: (next: UIPageAnimationDirection) => void;
    onAngleChange: (next: number) => void;
    onDurationChange: (next: number) => void;
    onExitBlockingChange?: (next: boolean) => void;
}) {
    const shownDirection = visibleDirection(direction, autoFallbackDirection);
    const isAngle = shownDirection === "angle";

    return (
        <div className="space-y-2 rounded-md border border-white/10 bg-white/[0.025] p-2">
            <div className="flex min-h-7 items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
                {showExitBlocking ? (
                    <label className="flex min-w-0 items-center gap-2 text-[11px] text-gray-400">
                        <span>Wait</span>
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
                    <span className="block text-[10px] font-medium uppercase tracking-wide text-gray-500">Preset</span>
                    <Select
                        fullWidth
                        options={PRESET_OPTIONS}
                        value={preset}
                        onChange={value => onPresetChange(value as UIPageAnimationPreset)}
                        portalMenu
                    />
                </label>
                <label className="min-w-0 space-y-1">
                    <span className="block text-[10px] font-medium uppercase tracking-wide text-gray-500">Seconds</span>
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
                    <span className="block text-[10px] font-medium uppercase tracking-wide text-gray-500">Direction</span>
                    <IconButtonSegGroup
                        options={DIRECTION_OPTIONS}
                        mode="single"
                        value={shownDirection as IconButtonSelection}
                        onChange={value => onDirectionChange(String(value) as UIPageAnimationDirection)}
                        showLabels={false}
                        density="compact"
                        className="h-9"
                    />
                </div>
                <label className="min-w-0 space-y-1">
                    <span className="block text-[10px] font-medium uppercase tracking-wide text-gray-500">Angle</span>
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
        </div>
    );
}

export function PageAnimationEditor({
    settings,
    inherited = false,
    inheritedSettings,
    inheritLabel = "Use Page animation",
    onChange,
    onInheritedChange,
}: PageAnimationEditorProps) {
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
                <div className="flex min-h-9 items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5">
                    <span className="min-w-0 text-xs font-medium text-gray-300">{inheritLabel}</span>
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
                        label="Enter"
                        preset={ownSettings.enter}
                        direction={ownSettings.enterDirection}
                        autoFallbackDirection="right"
                        angleDegrees={ownSettings.enterAngleDegrees}
                        durationSeconds={ownSettings.enterDurationSeconds}
                        onPresetChange={value => patch({ enter: value })}
                        onDirectionChange={value => patch({ enterDirection: value })}
                        onAngleChange={value => patch({ enterAngleDegrees: value })}
                        onDurationChange={value => patch({ enterDurationSeconds: value })}
                    />
                    <AnimationPhaseBlock
                        label="Exit"
                        preset={ownSettings.exit}
                        direction={ownSettings.exitDirection}
                        autoFallbackDirection="left"
                        angleDegrees={ownSettings.exitAngleDegrees}
                        durationSeconds={ownSettings.exitDurationSeconds}
                        exitBlocking={ownSettings.exitBlocking}
                        showExitBlocking
                        onPresetChange={value => patch({ exit: value })}
                        onDirectionChange={value => patch({ exitDirection: value })}
                        onAngleChange={value => patch({ exitAngleDegrees: value })}
                        onDurationChange={value => patch({ exitDurationSeconds: value })}
                        onExitBlockingChange={value => patch({ exitBlocking: value })}
                    />
                </>
            ) : null}

            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_72px] gap-2">
                <PageAnimationPreview settings={effectiveSettings} phase={preview.phase} tick={preview.tick} />
                <div className="flex min-w-0 flex-col justify-center gap-2">
                    <PreviewButton
                        label="Enter"
                        ariaLabel="Preview enter"
                        onClick={() => setPreview(prev => ({ phase: "enter", tick: prev.tick + 1 }))}
                    />
                    <PreviewButton
                        label="Exit"
                        ariaLabel="Preview exit"
                        onClick={() => setPreview(prev => ({ phase: "exit", tick: prev.tick + 1 }))}
                    />
                </div>
            </div>
        </div>
    );
}
