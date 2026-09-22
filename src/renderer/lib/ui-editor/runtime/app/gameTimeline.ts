/**
 * The game's performance timeline: every mark and measure the runtime writes, and the one place
 * that writes them.
 *
 * A game's page records where its time goes on the standard User Timing timeline, under names that
 * start with `nl.`. Nothing in Studio reads them. They are there for whoever attaches to a running
 * game - a runtime plugin with a `PerformanceObserver`, a profiler, DevTools - and they are written
 * in every build, shipped games included, because the plugin that reads them decides whether it is
 * in a build, not the runtime. The names and the `detail` each entry carries are a contract with
 * those readers: documented for plugin authors in `project/docs/runtime-api.md`, and exported to them
 * as types through `runtimePluginApi`.
 *
 * ## What is on it
 *
 * - `nl.launch` - a mark at the page's time origin whose detail says when the launch began and what
 *   happened before the page existed ({@link GameLaunchEntryDetail}). Once per page.
 * - `nl.boot.*` - the boot's phases, written by `bootTiming`, which predates this module and keeps
 *   its own names.
 * - The spans below, each a measure with a detail, written as they happen for the whole session.
 *
 * ## What it costs
 *
 * Nothing per frame: every entry is one event the game was doing anyway - a save, a page opening,
 * an asset landing - and the counts are bounded by those events. The measures are written with
 * explicit start and end times rather than as pairs of marks, so each event is one entry, not three.
 *
 * The buffer is bounded too, and has to be by this module: Chromium keeps every mark and measure a
 * page writes for as long as the page lives, with no cap of its own. Each name keeps at most a fixed
 * number of entries; the write that would exceed it clears that name first. An observer that is
 * already subscribed has every entry delivered to it regardless - the clear only drops the page's
 * buffered copy, which is what a `buffered: true` subscription replays. So a reader subscribes early
 * and keeps what it wants; the buffer is a courtesy to late subscribers, not an archive.
 *
 * Every write is guarded. A timeline that refuses an entry, or an environment without one, costs the
 * game nothing: this is an observation, and the game starting is the thing that matters.
 *
 * Comments in English per project convention.
 */

import type { GameLaunchTiming } from "@shared/types/gameLaunchTiming";

/** Every name this runtime writes starts with this. A reader filters on it. */
export const GAME_TIMELINE_PREFIX = "nl.";

/** The names of the entries written after the boot, and of the launch mark. */
export const GameTimelineName = {
    launch: "nl.launch",
    storyCompile: "nl.story.compile",
    sceneLoad: "nl.scene.load",
    preloadAsset: "nl.preload.asset",
    surfaceMount: "nl.surface.mount",
    saveWrite: "nl.save.write",
    saveLoad: "nl.save.load",
} as const;

/**
 * The detail on `nl.launch`: where this page sits on the launch's own timeline.
 *
 * Every entry's `startTime` is measured from the page's time origin. Add `pageOrigin` to it and it
 * is measured from the launch instead, which is how a boot phase and the process start end up on
 * one axis.
 */
export type GameLaunchEntryDetail = {
    /**
     * What zero is.
     *
     * - `process` - the game's process was created (a packaged game, a preview).
     * - `devMode` - an author asked Studio to run the game (a Dev Mode window).
     * - `page` - nothing earlier is known, so zero is this page's own origin (the web export).
     */
    origin: "process" | "devMode" | "page";
    /** Milliseconds from zero to this page's time origin. Zero when `origin` is `page`. */
    pageOrigin: number;
    /**
     * What happened between zero and the page, in milliseconds from zero: `appReady` (Electron has
     * started) and `windowCreated` (the window exists and its page has been asked for) on a
     * packaged game, `windowCreated` alone in Dev Mode. Empty when `origin` is `page`.
     */
    milestones: { name: string; at: number }[];
};

/** `nl.story.compile` - a story compiled outside the boot. The boot's own is `nl.boot.story`. */
export type GameStoryCompileDetail = {
    storyId: string;
    sceneId: string | null;
};

/**
 * `nl.scene.load` - a scene's gate: from the player asking what to warm for the scene to the last
 * picture its first frame waits for having landed.
 *
 * That is the part of entering a scene that loading decides; a transition the author wrote plays
 * after it and is not included. A scene whose gate was already warm - or that had nothing in it -
 * records a span of about zero, which is the honest answer rather than a missing one.
 */
