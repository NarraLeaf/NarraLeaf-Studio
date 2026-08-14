/**
 * The calendar arithmetic behind the Time nodes.
 *
 * Everything here takes and returns epoch milliseconds, which is what a Time pin carries and what a
 * save record's stamp already is. The functions are pure apart from {@link blueprintTimeNow}, and
 * they read the *local* calendar - the player's, not UTC - because every one of them exists to
 * answer a question a player asks about their own day: which slot did I save today, how long ago was
 * that, what does this clock say. `toIsoString` is the one deliberate exception, and it says UTC in
 * its own doc comment.
 *
 * Kept out of the node definitions so the resolvers, the nodes, and the tests all agree on one
 * implementation, and so the calendar rules can be tested without a graph around them.
 *
 * Comments in English per project convention.
 */

import type {
    BlueprintTimeDisplayStyle,
    BlueprintTimeDurationStyle,
    BlueprintTimeRelativeStyle,
    BlueprintTimeUnit,
} from "@shared/types/blueprint/graph";

/** Milliseconds in each unit that has a fixed length. Months and years deliberately absent. */
const FIXED_UNIT_MS: Record<string, number> = {
    milliseconds: 1,
    seconds: 1_000,
    minutes: 60_000,
    hours: 3_600_000,
    days: 86_400_000,
    weeks: 604_800_000,
};

/** The value an unusable timestamp resolves to, so a broken input reads as the epoch, not as NaN. */
export const BLUEPRINT_TIME_INVALID = 0;

/**
 * Coerce whatever reached a timestamp pin into epoch milliseconds.
 *
 * A pin can carry a number, a numeric string from a text field, or a `Date` that a plugin node
 * produced. Anything else - and any non-finite number - is not a moment, and answering
 * {@link BLUEPRINT_TIME_INVALID} keeps a downstream formatter printing a date instead of "Invalid
 * Date". Out-of-range values are clamped for the same reason: `new Date(1e300)` formats as garbage.
 */
export function toBlueprintTimestamp(value: unknown): number {
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? clampTimestamp(ms) : BLUEPRINT_TIME_INVALID;
    }
    const raw = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(raw)) {
        return BLUEPRINT_TIME_INVALID;
    }
    return clampTimestamp(raw);
}

/** The range `Date` can represent; beyond it every method answers NaN. */
const MAX_TIMESTAMP = 8.64e15;

function clampTimestamp(ms: number): number {
    if (ms > MAX_TIMESTAMP) {
        return MAX_TIMESTAMP;
    }
    if (ms < -MAX_TIMESTAMP) {
        return -MAX_TIMESTAMP;
    }
    return Math.trunc(ms);
}

/** Now, as epoch milliseconds. The one impure function here; every node reads the clock through it. */
export function blueprintTimeNow(): number {
    return Date.now();
}

/** One moment broken into the local calendar. `weekday` is 0 for Sunday, matching `Date.getDay`. */
export type BlueprintTimeParts = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    millisecond: number;
    weekday: number;
    dayOfYear: number;
};

/**
 * Build a moment from local calendar fields.
 *
 * Out-of-range fields roll over the way `Date` does - month 13 is January of the next year, day 0 is
 * the last day of the previous month - which is what makes "the last day of this month" expressible
 * without a node for it. `month` is 1-12 here, not `Date`'s 0-11: the author is typing a date, not
 * an array index.
 */
export function makeBlueprintTime(input: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    second?: number;
    millisecond?: number;
}): number {
    const date = new Date(
        toInt(input.year),
        toInt(input.month) - 1,
        toInt(input.day),
        toInt(input.hour ?? 0),
        toInt(input.minute ?? 0),
        toInt(input.second ?? 0),
        toInt(input.millisecond ?? 0),
    );
    // Years 0-99 mean 1900-1999 to the Date constructor. An author typing 50 means the year 50.
    const year = toInt(input.year);
    if (year >= 0 && year <= 99) {
        date.setFullYear(year);
    }
    const ms = date.getTime();
    return Number.isFinite(ms) ? clampTimestamp(ms) : BLUEPRINT_TIME_INVALID;
}

