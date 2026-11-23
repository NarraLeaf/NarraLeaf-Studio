import type {
    StoryBlock,
    StoryCustomCommandArg,
    StoryCustomCommandBinding,
    StoryCustomCommandBindingMap,
    StoryCustomCommandParam,
    StoryCustomCommandRow,
    StoryCustomCommandTableEntry,
    StoryPluginActionParamValue,
} from "@shared/types/story";
import { isValidCustomCommandParamName, readPath, sameJson } from "@shared/story/customCommands";
import { toCanonicalCommandLine } from "./commandTrigger";
import { getCommandSpec } from "./commands/registry";
import { CUSTOM_COMMAND_BODY_COMMAND_IDS, serializeCustomCommandArgs } from "./commands/customCommands";
import { customCommandOfSpecId, isCustomCommandSpecId } from "./commands/customCommandState";
import type { StoryCommandParam, StoryCommandParamType } from "./storyCommandGrammar";
import { canCommit, parseCommandLine } from "./storyCommandParser";
import { resolveCommandLine } from "./storyCommandResolution";
import type { StoryCommandContext, StoryCommandResolvedArgs } from "./storyCommandValues";

/**
 * One line of a custom command, as the author typed it, turned into the row it stands for and the
 * places its parameters land.
 *
 * A parameter is written where a value goes, in angle brackets: `/transform <角色> x=-<力度>`. A
 * leading `-` negates it; `<力度=5>` gives it a default. The line is otherwise an ordinary command
 * line, read by the editor's own parse → resolve → build.
 *
 * **How a parameter is placed without a table.** Every command keeps its values in fields of its own
 * choosing, and some convert on the way in (seconds to milliseconds; an option to a preset). Rather
 * than a hand-kept map of which slot writes which field, the line is built twice with two different
 * sample values in the parameter's place, and the fields that moved are where it lands. A number
 * writes `scale × value + offset` (checked against a third sample, so a slot that does not convert
 * linearly is refused rather than guessed); an option or a switch writes what each of its values wrote;
 * a character is copied from the value the line resolved. This is what lets a parameter sit in any
 * slot of any command, including commands added after this was written.
 */

export type CustomCommandRowProblem =
    /** Not a command line yet, a required slot is empty, or a name does not resolve. */
    | { code: "incomplete" }
    /** A finished command a custom command cannot hold (see `CUSTOM_COMMAND_BODY_COMMAND_IDS`). */
    | { code: "notAllowed" }
    /** `<…>` not standing for a whole value, or in a slot the command does not have. */
    | { code: "placement"; name: string }
    /** A slot whose values a parameter cannot stand for (a file, a variable, an expression). */
    | { code: "unsupported"; name: string }
    /** The slot took the sample values but the row came out the same, or not in a way that can be replayed. */
    | { code: "noEffect"; name: string }
    /** The same parameter written in two slots of different kinds. */
    | { code: "mismatch"; name: string }
    | { code: "badName"; name: string };

export type CustomCommandRowResult =
    | { ok: true; row: StoryCustomCommandRow; params: StoryCustomCommandParam[] }
    | { ok: false; problem: CustomCommandRowProblem };

type Placeholder = { start: number; end: number; name: string; negate: boolean; defaultText?: string };

const PLACEHOLDER = /(-?)<([^<>\s=]+)(?:=([^<>\s]*))?>/gu;

/** The parameters a typed line uses, in order of first appearance. */
export function findCustomCommandPlaceholders(line: string): Placeholder[] {
    const found: Placeholder[] = [];
    for (const match of line.matchAll(PLACEHOLDER)) {
        found.push({
            start: match.index ?? 0,
            end: (match.index ?? 0) + match[0].length,
            name: match[2],
            negate: match[1] === "-",
            ...(match[3] !== undefined && match[3] !== "" ? { defaultText: match[3] } : {}),
        });
    }
    return found;
}

function substitute(line: string, placeholders: readonly Placeholder[], values: readonly string[]): string {
    let out = "";
    let at = 0;
    placeholders.forEach((placeholder, index) => {
        out += line.slice(at, placeholder.start) + values[index];
        at = placeholder.end;
    });
    return out + line.slice(at);
}

