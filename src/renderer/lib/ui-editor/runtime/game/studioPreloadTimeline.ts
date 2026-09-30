import type { GameState, PreloadEntry, PreloadPlan } from "narraleaf-react";
import {
    GameTimelineName,
    gameTimelineNow,
    recordGameSpan,
    type GamePreloadAssetDetail,
    type GameSceneLoadDetail,
} from "../app/gameTimeline";

/**
 * What the player's warming of a scene costs, asset by asset, on the page's performance timeline.
 *
 * Studio plans what the player warms (`studioPreloadStrategy`), and the player does the work. For a
 * picture it has never fetched, it asks the plan's `acquire` for a url the moment it starts, then
 * fetches and decodes it off-screen - so the start is a call Studio receives and the end is the
 * player's own settle, which this follows. For a picture it already holds without a bitmap -
 * fetched earlier as look-ahead, or released by the decoded-image budget - it decodes again without
 * asking anything, and the only witness is the cache itself, which this checks while such a picture
 * is outstanding. Neither costs the player any work of its own.
 *
 * Two kinds of entry come out (see `gameTimeline` for the contract):
 *
 * - `nl.preload.asset`, one per picture the player fetched and decoded, or decoded again;
 * - `nl.scene.load`, one per scene, spanning what that scene's first frame waited for.
 *
 * Comments in English per project convention.
 */

/** How much of a picture the player holds: nothing, the bytes, or the bytes and a decoded bitmap. */
export type PreloadWarmth = "none" | "fetched" | "decoded";

/**
 * How this reads the player's image cache. Injected, because the cache belongs to a live game that
 * does not exist when the scheduler is built, and because a test has none.
 */
export type PreloadWarmWatcher = {
    warmth(src: string): PreloadWarmth;
    /**
     * When the player's fetch of `src` settles - true when it loaded - or null when nothing is in
     * flight for it, in which case nothing is started either.
     */
    settled(src: string): Promise<boolean> | null;
};

/**
 * A watcher over the live game's image cache.
 *
 * `settled` rides on `ImageCacheManager.preload`, which for a source already being fetched returns a
 * token that follows that fetch rather than starting another - the documented behaviour, and the
 * only completion signal the cache publishes. It is asked only while the source is in flight, and
 * without a decode, so it can never ask the player for anything the player had not already started:
 * the answer it waits for is the one the player's own task produces.
 */
export function createImageCacheWarmWatcher(readGameState: () => GameState | null | undefined): PreloadWarmWatcher {
    const cacheOf = () => {
        const gameState = readGameState() ?? null;
        return { gameState, cache: gameState?.getImageCache() ?? null };
    };
    return {
        warmth(src) {
            const { cache } = cacheOf();
            if (!cache || !cache.has(src)) {
                return "none";
            }
            return cache.isDecoded(src) ? "decoded" : "fetched";
        },
        settled(src) {
            const { gameState, cache } = cacheOf();
            if (!gameState || !cache || !cache.isPreloading(src) || cache.has(src)) {
                return null;
            }
            return new Promise<boolean>(resolve => {
                cache.preload(gameState, src, { decode: false })
                    .onFinished(() => resolve(true))
                    .onErrored(() => resolve(false));
            });
        },
    };
}

function isWarmFor(warmth: PreloadWarmth, decode: boolean): boolean {
    return decode ? warmth === "decoded" : warmth !== "none";
}

type PlannedAsset = {
    band: PreloadEntry["band"];
    pass: "scene" | "advance";
    scene: string | null;
    /** Whether the player decodes it, which is whether it does any work at all for it. */
    decode: boolean;
};

/** A picture the player is decoding again, which it does without asking for a url. */
type Redecode = { start: number; info: PlannedAsset };

type PendingSceneLoad = {
    start: number;
    scene: string | null;
    gated: number;
    waited: number;
    remaining: Set<string>;
    decodeBySrc: Map<string, boolean>;
    giveUp: ReturnType<typeof setTimeout> | null;
};

/**
 * How often what has no settle of its own is checked against the cache: a scene's gate, and a
 * picture being decoded again. About a frame. Checked only while one of those is outstanding, which
 * is a fraction of a second per scene, and the check is a map lookup per picture.
 */
const CACHE_CHECK_MS = 16;

/**
 * How long anything is waited for before it is written off.
 *
 * Longer than any gate that ever finishes on a real machine. A scene still waiting then is written
 * as incomplete, so a gate that never lands still shows up; a picture still waiting is dropped, since
 * a plan the story left behind is abandoned by the player and its pictures were never going to land.
 */
const GIVE_UP_MS = 60_000;

export type StudioPreloadTimeline = {
    /** Point at the live game's cache, or stop recording (and drop anything waiting) with null. */
    useWatcher(watcher: PreloadWarmWatcher | null): void;
    /** The project's id for each url a compile resolved, so an entry can name the asset. */
    useAssetIds(assetIdByUrl: ReadonlyMap<string, string>): void;
    /** A plan was handed to the player. `scene` moments start a scene load. */
    planned(kind: "scene" | "advance", sceneName: string | null, plan: PreloadPlan | null): void;
    /** The player started work on `src` - the plan's `acquire` was asked for it. */
    acquired(src: string): void;
};

