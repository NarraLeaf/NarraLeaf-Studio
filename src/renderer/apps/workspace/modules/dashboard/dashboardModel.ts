/**
 * Pure derivations for the dashboard: the daily writing curve, the streak, and the small
 * formatters the sections share. Kept out of the component so the delta rules stay in one
 * readable place — see {@link ActivityPointStatus}, which is the whole reason this file exists.
 */

import { toActivityDayKey, type ProjectStatsV1 } from "@shared/types/stats";
import type { Translator } from "@shared/i18n";

export const ACTIVITY_WINDOW_DAYS = 30;

/**
 * Why a day's delta is not simply `words - previousWords`:
 *
 * - `untracked` — the day predates collection entirely. There is no word total for it.
 * - `start` — the first tracked day. Its stored total is whatever the project already had when
 *   collection began, not what was written that day, so the delta is *unknowable* rather than
 *   zero. Zero-baselining it would plot the project's entire back catalogue as one day's work,
 *   dwarfing every real bar and permanently wrecking the chart's scale.
 * - `tracked` — a real delta against the previous day's total. A day with no stored entry inside
 *   the tracked range is genuinely different: the total carries forward, so its delta is 0.
 */
export type ActivityPointStatus = "untracked" | "start" | "tracked";

export type ActivityPoint = {
    key: string;
    date: Date;
    status: ActivityPointStatus;
    /** Word delta against the previous day. Non-null only when `status` is `tracked`. */
    delta: number | null;
    edits: number;
    activeSeconds: number;
};

export type ActivityWindowSummary = {
    wordsWritten: number;
    activeSeconds: number;
    edits: number;
    /** Largest single-day gain in the window; the chart's y-scale. 0 when nothing was written. */
    peakDelta: number;
};

function startOfLocalDay(timestamp: number): Date {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date;
}

/** Local-date arithmetic (not `+ 86400000`) so a DST boundary never skips or repeats a day. */
function addDays(date: Date, amount: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
}

function parseDayKey(key: string): Date {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
}

/**
 * One point per local day, from the earlier of (first tracked day, 30 days ago) through today.
 * Continuous by construction, so consumers can walk it without re-resolving gaps.
 */
export function buildActivityTimeline(stats: ProjectStatsV1, now: number): ActivityPoint[] {
    const today = startOfLocalDay(now);
    const windowStart = addDays(today, -(ACTIVITY_WINDOW_DAYS - 1));
    const earliestKey = Object.keys(stats.days).sort()[0];
    const earliest = earliestKey ? parseDayKey(earliestKey) : null;
    const start = earliest && earliest.getTime() < windowStart.getTime() ? earliest : windowStart;

    const points: ActivityPoint[] = [];
    let cursor = start;
    /** Total words as of the end of the most recent stored day at or before `cursor`. */
    let carried: number | null = null;

    while (cursor.getTime() <= today.getTime()) {
        const key = toActivityDayKey(cursor.getTime());
        const day = stats.days[key];
        const previousTotal = carried;
        if (day) {
            carried = day.words;
        }

        let status: ActivityPointStatus;
        let delta: number | null;
        if (carried === null) {
            status = "untracked";
            delta = null;
        } else if (previousTotal === null) {
            status = "start";
            delta = null;
        } else {
            status = "tracked";
            delta = carried - previousTotal;
        }

        points.push({
            key,
            date: cursor,
            status,
            delta,
            edits: day?.edits ?? 0,
            activeSeconds: day?.activeSeconds ?? 0,
        });
        cursor = addDays(cursor, 1);
    }
    return points;
}

export function getActivityWindow(timeline: readonly ActivityPoint[]): ActivityPoint[] {
    return timeline.slice(-ACTIVITY_WINDOW_DAYS);
}

function wroteOn(point: ActivityPoint | undefined): boolean {
    return !!point && point.status === "tracked" && (point.delta ?? 0) > 0;
}

/**
 * `wordsWritten` sums gains only: a day of cutting is not negative writing, and netting the two
 * would let a heavy edit pass report less work than a day off.
 */