/** Two stand-in characters, so a parameter in a character slot can be placed in a project with one or none. */
const PROBE_CHARACTERS = [
    { id: "__nls_probe_character_a__", name: "NlsProbeCharacterA" },
    { id: "__nls_probe_character_b__", name: "NlsProbeCharacterB" },
] as const;

type ProbePlan =
    | { kind: "linear"; values: [number, number, number] }
    | { kind: "table"; texts: string[] }
    | { kind: "pick"; texts: [string, string] };

function planFor(type: StoryCommandParam["type"]): ProbePlan | null {
    const branches: readonly StoryCommandParamType[] = Array.isArray(type) ? type : [type as StoryCommandParamType];
    for (const branch of branches) {
        if (branch.kind === "number") {
            return { kind: "linear", values: numberProbes(branch) };
        }
        if (branch.kind === "boolean") {
            return { kind: "table", texts: ["true", "false"] };
        }
        if (branch.kind === "enum" && branch.options.length > 0) {
            return { kind: "table", texts: branch.options.map(option => option.value) };
        }
        if (branch.kind === "character" || (branch.kind === "target" && branch.accepts.includes("character"))) {
            return { kind: "pick", texts: [PROBE_CHARACTERS[0].name, PROBE_CHARACTERS[1].name] };
        }
        if (branch.kind === "text") {
            return { kind: "pick", texts: ["nlsprobetexta", "nlsprobetextb"] };
        }
    }
    return null;
}

function numberProbes(type: Extract<StoryCommandParamType, { kind: "number" }>): [number, number, number] {
    const round = (value: number) => (type.integer ? Math.round(value) : value);
    if (type.min !== undefined && type.max !== undefined && type.max > type.min) {
        const span = type.max - type.min;
        const values = [round(type.min + span * 0.25), round(type.min + span * 0.5), round(type.min + span * 0.75)];
        if (new Set(values).size === 3) {
            return values as [number, number, number];
        }
    }
    const base = type.min ?? 0;
    return [base + 1, base + 2, base + 4];
}

function probeContext(context: StoryCommandContext): StoryCommandContext {
    return { ...context, characters: [...context.characters, ...PROBE_CHARACTERS] };
}

type Built = { payload: Record<string, unknown>; args: StoryCommandResolvedArgs; commandId: string; block: StoryBlock };

function build(line: string, context: StoryCommandContext, generateId: () => string): Built | CustomCommandRowProblem {
    const parsed = parseCommandLine(toCanonicalCommandLine(line, true));
    if (parsed.kind !== "command" || !parsed.def || !canCommit(parsed)) {
        return { code: "incomplete" };
    }
    const { args, issues } = resolveCommandLine(parsed, context);
    if (issues.length > 0) {
        return { code: "incomplete" };
    }
    const commandId = parsed.def.commandId;
    const spec = getCommandSpec(commandId);
    const allowed = CUSTOM_COMMAND_BODY_COMMAND_IDS.has(commandId) || isCustomCommandSpecId(commandId);
    if (!spec || spec.editScene || !spec.build || !allowed) {
        return { code: "notAllowed" };
    }
    const block = spec.build(args, { generateId, context });
    if (block.kind !== "action") {
        return { code: "notAllowed" };
    }
    return { payload: block.payload as unknown as Record<string, unknown>, args, commandId, block };
}

function isProblem(value: Built | CustomCommandRowProblem): value is CustomCommandRowProblem {
    return "code" in value;
}

/**
 * Build one row of a custom command from the line the author typed.
 *
 * `known` is the command's parameters so far, from its other rows: a parameter written again must be
 * the same kind of value, and keeps the slot it was first written in as the source of its type.
 */
