/**
 * The project's audio tracks, as the engine's boot-time bus declaration - and the player's own
 * volumes on top of it.
 *
 * Two halves that only make sense together:
 *
 * 1. **The shape** is the author's. It comes out of `editor/audio-tracks.json`, travels in the
 *    bundle, and is handed to `new Game({audioBuses})`. The engine realizes it into gain nodes
 *    once, at boot, and never re-shapes it - removing a channel stops every sound in its subtree,
 *    so live re-parenting would cut the music off mid-bar.
 * 2. **The volumes** are the player's. They are set after the fact through `game.audioBuses`, they
 *    survive the game unmounting, and they are what this module persists.
 *
 * Without the second half the first is a toy: a player who turns one character down loses it on
 * every launch, because the engine has no persistence of its own (`exportPreferences` /
 * `importPreferences` have no call sites anywhere in it) and Studio never sent a volume through
 * scope persistence. "Mute Bob" that forgets is worse than no slider at all.
 *
 * Comments in English per project convention.
 */

import type { AudioBusDeclaration } from "narraleaf-react";
import {
    clamp01,
    flattenAudioTrackTree,
    normalizeProjectAudioTracks,
    type ProjectAudioTrack,
} from "@shared/types/audioTrack";

/**
 * Where the player's bus volumes live in scope persistence.
 *
 * **One key holding the whole map**, not a key per bus, for three reasons:
 *
 * - A bus is authored content: the author adds `voice/alice` and later deletes it. A key per bus
 *   would leave a `audio.bus.alice` behind that nothing ever collects, in a store shared with the
 *   locale and the read-text record.
 * - The engine's own API is already map-shaped on both sides (`getVolumes()` returns exactly what
 *   `setVolumes()` takes), so a map is a straight read/write with no assembly at either end.
 * - Restore happens once at boot and has to complete before the first sound plays. One
 *   `persistenceGetAsync` is one round trip; a key per bus is one per bus, serially, on the path
 *   to the first frame.
 *
 * Namespaced under `audio.` and versioned by nothing, because the value is a plain
 * `Record<string, number>` keyed by bus id - a shape that cannot drift without the bus ids drifting
 * with it, and unknown bus ids are already harmless (see {@link readPersistedBusVolumes}).
 */
export const AUDIO_BUS_VOLUMES_PERSISTENCE_KEY = "audio.busVolumes";

/**
 * The author's tracks as a declaration the engine can resolve, parents before children.
 *
 * Order is not strictly required - the engine collects the whole declaration before validating, so
 * forward references resolve - but emitting it parents-first means the failure mode of a future
 * consumer that *does* walk it front-to-back is "works", not "silently reparents".
 *
 * The list is re-normalized first rather than trusted: `AudioBusTree.resolve` **throws** on an
 * unknown parent, a duplicate id or a cycle, and it throws lazily, the first time something plays.
 * A hand-corrupted `audio-tracks.json` must not be able to turn into "the game boots and then goes
 * silent forever with an exception nobody sees". The normalizer breaks exactly those three, so
 * after it there is nothing left for the engine to reject.
 */
export function audioTracksToBusDeclarations(
    tracks: readonly ProjectAudioTrack[] | undefined,
): AudioBusDeclaration[] {
    return flattenAudioTrackTree(normalizeProjectAudioTracks(tracks ?? [])).map(({ track }) => ({
        id: track.id,
        parentId: track.parentId,
        volume: clamp01(track.volume),
    }));
}

/**
 * A persisted value as a volume map, from whatever was in the store.
 *
 * Total: anything unreadable reads as "nothing saved", which lands the player on the volumes the
 * author declared. A stored entry naming a bus that no longer exists is kept rather than dropped -
 * `AudioBusMixer.setVolumes` records ids the tree does not contain without complaint, and keeping
 * them means an author who deletes a bus and puts it back does not silently reset the player's
 * setting for it. Nothing addresses the orphan in the meantime, so it costs one map entry.
 */
export function readPersistedBusVolumes(raw: unknown): Record<string, number> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const volumes: Record<string, number> = {};
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
        if (id.trim() && typeof value === "number" && Number.isFinite(value)) {
            volumes[id] = clamp01(value);
        }
    }
    return volumes;
}

/** The minimum of `Game.audioBuses` this module needs; structural so tests need no engine. */
export type AudioBusMixerLike = {
    setVolumes: (volumes: Readonly<Record<string, number>>) => unknown;
    getVolumes: () => Record<string, number>;
    onVolumeChange: (listener: (id: string, volume: number) => void) => unknown;
};

export type AudioBusPersistenceOptions = {
    /** `game.audioBuses`, or undefined on an engine dist that predates the mixer. */
    mixer: AudioBusMixerLike | undefined;
    read: (key: string) => Promise<unknown> | unknown;
    write: (key: string, value: unknown) => Promise<void> | void;
    /**
     * Fired after every bus volume change, alongside the write.
     *
     * The host fans this into the same listener set the preference stream feeds, which is what
     * `hostApi.sound.subscribeMixerChanges` hands to the `nl.video` widget: a DOM element is on no
     * gain node, so dragging a bus has to reach it as an event or the video keeps playing at the
     * level it mounted with.
     */
    onVolumeChange?: () => void;
    log?: (level: "info" | "warning" | "error", message: string) => void;
};

/**
 * Restore the player's saved bus volumes onto a freshly constructed game, then keep the store in
 * step with every change.
 *
 * Safe to call at any point after `new Game(...)` and before the player mounts: the mixer records a
 * volume for a bus whose channel does not exist yet and applies it when the channel is realized, so
 * there is no window where a restored value is lost. Returns a disposer for the subscription.
 *
 * Writes back the **whole** map rather than the one bus that changed, so the store always holds a
 * complete picture: a partial write would mean a crash between two slider drags could leave half
 * the mixer at its declared default and half at the player's.
 */
export async function attachAudioBusPersistence(
    options: AudioBusPersistenceOptions,
): Promise<() => void> {
    const { mixer, read, write, onVolumeChange, log } = options;
    if (!mixer) {
        return () => undefined;
    }

    try {
        const stored = readPersistedBusVolumes(await read(AUDIO_BUS_VOLUMES_PERSISTENCE_KEY));
        if (Object.keys(stored).length > 0) {
            mixer.setVolumes(stored);
        }
    } catch (error) {
        // A store that cannot be read is a player who starts at the authored volumes, not a game
        // that fails to boot.
        log?.("warning", `Audio bus volumes could not be restored: ${String(error)}`);
    }

    let disposed = false;
    const token = mixer.onVolumeChange(() => {
        if (disposed) {
            return;
        }
        try {
            void write(AUDIO_BUS_VOLUMES_PERSISTENCE_KEY, mixer.getVolumes());
        } catch (error) {
            log?.("warning", `Audio bus volumes could not be saved: ${String(error)}`);
        }
        // After the write and outside its try, so a store that refuses still updates the screen -
        // a slider that visibly does nothing is worse than one whose value is not kept.
        onVolumeChange?.();
    });

    return () => {
        disposed = true;
        // The engine hands back an `EventToken`; feature-detected because the only thing this
        // module needs from it is "stop", and an older dist that returns nothing must not throw
        // on teardown.
        (token as { cancel?: () => void } | undefined)?.cancel?.();
    };
}
