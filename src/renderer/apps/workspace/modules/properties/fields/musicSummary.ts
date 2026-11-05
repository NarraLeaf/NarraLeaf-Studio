import type { Translator } from "@shared/i18n";
import type { AudioClipRegion } from "@shared/types/audio";
import { formatSoundVolume } from "@/lib/ui-editor/widget-modules/shared/sound/SoundPlaybackOptions";

export type MusicSummaryInput = {
    /** The volume as it plays: the stored one, or 1. */
    volume: number;
    /** The track it plays on, by its display name. */
    trackName: string;
    /** Whether it loops, with the track's default already applied. */
    loops: boolean;
    /** The clip's marked region (`normalizeAudioClipRegion`), or null for an unmarked clip. */
    region: AudioClipRegion | null;
    /** The fade in and out, in milliseconds. */
    fadeMs: number;
};

/** Whole seconds where the time lands on one, one decimal otherwise. */
function formatSeconds(ms: number): string {
    const seconds = ms / 1000;
    return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

/**
 * The line a page's or a scene's music folds its options under, values only:
 * `Volume 1 · Music · Loops 12.8s to 112s`.
 *
 * It opens the way an element sound's line does (volume, then track), and adds what only music has.
 * What plays is said with the clip's marks, because the marks decide it and they are set on another
 * surface. A fade is said only when there is one.
 */
export function musicSummary(t: Translator["t"], input: MusicSummaryInput): string {
    const parts = [t("properties.interactionSound.summary", { volume: formatSoundVolume(input.volume), track: input.trackName })];
    parts.push(playbackPhrase(t, input.loops, input.region));
    if (input.fadeMs > 0) {
        parts.push(t("properties.music.fadeSummary", { seconds: formatSeconds(input.fadeMs) }));
    }
    return parts.join(" · ");
}

/**
 * What of the clip plays, as the player has it (`clipSoundConfig`): playback starts at the in point,
 * looping or not, and stops at the out point or the end of the file. A loop repeats from the loop
 * point, else from the in point, to the out point, else to the end of the file.
 *
 * A start at the head of the file goes unsaid. So does the stretch a loop point leaves before it: a
 * clip marked with a loop point plays what comes before it once, as an intro, and only an intro that
 * starts later than the head is named.
 */
function playbackPhrase(t: Translator["t"], loops: boolean, region: AudioClipRegion | null): string {
    const start = region?.inMs ?? 0;
    const end = region?.outMs;
    if (!loops) {
        if (end !== undefined) {
            return t("properties.music.onceRegion", { from: formatSeconds(start), to: formatSeconds(end) });
        }
        return start > 0 ? t("properties.music.onceFrom", { from: formatSeconds(start) }) : t("properties.music.once");
    }
    const repeat = region?.loopStartMs ?? start;
    const intro = start > 0 && repeat !== start;
    if (end !== undefined) {
        return intro
            ? t("properties.music.introLoopRegion", { start: formatSeconds(start), from: formatSeconds(repeat), to: formatSeconds(end) })
            : t("properties.music.loopRegion", { from: formatSeconds(repeat), to: formatSeconds(end) });
    }
    if (repeat > 0) {
        return intro
            ? t("properties.music.introLoopToEnd", { start: formatSeconds(start), from: formatSeconds(repeat) })
            : t("properties.music.loopToEnd", { from: formatSeconds(repeat) });
    }
    return t("properties.music.loops");
}