/** Break a moment into local calendar fields. */
export function blueprintTimeParts(timestamp: number): BlueprintTimeParts {
    const date = new Date(toBlueprintTimestamp(timestamp));
    const startOfYear = new Date(date.getFullYear(), 0, 1).getTime();
    return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
        second: date.getSeconds(),
        millisecond: date.getMilliseconds(),
        weekday: date.getDay(),
        // Counted from local midnights rather than by dividing, so a day that a DST shift made 23 or
        // 25 hours long still counts as one day.
        dayOfYear: Math.round((startOfDayMs(date.getTime()) - startOfDayMs(startOfYear)) / 86_400_000) + 1,
    };
}

/**
 * Move a moment by `amount` of `unit`.
 *
 * Fixed units are arithmetic on the number. Months and years go through the calendar, and clamp
 * rather than roll: 31 January plus one month is 28 February (29 in a leap year), not 3 March. That
 * is what "the same day next month" means to a person, and rolling silently skips a month whenever
 * the target is shorter.
 */
export function addBlueprintTime(timestamp: number, amount: number, unit: BlueprintTimeUnit): number {
    const base = toBlueprintTimestamp(timestamp);
    const delta = Number.isFinite(amount) ? amount : 0;
    const fixed = FIXED_UNIT_MS[unit];
    if (fixed !== undefined) {
        return clampTimestamp(base + delta * fixed);
    }
    const months = unit === "years" ? Math.trunc(delta) * 12 : Math.trunc(delta);
    const date = new Date(base);
    const targetMonthIndex = date.getMonth() + months;
    const dayOfMonth = date.getDate();
    // Land on the 1st first: setMonth on the 31st would roll a short target month forward before we
    // ever get to clamp it.
    date.setDate(1);
    date.setMonth(targetMonthIndex);
    date.setDate(Math.min(dayOfMonth, daysInMonth(date.getFullYear(), date.getMonth())));
    const ms = date.getTime();
    return Number.isFinite(ms) ? clampTimestamp(ms) : BLUEPRINT_TIME_INVALID;
}

/**
 * `to - from`, measured in `unit`.
 *
 * Fixed units divide and keep the fraction: an author asking for hours between two saves wants 1.5,
 * and `Floor` is one node away when they do not. Months and years count whole calendar steps
 * crossed, because a fractional month has no meaning to give.
 */
export function blueprintTimeDifference(from: number, to: number, unit: BlueprintTimeUnit): number {
    const a = toBlueprintTimestamp(from);
    const b = toBlueprintTimestamp(to);
    const fixed = FIXED_UNIT_MS[unit];
    if (fixed !== undefined) {
        return (b - a) / fixed;
    }
    const start = new Date(Math.min(a, b));
    const end = new Date(Math.max(a, b));
    let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    // The final month only counts once the day-of-month (and time within it) has been reached.
    if (addBlueprintTime(start.getTime(), months, "months") > end.getTime()) {
        months -= 1;
    }
    const signed = b >= a ? months : -months;
    return unit === "years" ? Math.trunc(signed / 12) : signed;
}

/** Local midnight of the day a moment falls in. */
export function startOfBlueprintDay(timestamp: number): number {
    return startOfDayMs(toBlueprintTimestamp(timestamp));
}

/** Whether two moments fall on the same local calendar day. */
export function isSameBlueprintDay(a: number, b: number): boolean {
    return startOfBlueprintDay(a) === startOfBlueprintDay(b);
}

/** The local zone's offset from UTC in minutes, positive east of Greenwich (the opposite of `Date`). */
export function blueprintTimeZoneOffsetMinutes(timestamp: number): number {
    return -new Date(toBlueprintTimestamp(timestamp)).getTimezoneOffset();
}

/** The IANA zone name the runtime is using, or an empty string when it will not say. */
export function blueprintTimeZoneName(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    } catch {
        return "";
    }
}

/** ISO 8601 in **UTC** (`2026-08-14T07:30:00.000Z`) - the round-trip partner of `Parse Time`. */
export function blueprintTimeToIsoString(timestamp: number): string {
    try {
        return new Date(toBlueprintTimestamp(timestamp)).toISOString();
    } catch {
        return "";
    }
}

/**
 * Read a written date back into a moment.
 *
 * ISO 8601 is the contract; anything else is whatever the runtime's `Date.parse` happens to accept
 * and must not be relied on. `ok` is the whole point of the return shape - a failed parse answers
 * the epoch, and without the flag that is indistinguishable from a genuine 1970 stamp.
 *
 * A bare `YYYY-MM-DD` is read as *local* midnight, against the ISO rule that makes it UTC. The rest
 * of these nodes speak the local calendar, and a date-only string that lands on the previous evening
 * in the western hemisphere is a bug report, not a specification win.
 */
