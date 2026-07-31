import { useMemo, useState } from "react";
import { Repeat } from "lucide-react";
import type { StoryMotionTargetKind } from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import { StoryMotionLoopPreview } from "./StoryMotionLoopPreview";
import type { StoryMotionPreviewTarget } from "./storyMotionPreviewTarget";
import { storyMotionTimelineSummary } from "./storyMotionSummary";
import { storyMotionSignatureTimeMs } from "./storyMotionTimeline";
import {
    storyMotionPresetCategoriesForTargetKind,
    storyMotionPresetsForTargetKind,
    type StoryMotionPreset,
} from "./storyMotionPresets";

const CARD_PREVIEW = { width: 148, height: 84 };

/**
 * The preset library, browsable.
 *
 * Two decisions carry the whole design:
 *  - **Every card previews on the author's own target.** The `target` passed in is whatever the action
 *    addresses — the camera, or the displayable resolved back through the scene — so the audition is
 *    on the right subject at the right size rather than on a generic box. (Its *image* only appears
 *    when the addressed block carries one: a character enter stores no `assetId` unless a pose was
 *    named, so a portrait still auditions as a portrait-shaped placeholder. Same limitation the
 *    motion hover preview has always had; fixing it means resolving a character's default appearance,
 *    which is the appearance resolver's job, not this gallery's.)
 *  - **Only the hovered card animates.** A grid of two dozen requestAnimationFrame loops would cost
 *    real frames in the editor for information nobody is reading; a parked card sits on frame 0, which
 *    is also the pose the motion starts from.
 */
export function StoryMotionPresetGallery(props: {
    targetKind: StoryMotionTargetKind;
    target: StoryMotionPreviewTarget;
    stageSize: { width: number; height: number };
    backgroundUrl?: string | null;
    onPick: (presetId: string) => void;
    /** Disabled while the project service is unavailable — picking would silently do nothing. */
    disabled?: boolean;
}) {
    const { t } = useTranslation();
    const [hovered, setHovered] = useState<string | null>(null);
    const presets = useMemo(() => storyMotionPresetsForTargetKind(props.targetKind), [props.targetKind]);
    const categories = useMemo(() => storyMotionPresetCategoriesForTargetKind(props.targetKind), [props.targetKind]);

    return (
        <div className="flex flex-col gap-2">
            {categories.map(category => (
                <section key={category}>
                    <div className="sticky top-0 z-10 bg-surface-overlay/95 px-1 pb-1 text-2xs font-medium tracking-wide text-fg-subtle backdrop-blur">
                        {t(`motion.presetCategory.${category}`)}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                        {presets.filter(preset => preset.category === category).map(preset => (
                            <PresetCard
                                key={preset.id}
                                preset={preset}
                                label={t(`motion.preset.${preset.id}`)}
                                target={props.target}
                                stageSize={props.stageSize}
                                backgroundUrl={props.backgroundUrl}
                                active={hovered === preset.id}
                                disabled={props.disabled}
                                onHover={() => setHovered(preset.id)}
                                onLeave={() => setHovered(current => (current === preset.id ? null : current))}
                                onPick={() => props.onPick(preset.id)}
                            />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

function PresetCard(props: {
    preset: StoryMotionPreset;
    label: string;
    target: StoryMotionPreviewTarget;
    stageSize: { width: number; height: number };
    backgroundUrl?: string | null;
    active: boolean;
    disabled?: boolean;
    onHover: () => void;
    onLeave: () => void;
    onPick: () => void;
}) {
    const { t } = useTranslation();
    const timeline = useMemo(() => props.preset.build(), [props.preset]);
    // Parked on the move's most extreme frame, not on frame 0: almost every motion starts from rest,
    // so a grid parked at 0 is two dozen identical squares.
    const restTimeMs = useMemo(() => storyMotionSignatureTimeMs(timeline), [timeline]);
    const repeat = props.preset.config?.repeat;

    return (
        <button
            type="button"
            disabled={props.disabled}
            // The card's text runs name + repeat + summary through adjacent spans, which concatenate
            // into "Quake60.24s / Position" as an accessible name. The preset's name is what this
            // control is; the rest is detail the eye reads off the layout.
            aria-label={props.label}
            className="group flex flex-col overflow-hidden rounded-md border border-edge bg-black/50 text-left transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-40"
            onMouseEnter={props.onHover}
            onMouseLeave={props.onLeave}
            onFocus={props.onHover}
            onBlur={props.onLeave}
            onClick={props.onPick}
        >
            <StoryMotionLoopPreview
                timeline={timeline}
                target={props.target}
                stageSize={props.stageSize}
                box={CARD_PREVIEW}
                backgroundUrl={props.backgroundUrl}
                active={props.active}
                restTimeMs={restTimeMs}
                className="w-full"
            />
            <span className="block min-w-0 border-t border-edge bg-surface-raised px-2 py-1">
                <span className="flex min-w-0 items-center gap-1">
                    <span className="min-w-0 flex-1 truncate text-2xs font-medium text-fg">{props.label}</span>
                    {/* A repeat count is part of what the preset IS — an idle motion that runs once is
                        a different move — so it is on the card, not only in the editor afterwards. */}
                    {repeat ? (
                        <span className="flex shrink-0 items-center gap-0.5 text-2xs text-fg-subtle" title={t("motion.panel.repeat")}>
                            <Repeat className="h-2.5 w-2.5" />
                            {repeat}
                        </span>
                    ) : null}
                </span>
                <span className="block truncate text-2xs text-fg-subtle">{storyMotionTimelineSummary(timeline, t)}</span>
            </span>
        </button>
    );
}
