import type {
    StoryActionPayload,
    StoryBlock,
    StoryTransformPreset,
    StoryTransformRef,
    StoryTransitionRef,
} from "@shared/types/story";
import {
    layerActionTargetRef,
    resolveDisplayableTargetRef,
    resolveStoryLayerRef,
    storyVariableRefKey,
} from "@shared/types/story";
import { formatStorySecondsValue, storySecondsToMs } from "@shared/utils/storyTime";
import { translate } from "@/lib/i18n";

import {
    getStorySceneName,
    storyCameraPanPlacement,
    storyCharacterName,
    variableRefShortLabel,
    type StoryRowLookups,
} from "@/lib/story/storyRowProjection";
import { storyVerbCommandId } from "@/lib/story/storyVerbVocabulary";
import { getPresetPosition } from "@/lib/ui-editor/runtime/game/storyTransformProps";
import { ACTION_TRIGGER } from "./commandTrigger";
import { localizedEnumValue } from "./commands/localizedEnums";
import { localizedParamKey } from "./commands/localizedParams";
import { localizedUnit } from "./commands/localizedUnits";
import { getDefById, localizedCommandToken } from "./commands/registry";
import {
    transformPresetFor,
    transitionKindFor,
    transitionWordFor,
    transitionWordForPreset,
} from "./commands/transitions";
import {
    findParam,
    matchEnumOption,
    paramTypes,
    type StoryCommandDef,
    type StoryCommandEnumOption,
    type StoryCommandParam,
} from "./storyCommandGrammar";
import type { StoryCommandContext, StoryCommandSpan } from "./storyCommandValues";

/**
 * A committed row read back as the command line that would produce it.
 *
 * The row used to print a *description* — `隐藏 Anyo` with a `d 1s` token beside it — while the line
 * the author typed was `@隐藏 Anyo 持续时间=1`. Two vocabularies for one row: the words differed, the
 * modifiers were abbreviated to one letter or dropped entirely, and the trigger character (the one
 * thing that says "this is a command") was missing. An author scanning a scene had to translate every
 * row back into the language they write in.
 *
 * So the row prints the line itself. Same skeleton before and after Enter, only dimmed.
 *
 * **The invariant: what this produces must parse back.** The output is a *source string*, not a list
 * of pretty fragments, and it is coloured by running it through the same `getCommandSegments` the
 * live field uses — so a line that stopped being legal shows up as a line that stops colouring, and
 * `storyCommandLine.test.ts` re-parses every projection it builds. That is what keeps this honest:
 * a row is not allowed to display a command the editor would refuse.
 *
 * **Why a hand-written table rather than a generic inverse of `spec.build`.** `build` is many-to-one
 * by design (bible B3: `/show` lands on six different payloads, `/swap` on two) and lossy on purpose
 * (`t=fade` becomes `fadeIn` or `dissolve` depending on context). There is no mechanical inverse to
 * derive. What CAN be shared is the vocabulary, and all of it is: the verb comes from
 * {@link storyVerbCommandId} (the same table the row's verb word already used), the keys from
 * {@link localizedParamKey}, the enum words from {@link localizedEnumValue}, and the transition words
 * from the same `transitions.ts` tables `build` writes through, read backwards.
 *
 * `null` means "no command owns this row" — an inspector-only displayable operation, a declaration, a
 * prose row. The caller keeps whatever it was already showing; this never invents a line.
 */

/**
 * The control a value opens when it is clicked — derived from the slot's declared TYPE, never
 * authored per command.
 *
 * That derivation is the whole reason every option is editable rather than the handful that were:
 * the grammar already says `t=` is an enum over these words, `d=` a number in seconds, `loop` a
 * boolean. Restating that per row would have been a second copy of the vocabulary, drifting the
 * moment a spec grew an option. The only thing a row still has to supply is where to WRITE the
 * result, which no type can know.
 */
export type StoryCommandLineControl =
    | { kind: "number"; min?: number; max?: number; integer?: boolean; unit: string; presets?: readonly number[] }
    | { kind: "enum"; options: readonly StoryCommandEnumOption[] }
    | { kind: "boolean" }
    | { kind: "color" }
    /** A closed list the grammar cannot hold — scenes, and anything else named per project. */
    | { kind: "choice"; options: readonly { value: string; label: string }[] };

/** One click-to-edit value inside the line: where it sits, what it opens, and what a change writes. */
export type StoryCommandLineEdit = {
    span: StoryCommandSpan;
    control: StoryCommandLineControl;
    /** The current value in CANONICAL form — a number as digits, an enum as its English word. */
    value: string;
    /**
     * The payload with this value replaced, in the same canonical form.
     *
     * A writer, not a rebuild: it patches the one field the value came from and leaves everything
     * else alone. Rebuilding the block from the edited line would have been less code and would have
     * silently dropped every field the line cannot express — an easing curve, a mask, a filter set in
     * the inspector.
     */
    apply: (next: string) => StoryBlock["payload"];
};

/**
 * A picture the line draws INSIDE itself, immediately before the token that starts at {@link at}.
 *
 * Recorded here rather than found by the renderer because the writer is the only thing that knows
 * where it put the name: a surface guessing "the first target-coloured token" would be a second,
 * weaker copy of {@link writeLine}, and would start decorating the wrong word the day a command
 * leads with something else. Same contract as {@link StoryCommandLineEdit} — an offset into
 * `source`, which only the trigger character can ever shift.
 *
 * The line stays plain text: `source` is unchanged, so it still parses, still round-trips, and a
 * surface that ignores ornaments (the overlay above the live field, which has to match the textarea
 * character for character) loses nothing.
 */
export type StoryCommandLineOrnament = {
    /** Offset in `source` the picture sits before — the first character of the token it belongs to. */
    at: number;
    kind: "character";
    /** Who is pictured. */
    id: string;
};

