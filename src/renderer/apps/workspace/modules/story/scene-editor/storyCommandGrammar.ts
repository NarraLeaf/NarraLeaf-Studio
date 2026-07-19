import type { StoryDisplayableTargetKind, StoryVariableScope } from "@shared/types/story";
import { ACTION_COMMANDS, type ActionCommandId } from "./storyActionCommands";

/**
 * Declarative grammar for the story editor's slash command line.
 *
 * A command line is `/<token> [positional…] [key=value…]`. The grammar declares, per command, what
 * may appear and of what type; it does NOT know how to write a `StoryBlock` (that is `applyArgs`,
 * which stays hand-written per command - the payload union is too heterogeneous to derive) and it
 * does NOT resolve names to ids (that needs project context - see "resolution" below).
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
     *  - `/say Zoe …` - a dialogue row may carry a bare `speakerName`, so a name matching no character
     *    is a temp speaker: a valid line (see {@link allowsFreeValue}). → `allowTemp: true`.
     *  - `/show Zoe` - a character action needs a real character to have a portrait to show. A name
     *    matching nothing has no image and cannot resolve. → no `allowTemp`.
     * Free-typing is therefore a property of the *param*, not of the type.
     */
    | { kind: "character"; allowTemp?: true }
    /**
     * A form/appearance name of an already-resolved character. Candidates depend on another param's
     * resolved value, named by `dependsOn` - the grammar cannot list them because they are per-character.
     */
    | { kind: "characterForm"; dependsOn: string }
    | { kind: "scene" }
    | { kind: "variable" }
    | { kind: "displayable"; targetKind?: StoryDisplayableTargetKind }
    /**
     * A named stage object already put on stage by an earlier block - the image `/imgshow` reveals,
     * the text `/settext` rewrites, the sound `/stop` stops.
     *
     * This is what makes a reference feel like `/bg`'s asset picker rather than a blind name field:
     * the candidates are the object names *in scope*, read from `listSceneDisplayableTargets` - the
     * same collector the inspector's target picker uses, so the two can never disagree. It differs
     * from `displayable` (which the four transform/effect ops need) in what the payload stores: these
     * commands address the object by its plain `objectName` string, not a resolved `DisplayableTargetRef`,
     * so no scene-graph *binding* is required - only the list of names.
     *
     * A free-typed name stays valid ({@link allowsFreeValue}): the object may be created dynamically or
     * live in another scene, and - as with speakers - offering the typed name back keeps the list from
     * ever being empty, which is what lets Tab and Enter mean one thing.
     */
    | { kind: "stageObject"; objectKind: "image" | "text" | "layer" | "video" | "audio" }
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
     * Free text with no candidates. Two shapes use it: a `greedy` line of prose (`/say`'s text), and a
     * single-token *name the author invents* for a stage object (`/image hero …`). The latter cannot
     * offer candidates yet - the names of already-created objects live in the scene graph, which is the
     * displayable-candidate work P0 deferred - so an object name is free-typed exactly like `set`'s
     * `literal` value, which has no candidate source either and has shipped since P0.
     */
    | { kind: "text" }
    /**
     * A computed value: the `gold + 1` in `/set gold gold + 1`, the `score > 90` in `/if score > 90`.
     *
     * Always `greedy` in practice, because an expression contains spaces and `=` and would otherwise
     * be shredded into args - `/set gold gold + 1` must reach the resolver as one string, exactly as
     * `/say`'s prose does. That is also why an expression param can carry no `key=value` modifiers
     * after it, and why anything optional on such a command must be declared before it.
     *
     * The parse happens in resolution, not here: binding an identifier to a variable needs project
     * state, which the parser must not have. So the grammar declares only *that* this slot is an
     * expression, and what it may be assigned to.
     */
    | {
          kind: "expression";
          /**
           * The param naming the variable this expression is assigned to, when the command is an
           * assignment. Buys two things: the compound-assignment sugar (`/set gold += 1` desugars to
           * `gold + 1`, which needs to know what "gold" is), and the type check of the result against
           * that variable's declared `valueType`.
           */
          assignTo?: string;
          /** Reject a non-boolean result. Set on conditions, where `/if gold` almost always means a mistyped comparison. */
          expects?: "boolean";
      };

export type StoryCommandParam = {
    /** The `key` in `key=value`. Positional params still need one - it keys `applyArgs` and the hint. */
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
    /** The palette command this line builds. Not 1:1 with `token` in general - `/wait` covers both `waitDuration` and `waitClick` via its `mode` payload field. */
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

/** A character that must have a portrait - show / hide / move. A bare name cannot resolve here. */
const CHARACTER: StoryCommandParam = { name: "character", type: { kind: "character" }, positional: true };
/** The speaker of a dialogue row, where a bare name is a temp speaker rather than an error. */
const SPEAKER: StoryCommandParam = { name: "character", type: { kind: "character", allowTemp: true }, positional: true };
const DURATION: StoryCommandParam = { name: "d", aliases: ["duration"], type: { kind: "number", min: 0 } };
const TRANSITION: StoryCommandParam = { name: "t", aliases: ["transition"], type: { kind: "enum", options: TRANSITIONS } };
const PLACEMENT: StoryCommandParam = { name: "at", aliases: ["pos"], type: { kind: "enum", options: PLACEMENTS } };

/**
 * A brand-new object name the author *invents* on a `create` - free text, no candidates, because it
 * does not exist yet. Kept positional only where the name *is* the object's identity and there is
 * nothing to derive it from (a `/layer`). Image / video / text lead with their asset or content and
 * take the name as {@link NAME_OPTION} instead, so the common line never asks for a name at all.
 */
const OBJECT_NAME: StoryCommandParam = { name: "name", type: { kind: "text" }, positional: true };
const IMAGE_ASSET: StoryCommandParam = { name: "image", aliases: ["src"], type: { kind: "asset", assetType: "image" }, positional: true };
const VIDEO_ASSET: StoryCommandParam = { name: "video", aliases: ["src"], type: { kind: "asset", assetType: "video" }, positional: true };
const OBJECT_CONTENT: StoryCommandParam = { name: "content", type: { kind: "text" }, positional: true, greedy: true };
/**
 * The optional handle for a created object. Named, not positional, so the asset/content leads the line
 * like `/bg` does. Left off, the resolver auto-derives the name from the asset filename (or a deduped
 * default), so `/image forest.png` lands an image called `forest` without the author naming it - see
 * the auto-name pass in `storyCommandResolution`.
 */
const NAME_OPTION: StoryCommandParam = { name: "name", type: { kind: "text" } };

/** A reference to an object already on stage - the picker the `show`/`hide`/`set` commands lead with. */
const imageRef = (positional: boolean): StoryCommandParam => ({ name: "name", type: { kind: "stageObject", objectKind: "image" }, ...(positional ? { positional: true } : {}) });
const textRef = (positional: boolean): StoryCommandParam => ({ name: "name", type: { kind: "stageObject", objectKind: "text" }, ...(positional ? { positional: true } : {}) });
const videoRef = (positional: boolean): StoryCommandParam => ({ name: "name", type: { kind: "stageObject", objectKind: "video" }, ...(positional ? { positional: true } : {}) });
const audioRef = (positional: boolean): StoryCommandParam => ({ name: "name", type: { kind: "stageObject", objectKind: "audio" }, ...(positional ? { positional: true } : {}) });

/** The declarable value types, in the order the author is most likely to want them. */
const VARIABLE_VALUE_TYPES: readonly StoryCommandEnumOption[] = [
    { value: "boolean", aliases: ["bool", "flag"] },
    { value: "number", aliases: ["num", "int"] },
    { value: "string", aliases: ["str", "text"] },
    { value: "json", aliases: ["object", "list"] },
];

/**
 * The params every `/local` `/var` `/persis` line takes - identical across all three, because the
 * only thing that differs between them is the scope, and the scope is the command name.
 *
 * `default` is an expression rather than a literal so it parses through one path with everything
 * else, but resolution requires it to fold to a constant: a declaration is evaluated once, before any
 * variable exists to read, so an expression naming one has nothing to name.
 *
 * Deliberately **not** greedy, unlike the expression on `/set`. A greedy param claims the rest of the
 * line, which would swallow the `type=` in `/local hp 100 type=number` - and that ordering is the one
 * an author will write. A default is a constant, so it fits in one token; a string default with
 * spaces quotes like any other value.
 */
function declarationParams(): readonly StoryCommandParam[] {
    return [
        { name: "name", type: { kind: "text" }, positional: true },
        { name: "default", aliases: ["value"], type: { kind: "expression" }, positional: true },
        { name: "type", aliases: ["as"], type: { kind: "enum", options: VARIABLE_VALUE_TYPES } },
        { name: "desc", aliases: ["note"], type: { kind: "text" } },
    ];
}

/**
 * The commands that declare a variable instead of inserting a row, and the scope each declares into.
 *
 * These are the only members of the command set with no block to build: committing one mutates the
 * document's variable declarations and leaves the scene exactly as it was. The commit path branches
 * on this map rather than on a list of ids, so adding a fourth scope (there is no fourth scope) would
 * be one entry.
 */
export const STORY_DECLARATION_COMMANDS: Readonly<Record<string, StoryVariableScope>> = {
    declareSceneVariable: "scene",
    declareSavedVariable: "saved",
    declarePersistentVariable: "persistent",
};

/** The character form/appearance, whose candidates only exist once the `character` positional resolves. */
const FORM: StoryCommandParam = { name: "form", type: { kind: "characterForm", dependsOn: "character" }, positional: true };

/**
 * The reveal animation of a `show`/`hide` - a `StoryTransformRef` preset the object animates *in* or
 * *out* with. The author picks it as `t=`, so it reads like `/bg`'s `t=` even though the payload folds
 * it into `transform.preset`, not a `StoryTransitionRef` (images/texts have no separate transition).
 */
const REVEALS: readonly StoryCommandEnumOption[] = [
    { value: "fadeIn", aliases: ["fade"] },
    { value: "fadeOut" },
    { value: "slideLeft", aliases: ["slideL"] },
    { value: "slideRight", aliases: ["slideR"] },
    { value: "slideUp" },
    { value: "slideDown" },
    { value: "zoom" },
    { value: "none" },
];
const REVEAL: StoryCommandParam = { name: "t", aliases: ["transition", "reveal"], type: { kind: "enum", options: REVEALS } };

/**
 * NVL's enter transition is a `StoryTransformRef` (preset-based), not the `StoryTransitionRef` the
 * scene/background commands use, so it takes its own short preset set rather than the crossfade-heavy
 * {@link TRANSITIONS}.
 */
const NVL_TRANSITIONS: readonly StoryCommandEnumOption[] = [
    { value: "fadeIn", aliases: ["fade"] },
    { value: "fadeOut" },
    { value: "none" },
];

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
            // Positional, like `/expr`: `/show Alice smile at=left` reads as one thought. `form=smile`
            // still works - a positional param stays addressable by name.
            FORM,
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
            { name: "seconds", type: [{ kind: "keyword", value: "click" }, { kind: "number", min: 0 }], positional: true },
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
            /**
             * The right-hand side is a full expression, greedy so it survives spaces and `=`.
             *
             * This slot used to be a bare literal, which is why adding one to a number required a
             * blueprint. A literal is still a literal - `/set met true` parses to a literal tree and
             * stores in `payload.value` exactly as before - so nothing about the common line changed;
             * it is only that the slot's *ceiling* is now `clamp(hp - dmg, 0, maxHp)`.
             */
            { name: "value", type: { kind: "expression", assignTo: "variable" }, positional: true, greedy: true },
        ],
    },

    // ── Variable declaration: one command per scope ───────────────────────────────────────────────
    //
    // The three variable scopes are a closed set, so the scope is encoded in the *command name* rather
    // than in a `scope=` modifier every line would have to carry. The params are identical across all
    // three - one handler, one grammar shape, three tokens - and the name an author reaches for says
    // the lifetime out loud: `/local` dies with the scene, `/var` rides the save file, `/persis` is
    // the game-level flag that outlives both.
    //
    // These are the only commands that declare rather than act: they write a variable definition and
    // insert no row. See `STORY_DECLARATION_COMMANDS`.
    { token: "local", commandId: "declareSceneVariable", aliases: ["scenevar"], params: declarationParams() },
    { token: "var", commandId: "declareSavedVariable", aliases: ["savedvar"], params: declarationParams() },
    { token: "persis", commandId: "declarePersistentVariable", aliases: ["persistent", "global"], params: declarationParams() },

    // ── Assignment sugar ──────────────────────────────────────────────────────────────────────────
    //
    // Each lowers to the same `setVariable` block an equivalent `/set` would build, so there is one
    // payload shape and one compiler path. They exist because `/inc gold` is what an author reaches
    // for and `/set gold gold + 1` is what they would otherwise have to spell - and the projection
    // renders the block back in sugar form, so the round trip does not undo the shorthand.
    {
        token: "inc",
        commandId: "incrementVariable",
        aliases: ["add"],
        params: [
            { name: "variable", type: { kind: "variable" }, positional: true },
            { name: "by", type: { kind: "expression" }, positional: true, greedy: true },
        ],
    },
    {
        token: "dec",
        commandId: "decrementVariable",
        aliases: ["sub"],
        params: [
            { name: "variable", type: { kind: "variable" }, positional: true },
            { name: "by", type: { kind: "expression" }, positional: true, greedy: true },
        ],
    },
    { token: "toggle", commandId: "toggleVariable", aliases: ["flip"], params: [{ name: "variable", type: { kind: "variable" }, positional: true }] },
    { token: "reset", commandId: "resetVariable", params: [{ name: "variable", type: { kind: "variable" }, positional: true }] },

    // ── Conditions ────────────────────────────────────────────────────────────────────────────────
    //
    // `expects: "boolean"` is the one place the grammar is stricter than the language: `/if gold` is
    // legal as an expression (a non-zero number is truthy) but is nearly always a comparison the
    // author started and did not finish, so it faults rather than quietly branching on truthiness.
    //
    // Only `/if` exists. `/elif` and `/else` would have to attach as siblings *inside* the condition
    // the caret happens to be in, and the insert slot carries no such enclosing-container context -
    // that is a change to how a slot resolves its parent, not a grammar entry. Extra branches are
    // added from the branch UI, which already does this correctly.
    { token: "if", commandId: "conditionIf", params: [{ name: "test", type: { kind: "expression", expects: "boolean" }, positional: true, greedy: true }] },

    // ── P1: the rest of the palette that fits the P0 param types ──────────────────────────────────
    //
    // Each command is designed from the author's seat, not filled in by rote. The through-line: a
    // command that *makes* an object lets you invent its name and pick its asset (like `/bg`); a
    // command that *acts on* one leads with the picker of what's already on stage (`stageObject`), so
    // "show the image I made" is a pick, never a remembered string. show/hide take the reveal as `t=`
    // and its timing as `d=`, mirroring `/bg`. The four `displayable*` ops, `layerZIndex` and
    // `executeScript` stay out: they need a resolved `DisplayableTargetRef` / blueprint id, not a name.
    { token: "expr", commandId: "characterExpression", aliases: ["face", "expression"], params: [CHARACTER, FORM] },
    { token: "menu", commandId: "choice", aliases: ["choice"], params: [{ name: "text", type: { kind: "text" }, positional: true, greedy: true }] },
    { token: "repeat", commandId: "repeat", aliases: ["loop"], params: [{ name: "times", type: { kind: "number", min: 1, integer: true }, positional: true }] },
    { token: "nvl", commandId: "nvl", params: [{ name: "t", aliases: ["transition"], type: { kind: "enum", options: NVL_TRANSITIONS } }, DURATION] },

    // Image - create leads with the asset (like `/bg`) and auto-names from it; the rest lead with the
    // picker of images on stage. `name=` overrides the auto-derived name when the author wants a handle.
    { token: "image", commandId: "imageCreate", aliases: ["img"], params: [IMAGE_ASSET, PLACEMENT, DURATION, NAME_OPTION] },
    { token: "imgsrc", commandId: "imageSetSource", aliases: ["setimg"], params: [imageRef(true), IMAGE_ASSET] },
    { token: "imgshow", commandId: "imageShow", params: [imageRef(true), REVEAL, DURATION] },
    { token: "imghide", commandId: "imageHide", params: [imageRef(true), REVEAL, DURATION] },

    // Text - create leads with the greedy content (the words are the point); set/show/hide/font pick an
    // existing overlay. A `name=` handle is optional and, being greedy-shadowed, must precede the content.
    { token: "text", commandId: "textCreate", aliases: ["txt"], params: [OBJECT_CONTENT, NAME_OPTION] },
    { token: "settext", commandId: "textSet", aliases: ["txtset"], params: [textRef(true), OBJECT_CONTENT] },
    { token: "txtshow", commandId: "textShow", params: [textRef(true), REVEAL, DURATION] },
    { token: "txthide", commandId: "textHide", params: [textRef(true), REVEAL, DURATION] },
    { token: "font", commandId: "textFont", aliases: ["txtfont"], params: [textRef(true), { name: "size", type: { kind: "number", min: 1 }, positional: true }, { name: "color", type: { kind: "color" } }] },

    { token: "layer", commandId: "layerCreate", params: [OBJECT_NAME, { name: "z", aliases: ["zindex"], type: { kind: "number", integer: true }, positional: true }] },

    // Video - create leads with the asset and auto-names from it; show/hide/play pick the video on stage.
    { token: "video", commandId: "videoCreate", aliases: ["vid"], params: [VIDEO_ASSET, { name: "muted", type: { kind: "boolean" } }, NAME_OPTION] },
    { token: "vidshow", commandId: "videoShow", params: [videoRef(true)] },
    { token: "vidhide", commandId: "videoHide", params: [videoRef(true)] },
    { token: "vidplay", commandId: "videoPlay", aliases: ["playvideo"], params: [videoRef(true)] },

    // Screen effects - pure scalars, no object reference.
    { token: "blink", commandId: "screenBlink", params: [DURATION, { name: "hold", type: { kind: "number", min: 0 } }, { name: "color", type: { kind: "color" } }] },
    { token: "vignette", commandId: "screenVignette", aliases: ["vig"], params: [DURATION, { name: "hold", type: { kind: "number", min: 0 } }, { name: "color", type: { kind: "color" } }, { name: "opacity", type: { kind: "number", min: 0, max: 1 } }] },

    // Sound control - lead with the picker of playing handles (default "sound") + the one value each op changes.
    { token: "stop", commandId: "stopSound", params: [audioRef(true)] },
    { token: "pausesound", commandId: "pauseSound", aliases: ["pause"], params: [audioRef(true)] },
    { token: "resume", commandId: "resumeSound", params: [audioRef(true)] },
    { token: "vol", commandId: "soundVolume", aliases: ["volume"], params: [{ name: "volume", type: { kind: "number", min: 0, max: 1 }, positional: true }, audioRef(false), { name: "fade", type: { kind: "number", min: 0 } }] },
    { token: "rate", commandId: "soundRate", params: [{ name: "rate", type: { kind: "number", min: 0 }, positional: true }, audioRef(false)] },
    { token: "mute", commandId: "muteSound", params: [{ name: "muted", type: { kind: "enum", options: [{ value: "on" }, { value: "off" }] }, positional: true }, audioRef(false)] },
];

