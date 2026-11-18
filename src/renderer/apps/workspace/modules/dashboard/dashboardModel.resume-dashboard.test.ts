import { describe, expect, it } from "vitest";
import { createTranslator } from "@shared/i18n";
import { createEmptyProjectStats, toActivityDayKey } from "@shared/types/stats";
import { buildActivityTimeline, formatGreeting } from "./dashboardModel";

describe("dashboard greeting", () => {
    it.each([
        [22, "Good evening"],
        [23, "Late night"],
        [4, "Late night"],
        [5, "Good morning"],
    ])("uses the local time band at %i:00", (hour, expected) => {
        const now = new Date(2026, 6, 17, hour).getTime();
        expect(formatGreeting(createTranslator("en"), now)).toBe(expected);
    });
});

describe("local activity days", () => {
    it.each([
        [2026, 2, 9],
        [2026, 10, 2],
    ])("keeps consecutive dates through a clock change", (year, month, day) => {
        const today = new Date(year, month, day, 12);
        const stats = createEmptyProjectStats();
        for (let offset = -2; offset <= 0; offset += 1) {
            const date = new Date(today);
            date.setDate(date.getDate() + offset);
            stats.days[toActivityDayKey(date.getTime())] = { words: 100 + (offset + 2) * 10, edits: 1, activeSeconds: 0 };
        }
        const points = buildActivityTimeline(stats, today.getTime()).slice(-3);
        expect(new Set(points.map(point => point.key)).size).toBe(3);
        expect(points.map(point => point.delta)).toEqual([null, 10, 10]);
    });
});