export type StoryCommandLineProjection = {
    /**
     * The line in CANONICAL form — a leading "/", whatever trigger the author's setting displays.
     * Same convention as the insert slot: only the first character can differ, so a surface that
     * shows "@" swaps that one character and every span still lines up.
     */
    source: string;
    /** Every value a click can change, by where it sits in {@link source}. */
    edits: readonly StoryCommandLineEdit[];
    /** Every picture the line draws inside itself, by where it sits in {@link source}. */
    ornaments: readonly StoryCommandLineOrnament[];
};

/** What the projection needs beyond the row itself — every lookup the prose projection already takes. */
export type StoryCommandLineLookups = StoryRowLookups & {
    /**
     * The name of a project audio track, or `null` when it is unknown. Absent lookup means the line
     * omits `track=` rather than printing the stored id — a row never shows an internal id.
     */
    audioTrackName?: (trackId: string) => string | null;
    /**
     * Every look this character can be asked for — the same list the command line's own candidate
     * menu offers. `axisId` rides along because a layered character stores its choice per axis while
     * a preset one stores a pose, and the writer has to know which.
     */
    appearanceOptions?: (characterId: string) => readonly { id: string; name: string; axisId?: string }[];
    /**
     * What a name on this line could refer to — the very view a TYPED line resolves against.
     *
     * Passed whole rather than as six lookups because that is what it is: the row is offering the
     * same candidates the command line would, so an object picked from a row is an object the author
     * could have typed. Absent (a test, a surface with no project) simply means the subjects are
     * printed and not offered.
     */
    commandContext?: StoryCommandContext;
};

/** The candidate list for a slot, as the picker wants it. Empty means "nothing to offer". */
function choicesOf(entries: readonly { id: string; name: string }[] | readonly string[]): { value: string; label: string }[] {
    return entries.map(entry => (typeof entry === "string" ? { value: entry, label: entry } : { value: entry.id, label: entry.name }));
}

// ---------------------------------------------------------------------------
// Writing a line
// ---------------------------------------------------------------------------

/**
 * One argument, named by the SPEC param it fills rather than by the word it prints.
 *
 * The spec param is what supplies both the localized key (`d` → `持续时间`) and, for an enum, the
 * option set a canonical value is respelled against (`fade` → `淡变`). Naming the param instead of
 * the word is what lets this table stay in the canonical vocabulary and the display follow the
 * author's command language for free.
 */
type Arg = {
    /** Param name as declared on the spec. */
    param: string;
    value: string;
    /** Written bare rather than as `key=value`. */
    positional?: boolean;
    /** The value is a canonical enum value (or one of its aliases) and gets respelled. */
    enum?: boolean;
    /**
     * Writes a new value back into the payload — presence is what makes the token click-to-edit.
     *
     * Takes the canonical string the control produced (`"1.5"`, `"fade"`, `"true"`) rather than a
     * typed value, so one signature serves every control and the writer stays a one-liner beside the
     * reader it mirrors. An arg with no writer is still printed; it just cannot be changed from the
     * row — which is the honest state for a name, an asset, an expression.
     */
    apply?: (next: string) => StoryBlock["payload"];
    /** Offered alongside a number's input, when the slot has a house set (`/wait`). */
    presets?: readonly number[];
    /** A picture drawn immediately before this arg — see {@link StoryCommandLineOrnament}. */
    ornament?: Omit<StoryCommandLineOrnament, "at">;
    /** The options of a {@link StoryCommandLineControl} "choice" — a list no param type can hold. */
    choices?: readonly { value: string; label: string }[];
    /**
     * The current value in the control's own terms, when that is not what the line prints. A choice
     * is keyed by id and the line prints a name, so without this the open menu could not mark which
     * option the row is already on.
     */
    editValue?: string;
};

type Sentence = {
    /** The spec id whose token leads the line. */
    commandId: string;
    args: readonly (Arg | null)[];
};

/** An arg, or `null` when there is nothing to say — the writers below stay expression-shaped. */
function arg(param: string, value: string | undefined | null, extra: Omit<Arg, "param" | "value"> = {}): Arg | null {
    return value === undefined || value === null || value === "" ? null : { param, value, ...extra };
}

function positional(param: string, value: string | undefined | null, extra: Omit<Arg, "param" | "value" | "positional"> = {}): Arg | null {
    return arg(param, value, { ...extra, positional: true });
}

/** Milliseconds as the seconds number the line is typed in — `1200` → `1.2`. */
function seconds(ms: number | undefined): string {
    return ms === undefined ? "" : formatStorySecondsValue(ms);
}

function numberValue(value: number | undefined): string {
    return value === undefined ? "" : String(value);
}

function booleanValue(value: boolean | undefined): string {
    return value === undefined ? "" : String(value);
}

/**
 * Quote a value the tokenizer would otherwise split. A value containing a single quote is wrapped in
 * double quotes, since the tokenizer has no escape syntax and both kinds group identically.
 *
 * A GREEDY slot is never quoted: it takes the rest of the line verbatim, so the quotes would land in
 * the value itself and a `/rename Alice The Stranger` would read back as one called `'The Stranger'`.
 */
function quoteValue(value: string, greedy: boolean): string {
    if (greedy || !/\s/.test(value)) {
        return value;
    }
    return value.includes("'") ? `"${value}"` : `'${value}'`;
}

/**
 * The pause lengths `/wait` offers beside its input — the bible's B10 "high-frequency" set, in the
 * seconds the line is written in.
 */
const WAIT_PRESET_SECONDS = [0.2, 0.5, 1, 2, 3] as const;

/** A value written as a bare number — the only kind a unit may be appended to. */
const NUMERIC = /^-?\d+(?:\.\d+)?$/;

