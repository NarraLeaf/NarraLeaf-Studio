/**
 * Accumulated, per-project authoring activity.
 *
 * Everything else the dashboard shows (scene counts, word totals, localization progress) is derived
 * from the project documents on demand and is therefore never stored. This record holds only the
 * history that cannot be recomputed after the fact: what the project looked like on days that have
 * already passed, and builds that have already finished.
 *
 * This is the sole payload of "clear statistics data".
 */

/** A finished build. `ok` folds the build's terminal status down to success/failure. */
export type BuildActivityRecord = {
    startedAt: number;
    finishedAt: number;
    durationMs: number;
    ok: boolean;
    /** Build target as reported by the build service, when it named one. */
    platform?: string;
    /**
     * The build's console output, one already-rendered plain-text line per entry. Stored
     * formatted rather than structured because this is an archived artifact, not live console
     * state: nothing re-styles or re-filters it, and the dashboard only ever prints it back.
     *
     * Absent on records written before build logs were kept, and on builds that produced no
     * output at all.
     */
    log?: string[];
    /** Lines dropped from the front of `log` by the retention cap; omitted when none were. */
    logOmittedLines?: number;
};

/**
 * Per-day rollups, keyed by local-time `YYYY-MM-DD`.
 *
 * Local time rather than UTC is deliberate: a writing streak is a human calendar fact, and a
 * midnight-to-2am session belongs to the day the author thinks they wrote it.
 */
export type ProjectActivityDay = {
    /**
     * Total project word count as of the end of this day, so a daily delta is this minus the prior
     * day's value.
     *
     * The earliest recorded day has no prior day and therefore no knowable delta - a project that
     * already had 50k words when collection started records 50k on day one, which is a starting
     * balance, not a day's writing. Readers must skip that day rather than diff it against zero.
     */
    words: number;
    /** Debounced document-change bursts, not keystrokes. */
    edits: number;
    /** Seconds the workspace window was focused and receiving input. */
    activeSeconds: number;
};

export type ProjectStatsV1 = {
    version: 1;
    /** First day this project was ever opened with stats collection running. */
    firstSeenAt: number | null;
    lastActiveAt: number | null;
    days: Record<string, ProjectActivityDay>;
    builds: BuildActivityRecord[];
};

/** Roughly 14 months - enough for a year-over-year look without unbounded growth. */
export const PROJECT_STATS_MAX_DAYS = 400;
export const PROJECT_STATS_MAX_BUILDS = 50;
/** Console lines kept per build. Fifty builds of these live in the global config, so it is a cap. */
export const PROJECT_STATS_MAX_BUILD_LOG_LINES = 300;
export const PROJECT_STATS_MAX_BUILD_LOG_LINE_CHARS = 1000;

/** Settings-key prefix; the per-project token is appended. See `getProjectStatsSettingsKey`. */
export const PROJECT_STATS_SETTINGS_KEY_PREFIX = "stats.project";

export function createEmptyProjectStats(): ProjectStatsV1 {
    return {
        version: 1,
        firstSeenAt: null,
        lastActiveAt: null,
        days: {},
        builds: [],
    };
}

export function createEmptyActivityDay(): ProjectActivityDay {
    return { words: 0, edits: 0, activeSeconds: 0 };
}

/** Local-time day key. `toISOString` is avoided here precisely because it would shift to UTC. */
export function toActivityDayKey(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function isActivityDay(value: unknown): value is ProjectActivityDay {
    if (!value || typeof value !== "object") {
        return false;
    }
    const day = value as Record<string, unknown>;
    return (
        typeof day.words === "number" &&
        typeof day.edits === "number" &&
        typeof day.activeSeconds === "number"
    );
}

/**
 * Rebuild a stored build record field by field rather than trusting the stored shape: the log is
 * the one part of a record that can be arbitrarily large and arbitrarily wrong, and it is rendered
 * verbatim.
 */
function parseBuildRecord(value: unknown): BuildActivityRecord | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value as Record<string, unknown>;
    if (
        typeof record.startedAt !== "number" ||
        typeof record.finishedAt !== "number" ||
        typeof record.durationMs !== "number" ||
        typeof record.ok !== "boolean"
    ) {
        return null;
    }

    const parsed: BuildActivityRecord = {
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        durationMs: record.durationMs,
        ok: record.ok,
    };
    if (typeof record.platform === "string") {
        parsed.platform = record.platform;
    }
    if (Array.isArray(record.log)) {
        const log = record.log.filter((line): line is string => typeof line === "string");
        if (log.length > 0) {
            parsed.log = log;
        }
    }
    if (typeof record.logOmittedLines === "number" && record.logOmittedLines > 0) {
        parsed.logOmittedLines = Math.floor(record.logOmittedLines);
    }
    return parsed;
}

/**
 * Clip a captured build log down to the retention caps, keeping the **tail**: a failed build says
 * why it failed at the end of its output, which is the reason the log is archived at all.
 */
export function clipBuildLog(lines: readonly string[]): { log: string[]; omitted: number } {
    const omitted = Math.max(0, lines.length - PROJECT_STATS_MAX_BUILD_LOG_LINES);
    return {
        log: lines.slice(omitted).map(line =>
            line.length > PROJECT_STATS_MAX_BUILD_LOG_LINE_CHARS
                ? `${line.slice(0, PROJECT_STATS_MAX_BUILD_LOG_LINE_CHARS)}…`
                : line,
        ),
        omitted,
    };
}

/**
 * Parse stored stats defensively, dropping individual malformed entries rather than the whole
 * record. Stats are strictly nice-to-have, so a corrupt day must never cost the author their
 * remaining history - and must never take the dashboard down.
 */
export function parseProjectStats(raw: unknown): ProjectStatsV1 | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const record = raw as Record<string, unknown>;
    if (record.version !== 1) {
        return null;
    }

    const days: Record<string, ProjectActivityDay> = {};
    if (record.days && typeof record.days === "object") {
        for (const [key, value] of Object.entries(record.days as Record<string, unknown>)) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(key) && isActivityDay(value)) {
                days[key] = value;
            }
        }
    }

    const builds = Array.isArray(record.builds)
        ? record.builds
              .map(parseBuildRecord)
              .filter((build): build is BuildActivityRecord => build !== null)
        : [];

    return {
        version: 1,
        firstSeenAt: typeof record.firstSeenAt === "number" ? record.firstSeenAt : null,
        lastActiveAt: typeof record.lastActiveAt === "number" ? record.lastActiveAt : null,
        days,
        builds,
    };
}

/** Drop the oldest days/builds past the retention caps. Mutates and returns `stats`. */
export function pruneProjectStats(stats: ProjectStatsV1): ProjectStatsV1 {
    const dayKeys = Object.keys(stats.days).sort();
    if (dayKeys.length > PROJECT_STATS_MAX_DAYS) {
        for (const key of dayKeys.slice(0, dayKeys.length - PROJECT_STATS_MAX_DAYS)) {
            delete stats.days[key];
        }
    }
    if (stats.builds.length > PROJECT_STATS_MAX_BUILDS) {
        stats.builds = stats.builds.slice(-PROJECT_STATS_MAX_BUILDS);
    }
    return stats;
}
