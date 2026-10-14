import { describe, expect, it } from "vitest";
import type { UISurface, UISurfaceSettings } from "@shared/types/ui-editor/document";
import type { UIPageMusic } from "@shared/types/ui-editor/pageMusic";
import { BUILTIN_AUDIO_TRACKS, type ProjectAudioTrack } from "@shared/types/audioTrack";
import { createPageMusicController, pageMusicCueFor, type PageMusicCue } from "./pageMusic";

function page(id: string, music?: UIPageMusic, extra?: Partial<UISurfaceSettings>): UISurface {
    return {
        id,
        name: id,
        host: "app",
        kind: "appSurface",
        designSize: { width: 1920, height: 1080 },
        rootElementId: `${id}-root`,
        settings: { ...(music ? { music } : {}), ...(extra ?? {}) },
    };
}

const gameUi: UISurface = {
    id: "dialog",
    name: "Dialogue",
    host: "player",
    kind: "stageSurface",
    designSize: { width: 1920, height: 1080 },
    rootElementId: "dialog-root",
    settings: { music: { assetId: "never" } },
    mount: { kind: "slot", slotId: "dialog" },
};

describe("the music the pages on screen call for", () => {
    it("is the top page's own music", () => {
        const cue = pageMusicCueFor({ surfaces: [page("extra", { assetId: "room" }), page("title", { assetId: "theme" })] });
        expect(cue?.assetId).toBe("room");
        expect(cue?.surfaceId).toBe("extra");
    });

    it("is the music of the page beneath when the top page has none", () => {
        const cue = pageMusicCueFor({ surfaces: [page("settings"), page("title", { assetId: "theme" })] });
        expect(cue?.assetId).toBe("theme");
        expect(cue?.surfaceId).toBe("title");
    });

    it("is nothing when no page has music, and never a Game UI's", () => {
        expect(pageMusicCueFor({ surfaces: [page("settings"), gameUi, null, undefined] })).toBeNull();
    });

    it("plays on the Music track unless the page names another, and a deleted track lands on Music", () => {
        const tracks: ProjectAudioTrack[] = [
            ...BUILTIN_AUDIO_TRACKS,
            { id: "ambience", name: "Ambience", parentId: null, volume: 1, loop: true },
        ];
        expect(pageMusicCueFor({ surfaces: [page("a", { assetId: "x" })], tracks })?.audioTrackId).toBe("bgm");
        expect(pageMusicCueFor({ surfaces: [page("a", { assetId: "x", audioTrackId: "ambience" })], tracks })?.audioTrackId)
            .toBe("ambience");
        expect(pageMusicCueFor({ surfaces: [page("a", { assetId: "x", audioTrackId: "gone" })], tracks })?.audioTrackId)
            .toBe("bgm");
    });

    it("carries the page's volume, loop and fade, and names the same clip on the same track the same music", () => {
        const a = pageMusicCueFor({ surfaces: [page("a", { assetId: "theme", volume: 0.5, loop: false, fadeMs: 1500 })] })!;
        const b = pageMusicCueFor({ surfaces: [page("b", { assetId: "theme", volume: 2 })] })!;
        expect(a).toMatchObject({ volume: 0.5, loop: false, fadeMs: 1500 });
        expect(b.volume).toBe(1);
        expect(b.loop).toBeUndefined();
        expect(b.fadeMs).toBe(0);
        expect(a.key).toBe(b.key);
        const otherTrack = pageMusicCueFor({ surfaces: [page("c", { assetId: "theme", audioTrackId: "sound" })] })!;
        expect(otherTrack.key).not.toBe(a.key);
    });

    it("plays the member of an asset set the build resolved for the game's language", () => {
        const surface = page("title", { assetId: "set" }, { assetVariants: { set: { en: "theme-en", ja: "theme-ja" } } });
        expect(pageMusicCueFor({ surfaces: [surface], locale: "ja", sourceLocale: "en" })?.assetId).toBe("theme-ja");
        expect(pageMusicCueFor({ surfaces: [surface], locale: "fr", sourceLocale: "en" })?.assetId).toBe("theme-en");
    });
});

type Handle = { id: number; assetId: string };

