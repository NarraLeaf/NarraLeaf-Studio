/**
 * Time nodes: a moment, the calendar around it, and the text a player reads.
 *
 * ## Why a number and not a Date
 *
 * Every pin here carries epoch milliseconds on a `float`. That is already the shape a save stamp
 * has, so `Get Save Time` and `Get Latest Auto Save` feed these nodes with no adapter, and the
 * existing `<`, `>`, `Min` and `Max` nodes sort and compare moments without a Time node for any of
 * it. A structured `Date` pin would have bought a tidier inspector and cost all of that, plus a
 * value that has to survive being written into a save's JSON metadata.
 *
 * The calendar is where the number stops being enough - a month is not a fixed number of
 * milliseconds, and "the same day" depends on where the player is. That is what `Make Time`,
 * `Get Time Parts`, `Add Time`, `Time Difference`, `Start Of Day` and `Is Same Day` are for, and
 * they all read the *local* calendar rather than UTC.
 *
 * ## Why they are pure
 *
 * None of them calls the host, so all of them are pure and usable in a Blueprint Value - which is
 * the point, because the place a save's date has to appear is a slot's label, and a label is a
 * Blueprint Value. `Now` is pure and still answers a different number each read; so does
 * `Random Float`, and for the same reason: purity here means "needs no execution flow", not
 * "returns a constant".
 *
 * Pure nodes are served by `graphParamResolvers`, never by `execute`. A node added here without a
 * branch there resolves to `undefined` at every downstream pin, silently.
 *
 * ## The locale seam
 *
 * `Format Time Localized` and `Format Relative Time` take a locale as an *input pin* instead of
 * reading the game's language, because reading it is an async host call that a pure node cannot
 * make. Leaving it empty uses the player's system locale; wiring `Get Current Language` into it
 * makes the date follow the in-game language switch, and the wire is what says which was meant.
 *
 * Comments in English per project convention.
 */

import {
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
    BLUEPRINT_TIME_DISPLAY_STYLES,
    BLUEPRINT_TIME_DURATION_STYLES,
    BLUEPRINT_TIME_PARAM_DATE_STYLE,
    BLUEPRINT_TIME_PARAM_STYLE,
    BLUEPRINT_TIME_PARAM_TIME_STYLE,
    BLUEPRINT_TIME_PARAM_UNIT,
    BLUEPRINT_TIME_RELATIVE_STYLES,
    BLUEPRINT_TIME_UNITS,
    type BlueprintTimeDisplayStyle,
    type BlueprintTimeDurationStyle,
    type BlueprintTimeRelativeStyle,
    type BlueprintTimeUnit,
} from "@shared/types/blueprint/graph";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";

const GRAPH_KINDS = ["event", "function", "macro"] as const;

/** A moment on the wire: epoch milliseconds, the same unit a save record's stamp arrives in. */
const timestampIn = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType: "float",
    label,
    allowInlineLiteral: true,
});
const numberIn = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType: "float",
    label,
    allowInlineLiteral: true,
});
const integerIn = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType: "integer",
    label,
    allowInlineLiteral: true,
});
const stringIn = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType: "string",
    label,
    allowInlineLiteral: true,
});
const out = (id: string, label: string, valueType: string): BlueprintNodePinDef => ({
    id,
    kind: "output",
    semantic: "data",
    valueType,
    label,
});

/** Every unit the calendar nodes accept, as one select. */
const unitParam = {
    key: BLUEPRINT_TIME_PARAM_UNIT,
    label: "Unit",
    kind: "select" as const,
    options: [
        { value: "milliseconds", label: "Milliseconds" },
        { value: "seconds", label: "Seconds" },
        { value: "minutes", label: "Minutes" },
        { value: "hours", label: "Hours" },
        { value: "days", label: "Days" },
        { value: "weeks", label: "Weeks" },
        { value: "months", label: "Months" },
        { value: "years", label: "Years" },
    ],
};

const displayStyleOptions = [
    { value: "none", label: "None" },
    { value: "short", label: "Short" },
    { value: "medium", label: "Medium" },
    { value: "long", label: "Long" },
    { value: "full", label: "Full" },
];

function timeNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins: BlueprintNodePinDef[];
    inspectorParams?: BlueprintNodeDef["inspectorParams"];
}): BlueprintNodeDef {
    return {
        type: input.type,
        displayName: input.displayName,
        category: "Time",
        keywords: input.keywords,
        graphKinds: [...GRAPH_KINDS],
        isPure: true,
        isLatent: false,
        pins: input.pins,
        inspectorParams: input.inspectorParams,
        // Pure: the value is produced by `graphParamResolvers`, and `execute` is never reached on
        // the data path. See the file header.
        execute: () => ({}),
    };
}

