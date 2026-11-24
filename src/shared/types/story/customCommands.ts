import type { StoryBlock, StoryCustomCommandArg, StoryPluginActionParamValue } from "./document";

/**
 * The project's own story commands: a few rows written once, named, and played wherever a row calls
 * them (`/左右摇晃 Anyo 力度=10`).
 *
 * Kept in one project file, `editor/story/commands.json`, rather than in a story document, because a
 * command belongs to the project: every story calls the same `/左右摇晃`, and it travels with the
 * repository like the transform presets do.
 *
 * Schema 1. The file is versioned on its own, apart from the story document, because the two change
 * for different reasons.
 */
export const STORY_CUSTOM_COMMAND_SCHEMA_VERSION = 1 as const;

export type StoryCustomCommandDocument = {
    schemaVersion: typeof STORY_CUSTOM_COMMAND_SCHEMA_VERSION;
    commands: StoryCustomCommand[];
};

export type StoryCustomCommand = {
    /** Identity. A call stores this, so renaming the command keeps every call on it. */
    id: string;
    /** What the author types after the trigger, and what every call prints. Unique in the project. */
    name: string;
    description?: string;
    /** In the order a call fills them: the ones written in a subject slot first, as the line reads. */
    params: StoryCustomCommandParam[];
    rows: StoryCustomCommandRow[];
};

export type StoryCustomCommandParam = {
    /** The word inside the angle brackets, and the key a call writes it under (`力度=10`). */
    name: string;
    /**
     * The built-in command and slot the placeholder was first written in. The parameter takes that
     * slot's type - a number with its unit and range, a character, an option list - so a call gets
     * the same completion, the same checks and the same click-to-edit as the slot itself, and nothing
     * about the type has to be declared or kept in step by hand.
     */
    source: { commandId: string; slot: string };
    /** Used when a call leaves the parameter out. Absent makes the parameter required. */
    default?: StoryCustomCommandArg;
};

/**
 * One row of a command: an ordinary story row, built from the line the author typed with each
 * placeholder standing at a sample value, plus where each parameter lands in it.
 */
export type StoryCustomCommandRow = {
    block: StoryBlock;
    bindings: StoryCustomCommandBinding[];
};

/**
 * Where one parameter lands in one row, and how the value a call passes becomes what the row holds
 * there.
 *
 * Found by building the row twice with two different sample values and reading which fields moved
 * (see the editor's `customCommandDefinition`), so it needs no table of which command keeps which
 * field where: `x=-<力度>` lands on the transform's x, negated; `d=<时长>` lands on a duration in
 * milliseconds, scaled by a thousand.
 */
export type StoryCustomCommandBinding = {
    param: string;
    /**
     * The slot the placeholder was written in and whether it was negated - what the line prints back
     * in the editor. Not read by the expansion.
     */
    slot: { name: string; negate?: true };
    /** Into the row's payload. */
    path: (string | number)[];
    map: StoryCustomCommandBindingMap;
};

export type StoryCustomCommandBindingMap =
    /** A number: `scale × value + offset`, read off the argument at `from`. */
    | { kind: "linear"; from: string[]; scale: number; offset: number }
    /** Copied from the argument at `from`: a character id, a text. */
    | { kind: "pick"; from: string[] }
    /**
     * A closed set of values (an option, a switch): what each one writes, matched on the argument at
     * `from`. An entry with `absent` removes the field.
     */
    | { kind: "table"; from: string[]; entries: StoryCustomCommandTableEntry[] };

export type StoryCustomCommandTableEntry = {
    match: StoryPluginActionParamValue;
    value?: StoryPluginActionParamValue;
    absent?: true;
};