export function parseBlueprintTime(value: string): { timestamp: number; ok: boolean } {
    const text = value.trim();
    if (!text) {
        return { timestamp: BLUEPRINT_TIME_INVALID, ok: false };
    }
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (dateOnly) {
        const ms = makeBlueprintTime({
            year: Number(dateOnly[1]),
            month: Number(dateOnly[2]),
            day: Number(dateOnly[3]),
        });
        return { timestamp: ms, ok: true };
    }
    const parsed = Date.parse(text);
    if (!Number.isFinite(parsed)) {
        return { timestamp: BLUEPRINT_TIME_INVALID, ok: false };
    }
    return { timestamp: clampTimestamp(parsed), ok: true };
}

/**
 * Substitute the pattern tokens of `Format Time` against the local calendar.
 *
 * Tokens are the widely recognised `YYYY-MM-DD HH:mm:ss` family, longest match first so `YYYY` never
 * decays into two `YY`. Text between tokens is copied through, and a run inside single quotes is
 * copied through *without* being scanned - the only way to print a letter that is also a token.
 */
export function formatBlueprintTime(timestamp: number, pattern: string): string {
    const parts = blueprintTimeParts(timestamp);
    const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
    const replacements: Array<[string, string]> = [
        ["YYYY", pad(parts.year, 4)],
        ["YY", pad(parts.year % 100, 2)],
        ["MM", pad(parts.month, 2)],
        ["M", String(parts.month)],
        ["DD", pad(parts.day, 2)],
        ["D", String(parts.day)],
        ["HH", pad(parts.hour, 2)],
        ["H", String(parts.hour)],
        ["hh", pad(hour12, 2)],
        ["h", String(hour12)],
        ["mm", pad(parts.minute, 2)],
        ["m", String(parts.minute)],
        ["ss", pad(parts.second, 2)],
        ["s", String(parts.second)],
        ["SSS", pad(parts.millisecond, 3)],
        ["A", parts.hour < 12 ? "AM" : "PM"],
        ["a", parts.hour < 12 ? "am" : "pm"],
    ];
    let out = "";
    let index = 0;
    while (index < pattern.length) {
        if (pattern[index] === "'") {
            const end = pattern.indexOf("'", index + 1);
            if (end === -1) {
                out += pattern.slice(index + 1);
                break;
            }
            // '' is a literal quote; anything else between the pair is copied verbatim.
            out += end === index + 1 ? "'" : pattern.slice(index + 1, end);
            index = end + 1;
            continue;
        }
        const hit = replacements.find(([token]) => pattern.startsWith(token, index));
        if (hit) {
            out += hit[1];
            index += hit[0].length;
            continue;
        }
        out += pattern[index];
        index += 1;
    }
    return out;
}

/** A span of time split into whole units, each one bounded by the next largest. */
export type BlueprintDurationParts = {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    milliseconds: number;
    totalHours: number;
    totalMinutes: number;
    totalSeconds: number;
    negative: boolean;
};

/**
 * Split a span into parts. The sign travels on `negative` alone, so the numbers can be printed
 * without every consumer having to strip a minus that only belongs at the front.
 */
export function blueprintDurationParts(milliseconds: number): BlueprintDurationParts {
    const raw = Number.isFinite(milliseconds) ? Math.trunc(milliseconds) : 0;
    const total = Math.abs(raw);
    return {
        days: Math.floor(total / 86_400_000),
        hours: Math.floor(total / 3_600_000) % 24,
        minutes: Math.floor(total / 60_000) % 60,
        seconds: Math.floor(total / 1_000) % 60,
        milliseconds: total % 1_000,
        totalHours: Math.floor(total / 3_600_000),
        totalMinutes: Math.floor(total / 60_000),
        totalSeconds: Math.floor(total / 1_000),
        negative: raw < 0,
    };
}

/**
 * A span as a clock reading. Digits and separators only - see
 * {@link BLUEPRINT_TIME_DURATION_STYLES} for why there are no unit words.
 *
 * `auto` shows hours once there are any; the other two are fixed so a column of play times does not
 * change width as it crosses an hour. Hours accumulate past 24 rather than rolling into days: a
 * play-time of 30 hours is `30:00:00`, not `06:00:00`.
 */
