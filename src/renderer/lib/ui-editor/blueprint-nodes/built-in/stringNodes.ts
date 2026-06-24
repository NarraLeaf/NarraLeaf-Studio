/**
 * Pure string utility nodes from the documented Blueprint catalog.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_STRING_CAPITALIZE,
    BLUEPRINT_NODE_TYPE_STRING_CHAR_AT,
    BLUEPRINT_NODE_TYPE_STRING_CONCAT,
    BLUEPRINT_NODE_TYPE_STRING_CONTAINS,
    BLUEPRINT_NODE_TYPE_STRING_COUNT,
    BLUEPRINT_NODE_TYPE_STRING_ENDS_WITH,
    BLUEPRINT_NODE_TYPE_STRING_EQUALS,
    BLUEPRINT_NODE_TYPE_STRING_EQUALS_IGNORE_CASE,
    BLUEPRINT_NODE_TYPE_STRING_EXTRACT_REGEX,
    BLUEPRINT_NODE_TYPE_STRING_FORMAT,
    BLUEPRINT_NODE_TYPE_STRING_INDEX_OF,
    BLUEPRINT_NODE_TYPE_STRING_INSERT,
    BLUEPRINT_NODE_TYPE_STRING_IS_BLANK,
    BLUEPRINT_NODE_TYPE_STRING_IS_EMPTY,
    BLUEPRINT_NODE_TYPE_STRING_JOIN,
    BLUEPRINT_NODE_TYPE_STRING_LAST_INDEX_OF,
    BLUEPRINT_NODE_TYPE_STRING_LENGTH,
    BLUEPRINT_NODE_TYPE_STRING_MATCHES_REGEX,
    BLUEPRINT_NODE_TYPE_STRING_NORMALIZE_LINE_BREAKS,
    BLUEPRINT_NODE_TYPE_STRING_PAD_END,
    BLUEPRINT_NODE_TYPE_STRING_PAD_START,
    BLUEPRINT_NODE_TYPE_STRING_REPEAT,
    BLUEPRINT_NODE_TYPE_STRING_REPLACE,
    BLUEPRINT_NODE_TYPE_STRING_REPLACE_ALL,
    BLUEPRINT_NODE_TYPE_STRING_SPLIT,
    BLUEPRINT_NODE_TYPE_STRING_STARTS_WITH,
    BLUEPRINT_NODE_TYPE_STRING_SUBSTRING,
    BLUEPRINT_NODE_TYPE_STRING_TO_LOWER,
    BLUEPRINT_NODE_TYPE_STRING_TO_STRING,
    BLUEPRINT_NODE_TYPE_STRING_TO_UPPER,
    BLUEPRINT_NODE_TYPE_STRING_TRIM,
    BLUEPRINT_NODE_TYPE_STRING_TRIM_END,
    BLUEPRINT_NODE_TYPE_STRING_TRIM_START,
} from "@shared/types/blueprint/graph";
import {
    BLUEPRINT_NODE_PARAMS_DYNAMIC_INPUT_PIN_IDS_KEY,
    type BlueprintNodeDef,
    type BlueprintNodePinDef,
} from "../types";

const GRAPH_KINDS = ["event", "function", "macro"] as const;

const stringIn = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType: "string",
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
const jsonIn = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType: "json",
    label,
});
const anyIn = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType: "any",
    label,
});
const out = (id: string, label: string, valueType: string): BlueprintNodePinDef => ({
    id,
    kind: "output",
    semantic: "data",
    valueType,
    label,
});

function stringNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins: BlueprintNodePinDef[];
    dynamic?: BlueprintNodeDef["dynamicInputPins"];
}): BlueprintNodeDef {
    return {
        type: input.type,
        displayName: input.displayName,
        category: "Data",
        keywords: input.keywords,
        graphKinds: [...GRAPH_KINDS],
        isPure: true,
        pins: input.pins,
        dynamicInputPins: input.dynamic,
        execute: () => ({}),
    };
}

export const stringBlueprintNodes: BlueprintNodeDef[] = [
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_TO_STRING,
        displayName: "To String",
        keywords: ["string", "toString", "convert", "text"],
        pins: [anyIn("value", "Value"), out("result", "Result", "string")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_CONCAT,
        displayName: "Concat",
        keywords: ["concat", "join", "append", "+", "string"],
        pins: [stringIn("a", "A"), stringIn("b", "B"), out("result", "Result", "string")],
        dynamic: {
            storageKey: BLUEPRINT_NODE_PARAMS_DYNAMIC_INPUT_PIN_IDS_KEY,
            fixedDataInputIds: ["a", "b"],
            generatedIdPrefix: "in",
            valueType: "string",
            allowInlineLiteral: true,
        },
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_FORMAT,
        displayName: "Format",
        keywords: ["format", "template", "placeholder", "string"],
        pins: [stringIn("template", "Template"), jsonIn("values", "Values"), out("result", "Result", "string")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_LENGTH,
        displayName: "Length",
        keywords: ["length", "size", "len", "string"],
        pins: [stringIn("value", "Value"), out("length", "Length", "integer")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_IS_EMPTY,
        displayName: "Is Empty",
        keywords: ["empty", "length", "string"],
        pins: [stringIn("value", "Value"), out("result", "Result", "boolean")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_IS_BLANK,
        displayName: "Is Blank",
        keywords: ["blank", "empty", "whitespace", "string"],
        pins: [stringIn("value", "Value"), out("result", "Result", "boolean")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_TRIM,
        displayName: "Trim",
        keywords: ["trim", "strip", "whitespace", "string"],
        pins: [stringIn("value", "Value"), out("result", "Result", "string")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_TRIM_START,
        displayName: "Trim Start",
        keywords: ["trim", "start", "left", "whitespace", "string"],
        pins: [stringIn("value", "Value"), out("result", "Result", "string")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_TRIM_END,
        displayName: "Trim End",
        keywords: ["trim", "end", "right", "whitespace", "string"],
        pins: [stringIn("value", "Value"), out("result", "Result", "string")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_TO_UPPER,
        displayName: "To Upper Case",
        keywords: ["uppercase", "upper", "toUpperCase", "string"],
        pins: [stringIn("value", "Value"), out("result", "Result", "string")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_TO_LOWER,
        displayName: "To Lower Case",
        keywords: ["lowercase", "lower", "toLowerCase", "string"],
        pins: [stringIn("value", "Value"), out("result", "Result", "string")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_CAPITALIZE,
        displayName: "Capitalize",
        keywords: ["capitalize", "title", "first", "string"],
        pins: [stringIn("value", "Value"), out("result", "Result", "string")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_CONTAINS,
        displayName: "Contains",
        keywords: ["contains", "includes", "search", "string"],
        pins: [stringIn("value", "Value"), stringIn("search", "Search"), out("result", "Result", "boolean")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_STARTS_WITH,
        displayName: "Starts With",
        keywords: ["starts", "prefix", "search", "string"],
        pins: [stringIn("value", "Value"), stringIn("search", "Search"), out("result", "Result", "boolean")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_ENDS_WITH,
        displayName: "Ends With",
        keywords: ["ends", "suffix", "search", "string"],
        pins: [stringIn("value", "Value"), stringIn("search", "Search"), out("result", "Result", "boolean")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_EQUALS,
        displayName: "Equals",
        keywords: ["equals", "same", "compare", "string"],
        pins: [stringIn("a", "A"), stringIn("b", "B"), out("result", "Result", "boolean")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_EQUALS_IGNORE_CASE,
        displayName: "Equals Ignore Case",
        keywords: ["equals", "case", "compare", "string"],
        pins: [stringIn("a", "A"), stringIn("b", "B"), out("result", "Result", "boolean")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_INDEX_OF,
        displayName: "Index Of",
        keywords: ["index", "find", "position", "string"],
        pins: [
            stringIn("value", "Value"),
            stringIn("search", "Search"),
            integerIn("start", "Start"),
            out("index", "Index", "integer"),
        ],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_LAST_INDEX_OF,
        displayName: "Last Index Of",
        keywords: ["last", "index", "find", "position", "string"],
        pins: [stringIn("value", "Value"), stringIn("search", "Search"), out("index", "Index", "integer")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_COUNT,
        displayName: "Count",
        keywords: ["count", "occurrence", "search", "string"],
        pins: [stringIn("value", "Value"), stringIn("search", "Search"), out("count", "Count", "integer")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_CHAR_AT,
        displayName: "Char At",
        keywords: ["char", "character", "index", "string"],
        pins: [stringIn("value", "Value"), integerIn("index", "Index"), out("char", "Char", "string")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_SUBSTRING,
        displayName: "Substring",
        keywords: ["substring", "slice", "range", "string"],
        pins: [
            stringIn("value", "Value"),
            integerIn("start", "Start"),
            integerIn("length", "Length"),
            out("result", "Result", "string"),
        ],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_INSERT,
        displayName: "Insert",
        keywords: ["insert", "splice", "string"],
        pins: [
            stringIn("value", "Value"),
            integerIn("index", "Index"),
            stringIn("insert", "Insert"),
            out("result", "Result", "string"),
        ],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_REPLACE,
        displayName: "Replace",
        keywords: ["replace", "search", "first", "string"],
        pins: [
            stringIn("value", "Value"),
            stringIn("search", "Search"),
            stringIn("replacement", "Replacement"),
            out("result", "Result", "string"),
        ],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_REPLACE_ALL,
        displayName: "Replace All",
        keywords: ["replace", "all", "search", "string"],
        pins: [
            stringIn("value", "Value"),
            stringIn("search", "Search"),
            stringIn("replacement", "Replacement"),
            out("result", "Result", "string"),
        ],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_SPLIT,
        displayName: "Split",
        keywords: ["split", "array", "separator", "string"],
        pins: [stringIn("value", "Value"), stringIn("separator", "Separator"), out("result", "Result", "json")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_JOIN,
        displayName: "Join",
        keywords: ["join", "array", "separator", "string"],
        pins: [jsonIn("values", "Values"), stringIn("separator", "Separator"), out("result", "Result", "string")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_REPEAT,
        displayName: "Repeat",
        keywords: ["repeat", "multiply", "string"],
        pins: [stringIn("value", "Value"), integerIn("count", "Count"), out("result", "Result", "string")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_PAD_START,
        displayName: "Pad Start",
        keywords: ["pad", "start", "left", "string"],
        pins: [
            stringIn("value", "Value"),
            integerIn("length", "Length"),
            stringIn("pad", "Pad"),
            out("result", "Result", "string"),
        ],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_PAD_END,
        displayName: "Pad End",
        keywords: ["pad", "end", "right", "string"],
        pins: [
            stringIn("value", "Value"),
            integerIn("length", "Length"),
            stringIn("pad", "Pad"),
            out("result", "Result", "string"),
        ],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_MATCHES_REGEX,
        displayName: "Matches Regex",
        keywords: ["regex", "match", "pattern", "string"],
        pins: [stringIn("value", "Value"), stringIn("pattern", "Pattern"), out("result", "Result", "boolean")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_EXTRACT_REGEX,
        displayName: "Extract Regex",
        keywords: ["regex", "extract", "match", "pattern", "string"],
        pins: [stringIn("value", "Value"), stringIn("pattern", "Pattern"), out("result", "Result", "string")],
    }),
    stringNode({
        type: BLUEPRINT_NODE_TYPE_STRING_NORMALIZE_LINE_BREAKS,
        displayName: "Normalize Line Breaks",
        keywords: ["line", "break", "newline", "normalize", "string"],
        pins: [stringIn("value", "Value"), out("result", "Result", "string")],
    }),
];
