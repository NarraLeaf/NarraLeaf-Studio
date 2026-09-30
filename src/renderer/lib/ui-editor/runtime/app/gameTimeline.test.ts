/**
 * The game's performance timeline is a contract with readers Studio never sees - a runtime plugin
 * with a `PerformanceObserver`, a profiler - so what is pinned here is what they read: the names
 * exactly as published, the detail each entry carries, where the launch puts the page, and that a
 * long session does not grow the page's buffer without bound while an observer still hears
 * everything.
 *
 * Comments in English per project convention.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    createGameTimelineFamily,
    describeGameLaunch,
    GAME_TIMELINE_PREFIX,
    GameTimelineName,
    publishGameLaunch,
    recordGameSpan,
    resetGameTimelineForTests,
    timeGameSpan,
} from "./gameTimeline";
import { createGameBootReporter } from "./bootTiming";

beforeEach(() => {
    performance.clearMarks();
    performance.clearMeasures();
    resetGameTimelineForTests();
});

afterEach(() => {
    performance.clearMarks();
    performance.clearMeasures();
});

function measuresNamed(name: string): PerformanceMeasure[] {
    return performance.getEntriesByName(name, "measure") as PerformanceMeasure[];
}

describe("the names a reader filters on", () => {
    it("are exactly the published ones, all under the one prefix", () => {
        // A renamed entry is a plugin that silently measures nothing, so these are spelled out
        // rather than derived: changing one here has to be a decision.
        expect(GameTimelineName).toEqual({
            launch: "nl.launch",
            storyCompile: "nl.story.compile",
            sceneLoad: "nl.scene.load",
            preloadAsset: "nl.preload.asset",
            surfaceMount: "nl.surface.mount",
            saveWrite: "nl.save.write",
            saveLoad: "nl.save.load",
        });
        for (const name of Object.values(GameTimelineName)) {
            expect(name.startsWith(GAME_TIMELINE_PREFIX)).toBe(true);
        }
    });
});

describe("a span", () => {
    it("is one measure, carrying its detail, at the times it was given", () => {
        recordGameSpan(GameTimelineName.saveWrite, 100, 142.5, { slot: "quick", screenshot: true, ok: true });

        const [entry] = measuresNamed("nl.save.write");
        expect(entry.startTime).toBe(100);
        expect(entry.duration).toBeCloseTo(42.5);
        expect(entry.detail).toEqual({ slot: "quick", screenshot: true, ok: true });
        // One entry per event, not a pair of marks around a measure.
        expect(performance.getEntriesByType("mark")).toHaveLength(0);
    });

    it("that ends before it starts is recorded as zero rather than refused", () => {
        recordGameSpan(GameTimelineName.saveLoad, 50, 40, { slot: "a", outcome: "loaded" });

        expect(measuresNamed("nl.save.load")[0]?.duration).toBe(0);
    });

    it("is timed around work that throws, which still throws", async () => {
        await expect(timeGameSpan(
            GameTimelineName.saveWrite,
            async () => {
                throw new Error("disk full");
            },
            outcome => ({ slot: "auto", screenshot: false, ok: outcome.ok }),
        )).rejects.toThrow("disk full");

        expect(measuresNamed("nl.save.write")[0]?.detail).toEqual({ slot: "auto", screenshot: false, ok: false });
    });

    it("passes the work's own answer through untouched", async () => {
        const value = await timeGameSpan(
            GameTimelineName.saveLoad,
            async () => ({ status: "refused" as const }),
            outcome => ({ slot: "1", outcome: outcome.ok && outcome.value.status === "refused" ? "refused" : "failed" }),
        );

        expect(value).toEqual({ status: "refused" });
        expect(measuresNamed("nl.save.load")[0]?.detail).toEqual({ slot: "1", outcome: "refused" });
    });
});

describe("a long session", () => {
    it("keeps each name's buffer under its allowance however many events there are", () => {
        // A session that opens pages all day. MEASURED against the allowance rather than a
        // hard-coded number so the test states the property, not the constant.
        for (let index = 0; index < 5000; index++) {
            recordGameSpan(GameTimelineName.surfaceMount, index, index + 1, {
                surfaceId: "menu",
                surface: "Menu",
                kind: "page",
            });
        }

        const kept = measuresNamed("nl.surface.mount").length;
        expect(kept).toBeGreaterThan(0);
        expect(kept).toBeLessThanOrEqual(200);
    });

    it("still hands every entry to an observer that was already listening", async () => {
        const seen: string[] = [];
        const observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                if (entry.name === "nl.save.write") {
                    seen.push(entry.name);
                }
            }
        });
        observer.observe({ entryTypes: ["measure"] });
        try {
            for (let index = 0; index < 250; index++) {
                recordGameSpan(GameTimelineName.saveWrite, index, index + 1, { slot: `s${index}`, screenshot: false, ok: true });
            }
            await new Promise(resolve => setTimeout(resolve, 20));
        } finally {
            observer.disconnect();
        }

        // 250 written, at most 100 buffered - and all 250 delivered.
        expect(measuresNamed("nl.save.write").length).toBeLessThanOrEqual(100);
        expect(seen).toHaveLength(250);
    });

    it("bounds the boot's own entries too, across as many boots as a Dev Mode window has", () => {
        for (let boot = 0; boot < 200; boot++) {
            const reporter = createGameBootReporter();
            reporter.begin("story");
            reporter.end("story");
            reporter.begin("preload");
            reporter.end("preload");
            reporter.firstFrame();
        }

        const bootEntries = performance.getEntries().filter(entry => entry.name.startsWith("nl.boot"));
        expect(bootEntries.length).toBeLessThanOrEqual(400);
    });

    it("clears only the names that family wrote", () => {
        const family = createGameTimelineFamily(2);
        performance.mark("someone-else");
        family.write("nl.a", timeline => timeline.mark("nl.a"));
        family.write("nl.a", timeline => timeline.mark("nl.a"));
        family.write("nl.a", timeline => timeline.mark("nl.a"));

        expect(performance.getEntriesByName("nl.a")).toHaveLength(1);
        expect(performance.getEntriesByName("someone-else")).toHaveLength(1);
    });
});

describe("the launch", () => {
    it("places the page on the process's timeline", () => {
        const detail = describeGameLaunch({
            origin: "process",
            zero: 1_000_000,
            milestones: [
                { name: "appReady", at: 1_000_180 },
                { name: "windowCreated", at: 1_000_240 },
            ],
        }, 1_000_300.25);

        expect(detail).toEqual({
            origin: "process",
            pageOrigin: 300.3,
            milestones: [
                { name: "appReady", at: 180 },
                { name: "windowCreated", at: 240 },
            ],
        });
    });

    it("falls back to the page when nothing earlier is known", () => {
        expect(describeGameLaunch(null, 1_000)).toEqual({ origin: "page", pageOrigin: 0, milestones: [] });
    });

    it("refuses a launch that says the page began before its own process", () => {
        // Two clocks that disagree. An offset built from them would be fiction.
        expect(describeGameLaunch({ origin: "process", zero: 5_000, milestones: [] }, 4_000).origin).toBe("page");
    });

    it("is one mark at the page's origin, written once per page", () => {
        const zero = performance.timeOrigin - 500;
        publishGameLaunch({ origin: "devMode", zero, milestones: [{ name: "windowCreated", at: zero + 120 }] });
        publishGameLaunch({ origin: "process", zero: zero - 99_999, milestones: [] });

        const marks = performance.getEntriesByName("nl.launch", "mark") as PerformanceMark[];
        expect(marks).toHaveLength(1);
        expect(marks[0].startTime).toBe(0);
        expect(marks[0].detail).toMatchObject({ origin: "devMode", milestones: [{ name: "windowCreated", at: 120 }] });
        expect((marks[0].detail as { pageOrigin: number }).pageOrigin).toBeCloseTo(500, 0);
    });
});