/**
 * The unit a numeric slot is written with, in the command language, or `""`.
 *
 * Read off the param rather than off the payload field, so "which values carry a unit" is answered
 * once, by the grammar, for the row and the typed line alike — and spelled through
 * {@link localizedUnit}, which comes out of the same table the parser accepts, so the `持续时间=1秒` a
 * Chinese author reads is a line they can type back.
 */
function unitOf(param: StoryCommandParam | null): string {
    if (!param) {
        return "";
    }
    for (const type of paramTypes(param)) {
        if (type.kind === "number" && type.unit) {
            return localizedUnit(type.unit);
        }
    }
    return "";
}

/** The command language's spelling of a canonical enum value, for whichever of the param's types owns it. */
function enumWord(param: StoryCommandParam, value: string): string {
    for (const type of paramTypes(param)) {
        if (type.kind !== "enum") {
            continue;
        }
        const option = matchEnumOption(type, value);
        if (option) {
            return localizedEnumValue(type, option);
        }
    }
    // A stored value no option names — an inspector-only choice. Printed as itself: the row says what
    // it actually holds, and the line failing to parse is the honest signal that it is not typeable.
    return value;
}

/**
 * What clicking this value opens, or `null` when the slot holds something no small control can edit
 * — a name, an asset, an expression, a line of prose.
 */
function controlFor(param: StoryCommandParam | null, entry: Arg): StoryCommandLineControl | null {
    if (entry.choices) {
        return { kind: "choice", options: entry.choices };
    }
    if (!param) {
        return null;
    }
    for (const type of paramTypes(param)) {
        if (type.kind === "enum") {
            return { kind: "enum", options: type.options };
        }
        if (type.kind === "number") {
            return {
                kind: "number",
                unit: type.unit ? localizedUnit(type.unit) : "",
                ...(type.min !== undefined ? { min: type.min } : {}),
                ...(type.max !== undefined ? { max: type.max } : {}),
                ...(type.integer ? { integer: true } : {}),
                ...(entry.presets ? { presets: entry.presets } : {}),
            };
        }
        if (type.kind === "boolean") {
            return { kind: "boolean" };
        }
        if (type.kind === "color") {
            return { kind: "color" };
        }
    }
    return null;
}

function writeLine(def: StoryCommandDef | null, verb: string, args: readonly (Arg | null)[]): StoryCommandLineProjection {
    let source = ACTION_TRIGGER + verb;
    const edits: StoryCommandLineEdit[] = [];
    const ornaments: StoryCommandLineOrnament[] = [];
    for (const entry of args) {
        if (!entry) {
            continue;
        }
        const param = def ? findParam(def, entry.param) : null;
        source += " ";
        if (!entry.positional) {
            source += `${def && param ? localizedParamKey(def, param) : entry.param}=`;
        }
        const start = source.length;
        if (entry.ornament) {
            ornaments.push({ ...entry.ornament, at: start });
        }
        source += quoteValue(entry.enum && param ? enumWord(param, entry.value) : entry.value, param?.greedy === true);
        // Only a NUMBER takes the unit — `/wait click` fills the same slot as `/wait 2` and must not
        // come back as `clicks`. It rides INSIDE the edit span: a click on `1s` opens the editor a
        // click on `1` would, and a span stopping short of it would leave a dead half-token beside it.
        source += entry.enum || !NUMERIC.test(entry.value) ? "" : unitOf(param);
        const control = entry.apply ? controlFor(param, entry) : null;
        if (control && entry.apply) {
            edits.push({ span: { start, end: source.length }, control, value: entry.editValue ?? entry.value, apply: entry.apply });
        }
    }
    return { source, edits, ornaments };
}

// ---------------------------------------------------------------------------
// Reading a payload back
// ---------------------------------------------------------------------------

/**
 * The four writers every `apply` is built from — the exact inverses of the readers below them.
 *
 * Generic over "a payload with this field" rather than written per action, because the same three
 * shapes carry almost every option in the vocabulary: a transform (placement, reveal preset,
 * duration), a transition (kind, duration), and plain fields (volume, loop, z, opacity…). Keeping the
 * pair adjacent is what stops a reader and its writer from drifting onto different fields.
 */
function patchTransform<P extends { transform?: StoryTransformRef }>(payload: P, patch: Partial<StoryTransformRef>): P {
    return { ...payload, transform: { ...(payload.transform ?? {}), ...patch } };
}

function patchTransition<P extends { transition?: StoryTransitionRef }>(payload: P, patch: Partial<StoryTransitionRef>): P {
    // A duration with no kind still means "animate", so an edit implies the house default rather than
    // writing a ref with no kind — the same rule `withTransitionRef` follows on the way in.
    return { ...payload, transition: { kind: "fadeIn", ...(payload.transition ?? {}), ...patch } };
}

/** Author-typed seconds → the milliseconds the document stores. */
function msOf(next: string): number {
    return storySecondsToMs(Number(next));
}

/**
 * The subject of a row as a pick: which character, which asset, which object on stage.
 *
 * Two rules keep this a convenience rather than a foot-gun:
 *
 *  - **a list never crosses payload shapes.** `/show` accepts a character or five kinds of stage
 *    object, but a row that IS a character row offers characters only — swapping in an image would
 *    rewrite what the row is, which is the same line `/camera`'s operation draws.
 *  - **a definition is not a reference.** The name a `create` row registers is what every later row
 *    addresses, so changing it from here would silently unbind them. Only rows that USE a name offer
 *    to change it; a create row offers its asset instead.
 */
function pickCharacter(
    payload: Extract<StoryActionPayload, { action: "character" }>,
    lookups: StoryCommandLineLookups,
): Pick<Arg, "choices" | "apply" | "editValue"> | null {
    const characters = lookups.commandContext?.characters ?? [];
    if (characters.length === 0) {
        return null;
    }
    return {
        choices: choicesOf(characters),
        ...(payload.characterId ? { editValue: payload.characterId } : {}),
        // The look goes with the character that had it: a pose is named per character and would
        // resolve to nothing on the next one.
        apply: next => ({ ...payload, characterId: next, pose: undefined, tags: undefined }),
    };
}

