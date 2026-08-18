import {
    anticipate,
    backIn,
    backInOut,
    backOut,
    circIn,
    circInOut,
    circOut,
    cubicBezier,
    easeIn,
    easeInOut,
    easeOut,
} from "motion/react";
import type {
    StoryAlignPositionValue,
    StoryAnimationAsset,
    StoryAnimationKeyframe,
    StoryAnimationKeyframeValue,
    StoryAnimationTimeline,
    StoryAnimationTrack,
    StoryAnimationTrackProperty,
} from "@shared/types/story";
import { parseStoryEasing } from "@shared/utils/storyEasing";
import { STORY_MOTION_DEFAULT_PRESET_ID, createStoryMotionPresetTimeline } from "./storyMotionPresets";

export const STORY_MOTION_FPS = 60;
export const STORY_MOTION_DEFAULT_DURATION_MS = 420;
export const STORY_MOTION_MAX_DURATION_MS = 300_000;
export const STORY_MOTION_DEFAULT_EASING = "easeOut";

export type StoryMotionValueKind = "position" | "number" | "text";

export type StoryMotionPropertyMeta = {
    property: StoryAnimationTrackProperty;
    label: string;
    valueKind: StoryMotionValueKind;
    core: boolean;
};

export const STORY_MOTION_PROPERTIES: StoryMotionPropertyMeta[] = [
    { property: "position", label: "Position", valueKind: "position", core: true },
    { property: "scaleX", label: "Scale X", valueKind: "number", core: true },
    { property: "scaleY", label: "Scale Y", valueKind: "number", core: true },
    { property: "zoom", label: "Zoom", valueKind: "number", core: true },
    { property: "rotation", label: "Rotation", valueKind: "number", core: true },
    { property: "opacity", label: "Opacity", valueKind: "number", core: true },
    { property: "fontColor", label: "Font color", valueKind: "text", core: false },
    { property: "maskImage", label: "Mask image", valueKind: "text", core: false },
    { property: "maskSize", label: "Mask size", valueKind: "text", core: false },
    { property: "maskPosition", label: "Mask position", valueKind: "text", core: false },
    { property: "maskRepeat", label: "Mask repeat", valueKind: "text", core: false },
    { property: "maskMode", label: "Mask mode", valueKind: "text", core: false },
    { property: "clipPath", label: "Clip path", valueKind: "text", core: false },
    { property: "filter", label: "Filter", valueKind: "text", core: false },
    { property: "backdropFilter", label: "Backdrop filter", valueKind: "text", core: false },
    { property: "mixBlendMode", label: "Blend mode", valueKind: "text", core: false },
];

export const STORY_MOTION_CORE_PROPERTIES = STORY_MOTION_PROPERTIES.filter(item => item.core);

const STORY_MOTION_NAMED_EASINGS: Record<string, (t: number) => number> = {
    linear: t => t,
    easeIn,
    easeOut,
    easeInOut,
    circIn,
    circOut,
    circInOut,
    backIn,
    backOut,
    backInOut,
    anticipate,
};

export const STORY_MOTION_EASING_OPTIONS: { value: string; label: string }[] = [
    { value: "linear", label: "Linear" },
    { value: "easeIn", label: "Ease in" },
    { value: "easeOut", label: "Ease out" },
    { value: "easeInOut", label: "Ease in-out" },
    { value: "circIn", label: "Circ in" },
    { value: "circOut", label: "Circ out" },
    { value: "circInOut", label: "Circ in-out" },
    { value: "backIn", label: "Back in" },
    { value: "backOut", label: "Back out" },
    { value: "backInOut", label: "Back in-out" },
    { value: "anticipate", label: "Anticipate" },
];

export function resolveStoryMotionEasing(easing?: string | number[]): (t: number) => number {
    const parsed = typeof easing === "string" ? parseStoryEasing(easing) : easing;
    if (Array.isArray(parsed)) {
        return parsed.length === 4 && parsed.every(value => Number.isFinite(value))
            ? cubicBezier(parsed[0], parsed[1], parsed[2], parsed[3])
            : STORY_MOTION_NAMED_EASINGS.linear;
    }
    if (parsed === undefined) {
        return STORY_MOTION_NAMED_EASINGS[STORY_MOTION_DEFAULT_EASING];
    }
    return STORY_MOTION_NAMED_EASINGS[parsed] ?? STORY_MOTION_NAMED_EASINGS.linear;
}

