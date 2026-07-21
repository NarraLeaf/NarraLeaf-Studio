import type { StoryCommandDef, StoryCommandParam } from "../storyCommandGrammar";
import type { StoryCommandParamsShape, StoryCommandSpec } from "./spec";
import { SCENE_COMMANDS } from "./specs/scene";
import { CHARACTER_COMMANDS } from "./specs/character";
import { OBJECT_COMMANDS } from "./specs/objects";
import { SOUND_COMMANDS } from "./specs/sound";
import { VARIABLE_COMMANDS } from "./specs/variables";
import { LOGIC_COMMANDS } from "./specs/logic";
import { EFFECT_COMMANDS } from "./specs/effects";
import { MISC_COMMANDS } from "./specs/misc";

/**
 * The command registry: every spec, aggregated, indexed, and projected onto the grammar shape the
 * pure pipeline layers consume.
 *
 * This replaces both halves of the old dual system - the P0 grammar table and the paramless
 * palette fall-through. Every command the line resolves is a spec here, and every commit runs the
 * same path; there is no second behaviour hiding behind `params.length === 0`.
 */

/** Erased spec - what the registry hands out. `build`/`validate` are called through the erased shape. */
export type AnyStoryCommandSpec = StoryCommandSpec<StoryCommandParamsShape>;

const ALL_SPECS: readonly AnyStoryCommandSpec[] = [
    ...SCENE_COMMANDS,
    ...CHARACTER_COMMANDS,
    ...OBJECT_COMMANDS,
    ...SOUND_COMMANDS,
    ...VARIABLE_COMMANDS,
    ...LOGIC_COMMANDS,
    ...EFFECT_COMMANDS,
    ...MISC_COMMANDS,
] as readonly AnyStoryCommandSpec[];

/** Project a spec's ordered params record onto the grammar's array shape (record key → param name). */
function specParams(spec: AnyStoryCommandSpec): readonly StoryCommandParam[] {
    return Object.entries(spec.params).map(([name, param]) => ({ name, ...param }));
}

function specToDef(spec: AnyStoryCommandSpec): StoryCommandDef {
    return {
        token: spec.token,
        commandId: spec.id,
        aliases: spec.aliases,
        params: specParams(spec),
    };
}

const DEFS: readonly StoryCommandDef[] = ALL_SPECS.map(specToDef);
const SPEC_BY_ID = new Map<string, AnyStoryCommandSpec>(ALL_SPECS.map(spec => [spec.id, spec]));
const DEF_BY_ID = new Map<string, StoryCommandDef>(DEFS.map(def => [def.commandId, def]));

// Duplicate ids or tokens are authoring mistakes worth failing loudly on, at import time.
if (SPEC_BY_ID.size !== ALL_SPECS.length) {
    throw new Error("Duplicate story command spec id.");
}
{
    const tokens = new Set<string>();
    for (const spec of ALL_SPECS) {
        for (const token of [spec.token, ...(spec.aliases ?? [])]) {
            if (tokens.has(token)) {
                throw new Error(`Duplicate story command token or alias: "${token}".`);
            }
            tokens.add(token);
        }
    }
}

export function listCommandSpecs(): readonly AnyStoryCommandSpec[] {
    return ALL_SPECS;
}

export function listCommandDefs(): readonly StoryCommandDef[] {
    return DEFS;
}

export function getCommandSpec(id: string): AnyStoryCommandSpec | null {
    return SPEC_BY_ID.get(id) ?? null;
}

export function getDefById(id: string): StoryCommandDef | null {
    return DEF_BY_ID.get(id) ?? null;
}

/** Resolve a typed token to its command def: canonical token, then alias, then the spec id. */
export function getCommandDef(token: string): StoryCommandDef | null {
    const normalized = token.trim().toLowerCase();
    if (!normalized) {
        return null;
    }
    return DEFS.find(def => def.token === normalized)
        ?? DEFS.find(def => (def.aliases ?? []).includes(normalized))
        ?? DEFS.find(def => def.commandId.toLowerCase() === normalized)
        ?? null;
}
