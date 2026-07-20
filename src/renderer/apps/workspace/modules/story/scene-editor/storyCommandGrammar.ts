import type { StoryCommandTargetKind } from "./storyCommandValues";

/**
 * The grammar vocabulary of the story editor's slash command line: what a param IS, independent of
 * any particular command.
 *
 * A command line is `/<token> [positional…] [key=value…]`. Commands themselves are declared as
 * specs - one `StoryCommandSpec` per command in `commands/specs/`, aggregated by
 * `commands/registry.ts`, which projects each spec onto the {@link StoryCommandDef} shape the pure
 * pipeline layers consume. This file carries only the type system and its helpers; it knows no
 * command names and holds no tables.
 *
 * Split of responsibilities:
 *  - grammar (this file): what param kinds exist and how values match them. Pure data + helpers.
 *  - specs (`commands/specs/*`): per command - params, block building, validation, projection.
 *  - parser (`storyCommandParser.ts`): source text → args + syntax/grammar issues. Pure.
 *  - resolution (`storyCommandResolution.ts`): name → id, and every check needing project state.
 *
 * Labels are deliberately absent. Command display text resolves through `story.command.<id>.label`;
 * the token itself is a keyword and stays English (`/bg` in every locale).
 */

/** An enum value the author may type. `aliases` are accepted on input; completion and storage use the canonical `value` (bible B6). */
export type StoryCommandEnumOption = {
    /** The canonical value - what completion inserts and the payload mapping receives. */
    value: string;
    aliases?: readonly string[];
};

export type StoryCommandParamType =
    | { kind: "asset"; assetType: "image" | "audio" | "video" }
    /**
     * A character. `allowTemp` is the difference between a *speaker* and a *portrait*:
     *  - `/say Zoe …` - a dialogue row may carry a bare `speakerName`, so a name matching no character
     *    is a temp speaker: a valid line (see {@link allowsFreeValue}). → `allowTemp: true`.
     *  - `/face Zoe` - a character action needs a real character to have a portrait. A name matching
     *    nothing has no image and cannot resolve. → no `allowTemp`.
     * Free-typing is therefore a property of the *param*, not of the type.
     */
    | { kind: "character"; allowTemp?: true }
    /**
     * A form/appearance name of an already-resolved character. Candidates depend on another param's
     * resolved value, named by `dependsOn` - the grammar cannot list them because they are per-character.
     * The dependency may resolve to a `character` value or to a `target` value of character type.
     */
    | { kind: "characterForm"; dependsOn: string }
    | { kind: "scene" }
    | { kind: "variable" }
    /**
     * The subject of a generic verb (`/show poster`, `/hide Alice`, `/vol piano`): a character or a
     * named stage object, whichever `accepts` allows. Resolution dispatches on what the name turns
     * out to be - which is what lets one verb serve every object type (bible B3) - and reports
     * `ambiguousName` when a character and an object share the name.
     *
     * A name matching nothing is legal only when exactly one non-character kind is possible (the
     * object may be created dynamically or in another scene); with several kinds possible there is
     * nothing to dispatch on, and the line faults with `unknownTarget`.
     */
    | { kind: "target"; accepts: readonly StoryCommandTargetKind[] }
    /**
     * The new content of a `/swap` - typed by what the *target* resolved to: an image target takes an
     * image asset, a video target a video asset, a text target free text. `dependsOn` names the
     * target param, exactly as {@link characterForm} does.
     */
    | { kind: "content"; dependsOn: string }
    | { kind: "enum"; options: readonly StoryCommandEnumOption[] }
    /** A bare word that means itself, e.g. the `click` in `/wait click`. Used inside unions. */
    | { kind: "keyword"; value: string }
    | { kind: "number"; min?: number; max?: number; integer?: boolean }
    | { kind: "boolean" }
    | { kind: "color" }
    /**
     * Any JSON-ish scalar (`true` / `12` / `hello`). Used where the *expected* type is only knowable
     * after another param resolves - `/set gold 100` can only be type-checked once `gold` resolves to
     * a variable with a declared `valueType`. The parser accepts any scalar; resolution rejects.
     */
    | { kind: "literal" }
    /**
     * A **constant** scalar - a value that must not read anything.
     *
     * Distinct from {@link literal} in what it offers and from {@link expression} in what it accepts.
     * The case it exists for is a declaration's default: `/local hp 100` runs once, before any variable
     * exists, so naming one is meaningless. Its candidates are the only scalars that can be enumerated
     * at all: `true` and `false`.
     */
    | { kind: "constant" }
    /**
     * Free text with no candidates. Two shapes use it: a `greedy` line of prose (`/say`'s text), and a
     * single-token *name the author invents* for a stage object (`/layer overlay`).
     */
    | { kind: "text" }
    /**
     * A computed value: the `gold + 1` in `/set gold gold + 1`, the `score > 90` in `/if score > 90`.
     *
     * Always `greedy` in practice, because an expression contains spaces and `=` and would otherwise
     * be shredded into args. The parse happens in resolution, not here: binding an identifier to a
     * variable needs project state, which the parser must not have.
     */
    | {
          kind: "expression";
          /**
           * The param naming the variable this expression is assigned to, when the command is an
           * assignment. Buys the compound-assignment sugar (`/set gold += 1`) and the type check of
           * the result against that variable's declared `valueType`.
           */
          assignTo?: string;
          /** Reject a non-boolean result. Set on conditions, where `/if gold` almost always means a mistyped comparison. */
          expects?: "boolean";
      };