export type StoryMotionPreviewEffectProperty =
    | "fontColor"
    | "maskImage"
    | "maskSize"
    | "maskPosition"
    | "maskRepeat"
    | "maskMode"
    | "clipPath"
    | "filter"
    | "backdropFilter"
    | "mixBlendMode";

export type StoryMotionPreviewState = {
    position: Required<StoryAlignPositionValue>;
    opacity: number;
    zoom: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    effects: Partial<Record<StoryMotionPreviewEffectProperty, string>>;
};

const DEFAULT_PREVIEW_STATE: StoryMotionPreviewState = {
    position: {
        xalign: 0.5,
        yalign: 0.55,
        xoffset: 0,
        yoffset: 0,
    },
    opacity: 1,
    zoom: 1,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    effects: {},
};

export function getStoryMotionPropertyMeta(property: StoryAnimationTrackProperty): StoryMotionPropertyMeta {
    return STORY_MOTION_PROPERTIES.find(item => item.property === property) ?? STORY_MOTION_PROPERTIES[0];
}

export function isStoryMotionCoreProperty(property: StoryAnimationTrackProperty): boolean {
    return STORY_MOTION_CORE_PROPERTIES.some(item => item.property === property);
}

export function getStoryMotionDurationMs(timeline: StoryAnimationTimeline | undefined): number {
    const keyframeTimes = (timeline?.tracks ?? []).flatMap(track => track.keyframes.map(keyframe => keyframe.timeMs));
    if (keyframeTimes.length === 0) {
        return STORY_MOTION_DEFAULT_DURATION_MS;
    }
    return clampStoryMotionTimeMs(Math.max(...keyframeTimes));
}

/** How many evenly spaced samples {@link storyMotionSignatureTimeMs} considers besides the keyframes. */
const SIGNATURE_SAMPLE_COUNT = 16;

/**
 * The most characteristic frame of a motion — the time whose pose is furthest from neutral, weighted
 * by how visible it is.
 *
 * Exists because a gallery of motions parked at t=0 is a grid of identical squares: almost every move
 * starts from rest, so frame 0 says nothing about which one it is. Parked here instead, "push in"
 * shows a tight frame, "pan sweep" a shifted one and "dutch tilt" a tilted one, and the difference is
 * visible before the pointer arrives.
 *
 * Two things the naive version got wrong, both found by the tests below:
 *  - **Keyframe times alone are not enough.** An entrance's extreme frame is its *first* one, where it
 *    is fully transparent — so `fadeInSlide` parked on an empty square. Intermediate samples give it a
 *    half-faded sprite mid-slide, which is what the move looks like.
 *  - **Deviation must be scaled by opacity.** Otherwise "furthest from neutral" is reliably the
 *    invisible frame, since opacity 0 is itself a large deviation.
 *
 * The channel weights are deliberately crude, tuned only so no single channel drowns the others (a
 * 120px offset and a 0.33 zoom change should read as comparable).
 */
export function storyMotionSignatureTimeMs(timeline: StoryAnimationTimeline | undefined): number {
    const keyframeTimes = (timeline?.tracks ?? []).flatMap(track => track.keyframes.map(keyframe => keyframe.timeMs));
    if (keyframeTimes.length === 0) {
        return 0;
    }
    const durationMs = Math.max(...keyframeTimes);
    const sampled = Array.from(
        { length: SIGNATURE_SAMPLE_COUNT + 1 },
        (_, index) => Math.round((durationMs * index) / SIGNATURE_SAMPLE_COUNT),
    );
    const times = [...new Set([...keyframeTimes, ...sampled])].sort((left, right) => left - right);

    let best = times[0];
    let bestScore = -1;
    for (const timeMs of times) {
        const state = sampleStoryMotionPreview(timeline, timeMs);
        const deviation = Math.abs(state.zoom - 1) * 3
            + Math.abs(state.scaleX - 1) * 3
            + Math.abs(state.scaleY - 1) * 3
            + Math.abs(state.rotation) / 20
            + Math.abs(state.position.xoffset) / 120
            + Math.abs(state.position.yoffset) / 120
            + Math.abs(state.opacity - 1);
        const score = deviation * Math.min(1, Math.max(0, state.opacity));
        if (score > bestScore) {
            bestScore = score;
            best = timeMs;
        }
    }
    return best;
}

export function clampStoryMotionTimeMs(timeMs: number): number {
    return Math.max(0, Math.min(STORY_MOTION_MAX_DURATION_MS, Math.round(timeMs)));
}

export function storyMotionFrameDurationMs(fps = STORY_MOTION_FPS): number {
    return 1000 / Math.max(1, fps);
}

