import type {
    StoryAlignPositionValue,
    StoryAnimationKeyframe,
    StoryAnimationKeyframeValue,
    StoryAnimationTimeline,
    StoryAnimationTrack,
    StoryAnimationTrackProperty,
} from "@shared/types/story";
import {
    STORY_MOTION_MAX_DURATION_MS,
    clampStoryMotionTimeMs,
    getStoryMotionDurationMs,
    sampleStoryMotionTrackValue,
    upsertStoryMotionKeyframe,
} from "./storyMotionTimeline";

/**
 * Edits that act on a set of keyframes at once: what the timeline's selection, clipboard and keyboard
 * reach for. Every function here is pure and returns a new timeline; the editor owns which keyframes
 * are selected and passes their ids in.
 */

/** Keyframes copied out of a timeline, timed from the earliest of them. */
export type StoryMotionClipboard = {
    items: Array<{
        property: StoryAnimationTrackProperty;
        offsetMs: number;
        value: StoryAnimationKeyframeValue;
        easing?: string;
    }>;
};

const POSITION_AXES = ["xalign", "yalign", "xoffset", "yoffset"] as const;

/** Every keyframe time in the timeline, once each, in order. */
export function listStoryMotionKeyframeTimes(
    timeline: StoryAnimationTimeline,
    trackIds?: ReadonlySet<string>,
): number[] {
    const times = new Set<number>();
    for (const track of timeline.tracks) {
        if (trackIds && !trackIds.has(track.id)) {
            continue;
        }
        for (const keyframe of track.keyframes) {
            times.add(keyframe.timeMs);
        }
    }
    return [...times].sort((a, b) => a - b);
}

/**
 * The nearest keyframe time strictly before (`-1`) or after (`1`) a time, or null at either end.
 * "Strictly" by half a millisecond, so standing on a keyframe and asking for the next one moves on.
 */
export function adjacentStoryMotionKeyframeTime(
    timeline: StoryAnimationTimeline,
    timeMs: number,
    direction: -1 | 1,
    trackIds?: ReadonlySet<string>,
): number | null {
    const times = listStoryMotionKeyframeTimes(timeline, trackIds);
    if (direction > 0) {
        return times.find(time => time > timeMs + 0.5) ?? null;
    }
    for (let index = times.length - 1; index >= 0; index--) {
        if (times[index] < timeMs - 0.5) {
            return times[index];
        }
    }
    return null;
}

/** The keyframe a track has at this time, if any. */
export function findStoryMotionKeyframeAt(track: StoryAnimationTrack, timeMs: number): StoryAnimationKeyframe | null {
    return track.keyframes.find(keyframe => Math.abs(keyframe.timeMs - timeMs) < 0.5) ?? null;
}

/**
 * How far a set of keyframes can actually move: the whole set keeps its spacing, so the earliest one
 * stops at zero and the latest at the longest motion there can be.
 */
export function clampStoryMotionKeyframeDelta(
    timeline: StoryAnimationTimeline,
    ids: ReadonlySet<string>,
    deltaMs: number,
): number {
    let earliest = Infinity;
    let latest = -Infinity;
    for (const track of timeline.tracks) {
        for (const keyframe of track.keyframes) {
            if (ids.has(keyframe.id)) {
                earliest = Math.min(earliest, keyframe.timeMs);
                latest = Math.max(latest, keyframe.timeMs);
            }
        }
    }
    if (!Number.isFinite(earliest)) {
        return 0;
    }
    return Math.round(Math.min(STORY_MOTION_MAX_DURATION_MS - latest, Math.max(-earliest, deltaMs)));
}

/**
 * Move keyframes by the same amount. A moved keyframe that lands on another keyframe of its track
 * replaces it, the way a timeline drops one clip over another: two keyframes at one time on one
 * track would leave the value there undecided.
 */
export function moveStoryMotionKeyframes(
    timeline: StoryAnimationTimeline,
    ids: ReadonlySet<string>,
    deltaMs: number,
): StoryAnimationTimeline {
    const delta = clampStoryMotionKeyframeDelta(timeline, ids, deltaMs);
    if (delta === 0) {
        return timeline;
    }
    const tracks = timeline.tracks.map(track => {
        if (!track.keyframes.some(keyframe => ids.has(keyframe.id))) {
            return track;
        }
        const moved = track.keyframes
            .filter(keyframe => ids.has(keyframe.id))
            .map(keyframe => ({ ...keyframe, timeMs: clampStoryMotionTimeMs(keyframe.timeMs + delta) }));
        const landed = new Set(moved.map(keyframe => keyframe.timeMs));
        const kept = track.keyframes.filter(keyframe => !ids.has(keyframe.id) && !landed.has(keyframe.timeMs));
        return { ...track, keyframes: sortKeyframes([...kept, ...moved]) };
    });
    return withDuration({ ...timeline, tracks });
}

