import { describe, expect, it } from "vitest";
import type { UISurface, UISurfaceSettings } from "@shared/types/ui-editor/document";
import type { UIPageMusicSetting } from "@shared/types/ui-editor/pageMusic";
import { BUILTIN_AUDIO_TRACKS, type ProjectAudioTrack } from "@shared/types/audioTrack";
import {
    createPageMusicController,
    pageMusicCueOf,
    pageMusicDecisionFor,
    pageMusicFor,
    type PageMusicCue,
    type PageMusicDecision,
    type PageMusicScreenEntry,
    type PageMusicTarget,
} from "./pageMusic";

function page(id: string, music?: UIPageMusicSetting, extra?: Partial<UISurfaceSettings>): UISurface {
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

/** Pages on screen, top first, each opened once under its own id as the instance key. */
function screen(...surfaces: (UISurface | null)[]): PageMusicScreenEntry[] {
    return surfaces.map((surface, index) => ({ key: surface ? `${surface.id}:${index}` : `missing:${index}`, surface }));
}

const title = page("title", { assetId: "theme", fadeMs: 1000 });
const settings = page("settings");
const movie = page("movie", { silent: true });

describe("the music the pages on screen call for", () => {
    it("is the top page's own music", () => {
        const target = pageMusicFor({ entries: screen(page("extra", { assetId: "room" }), title) });
        expect(target.cue?.assetId).toBe("room");
        expect(target.cue?.surfaceId).toBe("extra");
    });

    it("carries on under a page that keeps the music", () => {
        const target = pageMusicFor({ entries: screen(settings, title) });
        expect(target.cue?.assetId).toBe("theme");
        expect(target.cue?.surfaceId).toBe("title");
    });

    it("is silence under a page that asks for it, whatever plays beneath", () => {
        expect(pageMusicFor({ entries: screen(movie, title) })).toEqual({ cue: null });
        // A page that keeps, opened over the silent one, keeps the silence.
        expect(pageMusicFor({ entries: screen(settings, movie, title) })).toEqual({ cue: null });
    });

    it("is nothing when every page keeps, and never a Game UI's", () => {
        expect(pageMusicFor({ entries: screen(settings, gameUi, null) })).toEqual({ cue: null });
    });

    it("plays on the Music track unless the page names another, and a deleted track lands on Music", () => {
        const tracks: ProjectAudioTrack[] = [
            ...BUILTIN_AUDIO_TRACKS,
            { id: "ambience", name: "Ambience", parentId: null, volume: 1, loop: true },
        ];
        const trackOf = (music: UIPageMusicSetting) => pageMusicFor({ entries: screen(page("a", music)), tracks }).cue?.audioTrackId;
        expect(trackOf({ assetId: "x" })).toBe("bgm");
        expect(trackOf({ assetId: "x", audioTrackId: "ambience" })).toBe("ambience");
        expect(trackOf({ assetId: "x", audioTrackId: "gone" })).toBe("bgm");
    });

    it("carries the page's volume, loop and fade, and names the same clip on the same track the same music", () => {
        const a = pageMusicFor({ entries: screen(page("a", { assetId: "theme", volume: 0.5, loop: false, fadeMs: 1500 })) }).cue!;
        const b = pageMusicFor({ entries: screen(page("b", { assetId: "theme", volume: 2 })) }).cue!;
        expect(a).toMatchObject({ volume: 0.5, loop: false, fadeMs: 1500 });
        expect(b.volume).toBe(1);
        expect(b.loop).toBeUndefined();
        expect(b.fadeMs).toBe(0);
        expect(a.key).toBe(b.key);
        const otherTrack = pageMusicFor({ entries: screen(page("c", { assetId: "theme", audioTrackId: "sound" })) }).cue!;
        expect(otherTrack.key).not.toBe(a.key);
    });

    it("plays the member of an asset set the build resolved for the game's language", () => {
        const surface = page("title", { assetId: "set" }, { assetVariants: { set: { en: "theme-en", ja: "theme-ja" } } });
        expect(pageMusicFor({ entries: screen(surface), locale: "ja", sourceLocale: "en" }).cue?.assetId).toBe("theme-ja");
        expect(pageMusicFor({ entries: screen(surface), locale: "fr", sourceLocale: "en" }).cue?.assetId).toBe("theme-en");
    });
});

describe("the music an opened page was given while it is open", () => {
    const room = (assetId: string, fadeMs = 0): PageMusicDecision => ({
        kind: "play",
        cue: pageMusicCueOf({ assetId, fadeMs }, { surfaceId: "extra" }, {}),
    });

    it("overrides the page's own setting for that instance only", () => {
        const entries = screen(page("extra"), title);
        const setWhileOpen = new Map([[entries[0]!.key, room("track-2")]]);
        expect(pageMusicFor({ entries, setWhileOpen }).cue?.assetId).toBe("track-2");
        // Back: the music room's instance has gone, and the title's own theme is what is left.
        expect(pageMusicFor({ entries: entries.slice(1), setWhileOpen }).cue?.assetId).toBe("theme");
    });

    it("overrides a page's own music too, which is how a title changes its theme after the game is cleared", () => {
        const entries = screen(title);
        const setWhileOpen = new Map([[entries[0]!.key, room("theme-after-clear")]]);
        expect(pageMusicFor({ entries, setWhileOpen }).cue?.assetId).toBe("theme-after-clear");
    });

    it("silences with the fade it was asked to leave with", () => {
        const entries = screen(page("extra"), title);
        const setWhileOpen = new Map<string, PageMusicDecision>([[entries[0]!.key, { kind: "silence", leaveFadeMs: 2000 }]]);
        expect(pageMusicFor({ entries, setWhileOpen })).toEqual({ cue: null, leaveFadeMs: 2000 });
    });

    it("carries a replaced page's music over to a page that keeps, and never over one with its own", () => {
        // Title (theme), Replace with a menu that keeps: the menu carries the theme on.
        const before = screen(title);
        const carried = pageMusicDecisionFor({ entries: before });
        expect(carried?.kind).toBe("play");
        const keeping = screen(page("menu"));
        const carriedOver = new Map([[keeping[0]!.key, carried!]]);
        expect(pageMusicFor({ entries: keeping, carriedOver }).cue?.assetId).toBe("theme");

        const ownMusic = [{ key: keeping[0]!.key, surface: page("menu", { assetId: "menu-theme" }) }];
        expect(pageMusicFor({ entries: ownMusic, carriedOver }).cue?.assetId).toBe("menu-theme");
        const silent = [{ key: keeping[0]!.key, surface: page("menu", { silent: true }) }];
        expect(pageMusicFor({ entries: silent, carriedOver })).toEqual({ cue: null });
    });
});

type Handle = { id: number; assetId: string };

function harness() {
    let nextId = 0;
    let held = false;
    const log: string[] = [];
    const pending: { cue: PageMusicCue; resolve: (handle: Handle | null) => void }[] = [];
    const controller = createPageMusicController<Handle>({
        play: cue => new Promise(resolve => {
            log.push(`play ${cue.assetId} fade=${cue.fadeMs}`);
            pending.push({ cue, resolve });
        }),
        stop: (handle, fadeMs) => log.push(`stop ${handle.assetId}#${handle.id} fade=${fadeMs}`),
        setVolume: (handle, volume, fadeMs) => log.push(`volume ${handle.assetId}#${handle.id} ${volume} fade=${fadeMs}`),
        isHeld: () => held,
    });
    /** Let every play started so far settle, as the player answering. */
    const settle = async (answer: "play" | "nothing" = "play") => {
        for (const entry of pending.splice(0)) {
            entry.resolve(answer === "play" ? { id: nextId++, assetId: entry.cue.assetId } : null);
        }
        await Promise.resolve();
        await Promise.resolve();
    };
    const cue = (assetId: string, more: Partial<PageMusicCue> = {}): PageMusicTarget => ({
        cue: {
            key: `${assetId}\u0000bgm`,
            surfaceId: "page",
            assetId,
            audioTrackId: "bgm",
            volume: 1,
            fadeMs: 0,
            ...more,
        },
    });
    const none: PageMusicTarget = { cue: null };
    return {
        controller,
        log,
        settle,
        cue,
        none,
        hold: (value: boolean) => {
            held = value;
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
        h.controller.update(h.none);
        expect(h.log).toEqual([
            "play theme fade=1000",
            "stop theme#0 fade=1000",
            "play room fade=300",
            "stop room#1 fade=300",
        ]);
    });

    it("lets the music go with the fade the screen asks for, when it asks", async () => {
        const h = harness();
        h.controller.update(h.cue("theme", { fadeMs: 1000 }));
        await h.settle();
        h.controller.update({ cue: null, leaveFadeMs: 2500 });
        expect(h.log.at(-1)).toBe("stop theme#0 fade=2500");
    });

    it("never leaves a music playing whose page moved on before it started", async () => {
        const h = harness();
        h.controller.update(h.cue("theme"));
        h.controller.update(h.cue("room"));
        await h.settle();
        expect(h.log).toEqual(["play theme fade=0", "play room fade=0", "stop theme#0 fade=0"]);
    });

    it("gives the music to the game while one holds the screen, fading out as the press lands", async () => {
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

    it("asks again when nothing could be played", async () => {
        const h = harness();
        h.controller.update(h.cue("theme"));
        await h.settle("nothing");
        h.controller.refresh();
        expect(h.log).toEqual(["play theme fade=0", "play theme fade=0"]);
    });

    it("stops at once when the host goes away", async () => {
        const h = harness();
        h.controller.update(h.cue("theme", { fadeMs: 1000 }));
        await h.settle();
        h.controller.dispose();
        expect(h.log.at(-1)).toBe("stop theme#0 fade=0");
    });
});
