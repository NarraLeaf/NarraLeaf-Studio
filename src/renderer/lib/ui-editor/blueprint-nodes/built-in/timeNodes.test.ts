/**
 * Time nodes, read the way a graph reads them.
 *
 * Registration is already swept by `graphParamResolvers.test` (its pure half resolves every pure
 * node's output pins and fails on `undefined`), so nothing here re-checks that a pin is wired. What
 * it checks is the part a sweep cannot: that the calendar answers are *right* - a month that clamps
 * instead of rolling, a difference that counts calendar steps, a pattern that survives a literal
 * letter, a failed parse that says so.
 *
 * Every assertion goes through `resolveDataPinValue` rather than calling the helpers directly,
 * because the helpers are only half the path: a node that reads the wrong pin id or the wrong param
 * key passes a unit test of `@shared/blueprint/blueprintTime` and still ships broken.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_TIME,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_TIME_ADD,
    BLUEPRINT_NODE_TYPE_TIME_DIFFERENCE,
    BLUEPRINT_NODE_TYPE_TIME_DURATION_PARTS,
    BLUEPRINT_NODE_TYPE_TIME_FORMAT,
    BLUEPRINT_NODE_TYPE_TIME_FORMAT_DURATION,
    BLUEPRINT_NODE_TYPE_TIME_FORMAT_LOCALIZED,
    BLUEPRINT_NODE_TYPE_TIME_FORMAT_RELATIVE,
    BLUEPRINT_NODE_TYPE_TIME_IS_SAME_DAY,
    BLUEPRINT_NODE_TYPE_TIME_MAKE,
    BLUEPRINT_NODE_TYPE_TIME_NOW,
    BLUEPRINT_NODE_TYPE_TIME_PARSE,
    BLUEPRINT_NODE_TYPE_TIME_PARTS,
    BLUEPRINT_NODE_TYPE_TIME_START_OF_DAY,
    BLUEPRINT_NODE_TYPE_TIME_TO_ISO_STRING,
    BLUEPRINT_NODE_TYPE_TIME_ZONE_OFFSET,
    BLUEPRINT_TIME_PARAM_DATE_STYLE,
    BLUEPRINT_TIME_PARAM_STYLE,
    BLUEPRINT_TIME_PARAM_TIME_STYLE,
    BLUEPRINT_TIME_PARAM_UNIT,
} from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { executeGraph } from "../../behavior-graph/GraphExecutor";
import { isBlueprintNodeAllowedInBlueprintValueGraph } from "../BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";
import { resolveDataPinValue, type DataPinGraph } from "./graphParamResolvers";
import { timeBlueprintNodes } from "./timeNodes";

registerCoreBlueprintNodes();

/** Read one output pin of a lone node whose inputs are supplied as params (the unwired case). */
function readPin(type: string, portId: string, params: Record<string, unknown> = {}): unknown {
    const graph: DataPinGraph = {
        id: "time",
        nodes: { node: { type, params } },
        edges: [],
    };
    return resolveDataPinValue(graph, "node", portId, params, {});
}

/** A local moment, built the way `Make Time` builds one, so the test never depends on the zone. */
function localTime(
    year: number,
    month: number,
    day: number,
    hour = 0,
    minute = 0,
    second = 0,
    ms = 0,
): number {
    return new Date(year, month - 1, day, hour, minute, second, ms).getTime();
}