export type GameSceneLoadDetail = {
    /** The scene as the author named it, or null for a scene Studio did not compile (a row launch). */
    scene: string | null;
    /** Pictures the scene's first frame waits for. */
    gated: number;
    /** Of those, how many were not warm yet when the scene was asked for. */
    waited: number;
    /** False when it gave up waiting: something in the gate never landed. */
    complete: boolean;
};

/**
 * `nl.preload.asset` - one asset warmed, from the moment the work on it started to the moment it
 * settled, loaded or not.
 *
 * - `pass: "interface"` - the pass that warms the pages' pictures, sounds and fonts before the first
 *   screen and behind it. `firstScreen` says whether the first screen was waiting for it.
 * - `pass: "scene"` / `"advance"` - the player warming a picture a scene will show, asked for when
 *   the scene was entered or as the story moved. `band` is how urgently: `gate` holds the frame,
 *   `soon` is a click away, `idle` is speculative. Only pictures that were actually fetched and
 *   decoded appear; speculative ones the player merely noted cost nothing and are not listed. A
 *   picture it already held without a bitmap - fetched earlier as look-ahead, which is how most
 *   scenes' opening pictures arrive, or released by the decoded-image budget - is decoded again,
 *   and its span runs from the moment the scene or the story asked for it to the bitmap being held.
 */
export type GamePreloadAssetDetail = {
    pass: "interface" | "scene" | "advance";
    kind: "image" | "audio" | "video" | "font";
    /** The project's id for the asset, or null where only its address is known. */
    assetId: string | null;
    /** The address it was loaded from. Opaque; differs between Dev Mode and a build. */
    url: string;
    band?: "gate" | "soon" | "idle";
    firstScreen?: boolean;
    /** The scene it was warmed for, as the author named it. */
    scene?: string | null;
    ok: boolean;
};

/** `nl.surface.mount` - a page or layer, from being asked for to its first paint being allowed. */
export type GameSurfaceMountDetail = {
    surfaceId: string;
    /** The page's name as the author gave it. */
    surface: string | null;
    kind: "page" | "layer";
};

/** `nl.save.write` - a save, from the request to the file being written. */
export type GameSaveWriteDetail = {
    slot: string;
    screenshot: boolean;
    ok: boolean;
};

/** `nl.save.load` - a load, from the request to the player being back on the stage. */
export type GameSaveLoadDetail = {
    slot: string;
    /** `refused`: the save did not fit this build and the run was left where it was. */
    outcome: "loaded" | "refused" | "failed";
};

export type GameTimelineSpanDetails = {
    "nl.story.compile": GameStoryCompileDetail;
    "nl.scene.load": GameSceneLoadDetail;
    "nl.preload.asset": GamePreloadAssetDetail;
    "nl.surface.mount": GameSurfaceMountDetail;
    "nl.save.write": GameSaveWriteDetail;
    "nl.save.load": GameSaveLoadDetail;
};

export type GameTimelineSpanName = keyof GameTimelineSpanDetails;

/**
 * How many entries of each name the page keeps buffered.
 *
 * Assets get the most because they come in the largest numbers: a project's interface pass alone is
 * a few hundred. Everything else is one entry per thing a player did.
 */
const RETAINED_PER_SPAN: Readonly<Record<GameTimelineSpanName, number>> = {
    "nl.story.compile": 100,
    "nl.scene.load": 200,
    "nl.preload.asset": 1000,
    "nl.surface.mount": 200,
    "nl.save.write": 100,
    "nl.save.load": 100,
};

/**
 * The page's timeline, or null where there is not one.
 *
 * Every browser and every test environment this runs in has `performance`, but a node context
 * without `performance.mark` is reachable (a unit test importing a module that boots), and a
 * missing timeline must cost the caller nothing rather than throw.
 */
export function gameTimeline(): Performance | null {
    const candidate = typeof performance === "undefined" ? null : performance;
    return candidate && typeof candidate.mark === "function" && typeof candidate.now === "function"
        ? candidate
        : null;
}

/** The page's clock, or zero without one. Every time this module takes is on it. */
export function gameTimelineNow(): number {
    return gameTimeline()?.now() ?? 0;
}

/**
 * A group of names that share one buffer allowance.
 *
 * When the group has written its allowance, the next write clears every name the group has written
 * and starts counting again. Clearing by name is the only removal User Timing offers - there is no
 * "drop the oldest" - and it never touches entries an observer has already been handed.
 */
export type GameTimelineFamily = {
    write(name: string, write: (timeline: Performance) => void): void;
};

