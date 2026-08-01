/**
 * Backs the blueprint `sound` capability family for authored UI.
 *
 * Playback goes through the engine's `LiveGame.playSound`, never a host-owned
 * audio element. That is the whole reason this module is thin: the engine already
 * owns the per-channel mixer, so a clip started on the `bgm` channel follows the
 * player's BGM volume, the master volume and mute with no work here. Reproducing
 * any of that host-side would produce sound the player's settings cannot reach.
 *
 * What the host does own is the handle registry. A blueprint cannot hold an
 * engine `SoundToken` (it is not JSON-safe and must not cross into graph data),
 * so tokens live here behind opaque `{kind:"soundHandle", id}` values.
 *
 * Comments in English per project convention.
 */

import type { LiveGame } from "narraleaf-react";
import {
    toBlueprintSoundHandle,
    type BlueprintSoundHandle,
} from "@shared/types/blueprint/valueTypes";
import {
    BUILTIN_AUDIO_TRACKS,
    DEFAULT_AUDIO_TRACK_ID,
    resolveAudioTrack,
    resolveAudioTrackPlayback,
    type AudioTrackPlayback,
    type ProjectAudioTrack,
} from "@shared/types/audioTrack";
import type { BlueprintSoundPlayInput } from "../../blueprint-runtime/BlueprintHostApiBridge";
import type { StoryAssetKind } from "@/lib/ui-editor/runtime/game/storyCompiler";

/** The engine's SoundToken surface, duck-typed so an older dist degrades. */
type EngineSoundToken = {
    /** The option key is `fadeDuration`; a token from an older dist simply ignores it. */
    stop?: (options?: { fadeDuration?: number }) => unknown;
    pause?: () => unknown;
    resume?: () => unknown;
    isPlaying?: () => boolean;
    getVolume?: () => number;
    setVolume?: (volume: number) => unknown;
    /** Ramps the gain. Present since the sound backend's first release. */
    fade?: (from: number, to: number, duration: number) => { finished?: Promise<void> } | unknown;
    seek?: (time: number) => unknown;
};

/** `LiveGame.playSound` and the Sound constructor, both feature-detected. */
type EngineSoundHost = {
    playSound?: (sound: unknown) => Promise<EngineSoundToken> | EngineSoundToken;
};

export type SoundTransportOptions = {
    getLiveGame: () => LiveGame | null;
    resolveAssetUrl: (
        assetId: string,
        assetType?: StoryAssetKind,
    ) => Promise<string | null | undefined> | string | null | undefined;
    /**
     * The project's audio tracks. A function rather than a value because the bundle can be replaced
     * by a hot reload under a transport whose identity is deliberately stable across relaunches.
     * Omitted (or empty) resolves to the built-ins, which is what a host with no track file has.
     */
    getAudioTracks?: () => readonly ProjectAudioTrack[] | undefined;
    /**
     * Builds the engine Sound element for a url + channel. Injected rather than
     * imported so this module stays free of a hard engine dependency and can be
     * unit-tested without one.
     */
    createSound: (input: {
        src: string;
        channel: AudioTrackPlayback["channel"];
        loop: boolean;
        volume: number;
        /** So the host can fold in the in/out points marked on this asset. */
        assetId: string;
    }) => unknown;
    log: (level: "info" | "warning" | "error", message: string) => void;
};

/**
 * What a `Play Sound` request resolves to once its track has been folded in.
 *
 * Exported so the migration from the old `soundChannel` select is testable without a live game:
 * the whole point of the track model is that this function, not the node, decides the bus.
 */
export function resolveSoundPlayback(
    input: BlueprintSoundPlayInput,
    tracks: readonly ProjectAudioTrack[] | undefined,
): AudioTrackPlayback {
    const list = tracks && tracks.length > 0 ? tracks : BUILTIN_AUDIO_TRACKS;
    // A graph written before tracks existed carries `channel` and no `audioTrackId`. Mapping it to
    // that channel's built-in reproduces the old behaviour exactly, which is why the fallback lives
    // here rather than in a document migration alone - a graph can reach the runtime unmigrated
    // (an older project opened by a plugin, a hand-written host call) and must still make a sound.
    const legacyTrackId = input.channel ? DEFAULT_AUDIO_TRACK_ID[input.channel] : null;
    const track = resolveAudioTrack(list, input.audioTrackId ?? legacyTrackId, input.channel ?? "sound");
    const playback = resolveAudioTrackPlayback(track, { volume: input.volume, loop: input.loop });
    // A play carries only a fade-in, so it overrides that one field rather than going through the
    // shared `fadeMs` override (which sets both directions): the track's fade-out has to stay
    // authoritative for the eventual stop, which this call knows nothing about.
    const fadeInMs = typeof input.fadeInMs === "number" && Number.isFinite(input.fadeInMs)
        ? Math.max(0, input.fadeInMs)
        : playback.fadeInMs;
    return { ...playback, fadeInMs };
}