/** An asset slot — the row's own library, by kind. Writes the id; the row goes on printing the name. */
function pickAsset(
    payload: { assetId?: string },
    lookups: StoryCommandLineLookups,
    kind: "image" | "audio" | "video",
    apply: (assetId: string) => StoryBlock["payload"],
): Pick<Arg, "choices" | "apply" | "editValue"> | null {
    const context = lookups.commandContext;
    const assets = kind === "image" ? context?.images : kind === "audio" ? context?.audio : context?.videos;
    if (!assets || assets.length === 0) {
        return null;
    }
    return {
        choices: choicesOf(assets),
        ...(payload.assetId ? { editValue: payload.assetId } : {}),
        apply,
    };
}

/** A name that ADDRESSES something on stage — never the name a create row defines. */
function pickStageObject(
    lookups: StoryCommandLineLookups,
    kind: "image" | "text" | "layer" | "video" | "audio" | "vfx",
    current: string | undefined,
    apply: (name: string) => StoryBlock["payload"],
): Pick<Arg, "choices" | "apply" | "editValue"> | null {
    const names = lookups.commandContext?.stageObjects[kind] ?? [];
    if (names.length === 0) {
        return null;
    }
    return {
        choices: choicesOf(names),
        ...(current ? { editValue: current } : {}),
        apply,
    };
}

/** The three words `at=` spells. Everything else in the preset union is a reveal/conceal animation. */
const PLACEMENTS: ReadonlySet<StoryTransformPreset> = new Set<StoryTransformPreset>(["left", "center", "right"]);

function placementOf(transform: StoryTransformRef | undefined): string | undefined {
    const preset = transform?.preset;
    return preset && PLACEMENTS.has(preset) ? preset : undefined;
}

/** A stage object's `t=` — the reveal/conceal preset, but never a placement (that slot is `at=`). */
function revealWord(transform: StoryTransformRef | undefined, direction: "reveal" | "conceal" | "nvl"): string | undefined {
    const preset = transform?.preset;
    if (!preset || PLACEMENTS.has(preset)) {
        return undefined;
    }
    return transitionWordForPreset(direction, preset) ?? preset;
}

/** A whole-screen or character `t=` — the stored kind, named by the word an author would type. */
function transitionWord(kind: StoryTransitionRef["kind"] | undefined, context: "scene" | "character"): string | undefined {
    if (kind === undefined) {
        return undefined;
    }
    return transitionWordFor(context, kind) ?? kind;
}

/** The asset's own name, or the "this image is gone" phrase — never the id. */
function assetWord(lookups: StoryCommandLineLookups, assetId: string | undefined): string | undefined {
    if (!assetId) {
        return undefined;
    }
    if (!lookups.assetName) {
        return undefined;
    }
    return lookups.assetName(assetId) ?? translate("story.background.missingImage");
}

function characterWord(payload: Extract<StoryActionPayload, { action: "character" }>, lookups: StoryCommandLineLookups): string {
    return payload.characterId
        ? storyCharacterName(lookups, payload.characterId)
        : payload.objectName?.trim() ?? "";
}

/**
 * The appearance a character row asks for, as a word — the `smile` in `/face Alice smile`.
 *
 * Three storage shapes, one slot (the command's `form`), and only two of them can be named here:
 *
 *  - `puppetName` is the model's own string and reads back as itself;
 *  - `pose` (a `preset` character) is one id and resolves to one name;
 *  - `tags` (a `layered` character) is a map, and only a SINGLE entry is nameable — `/face` changing
 *    one axis. An `enter` resolves the map out to every axis, so naming one of five would claim the
 *    author chose it; those rows say nothing about the look, exactly as the prose row did.
 */
function appearanceWord(
    payload: Extract<StoryActionPayload, { action: "character" }>,
    lookups: StoryCommandLineLookups,
): string | undefined {
    const puppetName = payload.puppetName?.trim();
    if (puppetName) {
        return puppetName;
    }
    const characterId = payload.characterId;
    if (!characterId || !lookups.appearanceName) {
        return undefined;
    }
    if (payload.pose) {
        return lookups.appearanceName(characterId, payload.pose) ?? undefined;
    }
    const tags = Object.values(payload.tags ?? {});
    return tags.length === 1 ? lookups.appearanceName(characterId, tags[0]) ?? undefined : undefined;
}

/**
 * The appearance slot as a pick: this character's looks, and where the chosen one is written.
 *
 * `null` when there is nothing to choose from — a puppet character (its names live in a model file),
 * a row with no character yet, or a surface that supplied no options. The value then still PRINTS,
 * it just cannot be changed from the row.
 */
function appearanceChoice(
    payload: Extract<StoryActionPayload, { action: "character" }>,
    lookups: StoryCommandLineLookups,
): Pick<Arg, "choices" | "apply" | "editValue"> | null {
    const characterId = payload.characterId;
    const options = characterId ? lookups.appearanceOptions?.(characterId) ?? [] : [];
    if (options.length === 0 || payload.puppetName !== undefined) {
        return null;
    }
    const current = payload.pose ?? (Object.values(payload.tags ?? {}).length === 1 ? Object.values(payload.tags ?? {})[0] : undefined);
    return {
        choices: options.map(option => ({ value: option.id, label: option.name })),
        ...(current ? { editValue: current } : {}),
        // A layered character keeps one tag per axis and an expression changes only the axes it names,
        // so the pick MERGES; a preset character has one pose and it is replaced.
        apply: next => {
            const axisId = options.find(option => option.id === next)?.axisId;
            return axisId
                ? { ...payload, tags: { ...payload.tags, [axisId]: next } }
                : { ...payload, pose: next };
        },
    };
}

