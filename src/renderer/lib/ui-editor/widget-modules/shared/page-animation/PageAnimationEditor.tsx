import { useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Compass, Play } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Select } from "@/lib/components/elements/Select";
import { Switch } from "@/lib/components/elements/Switch";
import { IconButtonSegGroup } from "@/apps/workspace/modules/properties/framework/fields/IconButtonSegGroup";
import type { IconButtonSelection } from "@/apps/workspace/modules/properties/framework/types";
import {
    normalizeUIPageAnimationSettings,
    type UIPageAnimationDirection,
    type UIPageAnimationPreset,
    type UIPageAnimationSettings,
    type UIPageAnimationSpeed,
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

const SPEED_OPTIONS: { value: UIPageAnimationSpeed; label: string }[] = [
    { value: "fast", label: "Fast" },
    { value: "normal", label: "Normal" },
    { value: "slow", label: "Slow" },
];

const DIRECTION_OPTIONS = [
    { id: "auto", label: "Auto", icon: <Compass className="h-4 w-4" /> },
    { id: "left", label: "Left", icon: <ArrowLeft className="h-4 w-4" /> },
    { id: "right", label: "Right", icon: <ArrowRight className="h-4 w-4" /> },
    { id: "up", label: "Up", icon: <ArrowUp className="h-4 w-4" /> },
    { id: "down", label: "Down", icon: <ArrowDown className="h-4 w-4" /> },
];

type PageAnimationEditorProps = {
    settings: UIPageAnimationSettings | null | undefined;
    inherited?: boolean;
    inheritedSettings?: UIPageAnimationSettings | null | undefined;
    inheritLabel?: string;
    onChange: (next: UIPageAnimationSettings) => void;
    onInheritedChange?: (inherited: boolean, seed: UIPageAnimationSettings) => void;
};

function PreviewButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 text-xs text-gray-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            onClick={onClick}
            title={label}
            aria-label={label}
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
        <div className="relative h-20 overflow-hidden rounded-md border border-white/10 bg-[#080a0d]">
            <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:16px_16px]" />
            <div className="absolute inset-0 flex items-center justify-center">
                <motion.div
                    key={`${phase}:${tick}:${settings.enter}:${settings.exit}:${settings.direction}:${settings.speed}`}
                    className="h-10 w-16 rounded border border-cyan-300/40 bg-cyan-400/20 shadow-[0_0_24px_rgba(34,211,238,0.18)]"
                    initial={initial}
                    animate={animate}
                    transition={motionProps.transition}
                />
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

    const patch = (partial: Partial<UIPageAnimationSettings>) => {
        onChange({ ...ownSettings, ...partial });
    };

    return (
        <div className="space-y-3">
            {onInheritedChange ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
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
                    <div className="grid grid-cols-2 gap-2">
                        <label className="min-w-0 space-y-1">
                            <span className="block text-xs font-medium text-gray-400">Enter</span>
                            <Select
                                fullWidth
                                size="sm"
                                options={PRESET_OPTIONS}
                                value={ownSettings.enter}
                                onChange={value => patch({ enter: value as UIPageAnimationPreset })}
                                portalMenu
                            />
                        </label>
                        <label className="min-w-0 space-y-1">
                            <span className="block text-xs font-medium text-gray-400">Exit</span>
                            <Select
                                fullWidth
                                size="sm"
                                options={PRESET_OPTIONS}
                                value={ownSettings.exit}
                                onChange={value => patch({ exit: value as UIPageAnimationPreset })}
                                portalMenu
                            />
                        </label>
                    </div>

                    <div className="space-y-1">
                        <span className="block text-xs font-medium text-gray-400">Direction</span>
                        <IconButtonSegGroup
                            options={DIRECTION_OPTIONS}
                            mode="single"
                            value={ownSettings.direction as IconButtonSelection}
                            onChange={value => patch({ direction: String(value) as UIPageAnimationDirection })}
                            showLabels={false}
                            density="compact"
                        />
                    </div>

                    <label className="block space-y-1">
                        <span className="block text-xs font-medium text-gray-400">Speed</span>
                        <Select
                            fullWidth
                            size="sm"
                            options={SPEED_OPTIONS}
                            value={ownSettings.speed}
                            onChange={value => patch({ speed: value as UIPageAnimationSpeed })}
                            portalMenu
                        />
                    </label>
                </>
            ) : null}

            <PageAnimationPreview settings={effectiveSettings} phase={preview.phase} tick={preview.tick} />
            <div className="flex min-w-0 gap-2">
                <PreviewButton
                    label="Preview enter"
                    onClick={() => setPreview(prev => ({ phase: "enter", tick: prev.tick + 1 }))}
                />
                <PreviewButton
                    label="Preview exit"
                    onClick={() => setPreview(prev => ({ phase: "exit", tick: prev.tick + 1 }))}
                />
            </div>
        </div>
    );
}
