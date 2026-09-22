/**
 * What the player's warming costs, as the timeline records it: one entry per picture the player
 * actually fetched and decoded, and one per scene for what its first frame waited on.
 *
 * The player is stood in for by a watcher whose settles the test resolves by hand, because what is
 * being pinned is the bookkeeping - which asset, which band, when it started and when it ended, and
 * that a scene is only over when the last thing its gate named has landed - not the engine's cache.
 *
 * Comments in English per project convention.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreloadPlan } from "narraleaf-react";
import type { GameTimelineSpanDetails, GameTimelineSpanName } from "../app/gameTimeline";
import { createStudioPreloadTimeline, type PreloadWarmWatcher } from "./studioPreloadTimeline";

type Recorded = { name: GameTimelineSpanName; start: number; end: number; detail: GameTimelineSpanDetails[GameTimelineSpanName] };

function harness() {
    let clock = 0;
    const recorded: Recorded[] = [];
    const warm = new Set<string>();
    const settles = new Map<string, (ok: boolean) => void>();
    const watcher: PreloadWarmWatcher = {
        isWarm: src => warm.has(src),
        settled: src => new Promise<boolean>(resolve => {
            settles.set(src, resolve);
        }),
    };
    const timeline = createStudioPreloadTimeline({
        now: () => clock,
        record: (name, start, end, detail) => {
            recorded.push({ name, start, end, detail } as Recorded);
        },
    });
    timeline.useWatcher(watcher);
    return {
        timeline,
        recorded,
        warm,
        at(ms: number) {
            clock = ms;
        },
        async settle(src: string, ok = true) {
            warm.add(src);
            settles.get(src)?.(ok);
            // Two turns: the settle's own `then`, and the scene bookkeeping chained on it.
            await Promise.resolve();
            await Promise.resolve();
        },
        named(name: GameTimelineSpanName) {
            return recorded.filter(entry => entry.name === name);
        },
    };
}

function plan(entries: PreloadPlan["entries"]): PreloadPlan {
    return { entries };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("one asset", () => {
    it("is timed from the player starting on it to the player finishing, and named", async () => {
        const h = harness();
        h.timeline.useAssetIds(new Map([["bg.png", "asset-bg"]]));
        h.timeline.planned("scene", "The corridor", plan([{ type: "image", src: "bg.png", band: "gate" }]));

        h.at(10);
        h.timeline.acquired("bg.png");
        h.at(250);
        await h.settle("bg.png");

        expect(h.named("nl.preload.asset")).toEqual([{
            name: "nl.preload.asset",
            start: 10,
            end: 250,
            detail: {
                pass: "scene",
                kind: "image",
                assetId: "asset-bg",
                url: "bg.png",
                band: "gate",
                scene: "The corridor",
                ok: true,
            },
        }]);
    });

    it("says so when it did not load", async () => {
        const h = harness();
        h.timeline.planned("advance", "Scene", plan([{ type: "image", src: "a.png", band: "soon" }]));
        h.timeline.acquired("a.png");
        await h.settle("a.png", false);

        expect(h.named("nl.preload.asset")[0]?.detail).toMatchObject({ pass: "advance", band: "soon", ok: false });
    });

    it("is left out when the player only noted it and fetched nothing", async () => {
        // An idle entry is not decoded, and with Studio handing back the url there is no fetch
        // either: the span would be the cost of a function call.
        const h = harness();
        h.timeline.planned("scene", "Scene", plan([{ type: "image", src: "later.png", band: "idle" }]));
        h.timeline.acquired("later.png");
        await h.settle("later.png");

        expect(h.named("nl.preload.asset")).toEqual([]);
    });

    it("is not recorded at all without a player to follow", async () => {
        const h = harness();
        h.timeline.useWatcher(null);
        h.timeline.planned("scene", "Scene", plan([{ type: "image", src: "bg.png", band: "gate" }]));
        h.timeline.acquired("bg.png");
        await h.settle("bg.png");

        expect(h.recorded).toEqual([]);
    });
});

describe("a scene", () => {
    it("is over when the last picture its gate named has landed, and no sooner", async () => {
        const h = harness();
        h.at(100);
        h.timeline.planned("scene", "Title", plan([
            { type: "image", src: "bg.png", band: "gate" },
            { type: "image", src: "girl.png", band: "gate" },
            { type: "image", src: "next.png", band: "soon" },
        ]));
        h.timeline.acquired("bg.png");
        h.timeline.acquired("girl.png");
        h.timeline.acquired("next.png");

        h.at(300);
        await h.settle("bg.png");
        await h.settle("next.png");
        expect(h.named("nl.scene.load")).toEqual([]);

        h.at(480);
        await h.settle("girl.png");
        expect(h.named("nl.scene.load")).toEqual([{
            name: "nl.scene.load",
            start: 100,
            end: 480,
            detail: { scene: "Title", gated: 2, waited: 2, complete: true },
        }]);
    });

    it("whose gate was already warm is recorded at once, as having waited for nothing", () => {
        const h = harness();
        h.warm.add("bg.png");
        h.at(40);
        h.timeline.planned("scene", "Title", plan([{ type: "image", src: "bg.png", band: "gate" }]));

        expect(h.named("nl.scene.load")).toEqual([{
            name: "nl.scene.load",
            start: 40,
            end: 40,
            detail: { scene: "Title", gated: 1, waited: 0, complete: true },
        }]);
    });

    it("catches a picture the player warmed without asking for a url", async () => {
        // A bitmap the budget let go of is decoded again with no `acquire`, so nothing settles for
        // it here. The cache itself is the only witness, and it is checked while the scene waits.
        const h = harness();
        h.timeline.planned("scene", "Title", plan([{ type: "image", src: "bg.png", band: "gate" }]));

        h.warm.add("bg.png");
        await vi.advanceTimersByTimeAsync(60);

        expect(h.named("nl.scene.load")[0]?.detail).toMatchObject({ complete: true, waited: 1 });
    });

    it("that another scene replaces before it lands is not recorded", async () => {
        const h = harness();
        h.timeline.planned("scene", "First", plan([{ type: "image", src: "a.png", band: "gate" }]));
        h.timeline.acquired("a.png");
        h.timeline.planned("scene", "Second", plan([{ type: "image", src: "b.png", band: "gate" }]));
        h.timeline.acquired("b.png");

        await h.settle("a.png");
        await h.settle("b.png");

        expect(h.named("nl.scene.load").map(entry => (entry.detail as { scene: string }).scene)).toEqual(["Second"]);
    });

    it("whose gate never lands is still recorded, marked incomplete", async () => {
        const h = harness();
        h.timeline.planned("scene", "Stuck", plan([{ type: "image", src: "gone.png", band: "gate" }]));

        await vi.advanceTimersByTimeAsync(60_000);

        expect(h.named("nl.scene.load")[0]?.detail).toEqual({ scene: "Stuck", gated: 1, waited: 1, complete: false });
    });

    it("stops waiting when the session goes", async () => {
        const h = harness();
        h.timeline.planned("scene", "Gone", plan([{ type: "image", src: "a.png", band: "gate" }]));
        h.timeline.useWatcher(null);

        await vi.advanceTimersByTimeAsync(60_000);

        expect(h.recorded).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("is not started by the play head moving", () => {
        const h = harness();
        h.timeline.planned("advance", "Scene", plan([{ type: "image", src: "a.png", band: "soon" }]));

        expect(h.named("nl.scene.load")).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });
});