function characterSentence(
    payload: Extract<StoryActionPayload, { action: "character" }>,
    lookups: StoryCommandLineLookups,
    commandId: string,
): Sentence | null {
    const name = characterWord(payload, lookups);
    // The look is a closed list, so it is a pick rather than a field — but only for the characters
    // Studio draws: a puppet's expression is a name its own model owns and nothing here can enumerate.
    const appearance = appearanceChoice(payload, lookups);
    const form = positional("form", appearanceWord(payload, lookups), appearance ?? {});
    // `/show` and `/hide` name their subject `target`, the rest `character` — one pick, two slots.
    // The face rides with the name in both: it is the row's picture of WHO, and a row that pictures
    // its subject inline is a row whose plate is free to say what is being done to them.
    const who = {
        ...(pickCharacter(payload, lookups) ?? {}),
        ...(payload.characterId ? { ornament: { kind: "character" as const, id: payload.characterId } } : {}),
    };
    // A character's entrance and exit are driven by the TRANSFORM's duration, not the transition's —
    // the same field `hide()` reads (see `getQuickParams`), so that is the one an edit must write.
    const duration = arg("d", seconds(payload.transform?.durationMs), {
        apply: next => patchTransform(payload, { durationMs: msOf(next) }),
    });
    const placement = arg("at", placementOf(payload.transform), {
        enum: true,
        apply: next => patchTransform(payload, { preset: next as StoryTransformPreset }),
    });
    // `t=` is the TRANSFORM's preset, the one the engine animates a character's entrance and exit
    // with and the one the inspector's own 变换 → 预设 edits. The `transition` ref beside it is only
    // read on `expression` (a portrait swap), so a row that showed it here was reporting a field
    // nothing would play — and disagreeing with the inspector about the very same question.
    const reveal = (direction: "reveal" | "conceal") => arg("t", revealWord(payload.transform, direction), {
        enum: true,
        apply: next => patchTransform(payload, { preset: transformPresetFor(direction, next) }),
    });
    switch (payload.operation) {
        case "enter":
            return {
                commandId,
                args: [positional("target", name, who), form, placement, reveal("reveal"), duration],
            };
        case "exit":
            return { commandId, args: [positional("target", name, who), reveal("conceal"), duration] };
        case "move":
            return { commandId, args: [positional("character", name, who), placement, duration] };
        case "expression":
            return { commandId, args: [positional("character", name, who), form] };
        case "setMotion":
        case "setSkin":
            // The two puppet-only channels: their value is the model's own string, never a project ref.
            return { commandId, args: [positional("character", name, who), positional("name", payload.puppetName?.trim())] };
        case "setName":
            return { commandId, args: [positional("character", name, who), positional("name", payload.displayName)] };
        case "setParams": {
            // The line fills one pair; the map is the inspector's. Naming the first entry is what the
            // prose row already did, and it is the one an author reading the scene recognises.
            const [first] = Object.entries(payload.params ?? {});
            return {
                commandId,
                args: [
                    positional("character", name, who),
                    positional("id", first?.[0]),
                    positional("value", first === undefined ? "" : String(first[1]), {
                        apply: next => (first === undefined
                            ? payload
                            : { ...payload, params: { ...payload.params, [first[0]]: Number(next) } }),
                    }),
                ],
            };
        }
    }
}

function audioSentence(
    payload: Extract<StoryActionPayload, { action: "audio" }>,
    lookups: StoryCommandLineLookups,
    commandId: string,
): Sentence | null {
    const name = payload.objectName?.trim() || undefined;
    const asset = assetWord(lookups, payload.assetId);
    const track = payload.audioTrackId && lookups.audioTrackName ? lookups.audioTrackName(payload.audioTrackId) : null;
    const fade = arg("fade", seconds(payload.fadeMs), { apply: next => ({ ...payload, fadeMs: msOf(next) }) });
    const clip = pickAsset(payload, lookups, "audio", next => ({ ...payload, assetId: next })) ?? {};
    // The handle a control verb addresses: any sound already on stage, plus the reserved `bgm`.
    const handle = pickStageObject(lookups, "audio", name, next => ({ ...payload, objectName: next })) ?? {};
    const tracks = lookups.commandContext?.audioTracks ?? [];
    const trackPick = tracks.length === 0
        ? {}
        : {
            choices: choicesOf(tracks),
            ...(payload.audioTrackId ? { editValue: payload.audioTrackId } : {}),
            apply: (next: string) => ({ ...payload, audioTrackId: next }),
        };
    // One writer, two slots: `/bgm` names it `vol=` and `/vol` takes it as a positional `volume`.
    const volume = { apply: (next: string) => ({ ...payload, volume: Number(next) }) };
    const loop = arg("loop", booleanValue(payload.loop), { apply: next => ({ ...payload, loop: next === "true" }) });
    switch (payload.operation) {
        case "setBgm":
            return {
                commandId,
                args: [
                    positional("audio", asset, clip),
                    arg("track", track, trackPick),
                    arg("vol", numberValue(payload.volume), volume),
                    fade,
                    loop,
                ],
            };
        case "playSound":
            return {
                commandId,
                args: [
                    positional("audio", asset, clip),
                    arg("name", name),
                    arg("track", track, trackPick),
                    arg("vol", numberValue(payload.volume), volume),
                    fade,
                    loop,
                ],
            };
        case "setVolume":
            return { commandId, args: [positional("target", name, handle), positional("volume", numberValue(payload.volume), volume), fade] };
        case "setRate":
            return {
                commandId,
                args: [positional("target", name, handle), positional("rate", numberValue(payload.rate), { apply: next => ({ ...payload, rate: Number(next) }) })],
            };
        case "seekSound":
            return {
                commandId,
                args: [positional("target", name, handle), positional("time", seconds(payload.timeMs), { apply: next => ({ ...payload, timeMs: msOf(next) }) })],
            };
        case "stopSound":
        case "pauseSound":
        case "resumeSound":
            return { commandId, args: [positional("target", name, handle), fade] };
        case "muteSound":
            return { commandId, args: [positional("target", name, handle)] };
    }
}

