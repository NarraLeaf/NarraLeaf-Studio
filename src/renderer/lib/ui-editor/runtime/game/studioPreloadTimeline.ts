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
 * Studio plans what the player warms (`studioPreloadStrategy`), and the player does the work: it
 * asks the plan's `acquire` for a url the moment it starts on an asset, then fetches and decodes it
 * off-screen. So the start of each asset's work is a call Studio receives, and the end is the
 * player's own. This follows the second without adding any work of its own, and writes two kinds of
 * entry (see `gameTimeline` for the contract):
 *
 * - `nl.preload.asset`, one per picture the player actually fetched and decoded;
 * - `nl.scene.load`, one per scene, spanning what that scene's first frame waited for.
 *
 * Comments in English per project convention.
 */

/**
 * How this reads the player's image cache. Injected, because the cache belongs to a live game that
 * does not exist when the scheduler is built, and because a test has none.
 */
export type PreloadWarmWatcher = {
    /** Whether the player already holds `src` the way an entry wanting `decode` needs it held. */
    isWarm(src: string, decode: boolean): boolean;
    /**
     * When the player's work on `src` settles - true when it loaded - or null when nothing is in
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
        isWarm(src, decode) {
            const { cache } = cacheOf();
            return Boolean(cache && cache.has(src) && (!decode || cache.isDecoded(src)));
        },
        settled(src) {
            const { gameState, cache } = cacheOf();
            if (!gameState || !cache || !cache.isPreloading(src)) {
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

type PlannedAsset = {
    band: PreloadEntry["band"];
    pass: "scene" | "advance";
    scene: string | null;
    /** Whether the player decodes it, which is whether it does any work at all for it. */
    decode: boolean;
};

type PendingSceneLoad = {
    start: number;
    scene: string | null;
    gated: number;
    waited: number;
    remaining: Set<string>;
    decodeBySrc: Map<string, boolean>;
    poll: ReturnType<typeof setInterval> | null;
    giveUp: ReturnType<typeof setTimeout> | null;
};

/**
 * How often a scene still waiting is checked against the cache directly.
 *
 * Most gated pictures report through their own settle; this is for the ones that do not - a bitmap
 * the budget released and the player decodes again, which it does without asking for a url and so
 * without Studio hearing of it. Checked only while a scene is waiting, which is a fraction of a
 * second per scene.
 */
const SCENE_LOAD_CHECK_MS = 50;

/**
 * How long a scene's gate is waited for before the span is written as incomplete.
 *
 * Longer than any gate that ever finishes on a real machine; its job is to make sure a gate that
 * never lands still shows up, marked as such, rather than vanishing.
 */
const SCENE_LOAD_GIVE_UP_MS = 60_000;

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
    /** Per url, the settle of the work the player is doing on it right now. */
    const inFlight = new Map<string, Promise<void>>();
    let pendingScene: PendingSceneLoad | null = null;

    const stopWaiting = (pending: PendingSceneLoad): void => {
        if (pending.poll !== null) {
            clearInterval(pending.poll);
            pending.poll = null;
        }
        if (pending.giveUp !== null) {
            clearTimeout(pending.giveUp);
            pending.giveUp = null;
        }
        if (pendingScene === pending) {
            pendingScene = null;
        }
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

    const checkRemaining = (pending: PendingSceneLoad): void => {
        const current = watcher;
        if (!current || pendingScene !== pending) {
            return;
        }
        for (const src of [...pending.remaining]) {
            if (current.isWarm(src, pending.decodeBySrc.get(src) ?? true)) {
                settleForScene(src);
            }
        }
    };

    return {
        useWatcher(next) {
            watcher = next;
            if (!next && pendingScene) {
                // The session this was waiting in is gone; what it was waiting for will never land.
                stopWaiting(pendingScene);
            }
        },

        useAssetIds(next) {
            assetIds = next;
        },

        planned(kind, sceneName, plan) {
            if (!plan) {
                return;
            }
            const gate = new Map<string, boolean>();
            for (const entry of plan.entries) {
                const decode = entry.decode ?? entry.band !== "idle";
                planned.set(entry.src, { band: entry.band, pass: kind, scene: sceneName, decode });
                if (entry.band === "gate") {
                    gate.set(entry.src, decode || gate.get(entry.src) === true);
                }
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
            const current = watcher;
            if (!current) {
                return;
            }
            const start = now();
            const remaining = new Set([...gate].filter(([src, decode]) => !current.isWarm(src, decode)).map(([src]) => src));
            const pending: PendingSceneLoad = {
                start,
                scene: sceneName,
                gated: gate.size,
                waited: remaining.size,
                remaining,
                decodeBySrc: gate,
                poll: null,
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
            pending.poll = setInterval(() => checkRemaining(pending), SCENE_LOAD_CHECK_MS);
            pending.giveUp = setTimeout(() => {
                if (pendingScene === pending) {
                    finishScene(pending, false);
                }
            }, SCENE_LOAD_GIVE_UP_MS);
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
                    const detail: GamePreloadAssetDetail = {
                        pass: info?.pass ?? "scene",
                        kind: "image",
                        assetId: assetIds.get(src) ?? null,
                        url: src,
                        ...(info ? { band: info.band, scene: info.scene } : {}),
                        ok,
                    };
                    record(GameTimelineName.preloadAsset, start, now(), detail);
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
