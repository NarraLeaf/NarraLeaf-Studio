/**
 * One saved variable, read by a Game UI screen (`Get Saved Var`, or a value binding reaching it
 * through a Fn).
 *
 * A saved variable belongs to a playthrough, and a screen can ask before there is one: a title screen
 * lays out before any story has started - before any has even been compiled. The answer then is the
 * one every other unwritten variable gives, the value the author declared it with: "not written yet
 * reads the default" is the rule the persistent scope keeps too (`ScopeStoreBridge`). `found` stays
 * false, so a screen that has to tell "no playthrough" from "a playthrough that holds the default" can
 * still do so - the value is simply no longer `null` for a variable declared with something else.
 *
 * Comments in English per project convention.
 */

import type { StoryLiteralValue, StorySavedVariableDefinition } from "@shared/types/story";

/** The part of the running compile this reads: where saved values live, and which ids it declares. */
export type SavedVariableCompile = {
    savedNamespaceName: string;
    savedVariables: Record<string, Pick<StorySavedVariableDefinition, "storageKey" | "defaultValue">>;
};

/** The part of the engine's store this reads. */
export type SavedVariableStorable = {
    hasNamespace(name: string): boolean;
    getNamespace(name: string): { has(key: string): boolean; get(key: string): unknown };
};

export type SavedVariableRead = { value: unknown; found: boolean };

/**
 * Read `variableId` for a screen.
 *
 * - A playthrough that declares it: `found`, with what it holds, or its default until it is written
 *   (`has` rather than a nullish check - a variable holding null, false or 0 is set).
 * - Anything else - no game, a compile that does not declare it (a variable of another story's
 *   `/save` row), a namespace the compile never built: not `found`, and the default the build
 *   declares, from `declaredDefaults` (see `declaredSavedDefaults`). An id nothing declares reads null.
 */
export function readSavedVariableForScreen(input: {
    variableId: string;
    compiled: SavedVariableCompile | null | undefined;
    storable: (() => SavedVariableStorable) | null;
    declaredDefaults: Readonly<Record<string, StoryLiteralValue | null>>;
}): SavedVariableRead {
    const id = String(input.variableId ?? "").trim();
    const notInPlaythrough = (): SavedVariableRead => ({
        value: id ? input.declaredDefaults[id] ?? null : null,
        found: false,
    });
    const compiled = input.compiled;
    const definition = id ? compiled?.savedVariables?.[id] : undefined;
    if (!input.storable || !compiled?.savedNamespaceName || !definition) {
        return notInPlaythrough();
    }
    try {
        const storable = input.storable();
        if (!storable.hasNamespace(compiled.savedNamespaceName)) {
            return notInPlaythrough();
        }
        const namespace = storable.getNamespace(compiled.savedNamespaceName);
        const stored = namespace.has(definition.storageKey)
            ? namespace.get(definition.storageKey)
            : definition.defaultValue ?? null;
        return { value: stored ?? null, found: true };
    } catch {
        return notInPlaythrough();
    }
}

/**
 * A copy of the declared defaults for one build, so a screen reading an object default cannot edit
 * the declaration through it. One copy, not one per read: a value binding compares what it is handed
 * with what it showed, and a fresh object on every read would read as a change every time.
 */
export function copyDeclaredSavedDefaults(
    defaults: Readonly<Record<string, StoryLiteralValue | null>>,
): Record<string, StoryLiteralValue | null> {
    const copy: Record<string, StoryLiteralValue | null> = {};
    for (const [id, value] of Object.entries(defaults)) {
        copy[id] = value !== null && typeof value === "object"
            ? JSON.parse(JSON.stringify(value)) as StoryLiteralValue
            : value;
    }
    return copy;
}
