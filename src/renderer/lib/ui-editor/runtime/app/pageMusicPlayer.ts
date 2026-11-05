/**
 * Plays page music, outside any one game session.
 *
 * # Why not through the engine like every other sound
 *
 * Everything else a page plays goes through `LiveGame.playSound` (`soundTransport.ts`), and for a
 * button click that is right. Page music is the one sound whose whole job is to outlive the moments
 * the engine is torn down or reset, and on the title side those moments are constant:
 *
 *  - **Starting a game** resets the engine's audio (`newGame()` stops every sound it is playing), so
 *    a title theme played through it was cut off where the press landed, whatever fade the page set.
 *  - **Quitting to the title, or an ending page**, tears the run's session down and mounts another
 *    for the menu; music played through the engine had to wait for that one to arrive.
 *  - **A Dev Mode hot reload** mounts a fresh session, so every edit started the title theme again
 *    from its first bar.
 *
 * So the music plays on an audio graph of its own, which none of those touch.
 *
 * # Why the player's settings still reach it
 *
 * A sound outside the engine's graph is one the player's mixer cannot reach by itself - the reason
 * the `<video>` widget multiplies the mixer in by hand (`videoMixer.ts`). Page music does the same:
 * its gain node carries what the engine's own nodes would have, read off the live game whenever one
 * is up ({@link PageMusicMix}) - every bus between the music's track and the master output, the
 * master volume, and the output gate a window losing focus shuts. One fact, a second applier,
 * because the sound genuinely comes out of a second place. Between sessions the last reading holds;
 * before the first one, music waits, so it never starts at a level the player did not choose.
 *
 * # How a clip plays
 *
 * As the engine's backend plays it (`@narraleaf/sound`): a clip with marked points (an intro and a
 * loop, an in or out point) is decoded and looped sample-accurately on its markers; a whole-file
 * clip streams from a media element. The clip's own gain, and its markers, are read the way every
 * other path reads them (`clipSoundConfig`).
 *
 * Comments in English per project convention.
 */

import { clipSoundConfig, clipVolume, type AudioClipRegion } from "@shared/types/audio";
import type { PageMusicCue, PageMusicPlayer } from "./pageMusic";

/** The player's mixer, as page music needs it. */
export type PageMusicMix = {
    /**
     * Everything the player's settings multiply a sound on this track by, 0..1 - or null while it
     * cannot be known yet (no game has been up since the window opened).
     */
    read: (trackId: string) => number | null;
    /** Fires when anything {@link read} reads may have changed. Returns a disposer. */
    subscribe: (listener: () => void) => () => void;
    /**
     * Whether {@link read} can answer for this track, waiting for a game to come up when none has
     * yet. False when none came: a host with no game has no mixer, and plays no page music.
     */
    ready: (trackId: string) => Promise<boolean>;
};

/** One playing clip, as the audio backend holds it. */
export type PageMusicVoice = {
    /** Move the clip's own level (its volume, with the clip's gain folded in) over `seconds`. */
    rampTo: (value: number, seconds: number) => void;
    /** The player's settings for its track. */
    setMix: (value: number) => void;
    /** Stop and let go of everything, at once. */
    release: () => void;
};

export type PageMusicVoiceInput = {
    url: string;
    loop: boolean;
    /** Seconds from the start of the file. */
    seek: number;
    endTime?: number;
    loopStart?: number;
    /** The clip's own level once faded in. */
    level: number;
    mix: number;
    fadeInSeconds: number;
};

/** Where clips actually make sound. The Web Audio one below in a game; a fake in a test. */
export type PageMusicAudioBackend = {
    start: (input: PageMusicVoiceInput) => Promise<PageMusicVoice | null>;
    dispose: () => void;
};

export type PageMusicPlayerOptions = {
    resolveAssetUrl: (assetId: string) => Promise<string | null | undefined> | string | null | undefined;
    /** The markers and gain set on an asset in the audio preview, absent for one with none. */
    getClip: (assetId: string) => AudioClipRegion | null | undefined;
    /** Whether the track loops what plays on it, for a cue that does not say. */
    trackLoops: (trackId: string) => boolean;
    mix: PageMusicMix;
    backend: PageMusicAudioBackend;
    /** True while a game holds the screen; see `pageMusic.ts`. */
    isHeld: () => boolean;
    /** Schedules a release after a fade; injectable so a test can run the clock. */
    setTimeout?: (callback: () => void, ms: number) => unknown;
    log: (level: "info" | "warning" | "error", message: string) => void;
};

