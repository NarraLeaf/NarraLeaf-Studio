import type { StoryDisplayableTargetKind } from "@shared/types/story";
import { ACTION_COMMANDS, type ActionCommandId } from "./storyActionCommands";

/**
 * Declarative grammar for the story editor's slash command line.
 *
 * A command line is `/<token> [positional…] [key=value…]`. The grammar declares, per command, what
 * may appear and of what type; it does NOT know how to write a `StoryBlock` (that is `applyArgs`,
 * which stays hand-written per command — the payload union is too heterogeneous to derive) and it
 * does NOT resolve names to ids (that needs project context — see "resolution" below).
 *
 * Split of responsibilities:
 *  - grammar (this file): what params exist, in what order, of what type. Pure data.
 *  - parser (`storyCommandParser.ts`): source text → args + syntax/grammar issues. Pure.
 *  - resolution (not yet written): name → id, and the context-dependent checks the parser cannot do
 *    (does this asset exist? does `value` match the variable's declared type?).
 *
 * Labels are deliberately absent. Command display text already resolves through
 * `story.actionCommand.<id>.label` (see `translateActionCommandLabel`), so a Chinese author typing
 * `/背景` matches on the translated label without the grammar carrying any locale data. The token
 * itself is a keyword and stays English (`/bg` in every locale).
 */

/** An enum value the author may type. `aliases` exist because the payload's own values are often unusable as input (`fadeIn` reads better as `fade`, `maskCircle` is unusable as-is). */
export type StoryCommandEnumOption = {
    /** The value written to the payload. */
    value: string;
    aliases?: readonly string[];
};

export type StoryCommandParamType =
    | { kind: "asset"; assetType: "image" | "audio" | "video" }
    /**
     * A character. `allowTemp` is the difference between a *speaker* and a *portrait*:
     *  - `/say Zoe …` — a dialogue row may carry a bare `speakerName`, so a name matching no character
     *    is a temp speaker: a valid line (see {@link allowsFreeValue}). → `allowTemp: true`.
     *  - `/show Zoe` — a character action needs a real character to have a portrait to show. A name
     *    matching nothing has no image and cannot resolve. → no `allowTemp`.
     * Free-typing is therefore a property of the *param*, not of the type.
     */
    | { kind: "character"; allowTemp?: true }
    /**
     * A form/appearance name of an already-resolved character. Candidates depend on another param's
     * resolved value, named by `dependsOn` — the grammar cannot list them because they are per-character.
     */
    | { kind: "characterForm"; dependsOn: string }
    | { kind: "scene" }
    | { kind: "variable" }
    | { kind: "displayable"; targetKind?: StoryDisplayableTargetKind }
    | { kind: "enum"; options: readonly StoryCommandEnumOption[] }
    /** A bare word that means itself, e.g. the `click` in `/wait click`. Used inside unions. */
    | { kind: "keyword"; value: string }
    | { kind: "number"; min?: number; max?: number; integer?: boolean }
    | { kind: "boolean" }
    | { kind: "color" }
    /**
     * Any JSON-ish scalar (`true` / `12` / `hello`). Used where the *expected* type is only knowable
     * after another param resolves — `/set gold 100` can only be type-checked once `gold` resolves to
     * a variable with a declared `valueType`. The parser accepts any scalar; resolution rejects.
     */
    | { kind: "literal" }
    /** Free text with no candidates. Only meaningful on a `greedy` param. */
    | { kind: "text" };

export type StoryCommandParam = {
    /** The `key` in `key=value`. Positional params still need one — it keys `applyArgs` and the hint. */
    name: string;
    aliases?: readonly string[];
    /** An array is a union: the value is valid if any branch accepts it. */
    type: StoryCommandParamType | readonly StoryCommandParamType[];
    /** Positional params are filled in declaration order. Must precede all named params. */
    positional?: boolean;
    /** Consumes the rest of the line verbatim, spaces included. At most one, must be last. */
    greedy?: boolean;
    /**
     * Blocks submission while unfilled. No built-in P0 command sets this: `createBlockForCommand`
     * already yields a valid-but-unfilled block for every command, and "commit an unfilled block" is
     * the existing palette contract we must not regress. Kept for plugin-declared params.
     */
    required?: boolean;
};