export function snapStoryMotionTimeToFrame(timeMs: number, fps = STORY_MOTION_FPS): number {
    const frameMs = storyMotionFrameDurationMs(fps);
    return clampStoryMotionTimeMs(Math.round(timeMs / frameMs) * frameMs);
}

export function stepStoryMotionTimeByFrames(timeMs: number, frames: number, fps = STORY_MOTION_FPS): number {
    const frameMs = storyMotionFrameDurationMs(fps);
    return clampStoryMotionTimeMs(snapStoryMotionTimeToFrame(timeMs, fps) + frames * frameMs);
}

export function formatStoryMotionTime(ms: number, fps = STORY_MOTION_FPS): string {
    const safeMs = Math.max(0, Math.round(ms));
    const frame = Math.round((safeMs / 1000) * fps);
    return `${(safeMs / 1000).toFixed(2)}s / f${frame}`;
}

export function getStoryMotionTimeline(asset: StoryAnimationAsset | null | undefined): StoryAnimationTimeline {
    return asset?.timeline ?? createStoryMotionPresetTimeline(STORY_MOTION_DEFAULT_PRESET_ID);
}

/**
 * The name a freshly created motion asset carries. Both halves arrive **already localized** — the
 * name is authored content the author reads and renames, so "立绘 震动" is the right default in a
 * Chinese project and "Character Shake" in an English one. (The previous version derived the prefix
 * from the raw `targetKind` literal, which was English in every locale.)
 */
export function createStoryMotionName(targetKindLabel: string, motionLabel: string): string {
    return `${targetKindLabel} ${motionLabel}`.trim();
}

export function sampleStoryMotionPreview(timeline: StoryAnimationTimeline | undefined, timeMs: number): StoryMotionPreviewState {
    const state: StoryMotionPreviewState = {
        ...DEFAULT_PREVIEW_STATE,
        position: { ...DEFAULT_PREVIEW_STATE.position },
        effects: {},
    };
    for (const track of timeline?.tracks ?? []) {
        const value = sampleStoryMotionTrackValue(track, timeMs);
        if (value === undefined) {
            continue;
        }
        if (track.property === "position" && typeof value === "object") {
            state.position = {
                ...state.position,
                ...value,
            };
        } else if (track.property === "opacity" && typeof value === "number") {
            state.opacity = value;
        } else if (track.property === "zoom" && typeof value === "number") {
            state.zoom = value;
        } else if (track.property === "scaleX" && typeof value === "number") {
            state.scaleX = value;
        } else if (track.property === "scaleY" && typeof value === "number") {
            state.scaleY = value;
        } else if (track.property === "rotation" && typeof value === "number") {
            state.rotation = value;
        } else if (typeof value === "string" && value && getStoryMotionPropertyMeta(track.property).valueKind === "text") {
            state.effects[track.property as StoryMotionPreviewEffectProperty] = value;
        }
    }
    return state;
}

export function upsertStoryMotionKeyframe(
    timeline: StoryAnimationTimeline,
    property: StoryAnimationTrackProperty,
    timeMs: number,
    value: StoryAnimationKeyframeValue,
    easing?: string,
): StoryAnimationTimeline {
    const next = cloneTimeline(timeline);
    const roundedTime = clampStoryMotionTimeMs(timeMs);
    let track = next.tracks.find(item => item.property === property);
    if (!track) {
        track = {
            id: `track-${property}-${Date.now().toString(36)}`,
            property,
            keyframes: [],
        };
        next.tracks.push(track);
    }
    const existing = track.keyframes.find(item => item.timeMs === roundedTime);
    if (existing) {
        existing.value = value;
        existing.easing = easing ?? existing.easing;
    } else {
        track.keyframes.push({
            id: `kf-${property}-${roundedTime}-${Date.now().toString(36)}`,
            timeMs: roundedTime,
            value,
            easing: easing ?? STORY_MOTION_DEFAULT_EASING,
        });
    }
    track.keyframes.sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
    next.durationMs = getStoryMotionDurationMs(next);
    return next;
}

export function updateStoryMotionKeyframe(
    timeline: StoryAnimationTimeline,
    keyframeId: string,
    updater: (keyframe: StoryAnimationKeyframe, track: StoryAnimationTrack) => StoryAnimationKeyframe,
): StoryAnimationTimeline {
    const next = cloneTimeline(timeline);
    for (const track of next.tracks) {
        const index = track.keyframes.findIndex(keyframe => keyframe.id === keyframeId);
        if (index >= 0) {
            track.keyframes[index] = updater(track.keyframes[index], track);
            track.keyframes[index].timeMs = clampStoryMotionTimeMs(track.keyframes[index].timeMs);
            track.keyframes.sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
            next.durationMs = getStoryMotionDurationMs(next);
            return next;
        }
    }
    return next;
}

