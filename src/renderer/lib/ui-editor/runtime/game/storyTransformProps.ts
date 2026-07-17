import type {
    StoryActionPayload,
    StoryAnimationAsset,
    StoryAnimationKeyframe,
    StoryAnimationSequence,
    StoryAnimationTimeline,
    StoryAnimationTrack,
    StoryAnimationTrackProperty,
    StoryLiteralValue,
    StoryTransformSequenceProps,
    StoryTransformRef,
} from "@shared/types/story";
import { parseStoryEasing } from "@shared/utils/storyEasing";

/**
 * Pure transform-ref → props math shared by the NLR story compiler (building live Transforms)
 * and the stage-snapshot walker (computing settled final props for the editor preview).
 */

export type StoryAlignPosition = {
    xalign: number;
    yalign: number;
    xoffset?: number;
    yoffset?: number;
};

export type VisibilityTransformMode = "show" | "hide" | "none";

export function getPresetPosition(preset: string, props: Record<string, StoryLiteralValue>): StoryAlignPosition | null {
    const xalign = optionalNumberProp(props, "xalign") ?? optionalNumberProp(props, "x");
    const yalign = optionalNumberProp(props, "yalign") ?? optionalNumberProp(props, "y") ?? 0.5;
    const xoffset = optionalNumberProp(props, "xoffset") ?? optionalNumberProp(props, "xOffset");
    const yoffset = optionalNumberProp(props, "yoffset") ?? optionalNumberProp(props, "yOffset");
    const withOffsets = (position: { xalign: number; yalign: number }): StoryAlignPosition => ({
        ...position,
        ...(xoffset !== undefined ? { xoffset } : {}),
        ...(yoffset !== undefined ? { yoffset } : {}),
    });

    if (preset === "left" || preset === "center" || preset === "right" || preset === "custom") {
        const targetX = preset === "left" ? 0.25 : preset === "right" ? 0.75 : preset === "center" ? 0.5 : xalign ?? 0.5;
        return withOffsets({ xalign: targetX, yalign });
    }
    if (preset === "slideLeft") return withOffsets({ xalign: xalign ?? 0.25, yalign });
    if (preset === "slideRight") return withOffsets({ xalign: xalign ?? 0.75, yalign });
    if (preset === "slideUp") return withOffsets({ xalign: xalign ?? 0.5, yalign: yalign ?? 0.7 });
    if (preset === "slideDown") return withOffsets({ xalign: xalign ?? 0.5, yalign: yalign ?? 0.3 });
    return null;
}

/**
 * The instantly-applicable props a preset transform expresses (position/zoom/scale/rotation/
 * opacity/darken-filter). Mirrors what a character "enter" folds into its show transform.
 */
export function getInlineTransformProps(
    transform: StoryTransformRef | undefined,
    onDiagnostic?: (message: string) => void,
): Record<string, unknown> {
    if (!transform) {
        return {};
    }
    if (transform.mode === "animation") {
        return {};
    }
    const preset = transform.preset ?? "none";
    if (preset === "none" || preset === "fadeIn" || preset === "fadeOut") {
        return {};
    }

    const props = transform.props ?? {};
    const inlineProps: Record<string, unknown> = {};
    const position = getPresetPosition(preset, props);
    if (position) {
        inlineProps.position = position;
    }

    const explicitZoom = optionalNumberProp(props, "zoom");
    if (explicitZoom !== undefined) {
        inlineProps.zoom = explicitZoom;
    }
    if (preset === "zoom") {
        inlineProps.zoom = explicitZoom ?? 1;
        return inlineProps;
    }
    if (preset === "scale") {
        const scale = numberProp(props, "scale", 1);
        inlineProps.scaleX = numberProp(props, "scaleX", scale);
        inlineProps.scaleY = numberProp(props, "scaleY", scale);
        return inlineProps;
    }
    if (preset === "rotate") {
        inlineProps.rotation = numberProp(props, "rotation", numberProp(props, "degrees", 0));
        return inlineProps;
    }
    if (preset === "opacity") {
        inlineProps.opacity = numberProp(props, "opacity", 1);
        return inlineProps;
    }
    if (preset === "darken") {
        inlineProps.filter = `brightness(${1 - numberProp(props, "darkness", 0.5)})`;
        return inlineProps;
    }
    if (preset === "circleReveal" || preset === "circleClose" || preset === "wipe") {
        onDiagnostic?.(`${preset} transforms cannot be folded into character show yet.`);
    }
    return inlineProps;
}