const GRAMMAR_COMMAND_IDS = new Set<ActionCommandId>(STORY_COMMANDS.map(def => def.commandId));

/**
 * The commands the palette knows but P0 gave no grammar to.
 *
 * They exist here so the command line is never *less* capable than the seam it replaces: typing
 * `/imageCreate` or `//` resolved before and must still resolve. With no params they take no args and
 * commit exactly as picking them from the menu does - see `commitCommandFromInsert`, which routes a
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
 * The id fallback is what keeps `/characterEnter` working now that its short token is `/show` - the
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
    if (type.kind === "characterForm") {
        return type.dependsOn;
    }
    return null;
}

/**
 * Whether a value that resolves to nothing is still a legal value for this type.
 *
 * The speaker case comes straight from the interaction model: a dialogue row points at a real
 * `characterId` **or** carries a bare `speakerName`, so a name matching no character is a temp
 * speaker - a valid line, not an error. The speaker picker always offers the typed name back as a
 * candidate for exactly this reason: it deletes "nothing matched" as a state, which is what lets Tab
 * and Enter mean one thing. `{ kind: "character", allowTemp: true }` inherits that.
 *
 * It is opt-in per param, not blanket for the type: `/show Zoe` has no portrait to show and must
 * still fail. Everything that must resolve (asset / scene / variable / displayable, and a plain
 * `character`) has no such fallback - an unresolvable value there is an error, and it is the
 * resolution layer's to report, since the parser has no project context.
 */
export function allowsFreeValue(type: StoryCommandParamType): boolean {
    switch (type.kind) {
        case "character":
            return type.allowTemp === true;
        case "literal":
        case "text":
        // A stage object name may point at something made dynamically or in another scene - an unknown
        // name is a valid reference, not an error (see the type's note).
        case "stageObject":
            return true;
        case "asset":
        case "scene":
        case "variable":
        case "displayable":
        case "characterForm":
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