export function deleteStoryMotionKeyframe(timeline: StoryAnimationTimeline, keyframeId: string): StoryAnimationTimeline {
    const next = cloneTimeline(timeline);
    next.tracks = next.tracks
        .map(track => ({
            ...track,
            keyframes: track.keyframes.filter(keyframe => keyframe.id !== keyframeId),
        }))
        .filter(track => track.keyframes.length > 0);
    next.durationMs = getStoryMotionDurationMs(next);
    return next;
}

export function deleteStoryMotionTrack(timeline: StoryAnimationTimeline, trackId: string): StoryAnimationTimeline {
    const next = cloneTimeline(timeline);
    next.tracks = next.tracks.filter(track => track.id !== trackId);
    next.durationMs = getStoryMotionDurationMs(next);
    return next;
}

export function ensureStoryMotionTrack(
    timeline: StoryAnimationTimeline,
    property: StoryAnimationTrackProperty,
    timeMs = 0,
): StoryAnimationTimeline {
    if (timeline.tracks.some(track => track.property === property)) {
        return timeline;
    }
    return upsertStoryMotionKeyframe(timeline, property, timeMs, defaultValueForProperty(property));
}

export function sampleStoryMotionTrackValue(track: StoryAnimationTrack, timeMs: number): StoryAnimationKeyframeValue | undefined {
    const keyframes = [...track.keyframes].sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
    if (keyframes.length === 0) {
        return undefined;
    }
    const next = keyframes.find(keyframe => keyframe.timeMs >= timeMs);
    const previous = [...keyframes].reverse().find(keyframe => keyframe.timeMs <= timeMs);
    if (!next) {
        return keyframes[keyframes.length - 1].value;
    }
    if (!previous || previous.id === next.id) {
        return next.value;
    }
    const rawProgress = Math.max(0, Math.min(1, (timeMs - previous.timeMs) / Math.max(1, next.timeMs - previous.timeMs)));
    const easedProgress = resolveStoryMotionEasing(next.easing)(rawProgress);
    return interpolateValue(previous.value, next.value, easedProgress, rawProgress);
}

function interpolateValue(
    from: StoryAnimationKeyframeValue,
    to: StoryAnimationKeyframeValue,
    easedProgress: number,
    rawProgress: number,
): StoryAnimationKeyframeValue {
    if (typeof from === "number" && typeof to === "number") {
        return from + (to - from) * easedProgress;
    }
    if (typeof from === "object" && typeof to === "object") {
        return {
            xalign: lerp(from.xalign ?? DEFAULT_PREVIEW_STATE.position.xalign, to.xalign ?? DEFAULT_PREVIEW_STATE.position.xalign, easedProgress),
            yalign: lerp(from.yalign ?? DEFAULT_PREVIEW_STATE.position.yalign, to.yalign ?? DEFAULT_PREVIEW_STATE.position.yalign, easedProgress),
            xoffset: lerp(from.xoffset ?? 0, to.xoffset ?? 0, easedProgress),
            yoffset: lerp(from.yoffset ?? 0, to.yoffset ?? 0, easedProgress),
        };
    }
    return rawProgress >= 1 ? to : from;
}

function defaultValueForProperty(property: StoryAnimationTrackProperty): StoryAnimationKeyframeValue {
    if (property === "position") return DEFAULT_PREVIEW_STATE.position;
    if (property === "opacity") return DEFAULT_PREVIEW_STATE.opacity;
    if (property === "zoom") return DEFAULT_PREVIEW_STATE.zoom;
    if (property === "scaleX") return DEFAULT_PREVIEW_STATE.scaleX;
    if (property === "scaleY") return DEFAULT_PREVIEW_STATE.scaleY;
    if (property === "rotation") return DEFAULT_PREVIEW_STATE.rotation;
    if (getStoryMotionPropertyMeta(property).valueKind === "text") return "";
    return DEFAULT_PREVIEW_STATE.opacity;
}

function lerp(from: number, to: number, progress: number): number {
    return from + (to - from) * progress;
}

function cloneTimeline(timeline: StoryAnimationTimeline): StoryAnimationTimeline {
    return JSON.parse(JSON.stringify(timeline)) as StoryAnimationTimeline;
}
