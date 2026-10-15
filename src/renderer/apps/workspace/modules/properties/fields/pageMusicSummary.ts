import type { Translator } from "@shared/i18n";
import type { AudioClipRegion } from "@shared/types/audio";
import { formatSoundVolume } from "@/lib/ui-editor/widget-modules/shared/sound/SoundPlaybackOptions";

export type PageMusicSummaryInput = {
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
 * The line page music folds its options under, values only: `Volume 1 · Music · Loops 12.8s to 112s`.
 *
 * It opens the way an element sound's line does (volume, then track), and adds what only music has.
 * Looping is said with the clip's marks, because the marks decide what repeats and they are set on
 * another surface: a clip marked with a loop point and an out point repeats that stretch, after
 * playing what comes before it once; with no out point it repeats to the end of the file. A fade is
 * said only when there is one.
 */
export function pageMusicSummary(t: Translator["t"], input: PageMusicSummaryInput): string {
    const parts = [t("properties.interactionSound.summary", { volume: formatSoundVolume(input.volume), track: input.trackName })];
    parts.push(loopPhrase(t, input.loops, input.region));
    if (input.fadeMs > 0) {
        parts.push(t("properties.pageMusic.fadeSummary", { seconds: formatSeconds(input.fadeMs) }));
    }
    return parts.join(" · ");
}

function loopPhrase(t: Translator["t"], loops: boolean, region: AudioClipRegion | null): string {
    if (!loops) {
        return t("properties.pageMusic.once");
    }
    // Where the repeat starts: the loop point when there is one, else the in point, as the player has it.
    const from = region?.loopStartMs ?? region?.inMs;
    const to = region?.outMs;
    if (to !== undefined) {
        return t("properties.pageMusic.loopRegion", { from: formatSeconds(from ?? 0), to: formatSeconds(to) });
    }
    if (from !== undefined && from > 0) {
        return t("properties.pageMusic.loopToEnd", { from: formatSeconds(from) });
    }
    return t("properties.pageMusic.loops");
}