export type StoryCommandDef = {
    /** The canonical keyword. English, never translated. */
    token: string;
    /** The palette command this line builds. Not 1:1 with `token` in general — `/wait` covers both `waitDuration` and `waitClick` via its `mode` payload field. */
    commandId: ActionCommandId;
    aliases?: readonly string[];
    params: readonly StoryCommandParam[];
};

const TRANSITIONS: readonly StoryCommandEnumOption[] = [
    { value: "fadeIn", aliases: ["fade"] },
    { value: "dissolve" },
    { value: "slide" },
    { value: "blinds" },
    { value: "softWipe", aliases: ["wipe"] },
    { value: "maskCircle", aliases: ["circle"] },
    { value: "maskWipe" },
    { value: "softIris", aliases: ["iris"] },
    { value: "blurDissolve", aliases: ["blur"] },
    { value: "throughColor", aliases: ["black"] },
    { value: "darkness" },
    { value: "none" },
];

/** The placement presets. The other `StoryTransformPreset` members are effects, not placements, and belong to the inspector. */
const PLACEMENTS: readonly StoryCommandEnumOption[] = [
    { value: "left" },
    { value: "center" },
    { value: "right" },
];

/** A character that must have a portrait — show / hide / move. A bare name cannot resolve here. */
const CHARACTER: StoryCommandParam = { name: "character", type: { kind: "character" }, positional: true };
/** The speaker of a dialogue row, where a bare name is a temp speaker rather than an error. */
const SPEAKER: StoryCommandParam = { name: "character", type: { kind: "character", allowTemp: true }, positional: true };
const DURATION: StoryCommandParam = { name: "d", aliases: ["duration"], type: { kind: "number", min: 0 } };
const TRANSITION: StoryCommandParam = { name: "t", aliases: ["transition"], type: { kind: "enum", options: TRANSITIONS } };
const PLACEMENT: StoryCommandParam = { name: "at", aliases: ["pos"], type: { kind: "enum", options: PLACEMENTS } };

/**
 * P0 covers the ten commands that carry most lines. They were chosen to stress the grammar, not to
 * be easy: `set` forces a param whose type depends on another param's resolution, and `say` forces
 * greedy text. See the plan doc's §6.
 */
export const STORY_COMMANDS: readonly StoryCommandDef[] = [
    {
        token: "bg",
        commandId: "background",
        aliases: ["background", "scene"],
        params: [
            { name: "image", type: [{ kind: "asset", assetType: "image" }, { kind: "color" }], positional: true },
            TRANSITION,
            DURATION,
        ],
    },
    {
        token: "show",
        commandId: "characterEnter",
        aliases: ["enter"],
        params: [
            CHARACTER,
            { name: "form", type: { kind: "characterForm", dependsOn: "character" } },
            PLACEMENT,
            TRANSITION,
            DURATION,
        ],
    },
    {
        token: "hide",
        commandId: "characterExit",
        aliases: ["exit"],
        params: [CHARACTER, TRANSITION, DURATION],
    },
    {
        token: "move",
        commandId: "characterMove",
        params: [CHARACTER, PLACEMENT, DURATION],
    },
    {
        token: "say",
        commandId: "dialogue",
        params: [
            SPEAKER,
            { name: "text", type: { kind: "text" }, positional: true, greedy: true },
        ],
    },
    {
        token: "wait",
        commandId: "waitDuration",
        params: [
            { name: "ms", type: [{ kind: "keyword", value: "click" }, { kind: "number", min: 0 }], positional: true },
        ],
    },
    {
        token: "bgm",
        commandId: "bgm",
        params: [
            { name: "audio", type: { kind: "asset", assetType: "audio" }, positional: true },
            { name: "fade", type: { kind: "number", min: 0 } },
            { name: "loop", type: { kind: "boolean" } },
        ],
    },
    {
        token: "sound",
        commandId: "sound",
        aliases: ["se"],
        params: [
            { name: "audio", type: { kind: "asset", assetType: "audio" }, positional: true },
            { name: "vol", aliases: ["volume"], type: { kind: "number", min: 0, max: 1 } },
            { name: "loop", type: { kind: "boolean" } },
        ],
    },
    {
        token: "jump",
        commandId: "jump",
        params: [
            { name: "scene", type: { kind: "scene" }, positional: true },
            TRANSITION,
            DURATION,
        ],
    },
    {
        token: "set",
        commandId: "setVariable",
        params: [
            { name: "variable", type: { kind: "variable" }, positional: true },
            { name: "value", type: { kind: "literal" }, positional: true },
        ],
    },
];

