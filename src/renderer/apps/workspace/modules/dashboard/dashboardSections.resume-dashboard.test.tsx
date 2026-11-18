// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyProjectStats, toActivityDayKey } from "@shared/types/stats";
import { CastSection } from "./CastSection";
import { WritingActivityChart } from "./WritingActivityChart";
import { buildActivityTimeline, summarizeActivityWindow } from "./dashboardModel";

vi.mock("@/lib/i18n", async () => {
    const { createTranslator } = await import("@shared/i18n");
    return { useTranslation: () => createTranslator("en") };
});

afterEach(cleanup);

describe("dashboard sections", () => {
    it("preserves the speaker totals as the preview expands and collapses", () => {
        const speakers = Array.from({ length: 10 }, (_, index) => ({
            key: `speaker-${index}`, kind: "named" as const, name: `Speaker ${index + 1}`,
            lines: index + 1, words: (index + 1) * 10,
        }));
        render(<CastSection cast={{ speakers, overflow: { speakers: 2, lines: 30, words: 300 } }} />);

        expect(screen.queryByText("Speaker 9")).toBeNull();
        expect(screen.getByText("4 other speakers").parentElement?.textContent).toContain("49490");
        fireEvent.click(screen.getByRole("button", { name: "Show all" }));
        expect(screen.getByText("Speaker 9")).toBeTruthy();
        expect(screen.getByText("2 other speakers").parentElement?.textContent).toContain("30300");
        fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
        expect(screen.queryByText("Speaker 9")).toBeNull();
        expect(screen.getByText("4 other speakers")).toBeTruthy();
    });

    it("renders tracking boundaries, gains, removals and unchanged days using the real activity model", () => {
        const now = new Date(2026, 6, 17, 12);
        const stats = createEmptyProjectStats();
        const put = (offset: number, words: number, rebased = false) => {
            const date = new Date(now);
            date.setDate(date.getDate() + offset);
            stats.days[toActivityDayKey(date.getTime())] = { words, edits: 0, activeSeconds: 0, rebased };
        };
        put(-4, 100);
        put(-3, 150);
        put(-2, 200, true);
        put(-1, 197);
        put(0, 197);
        const points = buildActivityTimeline(stats, now.getTime()).slice(-6);
        const { peakDelta } = summarizeActivityWindow(points);
        render(<WritingActivityChart points={points} peak={peakDelta} />);

        const chart = screen.getByRole("img", { name: "Words written per day over the last 30 days" });
        const labels = [...chart.querySelectorAll("[data-tip]")].map(column => column.getAttribute("data-tip"));
        expect(labels).toHaveLength(6);
        expect(labels[0]).toContain("before tracking started");
        expect(labels[1]).toContain("tracking started");
        expect(labels[2]).toContain("50 words added");
        expect(labels[3]).toContain("word count rule changed");
        expect(labels[4]).toContain("3 words removed");
        expect(labels[5]).toContain("no change");
        expect(screen.getByText("Peak 50 words")).toBeTruthy();
    });
});