function harness() {
    let nextId = 0;
    let held = false;
    let engine: object = {};
    const log: string[] = [];
    const pending: { cue: PageMusicCue; resolve: (handle: Handle | null) => void }[] = [];
    const controller = createPageMusicController<Handle>({
        play: cue => new Promise(resolve => {
            log.push(`play ${cue.assetId} fade=${cue.fadeMs}`);
            pending.push({ cue, resolve });
        }),
        stop: (handle, fadeMs) => log.push(`stop ${handle.assetId}#${handle.id} fade=${fadeMs}`),
        setVolume: (handle, volume, fadeMs) => log.push(`volume ${handle.assetId}#${handle.id} ${volume} fade=${fadeMs}`),
        currentEngine: () => engine,
        isHeld: () => held,
    });
    /** Let every play started so far settle, as the engine answering. */
    const settle = async (answer: "play" | "nothing" = "play") => {
        for (const entry of pending.splice(0)) {
            entry.resolve(answer === "play" ? { id: nextId++, assetId: entry.cue.assetId } : null);
        }
        await Promise.resolve();
        await Promise.resolve();
    };
    const cue = (assetId: string, more: Partial<PageMusicCue> = {}): PageMusicCue => ({
        key: `${assetId}\u0000bgm`,
        surfaceId: "page",
        assetId,
        audioTrackId: "bgm",
        volume: 1,
        fadeMs: 0,
        ...more,
    });
    return {
        controller,
        log,
        settle,
        cue,
        hold: (value: boolean) => {
            held = value;
        },
        newEngine: () => {
            engine = {};
        },
    };
}

describe("page music as the screen changes", () => {
    it("starts the page's music once, however often the same screen is asked about", async () => {
        const h = harness();
        h.controller.update(h.cue("theme", { fadeMs: 800 }));
        h.controller.update(h.cue("theme", { fadeMs: 800 }));
        await h.settle();
        h.controller.update(h.cue("theme", { fadeMs: 800 }));
        h.controller.refresh();
        expect(h.log).toEqual(["play theme fade=800"]);
    });

    it("keeps the same music playing across pages that share it, at the newer page's volume", async () => {
        const h = harness();
        h.controller.update(h.cue("theme"));
        await h.settle();
        h.controller.update(h.cue("theme", { surfaceId: "load", volume: 0.4, fadeMs: 500 }));
        expect(h.log).toEqual(["play theme fade=0", "volume theme#0 0.4 fade=500"]);
    });

    it("hands over: the outgoing music fades out with its own fade as the incoming one fades in", async () => {
        const h = harness();
        h.controller.update(h.cue("theme", { fadeMs: 1000 }));
        await h.settle();
        h.controller.update(h.cue("room", { fadeMs: 300 }));
        await h.settle();
        h.controller.update(null);
        expect(h.log).toEqual([
            "play theme fade=1000",
            "stop theme#0 fade=1000",
            "play room fade=300",
            "stop room#1 fade=300",
        ]);
    });

    it("never leaves a music playing whose page moved on before it started", async () => {
        const h = harness();
        h.controller.update(h.cue("theme"));
        h.controller.update(h.cue("room"));
        await h.settle();
        expect(h.log).toEqual(["play theme fade=0", "play room fade=0", "stop theme#0 fade=0"]);
    });

    it("gives the music to the game while one holds the screen, and back when it ends", async () => {
        const h = harness();
        h.controller.update(h.cue("theme", { fadeMs: 1000 }));
        await h.settle();
        h.hold(true);
        h.controller.refresh();
        // Pages opened over the running game play nothing of their own.
        h.controller.update(h.cue("settings-music"));
        h.hold(false);
        h.controller.update(h.cue("theme", { fadeMs: 1000 }));
        await h.settle();
        expect(h.log).toEqual([
            "play theme fade=1000",
            "stop theme#0 fade=1000",
            "play theme fade=1000",
        ]);
    });

    it("stops a music that only finished starting after a game took the screen", async () => {
        const h = harness();
        h.controller.update(h.cue("theme"));
        h.hold(true);
        await h.settle();
        expect(h.log).toEqual(["play theme fade=0", "stop theme#0 fade=0"]);
        h.hold(false);
        h.controller.refresh();
        expect(h.log.at(-1)).toBe("play theme fade=0");
    });

    it("starts the music again on a new engine, and asks again when nothing could be played", async () => {
        const h = harness();
        h.controller.update(h.cue("theme"));
        await h.settle();
        h.newEngine();
        h.controller.refresh();
        await h.settle("nothing");
        h.controller.refresh();
        expect(h.log).toEqual([
            "play theme fade=0",
            "stop theme#0 fade=0",
            "play theme fade=0",
            "play theme fade=0",
        ]);
    });

    it("stops at once when the host goes away", async () => {
        const h = harness();
        h.controller.update(h.cue("theme", { fadeMs: 1000 }));
        await h.settle();
        h.controller.dispose();
        expect(h.log.at(-1)).toBe("stop theme#0 fade=0");
    });
});