const GRAMMAR_COMMAND_IDS = new Set<ActionCommandId>(STORY_COMMANDS.map(def => def.commandId));

/**
 * The commands the palette knows but P0 gave no grammar to.
 *
 * They exist here so the command line is never *less* capable than the seam it replaces: typing
 * `/imageCreate` or `//` resolved before and must still resolve. With no params they take no args and
 * commit exactly as picking them from the menu does — see `commitCommandFromInsert`, which routes a
 * paramless command down the old path so its inspector-first behaviour survives until P1 gives it a
 * grammar.
 *
 * Palette aliases carry a leading slash (`//`), which the parser has already consumed by the time a
 * token reaches {@link getCommandDef}, so they are stored stripped: note's `//` is the token `/`.
 */
const PALETTE_COMMANDS: readonly StoryCommandDef[] = ACTION_COMMANDS
    .filter(command => !GRAMMAR_COMMAND_IDS.has(command.id))
    .map(command => ({
        token: command.id.toLowerCase(),
        commandId: command.id,
        aliases: (command.aliases ?? []).map(alias => alias.replace(/^\//, "").toLowerCase()),
        params: [],
    }));

/** Every command the line can resolve: the P0 grammar first, then the paramless remainder. */
export const ALL_STORY_COMMANDS: readonly StoryCommandDef[] = [...STORY_COMMANDS, ...PALETTE_COMMANDS];

export function listCommandDefs(): readonly StoryCommandDef[] {
    return ALL_STORY_COMMANDS;
}

/**
 * Resolve a typed token to its command: canonical token, then alias, then the raw `ActionCommandId`.
 *
 * The id fallback is what keeps `/characterEnter` working now that its short token is `/show` — the
 * old seam matched ids, and nothing the author already types may stop resolving.
 */
export function getCommandDef(token: string): StoryCommandDef | null {
    const normalized = token.trim().toLowerCase();
    if (!normalized) {
        return null;
    }
    return ALL_STORY_COMMANDS.find(def => def.token === normalized)
        ?? ALL_STORY_COMMANDS.find(def => (def.aliases ?? []).includes(normalized))
        ?? ALL_STORY_COMMANDS.find(def => def.commandId.toLowerCase() === normalized)
        ?? null;
}

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

/** Whether a param's candidates can only be listed once another param has resolved. */
export function dependsOnParam(type: StoryCommandParamType): string | null {
    return type.kind === "characterForm" ? type.dependsOn : null;
}

/**
 * Whether a value that resolves to nothing is still a legal value for this type.
 *
 * The speaker case comes straight from the interaction model: a dialogue row points at a real
 * `characterId` **or** carries a bare `speakerName`, so a name matching no character is a temp
 * speaker — a valid line, not an error. The speaker picker always offers the typed name back as a
 * candidate for exactly this reason: it deletes "nothing matched" as a state, which is what lets Tab
 * and Enter mean one thing. `{ kind: "character", allowTemp: true }` inherits that.
 *
 * It is opt-in per param, not blanket for the type: `/show Zoe` has no portrait to show and must
 * still fail. Everything that must resolve (asset / scene / variable / displayable, and a plain
 * `character`) has no such fallback — an unresolvable value there is an error, and it is the
 * resolution layer's to report, since the parser has no project context.
 */
export function allowsFreeValue(type: StoryCommandParamType): boolean {
    switch (type.kind) {
        case "character":
            return type.allowTemp === true;
        case "literal":
        case "text":
            return true;
        case "asset":
        case "scene":
        case "variable":
        case "displayable":
        case "characterForm":
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