export function formatBlueprintDuration(milliseconds: number, style: BlueprintTimeDurationStyle): string {
    const parts = blueprintDurationParts(milliseconds);
    const sign = parts.negative ? "-" : "";
    const mm = pad(parts.minutes, 2);
    const ss = pad(parts.seconds, 2);
    if (style === "minutesSeconds") {
        return `${sign}${pad(parts.totalMinutes, 2)}:${ss}`;
    }
    if (style === "hoursMinutesSeconds") {
        return `${sign}${pad(parts.totalHours, 2)}:${mm}:${ss}`;
    }
    return parts.totalHours > 0
        ? `${sign}${parts.totalHours}:${mm}:${ss}`
        : `${sign}${parts.minutes}:${ss}`;
}

/**
 * A moment in the reader's own conventions, via `Intl.DateTimeFormat`.
 *
 * `locale` is a BCP 47 tag; empty means the runtime's own, which in a shipped game is the player's
 * system setting. It is an input rather than something read from the game because the game's
 * language is an async host call that a pure node cannot make - an author wanting the two to agree
 * wires `Get Current Language` into it, and that wire is the only honest way to say so.
 *
 * Both halves set to `none` would ask `Intl` to print nothing, which it answers with a date anyway;
 * an empty string is the more truthful answer to "show me neither".
 */
export function formatBlueprintTimeLocalized(input: {
    timestamp: number;
    locale: string;
    dateStyle: BlueprintTimeDisplayStyle;
    timeStyle: BlueprintTimeDisplayStyle;
}): string {
    if (input.dateStyle === "none" && input.timeStyle === "none") {
        return "";
    }
    const options: Intl.DateTimeFormatOptions = {};
    if (input.dateStyle !== "none") {
        options.dateStyle = input.dateStyle;
    }
    if (input.timeStyle !== "none") {
        options.timeStyle = input.timeStyle;
    }
    const date = new Date(toBlueprintTimestamp(input.timestamp));
    try {
        return new Intl.DateTimeFormat(normalizeLocale(input.locale), options).format(date);
    } catch {
        // An unusable tag must not blank the save slot it was labelling.
        return new Intl.DateTimeFormat(undefined, options).format(date);
    }
}

/**
 * How long ago (or ahead) `to` is from `from`, worded by `Intl.RelativeTimeFormat`.
 *
 * The unit is chosen by size - seconds below a minute, then minutes, hours, days, months, years -
 * so a save list reads "5 minutes ago" and "2 months ago" without the author branching on either.
 * `auto` lets the locale say "yesterday" where it has a word for it; `always` keeps it numeric.
 */
export function formatBlueprintRelativeTime(input: {
    from: number;
    to: number;
    locale: string;
    numeric: BlueprintTimeRelativeStyle;
}): string {
    const from = toBlueprintTimestamp(input.from);
    const to = toBlueprintTimestamp(input.to);
    const diffMs = to - from;
    const abs = Math.abs(diffMs);
    const [value, unit]: [number, Intl.RelativeTimeFormatUnit] = abs < 60_000
        ? [diffMs / 1_000, "second"]
        : abs < 3_600_000
            ? [diffMs / 60_000, "minute"]
            : abs < 86_400_000
                ? [diffMs / 3_600_000, "hour"]
                : abs < 2_592_000_000
                    ? [diffMs / 86_400_000, "day"]
                    : abs < 31_536_000_000
                        ? [blueprintTimeDifference(from, to, "months"), "month"]
                        : [blueprintTimeDifference(from, to, "years"), "year"];
    const rounded = Math.trunc(value);
    try {
        return new Intl.RelativeTimeFormat(normalizeLocale(input.locale), { numeric: input.numeric })
            .format(rounded, unit);
    } catch {
        return new Intl.RelativeTimeFormat(undefined, { numeric: input.numeric }).format(rounded, unit);
    }
}

/** An empty or blank tag means "the runtime's own locale", which `Intl` spells as `undefined`. */
function normalizeLocale(locale: string): string | undefined {
    const trimmed = locale.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

/** Local midnight of whatever day `ms` falls in. */
function startOfDayMs(ms: number): number {
    const date = new Date(ms);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

function daysInMonth(year: number, monthIndex: number): number {
    return new Date(year, monthIndex + 1, 0).getDate();
}

function toInt(value: number): number {
    return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function pad(value: number, width: number): string {
    const negative = value < 0;
    const digits = Math.abs(value).toString().padStart(width, "0");
    return negative ? `-${digits}` : digits;
}