function imageSentence(
    payload: Extract<StoryActionPayload, { action: "image" }>,
    lookups: StoryCommandLineLookups,
    commandId: string,
): Sentence | null {
    const name = payload.objectName?.trim() || undefined;
    const asset = assetWord(lookups, payload.assetId);
    // `at=` and `t=` write the SAME field — a transform holds one preset — which is why the reader
    // prints whichever one the stored preset spells and never both.
    const placement = arg("at", placementOf(payload.transform), {
        enum: true,
        apply: next => patchTransform(payload, { preset: next as StoryTransformPreset }),
    });
    const duration = arg("d", seconds(payload.transform?.durationMs), {
        apply: next => patchTransform(payload, { durationMs: msOf(next) }),
    });
    const reveal = (direction: "reveal" | "conceal") => arg("t", revealWord(payload.transform, direction), {
        enum: true,
        apply: next => patchTransform(payload, { preset: transformPresetFor(direction, next) }),
    });
    const swapAsset = pickAsset(payload, lookups, "image", next => ({ ...payload, assetId: next, color: undefined })) ?? {};
    const object = pickStageObject(lookups, "image", name, next => ({ ...payload, objectName: next })) ?? {};
    if (payload.operation === "create") {
        // The NAME here is the one later rows address, so it is not offered; the asset is.
        return {
            commandId,
            args: [positional("image", asset ?? payload.color, swapAsset), arg("name", name), placement, reveal("reveal"), duration],
        };
    }
    if (payload.operation === "setSource") {
        return { commandId, args: [positional("target", name, object), positional("content", asset ?? payload.color, swapAsset)] };
    }
    return {
        commandId,
        args: [positional("target", name, object), reveal(payload.operation === "show" ? "reveal" : "conceal"), duration],
    };
}

function textSentence(
    payload: Extract<StoryActionPayload, { action: "text" }>,
    lookups: StoryCommandLineLookups,
    commandId: string,
): Sentence | null {
    const name = payload.objectName?.trim() || undefined;
    const object = pickStageObject(lookups, "text", name, next => ({ ...payload, objectName: next })) ?? {};
    switch (payload.operation) {
        case "create":
            // `name=` before the greedy content: the one ordering rule the grammar imposes, and the
            // line has to be written in an order that parses back.
            return {
                commandId,
                args: [
                    arg("name", name),
                    arg("at", placementOf(payload.transform), {
                        enum: true,
                        apply: next => patchTransform(payload, { preset: next as StoryTransformPreset }),
                    }),
                    positional("content", payload.text),
                ],
            };
        case "setText":
            return { commandId, args: [positional("target", name, object), positional("content", payload.text)] };
        case "setFontSize":
            return {
                commandId,
                args: [positional("target", name, object), positional("size", numberValue(payload.fontSize), { apply: next => ({ ...payload, fontSize: Number(next) }) })],
            };
        case "setFontColor":
            return {
                commandId,
                args: [positional("target", name, object), arg("color", payload.fontColor, { apply: next => ({ ...payload, fontColor: next }) })],
            };
        case "show":
        case "hide": {
            const direction = payload.operation === "show" ? "reveal" : "conceal";
            return {
                commandId,
                args: [
                    positional("target", name, object),
                    arg("t", revealWord(payload.transform, direction), {
                        enum: true,
                        apply: next => patchTransform(payload, { preset: transformPresetFor(direction, next) }),
                    }),
                    arg("d", seconds(payload.transform?.durationMs), { apply: next => patchTransform(payload, { durationMs: msOf(next) }) }),
                ],
            };
        }
    }
}

function layerSentence(
    payload: Extract<StoryActionPayload, { action: "layer" }>,
    lookups: StoryCommandLineLookups,
    commandId: string,
): Sentence | null {
    const name = payload.operation === "create"
        ? payload.objectName?.trim() || undefined
        : resolveStoryLayerRef(lookups.scene, layerActionTargetRef(payload.target, payload.objectName)).name || undefined;
    if (payload.operation === "create" || payload.operation === "setZIndex") {
        return {
            commandId,
            args: [positional("name", name), arg("z", numberValue(payload.zIndex), { apply: next => ({ ...payload, zIndex: Number(next) }) })],
        };
    }
    // A layer reference stores a stable `sourceBlockId` binding that follows renames; re-pointing it
    // by name would drop that anchor, so a layer target is read here and re-bound in the inspector.
    if (payload.operation === "transform") {
        return {
            commandId,
            args: [positional("target", name), arg("d", seconds(payload.transform?.durationMs), { apply: next => patchTransform(payload, { durationMs: msOf(next) }) })],
        };
    }
    return { commandId, args: [positional("target", name)] };
}

function videoSentence(
    payload: Extract<StoryActionPayload, { action: "video" }>,
    lookups: StoryCommandLineLookups,
    commandId: string,
): Sentence | null {
    const name = payload.objectName?.trim() || undefined;
    const object = pickStageObject(lookups, "video", name, next => ({ ...payload, objectName: next })) ?? {};
    if (payload.operation === "create") {
        return {
            commandId,
            args: [
                positional("video", assetWord(lookups, payload.assetId), pickAsset(payload, lookups, "video", next => ({ ...payload, assetId: next })) ?? {}),
                arg("name", name),
                arg("muted", booleanValue(payload.muted), { apply: next => ({ ...payload, muted: next === "true" }) }),
            ],
        };
    }
    if (payload.operation === "seek") {
        return {
            commandId,
            args: [positional("target", name, object), positional("time", seconds(payload.timeMs), { apply: next => ({ ...payload, timeMs: msOf(next) }) })],
        };
    }
    return { commandId, args: [positional("target", name, object)] };
}

