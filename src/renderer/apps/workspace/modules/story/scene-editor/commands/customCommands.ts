import { useSyncExternalStore } from "react";
import { SquareFunction } from "lucide-react";
import type { StoryBlock, StoryCustomCommand, StoryCustomCommandArg, StoryCustomCommandParam } from "@shared/types/story";
import { foldCustomCommandName } from "@shared/story/customCommands";
import { dependsOnParam, type StoryCommandDef, type StoryCommandParam, type StoryCommandParamType } from "../storyCommandGrammar";
import type { StoryCommandResolvedArgs, StoryCommandTargetKind } from "../storyCommandValues";
import type { StoryCommandParamSpec, StoryCommandParamsShape, StoryCommandSpec } from "./spec";
import { getBuiltinCommandSpec, getCommandDef } from "./registry";
import {
    customCommandLayer,
    customCommandSpecId,
    customParamHint,
    replaceCustomCommandLayer,
    subscribeCustomCommandLayer,
} from "./customCommandState";

type AnySpec = StoryCommandSpec<StoryCommandParamsShape>;

/**
 * The commands a custom command's rows may be written with.
 *
 * What a command is for decides it: staging, sound and state - what a writer repeats - and nothing
 * that shapes the flow of the scene. A dialogue line, a branch, a jump or a label inside a command
 * would be a piece of the script nobody can see where it is played; a row that creates a stage
 * object (`/image`, `/text`, `/layer`, `/play`) would declare a name inside the command that the
 * scene around the call then addresses, which is a dependency the call line does not show.
 *
 * Another custom command is allowed: a command made of commands is the point of having them.
 */
export const CUSTOM_COMMAND_BODY_COMMAND_IDS: ReadonlySet<string> = new Set([
    "show",
    "hide",
    "face",
    "motion",
    "skin",
    "param",
    "swap",
    "front",
    "transform",
    "reset",
    "wait",
    "rumble",
    "background",
    "bgm",
    "sound",
    "volume",
    "rate",
    "stop",
    "pause",
    "resume",
    "seek",
    "mute",
    "unmute",
    "vfx",
    "set",
    "inc",
    "dec",
    "toggle",
]);

/**
 * The type a parameter takes: the slot's own, borrowed from the built-in command it was written in.
 *
 * A subject slot is narrowed to characters. The parameter's binding was found by trying characters in
 * it (see `customCommandDefinition`), and a call that handed it a picture would write a picture's
 * fields into rows that were read as a character's.
 */
export function customCommandParamType(param: StoryCustomCommandParam): StoryCommandParamType | readonly StoryCommandParamType[] | null {
    const slot = getBuiltinCommandSpec(param.source.commandId)?.params[param.source.slot];
    if (!slot) {
        return null;
    }
    const branches = Array.isArray(slot.type) ? slot.type : [slot.type as StoryCommandParamType];
    const usable: StoryCommandParamType[] = branches
        .filter(type => dependsOnParam(type) === null)
        .map((type): StoryCommandParamType => (type.kind === "target"
            // The reserved words go too: `camera` and the layers are stage singletons, not characters,
            // and offering them as candidates invited a call the binding cannot play.
            ? { ...type, accepts: type.accepts.filter((kind: StoryCommandTargetKind) => kind === "character"), reserved: [] }
            : type))
        .filter(type => type.kind !== "target" || type.accepts.length > 0);
    if (usable.length === 0) {
        return null;
    }
    return usable.length === 1 ? usable[0] : usable;
}

/** The built-in slot a parameter borrows from, as declared on its command. */
export function customCommandSourceSlot(param: StoryCustomCommandParam): StoryCommandParamSpec | null {
    return getBuiltinCommandSpec(param.source.commandId)?.params[param.source.slot] ?? null;
}

/**
 * One project command as a spec the whole command layer serves: typed as a line, completed, coloured
 * and committed like a built-in, building a call row (`{action:"customCommand"}`).
 *
 * Null when none of it can be served - a parameter whose slot no longer exists in this build.
 */
