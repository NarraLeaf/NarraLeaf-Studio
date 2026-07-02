import type {
    StoryAlignPositionValue,
    StoryAnimationAsset,
    StoryAnimationKeyframe,
    StoryAnimationKeyframeValue,
    StoryAnimationTimeline,
    StoryAnimationTrack,
    StoryAnimationTrackProperty,
    StoryDisplayableTargetKind,
} from "@shared/types/story";

export const STORY_MOTION_FPS = 60;
export const STORY_MOTION_DEFAULT_DURATION_MS = 420;
export const STORY_MOTION_MAX_DURATION_MS = 300_000;

export const STORY_MOTION_TEMPLATES = [
    "Fade in + slide",
    "Center pop",
    "Look around",
    "Flash",
] as const;

export type StoryMotionTemplateName = typeof STORY_MOTION_TEMPLATES[number];
export type StoryMotionEditableTrackProperty = Extract<
    StoryAnimationTrackProperty,
    "position" | "scaleX" | "scaleY" | "zoom" | "rotation" | "opacity"
>;

export const STORY_MOTION_PROPERTIES: {
    property: StoryMotionEditableTrackProperty;
    label: string;
    valueKind: "position" | "number";
}[] = [
    { property: "position", label: "Position", valueKind: "position" },
    { property: "scaleX", label: "Scale X", valueKind: "number" },
    { property: "scaleY", label: "Scale Y", valueKind: "number" },
    { property: "zoom", label: "Zoom", valueKind: "number" },
    { property: "rotation", label: "Rotation", valueKind: "number" },
    { property: "opacity", label: "Opacity", valueKind: "number" },
];

export type StoryMotionPreviewState = {
    position: Required<StoryAlignPositionValue>;
    opacity: number;
    zoom: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
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
};

export function getStoryMotionPropertyMeta(property: StoryAnimationTrackProperty) {
    return STORY_MOTION_PROPERTIES.find(item => item.property === property) ?? STORY_MOTION_PROPERTIES[0];
}

export function isStoryMotionEditableProperty(property: StoryAnimationTrackProperty): property is StoryMotionEditableTrackProperty {
    return STORY_MOTION_PROPERTIES.some(item => item.property === property);
}

export function getStoryMotionDurationMs(timeline: StoryAnimationTimeline | undefined): number {
    const keyframeDuration = Math.max(0, ...(timeline?.tracks ?? []).flatMap(track => track.keyframes.map(keyframe => keyframe.timeMs)));
    return clampStoryMotionTimeMs(Math.max(STORY_MOTION_DEFAULT_DURATION_MS, timeline?.durationMs ?? 0, keyframeDuration));
}

export function clampStoryMotionTimeMs(timeMs: number): number {
    return Math.max(0, Math.min(STORY_MOTION_MAX_DURATION_MS, Math.round(timeMs)));
}

export function formatStoryMotionTime(ms: number, fps = STORY_MOTION_FPS): string {
    const safeMs = Math.max(0, Math.round(ms));
    const frame = Math.round((safeMs / 1000) * fps);
    return `${(safeMs / 1000).toFixed(2)}s / f${frame}`;
}

export function getStoryMotionTimeline(asset: StoryAnimationAsset | null | undefined): StoryAnimationTimeline {
    return asset?.timeline ?? createStoryMotionTemplateTimeline("Fade in + slide");
}

export function createStoryMotionTemplateTimeline(template: StoryMotionTemplateName = "Fade in + slide"): StoryAnimationTimeline {
    switch (template) {
        case "Center pop":
            return timeline(360, [
                track("zoom", [
                    keyframe("zoom", 0, 0.82, "easeOut"),
                    keyframe("zoom", 220, 1.08, "easeOut"),
                    keyframe("zoom", 360, 1, "easeOut"),
                ]),
                track("opacity", [
                    keyframe("opacity", 0, 0, "easeOut"),
                    keyframe("opacity", 180, 1, "easeOut"),
                ]),
            ]);
        case "Look around":
            return timeline(540, [
                track("rotation", [
                    keyframe("rotation", 0, -3, "easeInOut"),
                    keyframe("rotation", 220, 3, "easeInOut"),
                    keyframe("rotation", 540, 0, "easeOut"),
                ]),
            ]);
        case "Flash":
            return timeline(280, [
                track("opacity", [
                    keyframe("opacity", 0, 0, "linear"),
                    keyframe("opacity", 80, 1, "linear"),
                    keyframe("opacity", 150, 0.2, "linear"),
                    keyframe("opacity", 280, 1, "easeOut"),
                ]),
            ]);
        case "Fade in + slide":
        default:
            return timeline(420, [
                track("position", [
                    keyframe("position", 0, { xalign: 0.5, yalign: 0.55, xoffset: -120, yoffset: 0 }, "easeOut"),
                    keyframe("position", 420, { xalign: 0.5, yalign: 0.55, xoffset: 0, yoffset: 0 }, "easeOut"),
                ]),
                track("opacity", [
                    keyframe("opacity", 0, 0, "easeOut"),
                    keyframe("opacity", 420, 1, "easeOut"),
                ]),
            ]);
    }
}