describe("Time blueprint nodes", () => {
    it("reads the clock through Now", () => {
        const before = Date.now();
        const value = readPin(BLUEPRINT_NODE_TYPE_TIME_NOW, "timestamp") as number;
        expect(value).toBeGreaterThanOrEqual(before);
        expect(value).toBeLessThanOrEqual(Date.now());
    });

    it("round-trips Make Time through Get Time Parts", () => {
        const timestamp = readPin(BLUEPRINT_NODE_TYPE_TIME_MAKE, "timestamp", {
            year: 2026, month: 8, day: 14, hour: 15, minute: 30, second: 5, millisecond: 250,
        });
        expect(timestamp).toBe(localTime(2026, 8, 14, 15, 30, 5, 250));

        const parts = (id: string) => readPin(BLUEPRINT_NODE_TYPE_TIME_PARTS, id, { timestamp });
        expect(parts("year")).toBe(2026);
        expect(parts("month")).toBe(8);
        expect(parts("day")).toBe(14);
        expect(parts("hour")).toBe(15);
        expect(parts("minute")).toBe(30);
        expect(parts("second")).toBe(5);
        expect(parts("millisecond")).toBe(250);
        // 2026-08-14 is a Friday, and 31+28+31+30+31+30+31+14 days into the year.
        expect(parts("weekday")).toBe(5);
        expect(parts("dayOfYear")).toBe(226);
    });

    it("rolls out-of-range Make Time fields the way a date picker would", () => {
        // Day 0 of September is the last day of August - how "the end of this month" gets expressed.
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_MAKE, "timestamp", { year: 2026, month: 9, day: 0 }))
            .toBe(localTime(2026, 8, 31));
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_MAKE, "timestamp", { year: 2026, month: 13, day: 1 }))
            .toBe(localTime(2027, 1, 1));
    });

    it("keeps a two-digit year as itself rather than the 1900s", () => {
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_PARTS, "year", {
            timestamp: readPin(BLUEPRINT_NODE_TYPE_TIME_MAKE, "timestamp", { year: 50, month: 1, day: 1 }),
        })).toBe(50);
    });

    it("clamps Add Time to the shorter month instead of rolling past it", () => {
        const jan31 = localTime(2026, 1, 31);
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_ADD, "result", {
            timestamp: jan31, amount: 1, [BLUEPRINT_TIME_PARAM_UNIT]: "months",
        })).toBe(localTime(2026, 2, 28));
        // 2028 is a leap year, so the same add lands one day later there.
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_ADD, "result", {
            timestamp: localTime(2028, 1, 31), amount: 1, [BLUEPRINT_TIME_PARAM_UNIT]: "months",
        })).toBe(localTime(2028, 2, 29));
    });

    it("adds fixed units by arithmetic and years by the calendar", () => {
        const base = localTime(2026, 8, 14, 12);
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_ADD, "result", {
            timestamp: base, amount: 90, [BLUEPRINT_TIME_PARAM_UNIT]: "minutes",
        })).toBe(base + 90 * 60_000);
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_ADD, "result", {
            timestamp: base, amount: -2, [BLUEPRINT_TIME_PARAM_UNIT]: "years",
        })).toBe(localTime(2024, 8, 14, 12));
    });

    it("measures Time Difference in fractions for fixed units and whole steps for months", () => {
        const from = localTime(2026, 1, 31, 0, 0, 0);
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_DIFFERENCE, "difference", {
            from, to: from + 5_400_000, [BLUEPRINT_TIME_PARAM_UNIT]: "hours",
        })).toBe(1.5);
        // One day short of a full calendar month is still zero months.
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_DIFFERENCE, "difference", {
            from, to: localTime(2026, 2, 27), [BLUEPRINT_TIME_PARAM_UNIT]: "months",
        })).toBe(0);
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_DIFFERENCE, "difference", {
            from, to: localTime(2026, 2, 28), [BLUEPRINT_TIME_PARAM_UNIT]: "months",
        })).toBe(1);
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_DIFFERENCE, "difference", {
            from: localTime(2026, 6, 1), to: from, [BLUEPRINT_TIME_PARAM_UNIT]: "months",
        })).toBe(-4);
    });

    it("substitutes Format Time pattern tokens against the local calendar", () => {
        const timestamp = localTime(2026, 8, 14, 15, 30, 5, 7);
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_FORMAT, "result", {
            timestamp, pattern: "YYYY-MM-DD HH:mm:ss.SSS",
        })).toBe("2026-08-14 15:30:05.007");
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_FORMAT, "result", {
            timestamp, pattern: "M/D/YY h:mm a",
        })).toBe("8/14/26 3:30 pm");
    });

    it("copies a quoted run of Format Time's pattern through untouched", () => {
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_FORMAT, "result", {
            timestamp: localTime(2026, 8, 14, 15, 30),
            pattern: "'Day' D 'of' MM",
        })).toBe("Day 14 of 08");
    });

    it("falls back to a readable pattern when Format Time's Pattern pin is blank", () => {
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_FORMAT, "result", {
            timestamp: localTime(2026, 8, 14, 15, 30), pattern: "",
        })).toBe("2026-08-14 15:30");
    });

    it("formats a duration as a clock, hours accumulating past a day", () => {
        const span = (30 * 3_600_000) + (2 * 60_000) + 3_000;
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_FORMAT_DURATION, "result", {
            milliseconds: span,
        })).toBe("30:02:03");
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_FORMAT_DURATION, "result", {
            milliseconds: 65_000,
        })).toBe("1:05");
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_FORMAT_DURATION, "result", {
            milliseconds: 65_000, [BLUEPRINT_TIME_PARAM_STYLE]: "hoursMinutesSeconds",
        })).toBe("00:01:05");
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_FORMAT_DURATION, "result", {
            milliseconds: -65_000, [BLUEPRINT_TIME_PARAM_STYLE]: "minutesSeconds",
        })).toBe("-01:05");
    });

    it("splits a duration into bounded parts plus totals", () => {
        const span = (1 * 86_400_000) + (2 * 3_600_000) + (3 * 60_000) + 4_000 + 5;
        const part = (id: string) => readPin(BLUEPRINT_NODE_TYPE_TIME_DURATION_PARTS, id, { milliseconds: span });
        expect(part("days")).toBe(1);
        expect(part("hours")).toBe(2);
        expect(part("minutes")).toBe(3);
        expect(part("seconds")).toBe(4);
        expect(part("remainingMilliseconds")).toBe(5);
        expect(part("totalHours")).toBe(26);
        expect(part("negative")).toBe(false);
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_DURATION_PARTS, "negative", { milliseconds: -1 })).toBe(true);
    });

    it("reports a failed Parse Time instead of answering the epoch silently", () => {
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_PARSE, "ok", { value: "not a date" })).toBe(false);
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_PARSE, "timestamp", { value: "not a date" })).toBe(0);
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_PARSE, "ok", { value: "" })).toBe(false);
    });

    it("reads a bare date as local midnight and round-trips ISO through To ISO String", () => {
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_PARSE, "timestamp", { value: "2026-08-14" }))
            .toBe(localTime(2026, 8, 14));

        const timestamp = localTime(2026, 8, 14, 15, 30, 5, 250);
        const iso = readPin(BLUEPRINT_NODE_TYPE_TIME_TO_ISO_STRING, "result", { timestamp });
        expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_PARSE, "timestamp", { value: iso })).toBe(timestamp);
    });

    it("compares calendar days rather than elapsed hours", () => {
        const morning = localTime(2026, 8, 14, 1);
        const night = localTime(2026, 8, 14, 23, 59);
        const nextDay = localTime(2026, 8, 15, 0, 30);
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_IS_SAME_DAY, "result", { a: morning, b: night })).toBe(true);
        // Half an hour apart, and a different day.
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_IS_SAME_DAY, "result", { a: night, b: nextDay })).toBe(false);
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_START_OF_DAY, "result", { timestamp: night }))
            .toBe(localTime(2026, 8, 14));
    });

    it("reports the local zone offset in minutes", () => {
        const timestamp = localTime(2026, 8, 14, 12);
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_ZONE_OFFSET, "offsetMinutes", { timestamp }))
            .toBe(-new Date(timestamp).getTimezoneOffset());
        expect(typeof readPin(BLUEPRINT_NODE_TYPE_TIME_ZONE_OFFSET, "name", { timestamp })).toBe("string");
    });

    it("formats a moment in the locale it is handed", () => {
        const timestamp = localTime(2026, 8, 14, 15, 30);
        const en = readPin(BLUEPRINT_NODE_TYPE_TIME_FORMAT_LOCALIZED, "result", {
            timestamp,
            locale: "en-US",
            [BLUEPRINT_TIME_PARAM_DATE_STYLE]: "long",
            [BLUEPRINT_TIME_PARAM_TIME_STYLE]: "none",
        });
        expect(en).toBe("August 14, 2026");
        const zh = readPin(BLUEPRINT_NODE_TYPE_TIME_FORMAT_LOCALIZED, "result", {
            timestamp,
            locale: "zh-CN",
            [BLUEPRINT_TIME_PARAM_DATE_STYLE]: "long",
            [BLUEPRINT_TIME_PARAM_TIME_STYLE]: "none",
        });
        expect(zh).toBe("2026年8月14日");
    });

    it("answers nothing when Format Time Localized is asked for neither half", () => {
        expect(readPin(BLUEPRINT_NODE_TYPE_TIME_FORMAT_LOCALIZED, "result", {
            timestamp: localTime(2026, 8, 14),
            locale: "en-US",
            [BLUEPRINT_TIME_PARAM_DATE_STYLE]: "none",
            [BLUEPRINT_TIME_PARAM_TIME_STYLE]: "none",
        })).toBe("");
    });

    it("picks the relative unit by size", () => {
        const now = localTime(2026, 8, 14, 12);
        const relative = (to: number, style?: string) => readPin(
            BLUEPRINT_NODE_TYPE_TIME_FORMAT_RELATIVE,
            "result",
            { from: now, to, locale: "en-US", ...(style ? { [BLUEPRINT_TIME_PARAM_STYLE]: style } : {}) },
        );
        expect(relative(now - 300_000)).toBe("5 minutes ago");
        expect(relative(now - 7_200_000)).toBe("2 hours ago");
        expect(relative(now + 172_800_000)).toBe("in 2 days");
        // `auto` lets the locale use its own word; `always` keeps it counted.
        expect(relative(now - 86_400_000)).toBe("yesterday");
        expect(relative(now - 86_400_000, "always")).toBe("1 day ago");
    });

    it("is usable in a Blueprint Value graph, which is where a save slot's label lives", () => {
        // The whole family is pure, and the surface that needs it most - a slot's label - is a
        // Blueprint Value. That graph filters by category, so a Time node is one omission away from
        // being unreachable exactly where it was built to be used.
        const excluded = timeBlueprintNodes
            .filter(def => !isBlueprintNodeAllowedInBlueprintValueGraph(def))
            .map(def => def.displayName);
        expect(excluded).toEqual([]);
    });

    it("falls back to the runtime locale rather than blanking on an unusable tag", () => {
        const result = readPin(BLUEPRINT_NODE_TYPE_TIME_FORMAT_LOCALIZED, "result", {
            timestamp: localTime(2026, 8, 14),
            locale: "not a locale!",
            [BLUEPRINT_TIME_PARAM_DATE_STYLE]: "short",
            [BLUEPRINT_TIME_PARAM_TIME_STYLE]: "none",
        });
        expect(typeof result).toBe("string");
        expect(result).not.toBe("");
    });
});