/** A playing clip, as the controller holds it. Opaque outside this module. */
export type PageMusicHandle = {
    readonly id: number;
};

type Live = {
    handle: PageMusicHandle;
    voice: PageMusicVoice;
    trackId: string;
    clip: AudioClipRegion | null | undefined;
};

/** Margin after a fade before its clip is let go, so the last of the ramp is heard. */
const RELEASE_MARGIN_MS = 50;

export type HostPageMusicPlayer = PageMusicPlayer<PageMusicHandle> & {
    /** Stop everything at once and close the audio graph. */
    dispose: () => void;
};

export function createPageMusicPlayer(options: PageMusicPlayerOptions): HostPageMusicPlayer {
    const { resolveAssetUrl, getClip, trackLoops, mix, backend, log } = options;
    const schedule = options.setTimeout ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
    const live = new Map<number, Live>();
    let nextId = 0;
    let disposed = false;

    const unsubscribe = mix.subscribe(() => {
        for (const entry of live.values()) {
            const value = mix.read(entry.trackId);
            if (value !== null) {
                entry.voice.setMix(value);
            }
        }
    });

    const release = (entry: Live): void => {
        if (live.get(entry.handle.id) !== entry) {
            return;
        }
        live.delete(entry.handle.id);
        entry.voice.release();
    };

    return {
        isHeld: options.isHeld,
        play: async (cue: PageMusicCue) => {
            // Asked again by the controller when the session it waited for arrives late.
            if (!(await mix.ready(cue.audioTrackId)) || disposed) {
                return null;
            }
            const url = await resolveAssetUrl(cue.assetId);
            if (disposed) {
                return null;
            }
            if (!url) {
                log("warning", `page music: no file for asset ${cue.assetId}`);
                return null;
            }
            const clip = getClip(cue.assetId);
            const loop = cue.loop ?? trackLoops(cue.audioTrackId);
            const config = clipSoundConfig(clip, { volume: cue.volume, loop });
            let voice: PageMusicVoice | null = null;
            try {
                voice = await backend.start({
                    url,
                    loop,
                    seek: config.seek,
                    ...(config.endTime !== undefined ? { endTime: config.endTime } : {}),
                    ...(config.loopStart !== undefined ? { loopStart: config.loopStart } : {}),
                    level: config.volume,
                    mix: mix.read(cue.audioTrackId) ?? 0,
                    fadeInSeconds: cue.fadeMs / 1000,
                });
            } catch (error) {
                log("warning", `page music: ${cue.assetId} could not be played: ${error instanceof Error ? error.message : String(error)}`);
                return null;
            }
            if (!voice) {
                return null;
            }
            if (disposed) {
                voice.release();
                return null;
            }
            const handle: PageMusicHandle = { id: nextId++ };
            live.set(handle.id, { handle, voice, trackId: cue.audioTrackId, clip });
            return handle;
        },
        stop: (handle, fadeMs) => {
            const entry = live.get(handle.id);
            if (!entry) {
                return;
            }
            if (fadeMs <= 0) {
                release(entry);
                return;
            }
            entry.voice.rampTo(0, fadeMs / 1000);
            schedule(() => release(entry), fadeMs + RELEASE_MARGIN_MS);
        },
        setVolume: (handle, volume, fadeMs) => {
            const entry = live.get(handle.id);
            entry?.voice.rampTo(clipVolume(entry.clip, volume), Math.max(0, fadeMs) / 1000);
        },
        dispose: () => {
            disposed = true;
            unsubscribe();
            for (const entry of [...live.values()]) {
                release(entry);
            }
            backend.dispose();
        },
    };
}

/** The part of the engine's bus mixer (`game.audioBuses`) the mix reads; duck-typed like `soundTransport`. */
type BusMixerLike = {
    getTree?: () => { get: (id: string) => { id: string; parentId: string | null } | null | undefined } | null | undefined;
    getEffectiveVolume?: (id: string) => number;
    onVolumeChange?: (listener: () => void) => { cancel?: () => void } | unknown;
};

/** The part of a live game the mix reads. */
export type PageMusicMixSource = {
    game?: {
        audioBuses?: BusMixerLike;
        preference?: { getPreference?: (key: string) => unknown };
    };
};

/** Deeper than any tree the engine accepts (`MaxAudioBusDepth`), so a malformed one cannot spin. */
const MAX_CHAIN = 16;

/**
 * The player's mixer as the live game holds it, held over the moments no game is up.
 *
 * What it multiplies is what the engine's own graph does for a sound on the same bus: each bus from
 * the track up to the master output (the author's level times the player's, which for the three
 * seeded buses is the Music / Sound / Voice slider), the master volume, and the output gate.
 *
 * Call {@link LiveGamePageMusicMix.sessionChanged} when the live game is replaced: a new session has
 * a mixer of its own, and a bus slider moved on it has to reach the music too.
 */