/** Delete keyframes. A track left with none goes with them, as deleting a single keyframe does. */
export function deleteStoryMotionKeyframes(
    timeline: StoryAnimationTimeline,
    ids: ReadonlySet<string>,
): StoryAnimationTimeline {
    const tracks = timeline.tracks
        .map(track => ({ ...track, keyframes: track.keyframes.filter(keyframe => !ids.has(keyframe.id)) }))
        .filter(track => track.keyframes.length > 0);
    return withDuration({ ...timeline, tracks });
}

/** Copy keyframes out, timed from the earliest one so a paste lands them at the playhead. */
export function copyStoryMotionKeyframes(
    timeline: StoryAnimationTimeline,
    ids: ReadonlySet<string>,
): StoryMotionClipboard | null {
    const picked: Array<{ property: StoryAnimationTrackProperty; keyframe: StoryAnimationKeyframe }> = [];
    for (const track of timeline.tracks) {
        for (const keyframe of track.keyframes) {
            if (ids.has(keyframe.id)) {
                picked.push({ property: track.property, keyframe });
            }
        }
    }
    if (picked.length === 0) {
        return null;
    }
    const earliest = Math.min(...picked.map(item => item.keyframe.timeMs));
    return {
        items: picked.map(({ property, keyframe }) => ({
            property,
            offsetMs: keyframe.timeMs - earliest,
            value: cloneValue(keyframe.value),
            ...(keyframe.easing !== undefined ? { easing: keyframe.easing } : {}),
        })),
    };
}

/**
 * Paste copied keyframes with the earliest at `atMs`. A property the motion does not animate yet
 * gains a track; a keyframe already at a pasted time takes the pasted value. Returns the ids of the
 * pasted keyframes so the editor can select them.
 */
export function pasteStoryMotionKeyframes(
    timeline: StoryAnimationTimeline,
    clipboard: StoryMotionClipboard,
    atMs: number,
): { timeline: StoryAnimationTimeline; ids: string[] } {
    let next = timeline;
    const landed: Array<{ property: StoryAnimationTrackProperty; timeMs: number }> = [];
    for (const item of clipboard.items) {
        const timeMs = clampStoryMotionTimeMs(atMs + item.offsetMs);
        next = upsertStoryMotionKeyframe(next, item.property, timeMs, cloneValue(item.value), item.easing);
        landed.push({ property: item.property, timeMs });
    }
    return { timeline: next, ids: collectKeyframeIds(next, landed) };
}

/** Give keyframes one easing; `undefined` returns them to the default. */
export function setStoryMotionKeyframesEasing(
    timeline: StoryAnimationTimeline,
    ids: ReadonlySet<string>,
    easing: string | undefined,
): StoryAnimationTimeline {
    return {
        ...timeline,
        tracks: timeline.tracks.map(track => track.keyframes.some(keyframe => ids.has(keyframe.id))
            ? {
                ...track,
                keyframes: track.keyframes.map(keyframe => {
                    if (!ids.has(keyframe.id)) {
                        return keyframe;
                    }
                    const { easing: _previous, ...rest } = keyframe;
                    return easing === undefined ? rest : { ...rest, easing };
                }),
            }
            : track),
    };
}

/**
 * Key the given tracks at a time with the value they already have there, so the motion looks the
 * same and the time becomes a point to edit. A keyframe already at that time is left alone.
 */
export function insertStoryMotionKeyframes(
    timeline: StoryAnimationTimeline,
    trackIds: ReadonlySet<string>,
    timeMs: number,
): { timeline: StoryAnimationTimeline; ids: string[] } {
    const time = clampStoryMotionTimeMs(timeMs);
    let next = timeline;
    const landed: Array<{ property: StoryAnimationTrackProperty; timeMs: number }> = [];
    for (const track of timeline.tracks) {
        if (!trackIds.has(track.id)) {
            continue;
        }
        landed.push({ property: track.property, timeMs: time });
        if (findStoryMotionKeyframeAt(track, time)) {
            continue;
        }
        const value = keyableTrackValue(track, time);
        if (value !== undefined) {
            next = upsertStoryMotionKeyframe(next, track.property, time, value);
        }
    }
    return { timeline: next, ids: collectKeyframeIds(next, landed) };
}