export function buildCustomCommandSpec(command: StoryCustomCommand): AnySpec | null {
    const params: Record<string, StoryCommandParamSpec> = {};
    const ordered = [...command.params].sort((a, b) => Number(Boolean(customCommandSourceSlot(b)?.positional)) - Number(Boolean(customCommandSourceSlot(a)?.positional)));
    for (const param of ordered) {
        const type = customCommandParamType(param);
        const slot = customCommandSourceSlot(param);
        if (!type || !slot) {
            return null;
        }
        params[param.name] = {
            hint: customParamHint(param.name),
            type,
            ...(slot.positional ? { positional: true } : {}),
            // Required where no default stands in: a call that leaves it out lands as a draft row,
            // the way a built-in's missing core does, instead of a row that would play nothing.
            ...(param.default === undefined ? { core: true } : {}),
        };
    }
    return {
        id: customCommandSpecId(command.id),
        token: foldCustomCommandName(command.name),
        category: "custom",
        icon: SquareFunction,
        params,
        build: (args, ctx) => ({
            id: ctx.generateId(),
            kind: "action",
            parentId: null,
            childrenIds: [],
            payload: { action: "customCommand", commandId: command.id, args: serializeCustomCommandArgs(args as StoryCommandResolvedArgs) },
        }) as StoryBlock,
    };
}

/**
 * What a call stores for its arguments: each value as the line resolved it, as plain JSON - the shape
 * the expansion reads (`@shared/story/customCommands`).
 */
export function serializeCustomCommandArgs(args: StoryCommandResolvedArgs): Record<string, StoryCustomCommandArg> {
    const out: Record<string, StoryCustomCommandArg> = {};
    for (const [name, value] of Object.entries(args)) {
        if (value) {
            out[name] = JSON.parse(JSON.stringify(value)) as StoryCustomCommandArg;
        }
    }
    return out;
}

/**
 * Publish the project's commands to the command layer. A command whose name a built-in command
 * already spells is left out: the built-in would win every line anyway, and the command's page says
 * why (`customCommandNameTakenByBuiltin`).
 */
export function publishCustomStoryCommands(commands: readonly StoryCustomCommand[]): void {
    // Cleared first, so the built-in check below never sees the commands being replaced.
    replaceCustomCommandLayer({ specs: [], defs: [], specById: new Map(), defById: new Map(), defByToken: new Map(), commandBySpecId: new Map() });
    const specs: AnySpec[] = [];
    const defs: StoryCommandDef[] = [];
    const specById = new Map<string, AnySpec>();
    const defById = new Map<string, StoryCommandDef>();
    const defByToken = new Map<string, StoryCommandDef>();
    const commandBySpecId = new Map<string, StoryCustomCommand>();
    for (const command of commands) {
        const token = foldCustomCommandName(command.name);
        if (!token || defByToken.has(token) || customCommandNameTakenByBuiltin(command.name)) {
            continue;
        }
        const spec = buildCustomCommandSpec(command);
        if (!spec) {
            continue;
        }
        const def: StoryCommandDef = {
            token: spec.token,
            commandId: spec.id,
            params: Object.entries(spec.params).map(([name, param]) => ({ name, ...param }) as StoryCommandParam),
        };
        specs.push(spec);
        defs.push(def);
        specById.set(spec.id, spec);
        defById.set(spec.id, def);
        defByToken.set(token, def);
        commandBySpecId.set(spec.id, command);
    }
    replaceCustomCommandLayer({ specs, defs, specById, defById, defByToken, commandBySpecId });
}

/** Whether a built-in command (in the active command language) already answers to this word. */
export function customCommandNameTakenByBuiltin(name: string): boolean {
    const def = getCommandDef(name);
    return Boolean(def && !customCommandLayer().defById.has(def.commandId));
}

/** Re-renders a component whenever the project's command list changes. */
export function useCustomStoryCommandsVersion(): number {
    return useSyncExternalStore(subscribeCustomCommandLayer, () => customCommandLayer().version, () => 0);
}