export function buildCustomCommandRow(
    line: string,
    context: StoryCommandContext,
    options: { rowId?: string; known?: readonly StoryCustomCommandParam[]; generateId?: () => string } = {},
): CustomCommandRowResult {
    const generateId = options.generateId ?? (() => globalThis.crypto.randomUUID());
    const placeholders = findCustomCommandPlaceholders(line);
    for (const placeholder of placeholders) {
        if (!isValidCustomCommandParamName(placeholder.name)) {
            return { ok: false, problem: { code: "badName", name: placeholder.name } };
        }
    }
    if (placeholders.length === 0) {
        const built = build(line, context, generateId);
        if (isProblem(built)) {
            return { ok: false, problem: built };
        }
        return { ok: true, row: { block: withId(built.block, options.rowId), bindings: [] }, params: [] };
    }

    // Which slot each placeholder stands in: a marker word in its place, read back off the parsed line.
    const markers = placeholders.map((_, index) => `nlsplaceholder${index}`);
    const marked = parseCommandLine(toCanonicalCommandLine(substitute(line, placeholders, markers), true));
    if (marked.kind !== "command" || !marked.def) {
        return { ok: false, problem: { code: "incomplete" } };
    }
    const slots: StoryCommandParam[] = [];
    for (const [index, placeholder] of placeholders.entries()) {
        const arg = marked.args.find(entry => entry.value === markers[index]);
        if (!arg?.param) {
            return { ok: false, problem: { code: "placement", name: placeholder.name } };
        }
        slots.push(arg.param);
    }
    const plans: ProbePlan[] = [];
    for (const [index, slot] of slots.entries()) {
        const plan = planFor(slot.type);
        if (!plan) {
            return { ok: false, problem: { code: "unsupported", name: placeholders[index].name } };
        }
        plans.push(plan);
    }

    const context2 = probeContext(context);
    const textOf = (plan: ProbePlan, which: number): string => (plan.kind === "linear" ? String(plan.values[which]) : plan.kind === "pick" ? plan.texts[which] : plan.texts[which]);
    const baselineValues = plans.map(plan => textOf(plan, 0));
    const baseline = build(substitute(line, placeholders, baselineValues), context2, generateId);
    if (isProblem(baseline)) {
        return { ok: false, problem: baseline };
    }
    const probe = (index: number, text: string): Built | CustomCommandRowProblem => {
        const values = [...baselineValues];
        values[index] = text;
        return build(substitute(line, placeholders, values), context2, () => "probe");
    };

    const bindings: StoryCustomCommandBinding[] = [];
    const params: StoryCustomCommandParam[] = [];
    for (const [index, placeholder] of placeholders.entries()) {
        const plan = plans[index];
        const slot = slots[index];
        const found = placeBinding(plan, baseline, text => probe(index, text), textOf);
        if (!found) {
            return { ok: false, problem: { code: "noEffect", name: placeholder.name } };
        }
        for (const entry of found) {
            const map = placeholder.negate && entry.map.kind === "linear" ? { ...entry.map, scale: -entry.map.scale } : entry.map;
            bindings.push({
                param: placeholder.name,
                slot: { name: slot.name, ...(placeholder.negate ? { negate: true as const } : {}) },
                path: entry.path,
                map,
            });
        }
        const source = sourceOf(baseline.commandId, slot.name);
        const known = options.known?.find(param => param.name === placeholder.name) ?? params.find(param => param.name === placeholder.name);
        if (known && !sameKind(known.source, source)) {
            return { ok: false, problem: { code: "mismatch", name: placeholder.name } };
        }
        let defaultArg: StoryCustomCommandArg | undefined;
        if (placeholder.defaultText !== undefined) {
            const withDefault = probe(index, placeholder.defaultText);
            if (isProblem(withDefault)) {
                return { ok: false, problem: withDefault };
            }
            defaultArg = serializeCustomCommandArgs(withDefault.args)[slot.name];
        }
        if (!params.some(param => param.name === placeholder.name)) {
            params.push({
                name: placeholder.name,
                source: known?.source ?? source,
                ...(defaultArg ? { default: defaultArg } : known?.default ? { default: known.default } : {}),
            });
        } else if (defaultArg) {
            const at = params.findIndex(param => param.name === placeholder.name);
            params[at] = { ...params[at], default: defaultArg };
        }
    }
    // The stand-in characters never reach the row: every field they touched is a binding, written
    // over at each call.
    return { ok: true, row: { block: withId(baseline.block, options.rowId), bindings }, params };
}

function withId(block: StoryBlock, rowId: string | undefined): StoryBlock {
    return { ...block, id: rowId ?? block.id, parentId: null, childrenIds: [] } as StoryBlock;
}

