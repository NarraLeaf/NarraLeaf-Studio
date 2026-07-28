#!/usr/bin/env node
/**
 * Snapshot the Lore C ABI from `@lore-vcs/sdk`'s generated bindings.
 *
 * Studio hand-writes its own koffi bindings (see `vcs/lore/`) instead of using the
 * SDK's runtime - the reasons are in docs/version-control.md. Hand-writing struct
 * layouts is the one genuinely dangerous part of that decision: a wrong field type
 * is not a type error, it is memory corruption.
 *
 * So the layouts stay machine-checked. The SDK's generated `dist/**\/ffi.js` files
 * are code-generated from `lore-capi/lore.h` and contain nothing but koffi type
 * declarations, which makes them a faithful, parseable mirror of the header. This
 * script freezes that mirror into `abi/upstream.json`, and `abi.test.ts` asserts
 * every struct Studio declares matches it field-for-field.
 *
 * Consequences worth knowing:
 *   - The snapshot is COMMITTED. The check runs without the SDK installed, and the
 *     SDK stays a devDependency.
 *   - Regenerating it on a Lore upgrade produces a reviewable diff of exactly what
 *     changed in the ABI. That diff is the upgrade report.
 *   - This parses source text on purpose. Importing the modules would register
 *     types into koffi's process-global registry under the same names Studio uses,
 *     so the two could never be compared in one process. It would also load the
 *     native library, which is exactly what this must not require.
 *
 * Usage: node tools/lore-abi-extract.mjs [--check]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SDK = path.join(ROOT, "node_modules", "@lore-vcs", "sdk");
const OUT = path.join(ROOT, "src", "main", "app", "application", "managers", "vcs", "lore", "abi", "upstream.json");

const SOURCES = [
    "dist/types/ffi.js",
    "dist/types/enums/ffi.js",
    "dist/types/args/ffi.js",
    "dist/types/events/ffi.js",
    "dist/functions/ffi.js",
];

/** `const LoreFooStruct = koffi.struct("LoreFoo", { ... })` */
const STRUCT_RE = /const\s+([A-Za-z0-9_]+)\s*=\s*koffi\.struct\(\s*"([A-Za-z0-9_]+)"\s*,\s*\{([^}]*)\}\s*\)/g;
/** `const LoreMetadataUnion = koffi.union({ ... })` - anonymous to C, named only by its variable. */
const UNION_RE = /const\s+([A-Za-z0-9_]+)\s*=\s*koffi\.union\(\s*\{([^}]*)\}\s*\)/g;
/** `const LoreBranchIdStruct = koffi.alias("LoreBranchId", "LoreContext")` */
const ALIAS_RE = /const\s+([A-Za-z0-9_]+)\s*=\s*koffi\.alias\(\s*"([A-Za-z0-9_]+)"\s*,\s*"([A-Za-z0-9_ *[\]]+)"\s*\)/g;
/** `const X = koffi.proto("LoreEventCallbackFunction", "void", [...])` */
const PROTO_RE = /const\s+([A-Za-z0-9_]+)\s*=\s*koffi\.proto\(\s*"([A-Za-z0-9_]+)"\s*,\s*"([a-z0-9_]+)"\s*,\s*\[([^\]]*)\]\s*\)/g;
/** `const lore_x = lib.func("lore_x", "int32_t", [ ... ])` */
const FUNC_RE = /lib\.func\(\s*"([a-z0-9_]+)"\s*,\s*"([a-z0-9_]+)"\s*,\s*\[([^\]]*)\]\s*\)/g;
/** `LoreEventTag[LoreEventTag["ERROR"] = 1] = "ERROR";` - tsdown's enum lowering. */
const ENUM_MEMBER_RE = /([A-Za-z0-9_]+)\[\1\["([A-Za-z0-9_]+)"\]\s*=\s*(-?\d+)\]/g;

/** Enum values are ABI too: a renumbered event tag is as breaking as a moved field. */
const ENUM_SOURCE = "dist/types/enums/index.js";

function readSource(relative) {
    const file = path.join(SDK, relative);
    if (!fs.existsSync(file)) {
        throw new Error(
            `Missing ${relative}. The ABI snapshot needs the @lore-vcs/sdk devDependency installed:\n`
            + "  yarn add -D @lore-vcs/sdk@0.8.5",
        );
    }
    return fs.readFileSync(file, "utf8");
}