export type StoryCommandParam = {
    /** The `key` in `key=value`. Positional params still need one - it keys the resolved args and the hint. */
    name: string;
    aliases?: readonly string[];
    /**
     * Key under `story.paramHint.*` naming this slot in the inline ghost hint. Defaults to
     * {@link name}; declared when the name is a terse payload key rather than an author-facing word.
     */
    hint?: string;
    /** An array is a union: the value is valid if any branch accepts it. */
    type: StoryCommandParamType | readonly StoryCommandParamType[];
    /** Positional params are filled in declaration order. Must precede all named params. */
    positional?: boolean;
    /** Consumes the rest of the line verbatim, spaces included. At most one, must be last. */
    greedy?: boolean;
    /**
     * Part of the command's required core (bible B9): Enter commits only when every core param is
     * filled and error-free; otherwise the line lands as a draft row. `/bg` declares its image core,
     * so a bare `/bg` no longer commits an empty block from the command line - the menu path, which
     * builds default blocks for inspector-first filling, is unaffected.
     */
    core?: boolean;
    /**
     * An omissible leading positional (bible B4): when the token strictly matches the NEXT
     * positional's closed value set (a number, an enum word), this slot is skipped rather than
     * consumed. `/vol 0.5` fills the volume, `/vol piano 0.5` fills both.
     */
    skippable?: boolean;
};

export type StoryCommandDef = {
    /** The canonical keyword. English, never translated. */
    token: string;
    /** The owning spec's id - keys `story.command.<id>.*` and the commit dispatch. */
    commandId: string;
    aliases?: readonly string[];
    params: readonly StoryCommandParam[];
};

/** Named-param lookup by name or alias. Positional params are addressable by name too (`/bg image=forest` is legal). */
export function findParam(def: StoryCommandDef, key: string): StoryCommandParam | null {
    const normalized = key.trim().toLowerCase();
    return def.params.find(param => param.name === normalized)
        ?? def.params.find(param => (param.aliases ?? []).includes(normalized))
        ?? null;
}

export function positionalParams(def: StoryCommandDef): readonly StoryCommandParam[] {
    return def.params.filter(param => param.positional);
}

export function namedParams(def: StoryCommandDef): readonly StoryCommandParam[] {
    return def.params.filter(param => !param.positional);
}

/** Normalize `type` to a list, so callers never branch on the union-vs-single shape. */
export function paramTypes(param: StoryCommandParam): readonly StoryCommandParamType[] {
    return Array.isArray(param.type) ? param.type : [param.type as StoryCommandParamType];
}

/** Resolve an author-typed enum value (canonical or alias) to its option. Case-insensitive. */
export function matchEnumOption(type: Extract<StoryCommandParamType, { kind: "enum" }>, raw: string): StoryCommandEnumOption | null {
    const normalized = raw.trim().toLowerCase();
    return type.options.find(option => option.value.toLowerCase() === normalized)
        ?? type.options.find(option => (option.aliases ?? []).some(alias => alias.toLowerCase() === normalized))
        ?? null;
}

/** Whether a param's candidates can only be listed once another param has resolved, and which one. */
export function dependsOnParam(type: StoryCommandParamType): string | null {
    if (type.kind === "characterForm" || type.kind === "content") {
        return type.dependsOn;
    }
    return null;
}

/** Whether a bare-flag token may fill this param: a named boolean (`loop` ≡ `loop=true`, bible B5). */
export function isFlagParam(param: StoryCommandParam): boolean {
    return !param.positional && paramTypes(param).some(type => type.kind === "boolean");
}

/**
 * Whether a value that resolves to nothing is still a legal value for this type.
 *
 * The speaker case comes straight from the interaction model: a dialogue row points at a real
 * `characterId` **or** carries a bare `speakerName`, so a name matching no character is a temp
 * speaker - a valid line, not an error. The speaker picker always offers the typed name back as a
 * candidate for exactly this reason: it deletes "nothing matched" as a state, which is what lets Tab
 * and Enter mean one thing.
 *
 * It is opt-in per param, not blanket for the type: `/face Zoe` has no portrait and must still
 * fail. Everything that must resolve has no such fallback - an unresolvable value there is an error,
 * and it is the resolution layer's to report, since the parser has no project context.
 */
export function allowsFreeValue(type: StoryCommandParamType): boolean {
    switch (type.kind) {
        case "character":
            return type.allowTemp === true;
        case "literal":
        // A constant is whatever scalar the author types; nothing to fail to resolve against.
        case "constant":
        case "text":
            return true;
        // A free-typed name can only stand where exactly one object kind is possible - the object may
        // be created dynamically or in another scene. With several kinds possible there is nothing to
        // dispatch the block type on, so the name must resolve.
        case "target":
            return type.accepts.length === 1 && type.accepts[0] !== "character";
        case "asset":
        case "scene":
        case "variable":
        case "characterForm":
        // Content is typed by its target: an image target's content is an asset that must resolve.
        // Resolution owns the per-target answer; the static answer is the strict one.
        case "content":
        // An expression that does not parse is an error worth reporting against, never a free value
        // silently kept as text - the whole point is that it must resolve to a tree that compiles.
        case "expression":
            return false;
        // Closed value sets the parser already checks; "free value" does not apply.
        case "enum":
        case "keyword":
        case "number":
        case "boolean":
        case "color":
            return false;
    }
}