export function summarizeActivityWindow(points: readonly ActivityPoint[]): ActivityWindowSummary {
    const summary: ActivityWindowSummary = { wordsWritten: 0, activeSeconds: 0, edits: 0, peakDelta: 0 };
    for (const point of points) {
        summary.activeSeconds += point.activeSeconds;
        summary.edits += point.edits;
        if (wroteOn(point) && point.delta !== null) {
            summary.wordsWritten += point.delta;
            summary.peakDelta = Math.max(summary.peakDelta, point.delta);
        }
    }
    return summary;
}

/**
 * Consecutive days of writing ending today or yesterday. Walks the full timeline rather than the
 * 30-day window so a longer streak still counts, and stops at any day whose delta is unknowable —
 * an unproven day can neither extend a streak nor honestly break one.
 */
export function computeWritingStreak(timeline: readonly ActivityPoint[]): number {
    let index = timeline.length - 1;
    // Today may simply not be written yet; yesterday can still anchor a live streak.
    if (!wroteOn(timeline[index])) {
        index -= 1;
    }
    let streak = 0;
    while (index >= 0 && wroteOn(timeline[index])) {
        streak += 1;
        index -= 1;
    }
    return streak;
}

/**
 * Time-of-day greeting. The bands follow how people actually name the hours rather than splitting
 * the day evenly — "late night" is its own thing, and nobody calls 11pm "evening".
 */
export function formatGreeting(translator: Translator, now: number): string {
    const hour = new Date(now).getHours();
    if (hour < 5) {
        return translator.t("dashboard.greeting.lateNight");
    }
    if (hour < 11) {
        return translator.t("dashboard.greeting.morning");
    }
    if (hour < 13) {
        return translator.t("dashboard.greeting.noon");
    }
    if (hour < 18) {
        return translator.t("dashboard.greeting.afternoon");
    }
    return translator.t("dashboard.greeting.evening");
}

export function formatActiveTime(translator: Translator, totalSeconds: number): string {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
        return translator.t("dashboard.duration.hoursMinutes", { hours, minutes });
    }
    return translator.t("dashboard.duration.minutes", { minutes });
}

export function formatBuildDuration(translator: Translator, durationMs: number): string {
    const total = Math.max(0, Math.round(durationMs / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    if (minutes > 0) {
        return translator.t("dashboard.duration.minutesSeconds", { minutes, seconds });
    }
    return translator.t("dashboard.duration.seconds", { seconds });
}

export function formatRelativeTime(translator: Translator, timestamp: number, now: number): string {
    const elapsed = Math.max(0, now - timestamp);
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1) {
        return translator.t("dashboard.relative.justNow");
    }
    if (minutes < 60) {
        return translator.t("dashboard.relative.minutesAgo", { count: minutes });
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return translator.t("dashboard.relative.hoursAgo", { count: hours });
    }
    const days = Math.floor(hours / 24);
    if (days < 30) {
        return translator.t("dashboard.relative.daysAgo", { count: days });
    }
    return translator.formatDate(timestamp, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDayLabel(translator: Translator, date: Date): string {
    return translator.formatDate(date, { month: "short", day: "numeric" });
}

/** Tooltip text for one chart column — the only place a negative day is reported honestly. */
export function formatActivityTooltip(translator: Translator, point: ActivityPoint): string {
    const date = formatDayLabel(translator, point.date);
    if (point.status === "untracked") {
        return translator.t("dashboard.activity.tooltip.untracked", { date });
    }
    if (point.status === "start") {
        return translator.t("dashboard.activity.tooltip.start", { date });
    }
    const delta = point.delta ?? 0;
    if (delta > 0) {
        return translator.t("dashboard.activity.tooltip.added", {
            date,
            words: translator.tn("dashboard.units.words", delta, { count: delta }),
        });
    }
    if (delta < 0) {
        const removed = Math.abs(delta);
        return translator.t("dashboard.activity.tooltip.removed", {
            date,
            words: translator.tn("dashboard.units.words", removed, { count: removed }),
        });
    }
    return translator.t("dashboard.activity.tooltip.unchanged", { date });
}