/** Host with just enough save surface for Get Save Time. */
function createSaveHostAdapter(times: Record<string, { savedAt: number; createdAt: number }>): UIHostAdapter {
    return {
        host: "player",
        blueprintRuntime: {
            hostApi: {
                game: {
                    getSaveTimes: async (id: string) => times[id] ?? null,
                },
            },
        },
    } as unknown as UIHostAdapter;
}

/** `Get Save Time` with each of its three outputs stored into a local. */
function readSaveTimeGraph(saveId: string): UIGraph {
    return {
        id: "readSaveTime",
        entries: { main: { start: { nodeId: "get", port: "in" } } },
        nodes: {
            get: { id: "get", type: BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_TIME, params: { id: saveId } },
            savedAt: { id: "savedAt", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "savedAt" } },
            createdAt: { id: "createdAt", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "createdAt" } },
            exists: { id: "exists", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "exists" } },
        },
        edges: [
            { from: { nodeId: "get", port: "next" }, to: { nodeId: "savedAt", port: "in" } },
            { from: { nodeId: "savedAt", port: "next" }, to: { nodeId: "createdAt", port: "in" } },
            { from: { nodeId: "createdAt", port: "next" }, to: { nodeId: "exists", port: "in" } },
            { from: { nodeId: "get", port: "savedAt" }, to: { nodeId: "savedAt", port: "value" } },
            { from: { nodeId: "get", port: "createdAt" }, to: { nodeId: "createdAt", port: "value" } },
            { from: { nodeId: "get", port: "exists" }, to: { nodeId: "exists", port: "value" } },
        ],
    } as UIGraph;
}

describe("Get Save Time", () => {
    it("publishes a slot's stamps to downstream data pins", async () => {
        const locals: Record<string, unknown> = {};
        await executeGraph({
            graph: readSaveTimeGraph("slot-1"),
            entry: { start: { nodeId: "get", port: "in" } },
            hostAdapter: createSaveHostAdapter({ "slot-1": { savedAt: 1_700_000_000_000, createdAt: 1_600_000_000_000 } }),
            blueprintLocals: locals,
        });
        expect(locals).toMatchObject({
            savedAt: 1_700_000_000_000,
            createdAt: 1_600_000_000_000,
            exists: true,
        });
    });

    it("tells a missing slot apart from one saved at the epoch", async () => {
        const locals: Record<string, unknown> = {};
        await executeGraph({
            graph: readSaveTimeGraph("gone"),
            entry: { start: { nodeId: "get", port: "in" } },
            hostAdapter: createSaveHostAdapter({}),
            blueprintLocals: locals,
        });
        expect(locals).toMatchObject({ savedAt: 0, createdAt: 0, exists: false });
    });
});
