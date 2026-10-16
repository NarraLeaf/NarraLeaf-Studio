import { describe, expect, it } from "vitest";
import type { AudioClipRegion } from "@shared/types/audio";
import type { PageMusicCue } from "./pageMusic";
import {
    createLiveGamePageMusicMix,
    createPageMusicPlayer,
    type PageMusicAudioBackend,
    type PageMusicMix,
    type PageMusicMixSource,
    type PageMusicVoiceInput,
} from "./pageMusicPlayer";

function cue(assetId: string, more: Partial<PageMusicCue> = {}): PageMusicCue {
    return { key: `${assetId}\u0000bgm`, surfaceId: "title", assetId, audioTrackId: "bgm", volume: 1, fadeMs: 0, ...more };
}

function fakeBackend() {
    const started: PageMusicVoiceInput[] = [];
    const events: string[] = [];
    let disposed = false;
    const backend: PageMusicAudioBackend = {
        start: async input => {
            started.push(input);
            const name = input.url;
            return {
                rampTo: (value, seconds) => events.push(`${name} ramp ${value} over ${seconds}`),
                setMix: value => events.push(`${name} mix ${value}`),
                release: () => events.push(`${name} released`),
            };
        },
        dispose: () => {
            disposed = true;
        },
    };
    return { backend, started, events, isDisposed: () => disposed };
}

function fakeMix(initial: number | null) {
    let value = initial;
    const listeners = new Set<() => void>();
    const mix: PageMusicMix = {
        read: () => value,
        subscribe: listener => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        ready: async () => value !== null,
    };
    return {
        mix,
        set: (next: number | null) => {
            value = next;
            for (const listener of listeners) {
                listener();
            }
        },
    };
}

function player(options: {
    mix?: PageMusicMix;
    clips?: Record<string, AudioClipRegion>;
    urls?: Record<string, string | null>;
} = {}) {
    const backend = fakeBackend();
    const timers: { at: number; run: () => void }[] = [];
    const warnings: string[] = [];
    const instance = createPageMusicPlayer({
        resolveAssetUrl: assetId => (options.urls && assetId in options.urls ? options.urls[assetId] : `url:${assetId}`),
        getClip: assetId => options.clips?.[assetId],
        trackLoops: trackId => trackId === "bgm",
        mix: options.mix ?? fakeMix(0.5).mix,
        backend: backend.backend,
        isHeld: () => false,
        setTimeout: (run, ms) => timers.push({ at: ms, run }),
        log: (_level, message) => warnings.push(message),
    });
    return {
        ...backend,
        player: instance,
        warnings,
        runTimers: () => {
            for (const timer of timers.splice(0)) {
                timer.run();
            }
        },
        timers,
    };
}

describe("the page music player", () => {
    it("plays a whole-file clip as a stream, at the player's mix, looping as the Music track does", async () => {
        const h = player();
        const handle = await h.player.play(cue("theme", { volume: 0.8, fadeMs: 1500 }));
        expect(handle).not.toBeNull();
        expect(h.started).toEqual([{ url: "url:theme", loop: true, seek: 0, level: 0.8, mix: 0.5, fadeInSeconds: 1.5 }]);
    });

    it("plays the markers and gain the author set on the clip, as every other path does", async () => {
        const h = player({ clips: { theme: { inMs: 1000, loopStartMs: 12800, outMs: 112000, gainDb: -6 } } });
        await h.player.play(cue("theme", { loop: true }));
        const input = h.started[0]!;
        expect(input).toMatchObject({ loop: true, seek: 1, loopStart: 12.8, endTime: 112 });
        expect(input.level).toBeCloseTo(Math.pow(10, -6 / 20));
    });

    it("plays nothing, and says why, for a clip with no file", async () => {
        const h = player({ urls: { gone: null } });
        expect(await h.player.play(cue("gone"))).toBeNull();
        expect(h.started).toEqual([]);
        expect(h.warnings).toHaveLength(1);
    });

    it("waits for the player's settings, and plays nothing where there never are any", async () => {
        const h = player({ mix: fakeMix(null).mix });
        expect(await h.player.play(cue("theme"))).toBeNull();
        expect(h.started).toEqual([]);
    });

    it("fades out and lets the clip go once the fade is over; at once without one", async () => {
        const h = player();
        const a = (await h.player.play(cue("a")))!;
        const b = (await h.player.play(cue("b")))!;
        h.player.stop(a, 1000);
        expect(h.events).toEqual(["url:a ramp 0 over 1"]);
        expect(h.timers[0]!.at).toBeGreaterThanOrEqual(1000);
        h.runTimers();
        h.player.stop(b, 0);
        expect(h.events).toEqual(["url:a ramp 0 over 1", "url:a released", "url:b released"]);
    });

    it("moves the level with the clip's gain folded in", async () => {
        const h = player({ clips: { theme: { gainDb: -20 } } });
        const handle = (await h.player.play(cue("theme")))!;
        h.player.setVolume(handle, 0.5, 400);
        expect(h.events).toEqual(["url:theme ramp 0.05 over 0.4"]);
    });

    it("follows the player's settings while it plays", async () => {
        const mix = fakeMix(0.5);
        const h = player({ mix: mix.mix });
        await h.player.play(cue("theme"));
        mix.set(0.2);
        expect(h.events).toEqual(["url:theme mix 0.2"]);
    });

    it("lets everything go when the window does", async () => {
        const h = player();
        await h.player.play(cue("theme"));
        h.player.dispose();
        expect(h.events).toEqual(["url:theme released"]);
        expect(h.isDisposed()).toBe(true);
    });
});