export type LiveGamePageMusicMix = PageMusicMix & {
    sessionChanged: () => void;
    dispose: () => void;
};

export function createLiveGamePageMusicMix(options: {
    getLiveGame: () => PageMusicMixSource | null;
    /** The live game once there is one, or null when none is coming. */
    waitForLiveGame: () => Promise<unknown>;
    /** The player's preferences changing, and the output gate opening or shutting. */
    subscribeChanges: (listener: () => void) => () => void;
    /** The output gate (a window losing focus with the preference on): 1 open, 0 shut. */
    outputGate: () => number;
}): LiveGamePageMusicMix {
    const last = new Map<string, number>();
    const listeners = new Set<() => void>();
    const notify = () => {
        for (const listener of [...listeners]) {
            listener();
        }
    };
    const unsubscribePreferences = options.subscribeChanges(notify);
    let mixerSubscription: { cancel?: () => void } | null = null;
    const watchMixer = () => {
        mixerSubscription?.cancel?.();
        mixerSubscription = null;
        const mixer = options.getLiveGame()?.game?.audioBuses;
        const token = typeof mixer?.onVolumeChange === "function" ? mixer.onVolumeChange(notify) : null;
        mixerSubscription = token && typeof token === "object" ? token as { cancel?: () => void } : null;
    };
    watchMixer();

    const read = (trackId: string): number | null => {
        const game = options.getLiveGame()?.game;
        const mixer = game?.audioBuses;
        if (!mixer || typeof mixer.getEffectiveVolume !== "function") {
            return last.get(trackId) ?? null;
        }
        let gain = 1;
        try {
            const tree = mixer.getTree?.();
            let id: string | null = trackId;
            for (let depth = 0; id && depth < MAX_CHAIN; depth++) {
                gain *= unit(mixer.getEffectiveVolume(id));
                id = tree?.get(id)?.parentId ?? null;
            }
        } catch {
            // A tree the engine could not resolve is reported at boot; the slider must not throw here.
            return last.get(trackId) ?? null;
        }
        const master = game?.preference?.getPreference?.("globalVolume");
        const value = unit(gain * (typeof master === "number" ? unit(master) : 1) * unit(options.outputGate()));
        last.set(trackId, value);
        return value;
    };

    return {
        read,
        subscribe: listener => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        ready: async trackId => {
            if (read(trackId) !== null) {
                return true;
            }
            await options.waitForLiveGame();
            return read(trackId) !== null;
        },
        sessionChanged: () => {
            watchMixer();
            notify();
        },
        dispose: () => {
            unsubscribePreferences();
            mixerSubscription?.cancel?.();
            mixerSubscription = null;
            listeners.clear();
        },
    };
}