/** Split an object-literal body on its top-level commas. `koffi.array("uint8_t", n)` has one inside. */
function splitTopLevel(body) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < body.length; i++) {
        const char = body[i];
        if (char === "(" || char === "[") depth++;
        else if (char === ")" || char === "]") depth--;
        else if (char === "," && depth === 0) {
            parts.push(body.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(body.slice(start));
    return parts.filter((part) => part.trim().length > 0);
}

/**
 * Resolve every `const X = koffi.<something>("Name", ...)` binding to the C name it
 * registered, so field and argument references can be printed as C types rather
 * than as the SDK's JS variable names. Doing this by table instead of by stripping
 * a "Struct" suffix matters: `LoreEventCallbackConfigInternalStruct` registers the
 * type `LoreEventCallbackConfig`, and the heuristic gets that one wrong.
 */
function buildVariableMap(sources) {
    const map = new Map();
    for (const source of sources) {
        for (const [, variable, name] of source.matchAll(STRUCT_RE)) map.set(variable, name);
        for (const [, variable, name] of source.matchAll(ALIAS_RE)) map.set(variable, name);
        for (const [, variable, name] of source.matchAll(PROTO_RE)) map.set(variable, name);
        for (const [, variable] of source.matchAll(UNION_RE)) map.set(variable, variable);
    }
    return map;
}

/**
 * Normalise one type expression to a stable string.
 *
 * The array form stays symbolic (`uint8_t[sizeof(LoreMetadataUnion)]`) rather than
 * resolved to a number: if upstream adds a union member the size changes, and the
 * symbolic form keeps the snapshot diff pointing at the cause instead of at a
 * magic constant.
 */
function normaliseType(expression, variables, context) {
    const text = expression.trim();

    const literal = /^"([^"]+)"$/.exec(text);
    if (literal) return literal[1];

    const pointerToPrimitive = /^koffi\.pointer\(\s*"([^"]+)"\s*\)$/.exec(text);
    if (pointerToPrimitive) return `${pointerToPrimitive[1]}*`;

    const pointer = /^koffi\.pointer\(([A-Za-z0-9_]+)\)$/.exec(text);
    if (pointer) return `${resolveVariable(pointer[1], variables, context)}*`;

    const array = /^koffi\.array\(\s*"([^"]+)"\s*,\s*koffi\.sizeof\(([A-Za-z0-9_]+)\)\s*\)$/.exec(text);
    if (array) return `${array[1]}[sizeof(${resolveVariable(array[2], variables, context)})]`;

    if (/^[A-Za-z0-9_]+$/.test(text)) return resolveVariable(text, variables, context);

    throw new Error(`Unparsed type in ${context}: ${JSON.stringify(text)}`);
}

function resolveVariable(variable, variables, context) {
    const resolved = variables.get(variable);
    if (!resolved) throw new Error(`Unknown type variable ${variable} in ${context}`);
    return resolved;
}

function parseFields(body, variables, owner) {
    const fields = {};
    for (const raw of splitTopLevel(body)) {
        const separator = raw.indexOf(":");
        if (separator < 0) throw new Error(`Unparsed field in ${owner}: ${JSON.stringify(raw)}`);
        const name = raw.slice(0, separator).trim();
        if (!/^[A-Za-z0-9_]+$/.test(name)) {
            throw new Error(`Unparsed field name in ${owner}: ${JSON.stringify(raw)}`);
        }
        fields[name] = normaliseType(raw.slice(separator + 1), variables, `${owner}.${name}`);
    }
    return fields;
}

function extract() {
    const sources = SOURCES.map(readSource);
    const variables = buildVariableMap(sources);

    const structs = {};
    const unions = {};
    const aliases = {};
    const prototypes = {};

    for (const source of sources) {
        for (const [, , name, body] of source.matchAll(STRUCT_RE)) {
            structs[name] = parseFields(body, variables, name);
        }
        for (const [, name, body] of source.matchAll(UNION_RE)) {
            unions[name] = parseFields(body, variables, name);
        }
        for (const [, , name, target] of source.matchAll(ALIAS_RE)) {
            aliases[name] = target;
        }
        for (const [, , name, returns, argList] of source.matchAll(PROTO_RE)) {
            prototypes[name] = {
                returns,
                args: splitTopLevel(argList).map((arg) => normaliseType(arg, variables, `proto ${name}`)),
            };
        }
    }

    const functions = {};
    const funcSource = sources[SOURCES.indexOf("dist/functions/ffi.js")];
    for (const [, symbol, returns, argList] of funcSource.matchAll(FUNC_RE)) {
        functions[symbol] = {
            returns,
            args: splitTopLevel(argList).map((arg) => normaliseType(arg, variables, `func ${symbol}`)),
        };
    }

    const enums = {};
    for (const [, enumName, member, value] of readSource(ENUM_SOURCE).matchAll(ENUM_MEMBER_RE)) {
        (enums[enumName] ??= {})[member] = Number(value);
    }

    const { version } = JSON.parse(readSource("package.json"));
    return {
        $comment: "Generated by tools/lore-abi-extract.mjs. Do not edit by hand.",
        sdkVersion: version,
        structs,
        unions,
        aliases,
        prototypes,
        functions,
        enums,
    };
}

const snapshot = extract();
const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;

if (process.argv.includes("--check")) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (current !== serialized) {
        console.error("ABI snapshot is stale. Re-run: node tools/lore-abi-extract.mjs");
        process.exit(1);
    }
    console.log(`ABI snapshot matches @lore-vcs/sdk ${snapshot.sdkVersion}.`);
} else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, serialized);
    console.log(
        `Wrote ${path.relative(ROOT, OUT)} from @lore-vcs/sdk ${snapshot.sdkVersion}: `
        + `${Object.keys(snapshot.structs).length} structs, `
        + `${Object.keys(snapshot.unions).length} unions, `
        + `${Object.keys(snapshot.aliases).length} aliases, `
        + `${Object.keys(snapshot.functions).length} functions.`,
    );
}
