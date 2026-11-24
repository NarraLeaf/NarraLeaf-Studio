import type {
    StoryBlock,
    StoryCustomCommandArg,
    StoryDocument,
    StoryPluginActionParamValue,
    StoryScene,
} from "../types/story/document";
import {
    STORY_CUSTOM_COMMAND_SCHEMA_VERSION,
    type StoryCustomCommand,
    type StoryCustomCommandBinding,
    type StoryCustomCommandBindingMap,
    type StoryCustomCommandDocument,
    type StoryCustomCommandParam,
    type StoryCustomCommandRow,
} from "../types/story/customCommands";
import { isRecord } from "@shared/utils/isRecord";

/**
 * The project's own story commands, and how a call to one becomes rows.
 *
 * **A call is expanded, not called.** A row `/左右摇晃 Anyo 力度=10` is replaced, before the compiler
 * and the stage walk see the scene, by the command's rows with the arguments written into them - as
 * if the author had typed those rows there. Nothing at runtime knows a command existed, so a save, a
 * rollback, the play head and "play from this row" all work on rows the engine already understands.
 * The engine has no call stack to put a command on, and a story that played differently from the
 * rows it is made of would be one nobody could reason about.
 *
 * **Stable names.** Each expanded row is named `<call row id>~<command row id>`, so an action a save
 * points at keeps its name for as long as the call and the command row exist - adding a row to the
 * command does not rename the rows already in it. Nested calls extend the chain.
 *
 * **Where it runs.** On the copy of a document that is about to be compiled or walked: the bundle a
 * game runs from (`bundleAssembler`), the editor's preview, the stage timeline. Never on the document
 * the editor holds - a call is one row there, and stays one.
 */

export const STORY_CUSTOM_COMMANDS_DOCUMENT_PATH = "editor/story/commands.json";

/** How deep calls may nest. Past this a call expands to nothing; the lint rule names the loop. */
export const MAX_CUSTOM_COMMAND_DEPTH = 8;

/** The separator in an expanded row's id. Also the one character a command row's own id never holds. */
export const CUSTOM_COMMAND_ROW_SEPARATOR = "~";

export type StoryCustomCommandLibrary = ReadonlyMap<string, StoryCustomCommand>;

export const EMPTY_CUSTOM_COMMAND_LIBRARY: StoryCustomCommandLibrary = new Map();

export function createEmptyStoryCustomCommandDocument(): StoryCustomCommandDocument {
    return { schemaVersion: STORY_CUSTOM_COMMAND_SCHEMA_VERSION, commands: [] };
}

export function customCommandLibrary(commands: readonly StoryCustomCommand[] | null | undefined): StoryCustomCommandLibrary {
    if (!commands || commands.length === 0) {
        return EMPTY_CUSTOM_COMMAND_LIBRARY;
    }
    return new Map(commands.map(command => [command.id, command]));
}

// ---------------------------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------------------------

/**
 * The file, read defensively: a command that cannot be read is dropped on its own rather than taking
 * the list with it, and a row or binding that cannot be read is dropped from its command.
 */
export function normalizeStoryCustomCommandDocument(raw: unknown): StoryCustomCommandDocument {
    const record = isRecord(raw) ? raw : {};
    const commands: StoryCustomCommand[] = [];
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const entry of Array.isArray(record.commands) ? record.commands : []) {
        const command = normalizeCommand(entry);
        if (!command || ids.has(command.id) || names.has(foldCustomCommandName(command.name))) {
            continue;
        }
        ids.add(command.id);
        names.add(foldCustomCommandName(command.name));
        commands.push(command);
    }
    return { schemaVersion: STORY_CUSTOM_COMMAND_SCHEMA_VERSION, commands };
}