export function createGameTimelineFamily(allowance: number): GameTimelineFamily {
    const names = new Set<string>();
    let written = 0;
    return {
        write(name, write) {
            const timeline = gameTimeline();
            if (!timeline) {
                return;
            }
            if (written >= allowance) {
                for (const entryName of names) {
                    try {
                        timeline.clearMarks(entryName);
                        timeline.clearMeasures(entryName);
                    } catch {
                        // A timeline that cannot clear keeps what it has; the next write still goes in.
                    }
                }
                written = 0;
            }
            try {
                write(timeline);
                names.add(name);
                written += 1;
            } catch {
                // A timeline that refuses an entry is not a reason for the game to stop.
            }
        },
    };
}

const spanFamilies = new Map<GameTimelineSpanName, GameTimelineFamily>();

function familyFor(name: GameTimelineSpanName): GameTimelineFamily {
    let family = spanFamilies.get(name);
    if (!family) {
        family = createGameTimelineFamily(RETAINED_PER_SPAN[name]);
        spanFamilies.set(name, family);
    }
    return family;
}

/**
 * Record one span that has finished.
 *
 * `start` and `end` are on the page's clock ({@link gameTimelineNow}). An end before its start - a
 * clock read out of order across an await - is recorded as a span of zero rather than refused.
 */
export function recordGameSpan<N extends GameTimelineSpanName>(
    name: N,
    start: number,
    end: number,
    detail: GameTimelineSpanDetails[N],
): void {
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return;
    }
    familyFor(name).write(name, timeline => {
        timeline.measure(name, { start, end: Math.max(start, end), detail });
    });
}

/**
 * Time an asynchronous piece of work as one span, whether it succeeds or throws.
 *
 * The detail is built after the work, from its outcome, so it can say how it ended. What the work
 * returns or throws is passed through untouched.
 */
export async function timeGameSpan<N extends GameTimelineSpanName, T>(
    name: N,
    work: () => Promise<T>,
    describe: (outcome: { ok: true; value: T } | { ok: false; error: unknown }) => GameTimelineSpanDetails[N],
): Promise<T> {
    const start = gameTimelineNow();
    try {
        const value = await work();
        recordGameSpan(name, start, gameTimelineNow(), describe({ ok: true, value }));
        return value;
    } catch (error) {
        recordGameSpan(name, start, gameTimelineNow(), describe({ ok: false, error }));
        throw error;
    }
}

/**
 * Where this page sits on its launch's timeline.
 *
 * Falls back to the page's own origin whenever the launch cannot be placed: none was handed down,
 * or the arithmetic says the page began before its own process did, which means two clocks
 * disagree and the offset would be fiction.
 */
export function describeGameLaunch(launch: GameLaunchTiming | null, timeOrigin: number): GameLaunchEntryDetail {
    const pageOnly: GameLaunchEntryDetail = { origin: "page", pageOrigin: 0, milestones: [] };
    if (!launch || !Number.isFinite(timeOrigin)) {
        return pageOnly;
    }
    const pageOrigin = timeOrigin - launch.zero;
    if (!(pageOrigin >= 0)) {
        return pageOnly;
    }
    return {
        origin: launch.origin,
        pageOrigin: roundMs(pageOrigin),
        milestones: launch.milestones
            .filter(milestone => milestone.at <= timeOrigin)
            .map(milestone => ({ name: milestone.name, at: roundMs(milestone.at - launch.zero) })),
    };
}

function roundMs(value: number): number {
    return Math.round(value * 10) / 10;
}

let launchPublished = false;

/**
 * Put the launch on this page's timeline, as the `nl.launch` mark at the page's time origin.
 *
 * Once per page: the launch is a fact about how this page came to exist, and a second call (a
 * component that mounts twice) has nothing new to say. Returns what was written, or null when it had
 * been written already or there is no timeline.
 */
export function publishGameLaunch(launch: GameLaunchTiming | null): GameLaunchEntryDetail | null {
    const timeline = gameTimeline();
    if (launchPublished || !timeline) {
        return null;
    }
    launchPublished = true;
    const detail = describeGameLaunch(launch, timeline.timeOrigin);
    try {
        timeline.mark(GameTimelineName.launch, { startTime: 0, detail });
    } catch {
        // Same as every other write here: the launch not being on the timeline is a gap, not a fault.
    }
    return detail;
}

/** Test seam: forget what has been written, as a freshly loaded page would. */
export function resetGameTimelineForTests(): void {
    launchPublished = false;
    spanFamilies.clear();
}