/** Where a parameter's type comes from: the built-in slot, seen through any custom command in between. */
function sourceOf(commandId: string, slot: string): StoryCustomCommandParam["source"] {
    if (isCustomCommandSpecId(commandId)) {
        const inner = customCommandOfSpecId(commandId)?.params.find(param => param.name === slot);
        if (inner) {
            return inner.source;
        }
    }
    return { commandId, slot };
}

function sameKind(a: StoryCustomCommandParam["source"], b: StoryCustomCommandParam["source"]): boolean {
    const kindOf = (source: StoryCustomCommandParam["source"]) => {
        const type = getCommandSpec(source.commandId)?.params[source.slot]?.type;
        const branches: readonly StoryCommandParamType[] = !type ? [] : Array.isArray(type) ? type : [type as StoryCommandParamType];
        return branches.map(branch => branch.kind === "target" ? "character" : branch.kind).sort().join("|");
    };
    return (a.commandId === b.commandId && a.slot === b.slot) || kindOf(a) === kindOf(b);
}

type Placement = { path: (string | number)[]; map: StoryCustomCommandBindingMap };

function placeBinding(
    plan: ProbePlan,
    baseline: Built,
    probe: (text: string) => Built | CustomCommandRowProblem,
    textOf: (plan: ProbePlan, which: number) => string,
): Placement[] | null {
    if (plan.kind === "linear") {
        const second = probe(textOf(plan, 1));
        const third = probe(textOf(plan, 2));
        if (isProblem(second) || isProblem(third)) {
            return null;
        }
        const paths = changedPaths(baseline.payload, second.payload);
        if (paths.length === 0) {
            return null;
        }
        const [a, b, c] = plan.values;
        const from = numberPathIn(firstArgValue(baseline, second), a) ?? ["value"];
        const placements: Placement[] = [];
        for (const path of paths) {
            const va = readPath(baseline.payload, path);
            const vb = readPath(second.payload, path);
            const vc = readPath(third.payload, path);
            if (typeof va !== "number" || typeof vb !== "number" || typeof vc !== "number") {
                return null;
            }
            const scale = (vb - va) / (b - a);
            const offset = va - scale * a;
            if (Math.abs(scale * c + offset - vc) > 1e-6 * Math.max(1, Math.abs(vc))) {
                return null;
            }
            placements.push({ path, map: { kind: "linear", from, scale: tidy(scale), offset: tidy(offset) } });
        }
        return placements;
    }
    if (plan.kind === "table") {
        const builds: Built[] = [baseline];
        for (let index = 1; index < plan.texts.length; index += 1) {
            const built = probe(plan.texts[index]);
            if (isProblem(built)) {
                return null;
            }
            builds.push(built);
        }
        const paths = uniquePaths(builds.slice(1).flatMap(built => changedPaths(baseline.payload, built.payload)));
        if (paths.length === 0) {
            return null;
        }
        const argOf = (built: Built) => slotArg(built, baseline);
        const from = argOf(baseline) && isRecordWithValue(argOf(baseline)) ? ["value"] : [];
        return paths.map(path => ({
            path,
            map: {
                kind: "table",
                from,
                entries: builds.map(built => {
                    const value = readPath(built.payload, path);
                    const entry: StoryCustomCommandTableEntry = { match: readPath(argOf(built), from) as StoryPluginActionParamValue };
                    return value === undefined ? { ...entry, absent: true as const } : { ...entry, value: value as StoryPluginActionParamValue };
                }),
            },
        }));
    }
    const second = probe(plan.texts[1]);
    if (isProblem(second)) {
        return null;
    }
    const paths = changedPaths(baseline.payload, second.payload);
    if (paths.length === 0) {
        return null;
    }
    const argA = slotArg(baseline, second);
    const argB = slotArg(second, baseline);
    const placements: Placement[] = [];
    for (const path of paths) {
        const va = readPath(baseline.payload, path);
        const vb = readPath(second.payload, path);
        const from = allPaths(argA).find(candidate => sameJson(readPath(argA, candidate), va) && sameJson(readPath(argB, candidate), vb));
        if (!from) {
            return null;
        }
        placements.push({ path, map: { kind: "pick", from: from.map(String) } });
    }
    return placements;
}