export type SoundTransport = {
    play: (input: BlueprintSoundPlayInput) => Promise<BlueprintSoundHandle | null>;
    stop: (handle: BlueprintSoundHandle | null, fadeMs: number) => Promise<void>;
    pause: (handle: BlueprintSoundHandle) => Promise<void>;
    resume: (handle: BlueprintSoundHandle) => Promise<void>;
    setVolume: (handle: BlueprintSoundHandle, volume: number, fadeMs: number) => Promise<void>;
    seek: (handle: BlueprintSoundHandle, timeMs: number) => Promise<void>;
    isPlaying: (handle: BlueprintSoundHandle) => boolean;
    /** Stop everything and forget every token. Call when a session ends. */
    dispose: () => void;
};

export function createSoundTransport(options: SoundTransportOptions): SoundTransport {
    const { getLiveGame, resolveAssetUrl, getAudioTracks, createSound, log } = options;
    const tokens = new Map<string, EngineSoundToken>();
    let nextId = 0;

    const engine = (): EngineSoundHost | null => {
        const liveGame = getLiveGame();
        return liveGame ? liveGame as unknown as EngineSoundHost : null;
    };

    const tokenFor = (handle: BlueprintSoundHandle | null): EngineSoundToken | null => {
        return handle ? tokens.get(handle.id) ?? null : null;
    };

    /**
     * A token that has finished playing stays in the map until something touches
     * it: there is no completion callback on the engine side, so this is the
     * only sweep point. Bounded by how many clips one screen starts.
     */
    const forget = (handle: BlueprintSoundHandle | null): void => {
        if (handle) {
            tokens.delete(handle.id);
        }
    };

    return {
        async play(input) {
            const host = engine();
            if (!host?.playSound) {
                // No running game (editor preview) or an engine dist without the
                // API. Warn once per call and let the graph continue silently -
                // an author checking layout should not hit an exception.
                log("warning", "Play Sound: no audio in this environment; the clip was skipped.");
                return null;
            }
            const url = await resolveAssetUrl(input.assetId, "audio");
            if (typeof url !== "string" || !url.trim()) {
                log("warning", `Play Sound: audio asset ${input.assetId} could not be resolved.`);
                return null;
            }
            const playback = resolveSoundPlayback(input, getAudioTracks?.());
            const sound = createSound({
                src: url,
                channel: playback.channel,
                loop: playback.loop,
                volume: playback.volume,
                assetId: input.assetId,
            });
            const token = await host.playSound(sound);
            if (!token) {
                return null;
            }
            // `LiveGame.playSound` forwards to `AudioManager.playSoundToken` with its default
            // `{end: 1}`, which sets the token to full volume *regardless of the Sound's configured
            // volume*. So the resolved level has to be written onto the token afterwards - without
            // this both the track gain and the node's Volume pin are silently discarded. The
            // fade-in is the same write with a ramp: start at silence, arrive at the resolved level.
            if (playback.fadeInMs > 0 && token.fade) {
                token.setVolume?.(0);
                token.fade(0, playback.volume, playback.fadeInMs);
            } else {
                token.setVolume?.(playback.volume);
            }
            const handle = toBlueprintSoundHandle(`sound:${nextId++}`);
            if (!handle) {
                return null;
            }
            tokens.set(handle.id, token);
            return handle;
        },

        async stop(handle, fadeMs) {
            // No handle means "everything this family started", which is what a
            // Page's exit handler wants: it does not track what it played.
            if (!handle) {
                for (const token of tokens.values()) {
                    token.stop?.(fadeMs > 0 ? { fadeDuration: fadeMs } : undefined);
                }
                tokens.clear();
                return;
            }
            tokenFor(handle)?.stop?.(fadeMs > 0 ? { fadeDuration: fadeMs } : undefined);
            forget(handle);
        },

        async pause(handle) {
            tokenFor(handle)?.pause?.();
        },

        async resume(handle) {
            tokenFor(handle)?.resume?.();
        },

        /**
         * Volume and fade in one operation, because "duck the music over a second" and "set it to
         * 0.3" are the same request with a different duration - so this is also the fade node.
         */
        async setVolume(handle, volume, fadeMs) {
            const token = tokenFor(handle);
            if (!token) {
                return;
            }
            if (fadeMs > 0 && token.fade) {
                const from = token.getVolume?.() ?? 1;
                token.fade(from, volume, fadeMs);
                return;
            }
            token.setVolume?.(volume);
        },

        async seek(handle, timeMs) {
            // Milliseconds in the graph, seconds at the engine boundary - the same conversion the
            // story compiler makes for `/seek`.
            tokenFor(handle)?.seek?.(timeMs / 1000);
        },

        isPlaying(handle) {
            return tokenFor(handle)?.isPlaying?.() === true;
        },

        dispose() {
            for (const token of tokens.values()) {
                token.stop?.();
            }
            tokens.clear();
        },
    };
}