function liveGame(input: {
    buses: Record<string, { volume: number; parentId: string | null }>;
    master?: number;
}) {
    const listeners = new Set<() => void>();
    const buses = { ...input.buses };
    let master = input.master ?? 1;
    const source: PageMusicMixSource = {
        game: {
            audioBuses: {
                getTree: () => ({ get: (id: string) => (buses[id] ? { id, parentId: buses[id]!.parentId } : null) }),
                getEffectiveVolume: (id: string) => buses[id]?.volume ?? 1,
                onVolumeChange: (listener: () => void) => {
                    listeners.add(listener);
                    return { cancel: () => listeners.delete(listener) };
                },
            },
            preference: { getPreference: (key: string) => (key === "globalVolume" ? master : undefined) },
        },
    };
    return {
        source,
        setBus: (id: string, volume: number) => {
            buses[id] = { ...buses[id]!, volume };
            for (const listener of listeners) {
                listener();
            }
        },
        setMaster: (value: number) => {
            master = value;
        },
        listenerCount: () => listeners.size,
    };
}

describe("the player's settings, as page music reads them", () => {
    function mixFor(game: { current: PageMusicMixSource | null }, gate = { value: 1 }) {
        const preferenceListeners = new Set<() => void>();
        const mix = createLiveGamePageMusicMix({
            getLiveGame: () => game.current,
            waitForLiveGame: async () => game.current,
            subscribeChanges: listener => {
                preferenceListeners.add(listener);
                return () => preferenceListeners.delete(listener);
            },
            outputGate: () => gate.value,
        });
        return { mix, announcePreference: () => preferenceListeners.forEach(listener => listener()) };
    }

    it("multiplies every bus up to the master, the master volume and the output gate", () => {
        const game = liveGame({
            buses: { bgm: { volume: 0.5, parentId: null }, "bgm/title": { volume: 0.8, parentId: "bgm" } },
            master: 0.5,
        });
        const gate = { value: 1 };
        const { mix } = mixFor({ current: game.source }, gate);
        expect(mix.read("bgm/title")).toBeCloseTo(0.2);
        gate.value = 0;
        expect(mix.read("bgm/title")).toBe(0);
    });

    it("cannot answer before any game has been up, and holds the last answer while none is", async () => {
        const holder: { current: PageMusicMixSource | null } = { current: null };
        const { mix } = mixFor(holder);
        expect(mix.read("bgm")).toBeNull();
        expect(await mix.ready("bgm")).toBe(false);
        holder.current = liveGame({ buses: { bgm: { volume: 0.3, parentId: null } } }).source;
        expect(await mix.ready("bgm")).toBe(true);
        expect(mix.read("bgm")).toBeCloseTo(0.3);
        holder.current = null;
        expect(mix.read("bgm")).toBeCloseTo(0.3);
    });

    it("hears a bus slider on the session that is up, and on the next one once told", () => {
        const first = liveGame({ buses: { bgm: { volume: 1, parentId: null } } });
        const holder: { current: PageMusicMixSource | null } = { current: first.source };
        const { mix, announcePreference } = mixFor(holder);
        let heard = 0;
        mix.subscribe(() => heard++);
        first.setBus("bgm", 0.4);
        announcePreference();
        expect(heard).toBe(2);

        const second = liveGame({ buses: { bgm: { volume: 1, parentId: null } } });
        holder.current = second.source;
        mix.sessionChanged();
        expect(first.listenerCount()).toBe(0);
        second.setBus("bgm", 0.1);
        expect(heard).toBe(4);
        mix.dispose();
        expect(second.listenerCount()).toBe(0);
    });
});