export function createStoryMotionName(targetKind: StoryDisplayableTargetKind | undefined, template?: StoryMotionTemplateName): string {
    const target = targetKind ? targetKind[0].toUpperCase() + targetKind.slice(1) : "Displayable";
    return template ? `${target} ${template}` : `${target} Motion`;
}

export function sampleStoryMotionPreview(timeline: StoryAnimationTimeline | undefined, timeMs: number): StoryMotionPreviewState {
    const state: StoryMotionPreviewState = {
        ...DEFAULT_PREVIEW_STATE,
        position: { ...DEFAULT_PREVIEW_STATE.position },
    };
    for (const track of timeline?.tracks ?? []) {
        const value = sampleTrackValue(track, timeMs);
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
        }
    }
    return state;
}

export function upsertStoryMotionKeyframe(
    timeline: StoryAnimationTimeline,
    property: StoryAnimationTrackProperty,
    timeMs: number,
    value: StoryAnimationKeyframeValue,
    easing = "easeOut",
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
        existing.easing = easing;
    } else {
        track.keyframes.push({
            id: `kf-${property}-${roundedTime}-${Date.now().toString(36)}`,
            timeMs: roundedTime,
            value,
            easing,
        });
    }
    track.keyframes.sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
    next.durationMs = Math.max(getStoryMotionDurationMs(next), roundedTime);
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

export function ensureStoryMotionTrack(timeline: StoryAnimationTimeline, property: StoryAnimationTrackProperty): StoryAnimationTimeline {
    if (timeline.tracks.some(track => track.property === property)) {
        return timeline;
    }
    return upsertStoryMotionKeyframe(timeline, property, 0, defaultValueForProperty(property), "easeOut");
}

function sampleTrackValue(track: StoryAnimationTrack, timeMs: number): StoryAnimationKeyframeValue | undefined {
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
        return interpolateValue(defaultValueForProperty(track.property), next.value, next.timeMs === 0 ? 1 : timeMs / next.timeMs);
    }
    const progress = (timeMs - previous.timeMs) / Math.max(1, next.timeMs - previous.timeMs);
    return interpolateValue(previous.value, next.value, progress);
}

function interpolateValue(from: StoryAnimationKeyframeValue, to: StoryAnimationKeyframeValue, progress: number): StoryAnimationKeyframeValue {
    const t = Math.max(0, Math.min(1, progress));
    if (typeof from === "number" && typeof to === "number") {
        return from + (to - from) * t;
    }
    if (typeof from === "object" && typeof to === "object") {
        return {
            xalign: lerp(from.xalign ?? DEFAULT_PREVIEW_STATE.position.xalign, to.xalign ?? DEFAULT_PREVIEW_STATE.position.xalign, t),
            yalign: lerp(from.yalign ?? DEFAULT_PREVIEW_STATE.position.yalign, to.yalign ?? DEFAULT_PREVIEW_STATE.position.yalign, t),
            xoffset: lerp(from.xoffset ?? 0, to.xoffset ?? 0, t),
            yoffset: lerp(from.yoffset ?? 0, to.yoffset ?? 0, t),
        };
    }
    return t >= 1 ? to : from;
}

function defaultValueForProperty(property: StoryAnimationTrackProperty): StoryAnimationKeyframeValue {
    if (property === "position") return DEFAULT_PREVIEW_STATE.position;
    if (property === "opacity") return DEFAULT_PREVIEW_STATE.opacity;
    if (property === "zoom") return DEFAULT_PREVIEW_STATE.zoom;
    if (property === "scaleX") return DEFAULT_PREVIEW_STATE.scaleX;
    if (property === "scaleY") return DEFAULT_PREVIEW_STATE.scaleY;
    if (property === "rotation") return DEFAULT_PREVIEW_STATE.rotation;
    return DEFAULT_PREVIEW_STATE.opacity;
}

function timeline(durationMs: number, tracks: StoryAnimationTrack[]): StoryAnimationTimeline {
    return {
        durationMs,
        tracks,
    };
}

function track(property: StoryAnimationTrackProperty, keyframes: StoryAnimationKeyframe[]): StoryAnimationTrack {
    return {
        id: `track-${property}`,
        property,
        keyframes,
    };
}

function keyframe(
    property: StoryAnimationTrackProperty,
    timeMs: number,
    value: StoryAnimationKeyframeValue,
    easing: string,
): StoryAnimationKeyframe {
    return {
        id: `kf-${property}-${timeMs}`,
        timeMs,
        value,
        easing,
    };
}

function lerp(from: number, to: number, progress: number): number {
    return from + (to - from) * progress;
}

function cloneTimeline(timeline: StoryAnimationTimeline): StoryAnimationTimeline {
    return JSON.parse(JSON.stringify(timeline)) as StoryAnimationTimeline;
}