export function timelineToNlrTransformSequences(timeline: StoryAnimationTimeline): { props: Record<string, unknown>; options: Record<string, unknown> }[] {
    const groups = new Map<string, {
        startMs: number;
        durationMs: number;
        props: Record<string, unknown>;
        options: Record<string, unknown>;
    }>();
    for (const track of timeline.tracks) {
        const keyframes = [...track.keyframes].sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
        let previousTimeMs = 0;
        for (const keyframe of keyframes) {
            const startMs = Math.max(0, previousTimeMs);
            const endMs = Math.max(startMs, keyframe.timeMs);
            const durationMs = endMs - startMs;
            const props = keyframeToTransformProps(track, keyframe);
            previousTimeMs = endMs;
            if (Object.keys(props).length === 0) {
                continue;
            }
            const groupKey = `${startMs}:${durationMs}:${keyframe.easing ?? ""}`;
            const group = groups.get(groupKey) ?? {
                startMs,
                durationMs,
                props: {},
                options: cleanObject({
                    duration: durationMs,
                    ease: parseStoryEasing(keyframe.easing),
                    at: startMs,
                }),
            };
            group.props = {
                ...group.props,
                ...props,
            };
            groups.set(groupKey, group);
        }
    }
    const sequences = [...groups.values()]
        .sort((a, b) => a.startMs - b.startMs || a.durationMs - b.durationMs)
        .map(group => ({
            props: group.props,
            options: group.options,
        }));
    return sequences.length > 0 ? sequences : [{ props: {}, options: { duration: 0 } }];
}

function keyframeToTransformProps(track: StoryAnimationTrack, keyframe: StoryAnimationKeyframe): Record<string, unknown> {
    const props: StoryTransformSequenceProps = {};
    if (track.property === "position" && keyframe.value && typeof keyframe.value === "object") {
        props.position = keyframe.value as StoryTransformSequenceProps["position"];
    } else if (isNumericTrackProperty(track.property) && typeof keyframe.value === "number") {
        (props as Record<string, unknown>)[track.property] = keyframe.value;
    } else if (typeof keyframe.value === "string") {
        (props as Record<string, unknown>)[track.property] = keyframe.value;
    }
    return cleanTransformSequenceProps(props);
}

function isNumericTrackProperty(property: StoryAnimationTrackProperty): boolean {
    return property === "opacity"
        || property === "zoom"
        || property === "scaleX"
        || property === "scaleY"
        || property === "rotation";
}

export function toNlrTransformSequence(sequence: StoryAnimationSequence): { props: Record<string, unknown>; options: Record<string, unknown> } {
    return {
        props: cleanTransformSequenceProps(sequence.props),
        options: cleanTransformSequenceOptions(sequence),
    };
}

export function cleanTransformSequenceProps(props: StoryTransformSequenceProps): Record<string, unknown> {
    const next: Record<string, unknown> = {};
    if (props.position) {
        const position = cleanObject({
            xalign: props.position.xalign,
            yalign: props.position.yalign,
            xoffset: props.position.xoffset,
            yoffset: props.position.yoffset,
        });
        if (Object.keys(position).length > 0) {
            next.position = position;
        }
    }
    assignDefined(next, "opacity", props.opacity);
    assignDefined(next, "zoom", props.zoom);
    assignDefined(next, "scaleX", props.scaleX);
    assignDefined(next, "scaleY", props.scaleY);
    assignDefined(next, "rotation", props.rotation);
    assignDefined(next, "fontColor", props.fontColor);
    assignDefined(next, "maskImage", props.maskImage);
    assignDefined(next, "maskSize", props.maskSize);
    assignDefined(next, "maskPosition", props.maskPosition);
    assignDefined(next, "maskRepeat", props.maskRepeat);
    assignDefined(next, "maskMode", props.maskMode);
    assignDefined(next, "clipPath", props.clipPath);
    assignDefined(next, "filter", props.filter);
    assignDefined(next, "backdropFilter", props.backdropFilter);
    assignDefined(next, "mixBlendMode", props.mixBlendMode);
    return next;
}

