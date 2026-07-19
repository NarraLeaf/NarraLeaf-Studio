import { describe, expect, it } from "vitest";
import { createEmptyProjectStats, type ProjectStatsV1 } from "@shared/types/stats";
import {
    buildActivityTimeline,
    computeWritingStreak,
    getActivityWindow,
    summarizeActivityWindow,
} from "./dashboardModel";

function dayKey(base: Date, offset: number): string {
    const d = new Date(base);
    d.setDate(d.getDate() + offset);
    const m = `${d.getMonth() + 1}`.padStart(2, "0");
    const day = `${d.getDate()}`.padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
}

function statsWith(now: Date, entries: Record<number, number>): ProjectStatsV1 {
    const stats = createEmptyProjectStats();
    for (const [offset, words] of Object.entries(entries)) {
        stats.days[dayKey(now, Number(offset))] = { words, edits: 1, activeSeconds: 60 };
    }
    return stats;
}

describe("dashboard activity model", () => {
    const now = new Date(2026, 6, 17, 12, 0, 0);

    it("does not zero-baseline the first tracked day (the 50k false-spike case)", () => {
        // Collection starts on a project that already had 50,000 words, then 120 written next day.
        const stats = statsWith(now, { [-2]: 50_000, [-1]: 50_120 });
        const timeline = buildActivityTimeline(stats, now.getTime());
        const points = getActivityWindow(timeline);

        const start = points.find(p => p.status === "start");
        expect(start?.delta).toBeNull();

        const summary = summarizeActivityWindow(points);
        expect(summary.wordsWritten).toBe(120);
        expect(summary.peakDelta).toBe(120);
    });

    it("carries a gap day forward as a real zero delta inside the tracked range", () => {
        const stats = statsWith(now, { [-4]: 100, [-3]: 200, [-1]: 200 });
        const timeline = buildActivityTimeline(stats, now.getTime());
        const byOffset = (offset: number) => timeline.find(p => p.key === dayKey(now, offset));

        expect(byOffset(-4)?.status).toBe("start");
        expect(byOffset(-3)?.delta).toBe(100);
        expect(byOffset(-2)?.status).toBe("tracked");
        expect(byOffset(-2)?.delta).toBe(0);
    });

    it("reports negatives honestly but keeps them out of words written", () => {
        const stats = statsWith(now, { [-3]: 500, [-2]: 900, [-1]: 700 });
        const timeline = buildActivityTimeline(stats, now.getTime());
        expect(timeline.find(p => p.key === dayKey(now, -1))?.delta).toBe(-200);
        expect(summarizeActivityWindow(getActivityWindow(timeline)).wordsWritten).toBe(400);
    });

    it("counts a streak anchored on yesterday and excludes the unknowable start day", () => {
        const stats = statsWith(now, { [-3]: 100, [-2]: 200, [-1]: 300 });
        expect(computeWritingStreak(buildActivityTimeline(stats, now.getTime()))).toBe(2);
    });

    it("breaks a streak on a zero-delta day", () => {
        const stats = statsWith(now, { [-4]: 100, [-3]: 200, [-2]: 200, [-1]: 300 });
        expect(computeWritingStreak(buildActivityTimeline(stats, now.getTime()))).toBe(1);
    });

    it("renders an empty project as 30 untracked days with no NaN", () => {
        const timeline = buildActivityTimeline(createEmptyProjectStats(), now.getTime());
        const points = getActivityWindow(timeline);
        expect(points).toHaveLength(30);
        expect(points.every(p => p.status === "untracked" && p.delta === null)).toBe(true);
        const summary = summarizeActivityWindow(points);
        expect(summary).toEqual({ wordsWritten: 0, activeSeconds: 0, edits: 0, peakDelta: 0 });
        expect(computeWritingStreak(timeline)).toBe(0);
    });

    it("keeps history older than the window out of the chart but in the streak", () => {
        const entries: Record<number, number> = {};
        for (let i = 40; i >= 1; i--) {
            entries[-i] = (41 - i) * 10;
        }
        const stats = statsWith(now, entries);
        const timeline = buildActivityTimeline(stats, now.getTime());
        const points = getActivityWindow(timeline);
        expect(points).toHaveLength(30);
        // The window's first day is well inside the tracked range, so it has a baseline.
        expect(points[0].status).toBe("tracked");
        expect(computeWritingStreak(timeline)).toBe(39);
    });
});