function vfxSentence(
    payload: Extract<StoryActionPayload, { action: "vfx" }>,
    lookups: StoryCommandLineLookups,
    commandId: string,
): Sentence | null {
    const name = payload.objectName?.trim() || undefined;
    const duration = arg("d", seconds(payload.durationMs), { apply: next => ({ ...payload, durationMs: msOf(next) }) });
    if (payload.operation === "create") {
        return {
            commandId,
            args: [
                positional("clip", assetWord(lookups, payload.assetId), pickAsset(payload, lookups, "video", next => ({ ...payload, assetId: next })) ?? {}),
                arg("name", name),
                arg("opacity", numberValue(payload.opacity), { apply: next => ({ ...payload, opacity: Number(next) }) }),
                duration,
            ],
        };
    }
    const object = pickStageObject(lookups, "vfx", name, next => ({ ...payload, objectName: next })) ?? {};
    if (payload.operation === "setRate") {
        return {
            commandId,
            args: [positional("target", name, object), positional("rate", numberValue(payload.rate), { apply: next => ({ ...payload, rate: Number(next) }) })],
        };
    }
    // `/show` and `/hide` carry the fade an overlay waits out; `/pause` and `/resume` take the name alone.
    const fades = payload.operation === "show" || payload.operation === "hide";
    return { commandId, args: [positional("target", name, object), fades ? duration : null] };
}

function cameraSentence(
    payload: Extract<StoryActionPayload, { action: "camera" }>,
    commandId: string,
): Sentence {
    const amount = (): string | undefined => {
        switch (payload.operation) {
            case "pan": return storyCameraPanPlacement(payload.position) ?? undefined;
            case "zoom": return numberValue(payload.zoom);
            case "rotate": return numberValue(payload.rotation);
            case "darken": return numberValue(payload.darkness);
            // A bound Story Motion is a binding, not a word — the line names the operation and the
            // motion's name rides the inspector, exactly as `/camera motion` is typed.
            case "motion":
            case "reset": return undefined;
        }
    };
    // The knob writes whichever field this operation reads. `pan` takes a word and the other three a
    // number, which is exactly the split the amount slot's own union already declares.
    const applyAmount = (next: string): StoryBlock["payload"] => {
        switch (payload.operation) {
            case "pan": return { ...payload, position: getPresetPosition(next, {}) ?? payload.position };
            case "zoom": return { ...payload, zoom: Number(next) };
            case "rotate": return { ...payload, rotation: Number(next) };
            case "darken": return { ...payload, darkness: Number(next) };
            case "motion":
            case "reset": return payload;
        }
    };
    // The OPERATION itself stays fixed here: pan → zoom is not a tweak, it changes which field the row
    // carries and what it means. That one belongs to the inspector, which can rebuild the knob with it.
    return {
        commandId,
        args: [
            positional("op", payload.operation, { enum: true }),
            positional("amount", amount(), { enum: payload.operation === "pan", apply: applyAmount }),
            payload.operation === "motion"
                ? null
                : arg("d", seconds(payload.durationMs), { apply: next => ({ ...payload, durationMs: msOf(next) }) }),
        ],
    };
}

function displayableSentence(
    payload: Extract<StoryActionPayload, { action: "displayable" }>,
    lookups: StoryCommandLineLookups,
    commandId: string,
): Sentence | null {
    const label = resolveDisplayableTargetRef(lookups.scene, payload.target).label || undefined;
    if (payload.operation === "transform") {
        return {
            commandId,
            args: [positional("target", label), arg("d", seconds(payload.durationMs), { apply: next => ({ ...payload, durationMs: msOf(next) }) })],
        };
    }
    const direction = payload.operation === "show" ? "reveal" : "conceal";
    return {
        commandId,
        args: [
            positional("target", label),
            arg("t", revealWord(payload.transform, direction), {
                enum: true,
                apply: next => patchTransform(payload, { preset: transformPresetFor(direction, next) }),
            }),
            // The transform's own duration is what a show/hide animates on; `durationMs` is the effect
            // timing the inspector sets, and is only read here when there is no transform to read.
            arg("d", seconds(payload.transform?.durationMs ?? payload.durationMs), {
                apply: next => patchTransform(payload, { durationMs: msOf(next) }),
            }),
        ],
    };
}

