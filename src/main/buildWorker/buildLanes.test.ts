import { describe, expect, it } from "vitest";
import {
    buildLaneCount,
    createKeyedTurns,
    forEachInLanes,
    MemoryBudget,
    resolveBuildLanes,
} from "./buildLanes";

const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));

describe("buildLaneCount", () => {
    it("leaves one core to the process feeding the lanes", () => {
        expect(buildLaneCount(8, 4)).toBe(3);
    });

    it("never goes past the caller's ceiling, however many cores there are", () => {
        expect(buildLaneCount(8, 64)).toBe(8);
    });

    it("still runs on a single-core machine", () => {
        expect(buildLaneCount(8, 1)).toBe(1);
    });
});

describe("resolveBuildLanes", () => {
    it("takes a count from the environment when one is named", () => {
        expect(resolveBuildLanes("NLS_TEST_LANES", 8, { NLS_TEST_LANES: "1" })).toBe(1);
        expect(resolveBuildLanes("NLS_TEST_LANES", 8, { NLS_TEST_LANES: "12" })).toBe(12);
    });

    it("reads the machine when the variable is absent or not a count", () => {
        expect(resolveBuildLanes("NLS_TEST_LANES", 8, {})).toBe(buildLaneCount(8));
        expect(resolveBuildLanes("NLS_TEST_LANES", 8, { NLS_TEST_LANES: "lots" })).toBe(buildLaneCount(8));
        expect(resolveBuildLanes("NLS_TEST_LANES", 8, { NLS_TEST_LANES: "0" })).toBe(buildLaneCount(8));
    });
});

describe("forEachInLanes", () => {
    it("keeps no more than the lane count in flight, and starts items in order", async () => {
        let running = 0;
        let peak = 0;
        const started: number[] = [];
        await forEachInLanes([1, 2, 3, 4, 5, 6, 7], 3, async item => {
            started.push(item);
            running += 1;
            peak = Math.max(peak, running);
            await tick();
            running -= 1;
        });
        expect(peak).toBe(3);
        expect(started).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it("does nothing for an empty list", async () => {
        let calls = 0;
        await forEachInLanes([], 4, async () => {
            calls += 1;
        });
        expect(calls).toBe(0);
    });

    it("asks before each item whether to stop, and lets a started item finish", async () => {
        const finished: number[] = [];
        let asked = 0;
        await forEachInLanes([1, 2, 3, 4], 1, async item => {
            await tick();
            finished.push(item);
        }, () => asked++ >= 2);
        expect(finished).toEqual([1, 2]);
    });

    it("starts nothing new after a failure, waits for what is running, then throws the first failure", async () => {
        const finished: number[] = [];
        const started: number[] = [];
        const run = forEachInLanes([1, 2, 3, 4, 5], 2, async item => {
            started.push(item);
            if (item === 1) {
                throw new Error("first");
            }
            await tick(20);
            finished.push(item);
        });
        await expect(run).rejects.toThrow("first");
        // Item 2 was already running when item 1 failed, and it was let finish.
        expect(finished).toEqual([2]);
        expect(started).toEqual([1, 2]);
    });
});

describe("MemoryBudget", () => {
    it("lets jobs in while they fit, and the next one in when room is given back", async () => {
        const budget = new MemoryBudget(100);
        const first = await budget.reserve(60);
        let secondIn = false;
        const second = budget.reserve(60).then(release => {
            secondIn = true;
            return release;
        });
        await tick();
        expect(secondIn).toBe(false);
        first();
        (await second)();
        expect(secondIn).toBe(true);
    });

    it("lets a job larger than the whole budget in alone, rather than never", async () => {
        const budget = new MemoryBudget(100);
        const small = await budget.reserve(10);
        let largeIn = false;
        const large = budget.reserve(500).then(release => {
            largeIn = true;
            return release;
        });
        await tick();
        expect(largeIn).toBe(false);
        small();
        (await large)();
        expect(largeIn).toBe(true);
    });

    it("serves the queue in order, so a large job is not overtaken forever by small ones", async () => {
        const budget = new MemoryBudget(100);
        const holding = await budget.reserve(50);
        const order: string[] = [];
        const large = budget.reserve(80).then(release => {
            order.push("large");
            return release;
        });
        // This one would fit beside what is held, but the large job asked first.
        const small = budget.reserve(10).then(release => {
            order.push("small");
            return release;
        });
        await tick();
        expect(order).toEqual([]);
        holding();
        (await large)();
        (await small)();
        expect(order).toEqual(["large", "small"]);
    });

    it("ignores a second release of the same reservation", async () => {
        const budget = new MemoryBudget(100);
        const first = await budget.reserve(100);
        first();
        first();
        const second = await budget.reserve(100);
        let thirdIn = false;
        void budget.reserve(100).then(() => {
            thirdIn = true;
        });
        await tick();
        expect(thirdIn).toBe(false);
        second();
    });
});

describe("createKeyedTurns", () => {
    it("runs work under one key one at a time, in the order it arrived", async () => {
        const turn = createKeyedTurns();
        const events: string[] = [];
        await Promise.all(["a", "b", "c"].map(name => turn("same", async () => {
            events.push(`${name}+`);
            await tick();
            events.push(`${name}-`);
        })));
        expect(events).toEqual(["a+", "a-", "b+", "b-", "c+", "c-"]);
    });

    it("lets work under different keys run side by side", async () => {
        const turn = createKeyedTurns();
        let running = 0;
        let peak = 0;
        await Promise.all(["x", "y", "z"].map(key => turn(key, async () => {
            running += 1;
            peak = Math.max(peak, running);
            await tick();
            running -= 1;
        })));
        expect(peak).toBe(3);
    });

    it("gives the next turn after a failed one, and hands the failure to its own caller", async () => {
        const turn = createKeyedTurns();
        const failed = turn("k", async () => {
            throw new Error("broken");
        });
        const next = turn("k", async () => "ran");
        await expect(failed).rejects.toThrow("broken");
        await expect(next).resolves.toBe("ran");
    });
});