/** The stored unit, or `seconds` when the param was never written. */
export function readBlueprintTimeUnit(params: Record<string, unknown> | undefined): BlueprintTimeUnit {
    const raw = String(params?.[BLUEPRINT_TIME_PARAM_UNIT] ?? "").trim();
    return BLUEPRINT_TIME_UNITS.includes(raw as BlueprintTimeUnit)
        ? (raw as BlueprintTimeUnit)
        : "seconds";
}

/** One of the two `Format Time Localized` style params, falling back to `fallback` when unset. */
export function readBlueprintTimeDisplayStyle(
    params: Record<string, unknown> | undefined,
    key: string,
    fallback: BlueprintTimeDisplayStyle,
): BlueprintTimeDisplayStyle {
    const raw = String(params?.[key] ?? "").trim();
    return BLUEPRINT_TIME_DISPLAY_STYLES.includes(raw as BlueprintTimeDisplayStyle)
        ? (raw as BlueprintTimeDisplayStyle)
        : fallback;
}

/** `Format Duration`'s clock layout, defaulting to the one that hides an empty hours field. */
export function readBlueprintDurationStyle(
    params: Record<string, unknown> | undefined,
): BlueprintTimeDurationStyle {
    const raw = String(params?.[BLUEPRINT_TIME_PARAM_STYLE] ?? "").trim();
    return BLUEPRINT_TIME_DURATION_STYLES.includes(raw as BlueprintTimeDurationStyle)
        ? (raw as BlueprintTimeDurationStyle)
        : "auto";
}

/** `Format Relative Time`'s wording mode, defaulting to the one that can say "yesterday". */
export function readBlueprintRelativeStyle(
    params: Record<string, unknown> | undefined,
): BlueprintTimeRelativeStyle {
    const raw = String(params?.[BLUEPRINT_TIME_PARAM_STYLE] ?? "").trim();
    return BLUEPRINT_TIME_RELATIVE_STYLES.includes(raw as BlueprintTimeRelativeStyle)
        ? (raw as BlueprintTimeRelativeStyle)
        : "auto";
}

