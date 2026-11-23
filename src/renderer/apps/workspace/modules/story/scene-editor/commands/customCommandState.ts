import type { StoryCustomCommand } from "@shared/types/story";
import type { StoryCommandDef } from "../storyCommandGrammar";
import type { StoryCommandParamsShape, StoryCommandSpec } from "./spec";

/**
 * The project's own commands, as the registry serves them: one spec per command, beside the built-in
 * ones, so the parser, the completion menu, the manual and the row projection reach them through the
 * calls they already make.
 *
 * Held here, apart from the registry and from the module that builds the specs, so neither has to
 * import the other: the registry reads this, the builder (`customCommands.ts`) reads the registry's
 * built-in half and writes this.
 *
 * Module state rather than React state because the command layer is module state: the parser is a
 * plain function every surface calls. Whoever owns the project's command file (the workspace's
 * `StoryCustomCommandService`) publishes into it; everything that caches against the command list
 * subscribes, and React surfaces re-render through {@link useCustomStoryCommandsVersion}.
 */

type AnySpec = StoryCommandSpec<StoryCommandParamsShape>;

export type CustomCommandLayer = {
    version: number;
    specs: readonly AnySpec[];
    defs: readonly StoryCommandDef[];
    specById: ReadonlyMap<string, AnySpec>;
    defById: ReadonlyMap<string, StoryCommandDef>;
    /** Folded name → def, the parser's pass. */
    defByToken: ReadonlyMap<string, StoryCommandDef>;
    /** Spec id → the command it was built from. */
    commandBySpecId: ReadonlyMap<string, StoryCustomCommand>;
};

const EMPTY: CustomCommandLayer = {
    version: 0,
    specs: [],
    defs: [],
    specById: new Map(),
    defById: new Map(),
    defByToken: new Map(),
    commandBySpecId: new Map(),
};

let layer: CustomCommandLayer = EMPTY;
const listeners = new Set<() => void>();

export function customCommandLayer(): CustomCommandLayer {
    return layer;
}

export function replaceCustomCommandLayer(next: Omit<CustomCommandLayer, "version">): void {
    layer = { ...next, version: layer.version + 1 };
    for (const listener of [...listeners]) {
        listener();
    }
}

export function subscribeCustomCommandLayer(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** The prefix a custom command's spec id carries; the rest is the command's own id. */
export const CUSTOM_COMMAND_SPEC_PREFIX = "custom:";

export function customCommandSpecId(commandId: string): string {
    return `${CUSTOM_COMMAND_SPEC_PREFIX}${commandId}`;
}

export function isCustomCommandSpecId(specId: string): boolean {
    return specId.startsWith(CUSTOM_COMMAND_SPEC_PREFIX);
}

/** The project command a spec id names, or null for a built-in or a command no longer in the project. */
export function customCommandOfSpecId(specId: string): StoryCustomCommand | null {
    return layer.commandBySpecId.get(specId) ?? null;
}

/**
 * A custom parameter's slot hint. A built-in slot is named by a catalog key (`story.paramHint.*`);
 * a parameter the author named has no key, and its name IS the word, in every language.
 */
const CUSTOM_PARAM_HINT_PREFIX = "custom-param:";

export function customParamHint(name: string): string {
    return `${CUSTOM_PARAM_HINT_PREFIX}${name}`;
}

/** The author's own name for a slot, when the hint is a custom parameter's; null for a built-in slot. */
export function customParamNameOfHint(hint: string): string | null {
    return hint.startsWith(CUSTOM_PARAM_HINT_PREFIX) ? hint.slice(CUSTOM_PARAM_HINT_PREFIX.length) : null;
}

/** What a slot hint reads as: the catalog's word for a built-in slot, the parameter's name for a custom one. */
export function paramHintText(hint: string, t: (key: never) => string): string {
    return customParamNameOfHint(hint) ?? t(`story.paramHint.${hint}` as never);
}