export function cleanTransformSequenceOptions(sequence: StoryAnimationSequence): Record<string, unknown> {
    const options = sequence.options ?? {};
    const next: Record<string, unknown> = {};
    assignDefined(next, "duration", options.durationMs);
    assignDefined(next, "ease", parseStoryEasing(options.easing));
    assignDefined(next, "delay", options.delayMs);
    assignDefined(next, "at", options.at);
    return next;
}

export function injectVisibilityDefault(sequences: { props: Record<string, unknown>; options: Record<string, unknown> }[], visibility: VisibilityTransformMode): void {
    if (visibility === "none" || sequences.length === 0) {
        return;
    }
    const opacity = visibility === "show" ? 1 : 0;
    const last = sequences[sequences.length - 1];
    if (last.props.opacity === undefined) {
        last.props = {
            ...last.props,
            opacity,
        };
    }
}

/**
 * The settled final props of a transform ref — what the stage looks like after the transform
 * completes. For animation refs this merges every sequence's props in order (later wins,
 * positions merged per-axis, matching NLR's TransformState merge); for preset refs it is the
 * inline props. Visibility folds in the trailing opacity exactly like the live compile path.
 */
export function storyTransformRefFinalProps(
    transform: StoryTransformRef | undefined,
    visibility: VisibilityTransformMode,
    animations: ReadonlyMap<string, StoryAnimationAsset>,
    onDiagnostic?: (message: string) => void,
): Record<string, unknown> {
    if (transform?.mode === "animation") {
        const animationId = transform.animationId?.trim();
        const asset = animationId ? animations.get(animationId) : undefined;
        if (!asset) {
            onDiagnostic?.(animationId ? `Story animation not found: ${animationId}` : "Animation transform is missing animationId.");
            return visibility === "none" ? {} : { opacity: visibility === "show" ? 1 : 0 };
        }
        const sequences = asset.timeline?.tracks.length
            ? timelineToNlrTransformSequences(asset.timeline)
            : asset.sequences.length > 0
                ? asset.sequences.map(sequence => toNlrTransformSequence(sequence))
                : [{ props: {}, options: { duration: 0 } }];
        injectVisibilityDefault(sequences, visibility);
        let merged: Record<string, unknown> = {};
        for (const sequence of sequences) {
            merged = mergeTransformProps(merged, sequence.props);
        }
        return merged;
    }
    const inline = getInlineTransformProps(transform, onDiagnostic);
    if (visibility === "show") {
        return { opacity: 1, ...inline };
    }
    if (visibility === "hide") {
        return { ...inline, opacity: 0 };
    }
    return inline;
}

/** Merge transform props with NLR's position-aware semantics (position axes merge individually). */
export function mergeTransformProps(
    base: Record<string, unknown>,
    next: Record<string, unknown>,
): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...base, ...next };
    const basePosition = base.position as Record<string, unknown> | undefined;
    const nextPosition = next.position as Record<string, unknown> | undefined;
    if (basePosition && nextPosition) {
        merged.position = { ...basePosition, ...cleanObject(nextPosition) };
    }
    return merged;
}

// Stage naming lives in @shared so the compiler and every target reference resolve through one rule;
// re-exported here under the runtime's existing names.
export { normalizeStageObjectName as normalizeObjectName, characterStageObjectName as getCharacterStageObjectName } from "@shared/types/story";

export function cleanObject(input: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

export function assignDefined(target: Record<string, unknown>, key: string, value: unknown): void {
    if (value !== undefined) {
        target[key] = value;
    }
}

export function numberProp(props: Record<string, StoryLiteralValue>, key: string, fallback: number | undefined): number {
    return optionalNumberProp(props, key) ?? fallback ?? 0;
}

export function optionalNumberProp(props: Record<string, StoryLiteralValue>, key: string): number | undefined {
    const value = props[key];
    if (typeof value === "number") return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

export function stringProp(props: Record<string, StoryLiteralValue>, key: string, fallback: string): string {
    const value = props[key];
    return typeof value === "string" && value.trim() ? value : fallback;
}

export function boolProp(props: Record<string, StoryLiteralValue>, key: string, fallback: boolean): boolean {
    const value = props[key];
    return typeof value === "boolean" ? value : fallback;
}