export const timeBlueprintNodes: BlueprintNodeDef[] = [
    timeNode({
        type: BLUEPRINT_NODE_TYPE_TIME_NOW,
        displayName: "Now",
        keywords: ["time", "now", "current", "date", "clock", "timestamp", "today"],
        pins: [out("timestamp", "Timestamp", "float")],
    }),
    timeNode({
        type: BLUEPRINT_NODE_TYPE_TIME_MAKE,
        displayName: "Make Time",
        keywords: ["time", "date", "make", "build", "construct", "new", "timestamp", "calendar"],
        pins: [
            integerIn("year", "Year"),
            integerIn("month", "Month"),
            integerIn("day", "Day"),
            integerIn("hour", "Hour"),
            integerIn("minute", "Minute"),
            integerIn("second", "Second"),
            integerIn("millisecond", "Millisecond"),
            out("timestamp", "Timestamp", "float"),
        ],
    }),
    timeNode({
        type: BLUEPRINT_NODE_TYPE_TIME_PARTS,
        displayName: "Get Time Parts",
        keywords: ["time", "date", "parts", "break", "split", "year", "month", "day", "hour", "weekday"],
        pins: [
            timestampIn("timestamp", "Timestamp"),
            out("year", "Year", "integer"),
            out("month", "Month", "integer"),
            out("day", "Day", "integer"),
            out("hour", "Hour", "integer"),
            out("minute", "Minute", "integer"),
            out("second", "Second", "integer"),
            out("millisecond", "Millisecond", "integer"),
            out("weekday", "Weekday", "integer"),
            out("dayOfYear", "Day Of Year", "integer"),
        ],
    }),
    timeNode({
        type: BLUEPRINT_NODE_TYPE_TIME_FORMAT,
        displayName: "Format Time",
        keywords: ["time", "date", "format", "pattern", "text", "string", "display", "YYYY"],
        pins: [
            timestampIn("timestamp", "Timestamp"),
            stringIn("pattern", "Pattern"),
            out("result", "Result", "string"),
        ],
    }),
    timeNode({
        type: BLUEPRINT_NODE_TYPE_TIME_FORMAT_LOCALIZED,
        displayName: "Format Time Localized",
        keywords: ["time", "date", "format", "locale", "language", "localized", "intl", "display"],
        pins: [
            timestampIn("timestamp", "Timestamp"),
            stringIn("locale", "Locale"),
            out("result", "Result", "string"),
        ],
        inspectorParams: [
            {
                key: BLUEPRINT_TIME_PARAM_DATE_STYLE,
                label: "Date Style",
                kind: "select",
                options: displayStyleOptions,
            },
            {
                key: BLUEPRINT_TIME_PARAM_TIME_STYLE,
                label: "Time Style",
                kind: "select",
                options: displayStyleOptions,
            },
        ],
    }),
    timeNode({
        type: BLUEPRINT_NODE_TYPE_TIME_FORMAT_RELATIVE,
        displayName: "Format Relative Time",
        keywords: ["time", "date", "relative", "ago", "since", "format", "locale", "display"],
        pins: [
            timestampIn("from", "From"),
            timestampIn("to", "To"),
            stringIn("locale", "Locale"),
            out("result", "Result", "string"),
        ],
        inspectorParams: [
            {
                key: BLUEPRINT_TIME_PARAM_STYLE,
                label: "Wording",
                kind: "select",
                options: [
                    { value: "auto", label: "Auto" },
                    { value: "always", label: "Always Numeric" },
                ],
            },
        ],
    }),
    timeNode({
        type: BLUEPRINT_NODE_TYPE_TIME_FORMAT_DURATION,
        displayName: "Format Duration",
        keywords: ["time", "duration", "elapsed", "length", "format", "clock", "playtime", "timer"],
        pins: [
            numberIn("milliseconds", "Milliseconds"),
            out("result", "Result", "string"),
        ],
        inspectorParams: [
            {
                key: BLUEPRINT_TIME_PARAM_STYLE,
                label: "Layout",
                kind: "select",
                options: [
                    { value: "auto", label: "Auto" },
                    { value: "hoursMinutesSeconds", label: "Hours Minutes Seconds" },
                    { value: "minutesSeconds", label: "Minutes Seconds" },
                ],
            },
        ],
    }),
    timeNode({
        type: BLUEPRINT_NODE_TYPE_TIME_DURATION_PARTS,
        displayName: "Get Duration Parts",
        keywords: ["time", "duration", "parts", "break", "split", "elapsed", "hours", "minutes"],
        pins: [
            numberIn("milliseconds", "Milliseconds"),
            out("days", "Days", "integer"),
            out("hours", "Hours", "integer"),
            out("minutes", "Minutes", "integer"),
            out("seconds", "Seconds", "integer"),
            out("remainingMilliseconds", "Remaining Milliseconds", "integer"),
            out("totalHours", "Total Hours", "integer"),
            out("totalMinutes", "Total Minutes", "integer"),
            out("totalSeconds", "Total Seconds", "integer"),
            out("negative", "Negative", "boolean"),
        ],
    }),
    timeNode({
        type: BLUEPRINT_NODE_TYPE_TIME_ADD,
        displayName: "Add Time",
        keywords: ["time", "date", "add", "offset", "shift", "plus", "minus", "later", "earlier"],
        pins: [
            timestampIn("timestamp", "Timestamp"),
            numberIn("amount", "Amount"),
            out("result", "Result", "float"),
        ],
        inspectorParams: [unitParam],
    }),
    timeNode({
        type: BLUEPRINT_NODE_TYPE_TIME_DIFFERENCE,
        displayName: "Time Difference",
        keywords: ["time", "date", "difference", "between", "elapsed", "since", "until", "delta"],
        pins: [
            timestampIn("from", "From"),
            timestampIn("to", "To"),
            out("difference", "Difference", "float"),
        ],
        inspectorParams: [unitParam],
    }),
    timeNode({
        type: BLUEPRINT_NODE_TYPE_TIME_PARSE,
        displayName: "Parse Time",
        keywords: ["time", "date", "parse", "read", "iso", "string", "convert", "text"],
        pins: [
            stringIn("value", "Value"),
            out("timestamp", "Timestamp", "float"),
            out("ok", "Ok", "boolean"),
        ],
    }),
    timeNode({
        type: BLUEPRINT_NODE_TYPE_TIME_TO_ISO_STRING,
        displayName: "To ISO String",
        keywords: ["time", "date", "iso", "8601", "string", "utc", "serialize", "store"],
        pins: [
            timestampIn("timestamp", "Timestamp"),
            out("result", "Result", "string"),
        ],
    }),
    timeNode({
        type: BLUEPRINT_NODE_TYPE_TIME_IS_SAME_DAY,
        displayName: "Is Same Day",
        keywords: ["time", "date", "same", "day", "today", "compare", "calendar"],
        pins: [
            timestampIn("a", "A"),
            timestampIn("b", "B"),
            out("result", "Result", "boolean"),
        ],
    }),
    timeNode({
        type: BLUEPRINT_NODE_TYPE_TIME_START_OF_DAY,
        displayName: "Start Of Day",
        keywords: ["time", "date", "start", "midnight", "day", "truncate", "floor", "today"],
        pins: [
            timestampIn("timestamp", "Timestamp"),
            out("result", "Result", "float"),
        ],
    }),
    timeNode({
        type: BLUEPRINT_NODE_TYPE_TIME_ZONE_OFFSET,
        displayName: "Get Time Zone",
        keywords: ["time", "zone", "timezone", "offset", "utc", "gmt", "region"],
        pins: [
            timestampIn("timestamp", "Timestamp"),
            out("offsetMinutes", "Offset Minutes", "float"),
            out("name", "Name", "string"),
        ],
    }),
];