function normalizeCommand(raw: unknown): StoryCustomCommand | null {
    if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id || typeof raw.name !== "string" || !raw.name.trim()) {
        return null;
    }
    const params: StoryCustomCommandParam[] = [];
    for (const entry of Array.isArray(raw.params) ? raw.params : []) {
        if (!isRecord(entry) || typeof entry.name !== "string" || !entry.name || !isRecord(entry.source)) {
            continue;
        }
        const { commandId, slot } = entry.source;
        if (typeof commandId !== "string" || typeof slot !== "string" || params.some(param => param.name === entry.name)) {
            continue;
        }
        params.push({
            name: entry.name,
            source: { commandId, slot },
            ...(isArg(entry.default) ? { default: entry.default } : {}),
        });
    }
    const rows: StoryCustomCommandRow[] = [];
    for (const entry of Array.isArray(raw.rows) ? raw.rows : []) {
        if (!isRecord(entry) || !isRecord(entry.block) || typeof entry.block.id !== "string" || entry.block.kind !== "action") {
            continue;
        }
        const block = { ...(entry.block as unknown as StoryBlock), parentId: null, childrenIds: [] } as StoryBlock;
        const bindings = (Array.isArray(entry.bindings) ? entry.bindings : [])
            .filter((binding): binding is StoryCustomCommandBinding => isBinding(binding) && params.some(param => param.name === binding.param));
        rows.push({ block, bindings });
    }
    return {
        id: raw.id,
        name: raw.name.trim(),
        ...(typeof raw.description === "string" && raw.description.trim() ? { description: raw.description.trim() } : {}),
        params,
        rows,
    };
}

function isArg(value: unknown): value is StoryCustomCommandArg {
    return isRecord(value) && typeof value.kind === "string";
}

function isBinding(value: unknown): value is StoryCustomCommandBinding {
    if (!isRecord(value) || typeof value.param !== "string" || !Array.isArray(value.path) || !isRecord(value.slot)) {
        return false;
    }
    if (!value.path.every(part => typeof part === "string" || typeof part === "number")) {
        return false;
    }
    const map = value.map;
    if (!isRecord(map) || !Array.isArray(map.from) || !map.from.every(part => typeof part === "string")) {
        return false;
    }
    if (map.kind === "linear") {
        return typeof map.scale === "number" && Number.isFinite(map.scale) && typeof map.offset === "number" && Number.isFinite(map.offset);
    }
    if (map.kind === "pick") {
        return true;
    }
    return map.kind === "table" && Array.isArray(map.entries);
}

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

/** How names are compared: trimmed and lower-cased, the way the command line folds a typed word. */
export function foldCustomCommandName(name: string): string {
    return name.trim().toLowerCase();
}

/**
 * Why a name cannot be a command's, or null when it can: blank, holds a space or a character the
 * command line reads as something else, or is taken by another command of the project.
 *
 * Whether a BUILT-IN command already spells it is the editor's question (the command vocabulary is
 * the editor's), asked by the same caller.
 */
