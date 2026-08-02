import type { TranslationKey, Translator } from "@shared/i18n";
import type { AudioTrackChannel, ProjectAudioTrack } from "@shared/types/audioTrack";
import { AUDIO_TRACK_CHANNELS, resolveAudioTrackChain } from "@shared/types/audioTrack";

/**
 * The player's own volume sliders, which alias onto the three seeded buses. Their names are fixed:
 * an author who renames the `voice` bus to "Dialogue" does not rename the player's Voice Volume, so
 * the two have to be said separately or the connection between them is unguessable.
 */
const SLIDER_KEYS: Record<AudioTrackChannel, TranslationKey> = {
    bgm: "project.audio.slider.bgm",
    sound: "project.audio.slider.sound",
    voice: "project.audio.slider.voice",
};

/**
 * Where a clip's audio goes, as one values-only line: the bus chain, then the player slider.
 *
 * `Alice → Voice · Voice Volume`
 *
 * **This says the two things a row's own fields cannot.** The Track select shows what the author
 * *picked* - often "Default (SFX)", and on the control verbs (`/vol`, `/stop`) it is not shown at
 * all, because those address a handle another row created and inherit its bus. So the resolved bus
 * is invisible. And the slider is invisible by construction: which of the player's four volumes
 * reaches this clip follows from where its bus sits in the tree, which lives on another surface
 * entirely.
 *
 * What it deliberately does NOT carry is a number. The previous version printed an "effective
 * volume" - the authored volume pre-multiplied by the track's gain - and that number no longer
 * exists: a bus applies its gain live in the engine's gain graph, so there is no compile-time
 * product to show, and the player moving a slider would change it anyway. Printing one would be
 * printing a value the author never typed and cannot find on any surface. The authored volume and
 * fade are already on screen, in their own fields, so repeating them would say nothing either.
 *
 * A chain that reaches the master output through none of the three seeded buses - an author's own
 * root - is governed by the global volume alone, and says so.
 */
export function audioBusStatusLine(
    t: Translator["t"],
    tracks: readonly ProjectAudioTrack[],
    trackId: string | null | undefined,
    fallbackChannel: AudioTrackChannel,
): string {
    const chain = resolveAudioTrackChain(tracks, trackId, fallbackChannel);
    // Master-most wins: the engine's own slot checks walk up to the top, so a bus beneath `voice`
    // is governed by Voice Volume however many buses of the author's own sit in between.
    const seeded = [...chain]
        .reverse()
        .find(track => (AUDIO_TRACK_CHANNELS as readonly string[]).includes(track.id));
    const slider = seeded
        ? t(SLIDER_KEYS[seeded.id as AudioTrackChannel])
        : t("project.audio.slider.global");

    return [chain.map(track => track.name).join(" → "), slider].join(" · ");
}