export function createStudioPreloadTimeline(options?: {
    now?: () => number;
    record?: typeof recordGameSpan;
}): StudioPreloadTimeline {
    const now = options?.now ?? gameTimelineNow;
    const record = options?.record ?? recordGameSpan;
    let watcher: PreloadWarmWatcher | null = null;
    let assetIds: ReadonlyMap<string, string> = new Map();
    /** The latest reason each url was asked for. */
    const planned = new Map<string, PlannedAsset>();
    /** Per url, the settle of the fetch the player is doing on it right now. */
    const inFlight = new Map<string, Promise<void>>();
    /** Per url, a decode the player is doing again, found only by looking. */
    const redecoding = new Map<string, Redecode>();
    let pendingScene: PendingSceneLoad | null = null;
    let check: ReturnType<typeof setInterval> | null = null;

    const recordAsset = (src: string, start: number, info: PlannedAsset | undefined, ok: boolean): void => {
        const detail: GamePreloadAssetDetail = {
            pass: info?.pass ?? "scene",
            kind: "image",
            assetId: assetIds.get(src) ?? null,
            url: src,
            ...(info ? { band: info.band, scene: info.scene } : {}),
            ok,
        };
        record(GameTimelineName.preloadAsset, start, now(), detail);
    };

    const stopChecking = (): void => {
        if (check !== null && !pendingScene && redecoding.size === 0) {
            clearInterval(check);
            check = null;
        }
    };

    const stopWaiting = (pending: PendingSceneLoad): void => {
        if (pending.giveUp !== null) {
            clearTimeout(pending.giveUp);
            pending.giveUp = null;
        }
        if (pendingScene === pending) {
            pendingScene = null;
        }
        stopChecking();
    };

    const finishScene = (pending: PendingSceneLoad, complete: boolean): void => {
        stopWaiting(pending);
        const detail: GameSceneLoadDetail = {
            scene: pending.scene,
            gated: pending.gated,
            waited: pending.waited,
            complete,
        };
        record(GameTimelineName.sceneLoad, pending.start, now(), detail);
    };

    const settleForScene = (src: string): void => {
        const pending = pendingScene;
        if (!pending || !pending.remaining.delete(src)) {
            return;
        }
        if (pending.remaining.size === 0) {
            finishScene(pending, true);
        }
    };

    const checkCache = (): void => {
        const current = watcher;
        if (!current) {
            return;
        }
        const at = now();
        for (const [src, redecode] of [...redecoding]) {
            if (current.warmth(src) === "decoded") {
                redecoding.delete(src);
                recordAsset(src, redecode.start, redecode.info, true);
                settleForScene(src);
            } else if (at - redecode.start > GIVE_UP_MS) {
                redecoding.delete(src);
            }
        }
        const pending = pendingScene;
        if (pending) {
            for (const src of [...pending.remaining]) {
                if (isWarmFor(current.warmth(src), pending.decodeBySrc.get(src) ?? true)) {
                    settleForScene(src);
                }
            }
        }
        stopChecking();
    };

    const startChecking = (): void => {
        if (check === null) {
            check = setInterval(checkCache, CACHE_CHECK_MS);
        }
    };

    return {
        useWatcher(next) {
            watcher = next;
            if (!next) {
                // The session this was waiting in is gone; what it was waiting for will never land.
                redecoding.clear();
                if (pendingScene) {
                    stopWaiting(pendingScene);
                }
                stopChecking();
            }
        },

        useAssetIds(next) {
            assetIds = next;
        },

        planned(kind, sceneName, plan) {
            if (!plan) {
                return;
            }
            const current = watcher;
            const start = now();
            const gate = new Map<string, boolean>();
            for (const entry of plan.entries) {
                const decode = entry.decode ?? entry.band !== "idle";
                const info: PlannedAsset = { band: entry.band, pass: kind, scene: sceneName, decode };
                planned.set(entry.src, info);
                if (entry.band === "gate") {
                    gate.set(entry.src, decode || gate.get(entry.src) === true);
                }
                // Held without a bitmap and wanted with one: the player will decode it again, and
                // say nothing to anyone. This is where that work is timed from.
                if (current && decode && !redecoding.has(entry.src) && !inFlight.has(entry.src)
                    && current.warmth(entry.src) === "fetched") {
                    redecoding.set(entry.src, { start, info });
                }
            }
            if (redecoding.size > 0) {
                startChecking();
            }
            if (kind !== "scene") {
                return;
            }
            // A scene asked for while another was still waiting has superseded it: the player stops
            // warming the first, so its gate will never complete, and a span written for it would
            // be an interruption dressed up as a load.
            if (pendingScene) {
                stopWaiting(pendingScene);
            }
            if (!current) {
                return;
            }
            const remaining = new Set(
                [...gate].filter(([src, decode]) => !isWarmFor(current.warmth(src), decode)).map(([src]) => src),
            );
            const pending: PendingSceneLoad = {
                start,
                scene: sceneName,
                gated: gate.size,
                waited: remaining.size,
                remaining,
                decodeBySrc: gate,
                giveUp: null,
            };
            if (remaining.size === 0) {
                finishScene(pending, true);
                return;
            }
            pendingScene = pending;
            for (const src of remaining) {
                void inFlight.get(src)?.then(() => settleForScene(src));
            }
            startChecking();
            pending.giveUp = setTimeout(() => {
                if (pendingScene === pending) {
                    finishScene(pending, false);
                }
            }, GIVE_UP_MS);
        },

        acquired(src) {
            const current = watcher;
            if (!current) {
                return;
            }
            const start = now();
            const settled = current.settled(src);
            if (!settled) {
                return;
            }
            const info = planned.get(src);
            const done = settled.then(ok => {
                // Nothing to report for a picture the player only noted: without a decode it takes
                // the url and fetches nothing, so the span would be the cost of a function call.
                if (!info || info.decode) {
                    recordAsset(src, start, info, ok);
                }
                settleForScene(src);
            });
            inFlight.set(src, done);
            void done.finally(() => {
                if (inFlight.get(src) === done) {
                    inFlight.delete(src);
                }
            });
        },
    };
}