/** The keyframes whose time falls in a range, on the given tracks: what a marquee covers. */
export function storyMotionKeyframesInRange(
    timeline: StoryAnimationTimeline,
    trackIds: ReadonlySet<string>,
    startMs: number,
    endMs: number,
): string[] {
    const low = Math.min(startMs, endMs);
    const high = Math.max(startMs, endMs);
    const ids: string[] = [];
    for (const track of timeline.tracks) {
        if (!trackIds.has(track.id)) {
            continue;
        }
        for (const keyframe of track.keyframes) {
            if (keyframe.timeMs >= low && keyframe.timeMs <= high) {
                ids.push(keyframe.id);
            }
        }
    }
    return ids;
}

/**
 * The time a dragged time snaps to: the nearest candidate within `tolerancePx` on screen, or null when
 * none is that close. Measured in pixels so the pull feels the same at every zoom.
 */
export function snapStoryMotionTime(
    timeMs: number,
    candidates: readonly number[],
    tolerancePx: number,
    pxPerMs: number,
): number | null {
    let best: number | null = null;
    let bestDistance = tolerancePx / Math.max(pxPerMs, 1e-6);
    for (const candidate of candidates) {
        const distance = Math.abs(candidate - timeMs);
        // A tie goes to the candidate seen first, so the result does not depend on duplicates.
        if (best === null ? distance <= bestDistance : distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }
    return best;
}

/**
 * The value a track has at a time, in the shape a keyframe stores.
 *
 * Position is the case that needs care: sampling fills in every axis, centre-aligned where nothing
 * said otherwise, and writing those back would pin the target to the middle of the stage - a motion
 * says how something moves *from where the row put it*, so it may only carry the axes its keyframes
 * already write. See {@link positionForWrite}.
 */
export function keyableTrackValue(track: StoryAnimationTrack, timeMs: number): StoryAnimationKeyframeValue | undefined {
    const value = sampleStoryMotionTrackValue(track, timeMs);
    if (track.property === "position" && value && typeof value === "object") {
        return positionForWrite(track, value, {});
    }
    // A value read off a curve has every digit the float carries; a keyframe keeps four.
    return typeof value === "number" ? round(value, 4) : value;
}

/**
 * A position value to store on this track: the axes its keyframes already write (taken from the
 * sampled value), plus the offsets, which every positional edit in the editor changes, plus `patch`.
 * An align axis the track never wrote stays unwritten, so the target keeps the place the row gave it.
 */
export function positionForWrite(
    track: StoryAnimationTrack | undefined,
    sampled: StoryAlignPositionValue,
    patch: StoryAlignPositionValue,
): StoryAlignPositionValue {
    const written = new Set<keyof StoryAlignPositionValue>(["xoffset", "yoffset"]);
    for (const keyframe of track?.keyframes ?? []) {
        if (keyframe.value && typeof keyframe.value === "object") {
            for (const axis of POSITION_AXES) {
                if (typeof keyframe.value[axis] === "number") {
                    written.add(axis);
                }
            }
        }
    }
    for (const axis of POSITION_AXES) {
        if (typeof patch[axis] === "number") {
            written.add(axis);
        }
    }
    const result: StoryAlignPositionValue = {};
    for (const axis of POSITION_AXES) {
        if (!written.has(axis)) {
            continue;
        }
        const value = typeof patch[axis] === "number" ? patch[axis] : sampled[axis];
        result[axis] = typeof value === "number" && Number.isFinite(value) ? round(value, axis.endsWith("align") ? 4 : 2) : 0;
    }
    return result;
}

function collectKeyframeIds(
    timeline: StoryAnimationTimeline,
    landed: Array<{ property: StoryAnimationTrackProperty; timeMs: number }>,
): string[] {
    const ids: string[] = [];
    for (const { property, timeMs } of landed) {
        const track = timeline.tracks.find(item => item.property === property);
        const keyframe = track ? findStoryMotionKeyframeAt(track, timeMs) : null;
        if (keyframe && !ids.includes(keyframe.id)) {
            ids.push(keyframe.id);
        }
    }
    return ids;
}

function sortKeyframes(keyframes: StoryAnimationKeyframe[]): StoryAnimationKeyframe[] {
    return [...keyframes].sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
}

function withDuration(timeline: StoryAnimationTimeline): StoryAnimationTimeline {
    return { ...timeline, durationMs: getStoryMotionDurationMs(timeline) };
}

function cloneValue(value: StoryAnimationKeyframeValue): StoryAnimationKeyframeValue {
    return value && typeof value === "object" ? { ...value } : value;
}

function round(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