function actionSentence(
    payload: StoryActionPayload,
    lookups: StoryCommandLineLookups,
): Sentence | null {
    const commandId = storyVerbCommandId(payload);
    if (commandId === null) {
        return null;
    }
    switch (payload.action) {
        case "setBackground":
            return {
                commandId,
                args: [
                    positional("image", assetWord(lookups, payload.assetId) ?? payload.color,
                        // A colour background has no asset to pick from, so it keeps its text.
                        payload.assetId ? pickAsset(payload, lookups, "image", next => ({ ...payload, assetId: next, color: undefined })) ?? {} : {}),
                    arg("t", transitionWord(payload.transition?.kind, "scene"), {
                        enum: true,
                        apply: next => patchTransition(payload, { kind: transitionKindFor("scene", next) ?? "dissolve" }),
                    }),
                    arg("d", seconds(payload.transition?.durationMs), {
                        apply: next => patchTransition(payload, { durationMs: msOf(next) }),
                    }),
                ],
            };
        case "character":
            return characterSentence(payload, lookups, commandId);
        case "audio":
            return audioSentence(payload, lookups, commandId);
        case "image":
            return imageSentence(payload, lookups, commandId);
        case "text":
            return textSentence(payload, lookups, commandId);
        case "layer":
            return layerSentence(payload, lookups, commandId);
        case "video":
            return videoSentence(payload, lookups, commandId);
        case "vfx":
            return vfxSentence(payload, lookups, commandId);
        case "camera":
            return cameraSentence(payload, commandId);
        case "displayable":
            // Only the three operations a verb owns; `mask`, `clip`, `filter` and the rest are reached
            // through the inspector after `/fx` and have no line to read back.
            return payload.operation === "show" || payload.operation === "hide" || payload.operation === "transform"
                ? displayableSentence(payload, lookups, commandId)
                : null;
        case "setVariable": {
            const variables = lookups.commandContext?.variables ?? [];
            return {
                commandId,
                args: [
                    positional("variable", variableRefShortLabel(payload.target, lookups.scene, lookups.scenes), variables.length === 0 ? {} : {
                        // Keyed by the ref's own key, since a variable is a scope plus an id rather
                        // than a name — two scopes may hold the same word.
                        choices: variables.map(entry => ({ value: storyVariableRefKey(entry.ref), label: entry.name })),
                        editValue: storyVariableRefKey(payload.target),
                        apply: next => {
                            const found = variables.find(entry => storyVariableRefKey(entry.ref) === next);
                            return found ? { ...payload, target: found.ref } : payload;
                        },
                    }),
                    positional("value", payload.expression?.source ?? String(payload.value)),
                ],
            };
        }
        case "wait":
            return {
                commandId,
                args: [payload.mode === "duration"
                    // The house set (bible B10) rides along, so the common pauses are one click rather
                    // than a number to type.
                    ? positional("seconds", seconds(payload.durationMs), {
                        presets: WAIT_PRESET_SECONDS,
                        apply: next => ({ ...payload, mode: "duration", durationMs: msOf(next) }),
                    })
                    : positional("seconds", "click")],
            };
        case "screenEffect":
            return {
                commandId,
                args: [
                    arg("d", seconds(payload.durationMs), { apply: next => ({ ...payload, durationMs: msOf(next) }) }),
                    arg("hold", seconds(payload.holdMs), { apply: next => ({ ...payload, holdMs: msOf(next) }) }),
                    arg("color", payload.color, { apply: next => ({ ...payload, color: next }) }),
                    arg("opacity", numberValue(payload.opacity), { apply: next => ({ ...payload, opacity: Number(next) }) }),
                ],
            };
        case "nvl":
            // NVL's `transition` is a transform ref (preset-based), not a `StoryTransitionRef` — the
            // one place the two shapes swap names, which is why it writes its own patch.
            return {
                commandId,
                args: [
                    arg("t", revealWord(payload.transition, "nvl"), {
                        enum: true,
                        apply: next => ({ ...payload, transition: { ...payload.transition, preset: transformPresetFor("nvl", next) } }),
                    }),
                    arg("d", seconds(payload.transition?.durationMs), {
                        apply: next => ({ ...payload, transition: { ...payload.transition, durationMs: msOf(next) } }),
                    }),
                ],
            };
        case "blueprint":
            // `/blueprint` takes no arguments, so the line would say strictly less than the row's own
            // sentence (which names the bound blueprint). The prose stands.
            return null;
    }
}

function blockSentence(block: StoryBlock, lookups: StoryCommandLineLookups): Sentence | null {
    if (block.kind === "action") {
        return actionSentence(block.payload, lookups);
    }
    if (block.kind === "jump") {
        const payload = block.payload;
        return {
            commandId: "jump",
            args: [
                positional("scene", getStorySceneName(lookups.scenes, payload.targetSceneId), {
                    // The one closed list the grammar cannot hold: which scenes exist is a fact about
                    // the project, so it arrives through the lookups the row already carries.
                    choices: Object.values(lookups.scenes ?? {}).map(scene => ({ value: scene.id, label: scene.name || scene.id })),
                    ...(payload.targetSceneId ? { editValue: payload.targetSceneId } : {}),
                    apply: next => ({ ...payload, targetSceneId: next }),
                }),
                arg("t", transitionWord(payload.transition?.kind, "scene"), {
                    enum: true,
                    apply: next => patchTransition(payload, { kind: transitionKindFor("scene", next) ?? "dissolve" }),
                }),
                arg("d", seconds(payload.transition?.durationMs), {
                    apply: next => patchTransition(payload, { durationMs: msOf(next) }),
                }),
            ],
        };
    }
    if (block.kind === "control") {
        if (block.payload.control === "label") {
            return { commandId: "label", args: [positional("name", block.payload.name)] };
        }
        if (block.payload.control === "goto") {
            const payload = block.payload;
            const labels = lookups.commandContext?.labels ?? [];
            return {
                commandId: "goto",
                args: [positional("target", payload.targetLabel, labels.length === 0 ? {} : {
                    choices: choicesOf(labels),
                    ...(payload.targetLabel ? { editValue: payload.targetLabel } : {}),
                    apply: next => ({ ...payload, targetLabel: next }),
                })],
            };
        }
        // Containers lead with their own pill and hold children; a one-line command would be a header
        // that lies about what the row is.
        return null;
    }
    // Prose, notes, declarations and invalid drafts all read as themselves already.
    return null;
}

/**
 * The command line a committed row reads as, or `null` when no command owns the row.
 *
 * Pure: everything project-shaped arrives through {@link StoryCommandLineLookups}, so the same call
 * answers for a row in the list, a row in a tooltip, or a row in a test with no services at all.
 */
export function projectStoryCommandLine(block: StoryBlock, lookups: StoryCommandLineLookups): StoryCommandLineProjection | null {
    const sentence = blockSentence(block, lookups);
    if (!sentence) {
        return null;
    }
    const def = getDefById(sentence.commandId);
    // The verb in the author's own command language, and always a spelling the parser accepts —
    // `localizedCommandToken` comes out of the same pass that built the parser's accept table.
    const verb = def ? localizedCommandToken(def) : sentence.commandId;
    return writeLine(def, verb, sentence.args);
}