export function customCommandNameProblem(
    name: string,
    commands: readonly StoryCustomCommand[],
    selfId?: string,
): "empty" | "invalid" | "taken" | null {
    const trimmed = name.trim();
    if (!trimmed) {
        return "empty";
    }
    if (!/^[^\s/@#<>='"~]+$/u.test(trimmed) || /^[0-9.+-]/.test(trimmed)) {
        return "invalid";
    }
    const folded = foldCustomCommandName(trimmed);
    if (commands.some(command => command.id !== selfId && foldCustomCommandName(command.name) === folded)) {
        return "taken";
    }
    return null;
}

/** Same rule for a parameter name: one word the command line can key a value by. */
export function isValidCustomCommandParamName(name: string): boolean {
    return /^[^\s/@#<>='"~]+$/u.test(name) && !/^[0-9.+-]/.test(name);
}

// ---------------------------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------------------------

export type CustomCommandCallProblem =
    | { code: "unknownCommand" }
    | { code: "missingArgs"; params: string[] }
    | { code: "recursion"; commandName: string };

/**
 * What a call is missing to be played, or null when it can be: the command exists, every parameter
 * without a default has a value, and it does not end up calling itself.
 */
export function customCommandCallProblem(
    call: StoryBlock,
    library: StoryCustomCommandLibrary,
): CustomCommandCallProblem | null {
    const payload = callPayload(call);
    if (!payload) {
        return null;
    }
    const command = library.get(payload.commandId);
    if (!command) {
        return { code: "unknownCommand" };
    }
    const missing = command.params
        .filter(param => param.default === undefined && payload.args[param.name] === undefined)
        .map(param => param.name);
    if (missing.length > 0) {
        return { code: "missingArgs", params: missing };
    }
    const loop = findRecursion(command, library, [command.id]);
    return loop ? { code: "recursion", commandName: loop.name } : null;
}

function findRecursion(command: StoryCustomCommand, library: StoryCustomCommandLibrary, stack: string[]): StoryCustomCommand | null {
    if (stack.length > MAX_CUSTOM_COMMAND_DEPTH) {
        return command;
    }
    for (const row of command.rows) {
        const inner = callPayload(row.block);
        if (!inner) {
            continue;
        }
        const next = library.get(inner.commandId);
        if (!next) {
            continue;
        }
        if (stack.includes(next.id)) {
            return next;
        }
        const found = findRecursion(next, library, [...stack, next.id]);
        if (found) {
            return found;
        }
    }
    return null;
}

function callPayload(block: StoryBlock): { commandId: string; args: Record<string, StoryCustomCommandArg> } | null {
    if (block.kind !== "action" || block.payload.action !== "customCommand") {
        return null;
    }
    return { commandId: block.payload.commandId, args: block.payload.args ?? {} };
}

/** Whether this row is a call to a custom command. */
export function isCustomCommandCall(block: StoryBlock | undefined | null): block is Extract<StoryBlock, { kind: "action" }> & {
    payload: { action: "customCommand" };
} {
    return Boolean(block && block.kind === "action" && block.payload.action === "customCommand");
}

/**
 * The rows one call plays, with its arguments written in: the command's rows as they would read had
 * the author typed them here, named under the call (`<call id>~<row id>`).
 *
 * Flat, with nested calls already expanded beneath their own call row - which is how the scene holds
 * them (see {@link expandStoryCustomCommandsInScene}). Empty when the call cannot be played; why is
 * {@link customCommandCallProblem}'s question.
 */
export function expandCustomCommandCall(
    call: StoryBlock,
    library: StoryCustomCommandLibrary,
    stack: readonly string[] = [],
): { childrenIds: string[]; blocks: StoryBlock[] } {
    const payload = callPayload(call);
    const command = payload ? library.get(payload.commandId) : undefined;
    if (!payload || !command || stack.includes(command.id) || stack.length >= MAX_CUSTOM_COMMAND_DEPTH) {
        return { childrenIds: [], blocks: [] };
    }
    const args: Record<string, StoryCustomCommandArg> = {};
    for (const param of command.params) {
        const value = payload.args[param.name] ?? param.default;
        if (value === undefined) {
            return { childrenIds: [], blocks: [] };
        }
        args[param.name] = value;
    }
    const childrenIds: string[] = [];
    const blocks: StoryBlock[] = [];
    for (const row of command.rows) {
        const id = `${call.id}${CUSTOM_COMMAND_ROW_SEPARATOR}${row.block.id}`;
        let payloadCopy = clone(row.block.payload) as Record<string, unknown>;
        for (const binding of row.bindings) {
            const arg = args[binding.param];
            if (arg !== undefined) {
                payloadCopy = applyBinding(payloadCopy, binding, arg);
            }
        }
        const expanded = {
            ...row.block,
            id,
            parentId: call.id,
            childrenIds: [],
            payload: payloadCopy,
            // The call decides whether its rows run: a disabled call never reaches here (the
            // compiler skips its subtree), and a disabled row inside the command is the author
            // switching that row off for every call.
        } as StoryBlock;
        if (isCustomCommandCall(expanded)) {
            const nested = expandCustomCommandCall(expanded, library, [...stack, command.id]);
            expanded.childrenIds = nested.childrenIds;
            blocks.push(expanded, ...nested.blocks);
        } else {
            blocks.push(expanded);
        }
        childrenIds.push(id);
    }
    return { childrenIds, blocks };
}

/**
 * A scene with every call's rows hung beneath it, ready for the compiler and the stage walk: both
 * already compile and walk an action row's children after the row itself, and a call compiles to
 * nothing of its own, so the rows play where the call stands.
 *
 * The same scene object back when it holds no call, so a project that never uses a command pays one
 * pass over its rows.
 */
export function expandStoryCustomCommandsInScene(scene: StoryScene, library: StoryCustomCommandLibrary): StoryScene {
    const calls = Object.values(scene.blocks).filter(block => isCustomCommandCall(block));
    if (calls.length === 0) {
        return scene;
    }
    const blocks: Record<string, StoryBlock> = { ...scene.blocks };
    for (const call of calls) {
        const expanded = expandCustomCommandCall(call, library);
        blocks[call.id] = { ...call, childrenIds: expanded.childrenIds };
        for (const block of expanded.blocks) {
            blocks[block.id] = block;
        }
    }
    return { ...scene, blocks };
}

/** {@link expandStoryCustomCommandsInScene} over every scene of a document. */
export function expandStoryCustomCommandsInDocument(document: StoryDocument, library: StoryCustomCommandLibrary): StoryDocument {
    let changed = false;
    const scenes: StoryDocument["scenes"] = {};
    for (const [sceneId, scene] of Object.entries(document.scenes)) {
        const expanded = expandStoryCustomCommandsInScene(scene, library);
        changed ||= expanded !== scene;
        scenes[sceneId] = expanded;
    }
    return changed ? { ...document, scenes } : document;
}

/** The call row an expanded row belongs to: the part of its id before the first separator. */
export function customCommandCallIdOf(blockId: string): string | null {
    const at = blockId.indexOf(CUSTOM_COMMAND_ROW_SEPARATOR);
    return at > 0 ? blockId.slice(0, at) : null;
}

// ---------------------------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------------------------

/** The value a binding writes for one argument, or `undefined` when the argument does not fit it. */
export function bindingValue(map: StoryCustomCommandBindingMap, arg: StoryCustomCommandArg): { value?: unknown; absent?: true } | undefined {
    const source = readPath(arg, map.from);
    if (map.kind === "linear") {
        if (typeof source !== "number" || !Number.isFinite(source)) {
            return undefined;
        }
        return { value: roundFloat(map.scale * source + map.offset) };
    }
    if (map.kind === "pick") {
        return source === undefined ? undefined : { value: clone(source) };
    }
    const entry = map.entries.find(candidate => sameJson(candidate.match, source as StoryPluginActionParamValue));
    if (!entry) {
        return undefined;
    }
    return entry.absent ? { absent: true } : { value: clone(entry.value) };
}

function applyBinding(payload: Record<string, unknown>, binding: StoryCustomCommandBinding, arg: StoryCustomCommandArg): Record<string, unknown> {
    const written = bindingValue(binding.map, arg);
    if (!written || binding.path.length === 0) {
        return payload;
    }
    return writePath(payload, binding.path, written) as Record<string, unknown>;
}

function writePath(target: unknown, path: readonly (string | number)[], written: { value?: unknown; absent?: true }): unknown {
    const [head, ...rest] = path;
    const container: Record<string | number, unknown> = Array.isArray(target)
        ? [...target] as unknown as Record<number, unknown>
        : isRecord(target) ? { ...target } : (typeof head === "number" ? [] as unknown as Record<number, unknown> : {});
    if (rest.length === 0) {
        if (written.absent) {
            delete container[head];
        } else {
            container[head] = written.value;
        }
        return container;
    }
    container[head] = writePath(container[head], rest, written);
    return container;
}

export function readPath(value: unknown, path: readonly (string | number)[]): unknown {
    let current = value;
    for (const part of path) {
        if (Array.isArray(current) && typeof part === "number") {
            current = current[part];
        } else if (isRecord(current)) {
            current = current[part as string];
        } else {
            return undefined;
        }
    }
    return current;
}

/** Float noise from `scale × value` (`0.1 × 3`) kept off the row: twelve significant digits. */
function roundFloat(value: number): number {
    return Number.parseFloat(value.toPrecision(12));
}

function clone<T>(value: T): T {
    return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

export function sameJson(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}