function unit(value: number): number {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

/**
 * The browser's audio, for page music: one context for the life of the game window, one gain for
 * the clip's level and fades and one for the player's mix, per playing clip.
 *
 * A context the browser keeps suspended until the player does something (a web build, before the
 * first click) is resumed on the first press or key, and a stream refused for the same reason is
 * started again then - the title theme starts with the first click rather than never.
 */
export function createWebAudioPageMusicBackend(): PageMusicAudioBackend {
    let context: AudioContext | null = null;
    /** Decoded clips, by url: the last few, so a page returned to does not decode its theme again. */
    const decoded = new Map<string, Promise<AudioBuffer>>();
    const waitingForGesture = new Set<() => void>();
    let gestureListening = false;

    const onGesture = (): void => {
        void context?.resume().catch(() => undefined);
        for (const resume of [...waitingForGesture]) {
            resume();
        }
        waitingForGesture.clear();
        stopListening();
    };
    const listenForGesture = (): void => {
        if (gestureListening || typeof window === "undefined") {
            return;
        }
        gestureListening = true;
        window.addEventListener("pointerdown", onGesture, true);
        window.addEventListener("keydown", onGesture, true);
    };
    const stopListening = (): void => {
        if (!gestureListening || typeof window === "undefined") {
            return;
        }
        gestureListening = false;
        window.removeEventListener("pointerdown", onGesture, true);
        window.removeEventListener("keydown", onGesture, true);
    };

    const audioContext = (): AudioContext => {
        if (!context) {
            context = new AudioContext();
        }
        if (context.state === "suspended") {
            void context.resume().catch(() => undefined);
            listenForGesture();
        }
        return context;
    };

    const decode = (ctx: AudioContext, url: string): Promise<AudioBuffer> => {
        const cached = decoded.get(url);
        if (cached) {
            // Most recently used last, so the oldest is the one dropped.
            decoded.delete(url);
            decoded.set(url, cached);
            return cached;
        }
        const pending = fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return response.arrayBuffer();
            })
            .then(bytes => ctx.decodeAudioData(bytes));
        pending.catch(() => decoded.delete(url));
        decoded.set(url, pending);
        while (decoded.size > 2) {
            decoded.delete(decoded.keys().next().value as string);
        }
        return pending;
    };

    return {
        start: async input => {
            const ctx = audioContext();
            const level = ctx.createGain();
            const mixGain = ctx.createGain();
            level.connect(mixGain);
            mixGain.connect(ctx.destination);
            mixGain.gain.value = input.mix;
            const disconnectGains = () => {
                level.disconnect();
                mixGain.disconnect();
            };

            let stopSource: () => void;
            // Marked points need the decoded clip, for a loop that turns round on the sample; a whole
            // file streams, which is how the engine plays a looping theme without holding it all.
            if (input.endTime !== undefined || input.loopStart !== undefined) {
                let buffer: AudioBuffer;
                try {
                    buffer = await decode(ctx, input.url);
                } catch (error) {
                    disconnectGains();
                    throw error;
                }
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                const end = Math.min(input.endTime ?? buffer.duration, buffer.duration);
                if (input.loop) {
                    source.loop = true;
                    source.loopStart = input.loopStart ?? input.seek;
                    source.loopEnd = end;
                }
                source.connect(level);
                if (!input.loop && input.endTime !== undefined) {
                    source.start(0, input.seek, Math.max(0, end - input.seek));
                } else {
                    source.start(0, input.seek);
                }
                stopSource = () => {
                    try {
                        source.stop();
                    } catch {
                        // Already ended.
                    }
                    source.disconnect();
                };
            } else {
                const element = new Audio(input.url);
                element.crossOrigin = "anonymous";
                element.loop = input.loop;
                element.preload = "auto";
                const node = ctx.createMediaElementSource(element);
                node.connect(level);
                if (input.seek > 0) {
                    element.currentTime = input.seek;
                }
                let released = false;
                const begin = () => {
                    if (!released) {
                        void element.play().catch(() => undefined);
                    }
                };
                try {
                    await element.play();
                } catch (error) {
                    if (error instanceof DOMException && error.name === "NotAllowedError") {
                        // Refused until the player does something; started on the first press.
                        waitingForGesture.add(begin);
                        listenForGesture();
                    } else {
                        node.disconnect();
                        disconnectGains();
                        throw error;
                    }
                }
                stopSource = () => {
                    released = true;
                    waitingForGesture.delete(begin);
                    element.pause();
                    node.disconnect();
                    element.removeAttribute("src");
                    element.load();
                };
            }

            const now = ctx.currentTime;
            if (input.fadeInSeconds > 0) {
                level.gain.setValueAtTime(0, now);
                level.gain.linearRampToValueAtTime(input.level, now + input.fadeInSeconds);
            } else {
                level.gain.setValueAtTime(input.level, now);
            }

            return {
                rampTo: (value, seconds) => {
                    const t = ctx.currentTime;
                    holdAt(level.gain, t);
                    if (seconds > 0) {
                        level.gain.linearRampToValueAtTime(value, t + seconds);
                    } else {
                        level.gain.setValueAtTime(value, t);
                    }
                },
                setMix: value => {
                    const t = ctx.currentTime;
                    mixGain.gain.cancelScheduledValues(t);
                    // A slew nobody hears rather than a step, as the engine's own bus ramp does.
                    mixGain.gain.setTargetAtTime(value, t, 0.02);
                },
                release: () => {
                    stopSource();
                    disconnectGains();
                },
            };
        },
        dispose: () => {
            stopListening();
            waitingForGesture.clear();
            decoded.clear();
            void context?.close().catch(() => undefined);
            context = null;
        },
    };
}

/**
 * Stop whatever ramp a gain is on, where it is now, so the next ramp starts from what is heard -
 * a fade-out asked for halfway through a fade-in goes down from halfway, not from the top.
 */
function holdAt(param: AudioParam, time: number): void {
    const hold = (param as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam }).cancelAndHoldAtTime;
    if (typeof hold === "function") {
        hold.call(param, time);
        return;
    }
    const value = param.value;
    param.cancelScheduledValues(time);
    param.setValueAtTime(value, time);
}