/** The resolved value of the one slot two builds disagree on - the slot being probed. */
function slotArg(built: Built, other: Built): unknown {
    for (const [name, value] of Object.entries(built.args)) {
        if (!sameJson(value, other.args[name])) {
            return value;
        }
    }
    return undefined;
}

function firstArgValue(built: Built, other: Built): unknown {
    return slotArg(built, other);
}

function isRecordWithValue(value: unknown): boolean {
    return typeof value === "object" && value !== null && "value" in value;
}

function numberPathIn(value: unknown, number: number): string[] | null {
    const found = allPaths(value).find(path => readPath(value, path) === number);
    return found ? found.map(String) : null;
}

/** Every path into a JSON value, the value itself first. */
function allPaths(value: unknown, prefix: (string | number)[] = []): (string | number)[][] {
    const paths: (string | number)[][] = [prefix];
    if (Array.isArray(value)) {
        value.forEach((item, index) => paths.push(...allPaths(item, [...prefix, index])));
    } else if (typeof value === "object" && value !== null) {
        for (const [key, item] of Object.entries(value)) {
            paths.push(...allPaths(item, [...prefix, key]));
        }
    }
    return paths;
}

/** The leaf paths at which two JSON values differ. */
export function changedPaths(a: unknown, b: unknown, prefix: (string | number)[] = []): (string | number)[][] {
    const objectA = typeof a === "object" && a !== null;
    const objectB = typeof b === "object" && b !== null;
    if (!objectA || !objectB || Array.isArray(a) !== Array.isArray(b)) {
        return sameJson(a, b) ? [] : [prefix];
    }
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    const out: (string | number)[][] = [];
    for (const key of keys) {
        const part = Array.isArray(a) ? Number(key) : key;
        out.push(...changedPaths((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], [...prefix, part]));
    }
    return out;
}

function uniquePaths(paths: (string | number)[][]): (string | number)[][] {
    const seen = new Set<string>();
    return paths.filter(path => {
        const key = JSON.stringify(path);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function tidy(value: number): number {
    return Number.parseFloat(value.toPrecision(12));
}

/**
 * The line a command row reads as in the editor: the line its row projects to, with each parameter
 * put back where it was written (`x=-<力度>`) in place of the sample value the row was built with.
 *
 * `source` is the row's projected line in canonical form. A slot the line no longer prints - the row
 * was edited out from under its binding - is left as it reads.
 */
export function customCommandRowLine(source: string, bindings: readonly StoryCustomCommandBinding[]): string {
    const parsed = parseCommandLine(source);
    if (parsed.kind !== "command") {
        return source;
    }
    const replacements: { start: number; end: number; text: string }[] = [];
    const seen = new Set<string>();
    for (const binding of bindings) {
        if (seen.has(binding.slot.name)) {
            continue;
        }
        seen.add(binding.slot.name);
        const arg = parsed.args.find(entry => entry.param?.name === binding.slot.name);
        if (!arg) {
            continue;
        }
        replacements.push({ start: arg.valueSpan.start, end: arg.valueSpan.end, text: `${binding.slot.negate ? "-" : ""}<${binding.param}>` });
    }
    let out = source;
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
        out = out.slice(0, replacement.start) + replacement.text + out.slice(replacement.end);
    }
    return out;
}

/**
 * A command's parameters as its rows now use them: in order of first appearance, keeping what each
 * already had (its source slot, its default), and dropping one no row writes any more.
 */
export function customCommandParamsOf(
    rows: readonly StoryCustomCommandRow[],
    previous: readonly StoryCustomCommandParam[],
    fresh: readonly StoryCustomCommandParam[] = [],
): StoryCustomCommandParam[] {
    const params: StoryCustomCommandParam[] = [];
    for (const row of rows) {
        for (const binding of row.bindings) {
            if (params.some(param => param.name === binding.param)) {
                continue;
            }
            const latest = fresh.find(param => param.name === binding.param);
            const kept = previous.find(param => param.name === binding.param);
            const param = kept ? { ...kept, ...(latest?.default ? { default: latest.default } : {}) } : latest;
            if (param) {
                params.push(param);
            }
        }
    }
    return params;
}
