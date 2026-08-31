import type {
    StoryActionableTargetRef,
    StoryActionPayload,
    StoryBlock,
    StoryDeclarationPayload,
    StoryDisplayableTargetRef,
    StoryJumpPayload,
    StoryLiteralValue,
    StoryTransformRef,
    StoryTransitionRef,
    StoryVariableRef,
    StoryVariableValueType,
} from "@shared/types/story";
import {
    actionableSubjectWord,
    declarationDefaultForType,
    displayableSubjectWord,
    layerActionTargetRef,
    listSceneLabels,
    resolveDisplayableTargetRef,
    resolveStoryLayerRef,
    storyVariableRefKey,
} from "@shared/types/story";
import { APP_TAG_ID_RELEASE } from "@shared/types/appTag";
import { formatStorySecondsValue, storySecondsToMs } from "@shared/utils/storyTime";
import { translate } from "@/lib/i18n";

import {
    getStorySceneName,
    resolveStorySceneName,
    resolveStoryVariableName,
    storyCameraPanPlacement,
    storyCharacterName,
    variableRefShortLabel,
    type StoryRowLookups,
} from "@/lib/story/storyRowProjection";
import { storyVerbCommandId } from "@/lib/story/storyVerbVocabulary";
import { getPresetPosition } from "@/lib/ui-editor/runtime/game/storyTransformProps";
import { isNeutralStoryTransformProps } from "@shared/story/transformProps";
import { getStoryCameraLookPreset } from "@/lib/ui-editor/runtime/game/cameraLookPresets";
import { ACTION_TRIGGER } from "./commandTrigger";
import { actionableTargetRef, audioTargetRef, displayableTargetRef } from "./commands/payloadHelpers";
import { localizedEnumValue } from "./commands/localizedEnums";
import { localizedParamKey } from "./commands/localizedParams";
import { localizedUnit } from "./commands/localizedUnits";
import { getDefById, localizedCommandToken, retiredCommandToken } from "./commands/registry";
import { DECLARATION_COMMANDS } from "./commands/specs/variables";
import {
    patchTransformProp,
    patchTransformTiming,
    transformPropArgs,
    transformTimingArgs,
    type TransformPropArg,
} from "./commands/transformVocabulary";
import {
    applyPlacementToTransform,
    applyTransitionWordToTransform,
    placementWordFor,
    transitionKindFor,
    transitionWordFor,
    transitionWordForTransform,
} from "./commands/transitions";
import {
    findParam,
    matchEnumOption,
    paramTypes,
    type StoryCommandDef,
    type StoryCommandEnumOption,
    type StoryCommandParam,
} from "./storyCommandGrammar";
import { assetChoices } from "./storyCommandValues";
import type {
    StoryCommandContext,
    StoryCommandSpan,
    StoryCommandStageObjectKind,
    StoryCommandTargetValue,
} from "./storyCommandValues";

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
 * by design (`/show` lands on six different payloads, `/swap` on two) and lossy on purpose
 * (`t=fade` becomes `fadeIn` or `dissolve` depending on context). There is no mechanical inverse to
 * derive. What CAN be shared is the vocabulary, and all of it is: the verb comes from
 * {@link storyVerbCommandId} (the same table the row's verb word already used), the keys from
 * {@link localizedParamKey}, the enum words from {@link localizedEnumValue}, and the transition words
 * from the same `transitions.ts` tables `build` writes through, read backwards.
 *
 * `null` means "no command owns this row" — an inspector-only displayable operation, a container
 * header, a prose row. The caller keeps whatever it was already showing; this never invents a line.
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
    | {
          kind: "enum";
          options: readonly StoryCommandEnumOption[];
          /**
           * This slot also takes a drawn easing curve, so the popover offers the card as well as the
           * words. Set from the grammar (`freeform` on the enum type), never per command - a slot
           * that takes a curve on the line is the same slot that takes one in the inspector.
           */
          curve?: true;
      }
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

/**
 * What a pointing word on the line REFERS TO — the smallest fact the projection can state about it.
 *
 * Deliberately not a `SearchJumpTarget`, which is the workspace's deep-link vocabulary and the thing
 * a surface eventually navigates with. That type's `storyBlock` and `storyScene` arms want a
 * `storyId`, a `storyName` and a `sceneName`, and this layer has none of them: it is handed a scene
 * and a table of scenes, never the story that owns them, and reaching for one would mean threading
 * an id through `StoryRowLookups` purely so the projection could name a destination it never opens.
 *
 * So the projection states the reference and the React layer supplies the context — the same split
 * `motionName`, `pluginActionLabel` and `projectVariableName` already live by. It also keeps this
 * honest in the other direction: a link says what the word MEANS, and "and what opens it" stays one
 * decision made in one place rather than per command.
 *
 * `block` is always a row of the SAME scene the projected row lives in. Every index it can come from
 * is scene-scoped — the label scan, the stage-object declaration index, a layer's `sourceBlockId` —
 * so the caller already knows the scene and does not have to be told.
 */
export type StoryCommandLineRef =
    /** A cast member: the character editor, not the row they walk on in. */
    | { kind: "character"; characterId: string }
    | { kind: "asset"; assetId: string }
    | { kind: "scene"; sceneId: string }
    /**
     * A variable, as the reference the row stores. Only the ref: a scene variable is declared by a
     * row and a project one by the registry, and which surface each opens is the navigation layer's
     * call rather than a fact about the line.
     */
    | { kind: "variable"; target: StoryVariableRef }
    /**
     * A row — the label a `/goto` lands on, or the row that declares a stage object.
     *
     * `sceneId` is absent for all but one of them, and absent MEANS "this row's own scene": every
     * declaration index a line reads is scene-scoped, because every stage object but one ends with
     * the scene that made it. The exception is the ambience overlay, which the engine holds at game
     * level, so the row that declares the rain a scene hides is usually somewhere else entirely -
     * and a link to it has to say where.
     */
    | { kind: "block"; blockId: string; sceneId?: string };

/**
 * One pointing word inside the line: where it sits, and what it points at.
 *
 * The third string beside {@link StoryCommandLineEdit} and {@link StoryCommandLineOrnament}, recorded
 * by the same writer at the same moment for the same reason — only the code that put the word on the
 * line knows which stretch of `source` it occupies.
 *
 * A link and an edit on one token are two INTENTIONS, not two spellings of one: `/show Narra` already
 * opens a character picker on `Narra`, and pointing at who Narra is does not replace that. The two
 * spans are therefore either identical (same arg) or disjoint (different args) — never overlapping by
 * halves — which is what lets a renderer group by their union without a tie-break rule.
 */
export type StoryCommandLineLink = {
    span: StoryCommandSpan;
    ref: StoryCommandLineRef;
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
    /** Every word that names something else in the project, by where it sits in {@link source}. */
    links: readonly StoryCommandLineLink[];
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
    /**
     * What this arg's word points at, when it points at anything — see {@link StoryCommandLineLink}.
     *
     * Set only where the reference RESOLVED. A name that answers to nothing (a dangling reference, a
     * freely typed speaker, a document whose declaring row was deleted) carries no link at all: the
     * word still prints, it just is not a way through to something. One missing link costs a click;
     * one wrong link opens the wrong thing, which is the failure worth being strict about.
     */
    link?: StoryCommandLineRef;
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
 * Quote a value the tokenizer would otherwise mis-read. A value containing a single quote is wrapped
 * in double quotes, since the tokenizer has no escape syntax and both kinds group identically.
 *
 * Three characters force the quotes, and all three for the same reason — bare, they make the line
 * parse as something other than this value:
 *
 *  - **whitespace** splits one token into two;
 *  - **`=`** turns the token into a `key=value` pair, so a default of `a=b` reads as an unknown param;
 *  - **a quote character** opens a group that never closes, and the rest of the line falls inside it —
 *    which is how a description reading `it's fine` came back as an unterminated quote.
 *
 * A GREEDY slot is never quoted: it takes the rest of the line verbatim, so the quotes would land in
 * the value itself and a `/rename Alice The Stranger` would read back as one called `'The Stranger'`.
 */
function quoteValue(value: string, greedy: boolean): string {
    if (greedy) {
        return value;
    }
    // The empty string is a fourth case, and the quotes are not decoration: bare, it is not a token at
    // all, so the only way to WRITE one is an empty quoted token. Only an arg built directly can carry
    // it here — `arg()` reads `""` as "nothing to say" and drops the arg.
    if (value === "") {
        return "''";
    }
    if (!/[\s='"]/.test(value)) {
        return value;
    }
    return value.includes("'") ? `"${value}"` : `'${value}'`;
}

/**
 * The pause lengths `/wait` offers beside its input — the "high-frequency" set, in the
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
            return { kind: "enum", options: type.options, ...(type.freeform ? { curve: true as const } : {}) };
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
    const links: StoryCommandLineLink[] = [];
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
        // The SAME span the edit above would take, taken from the same two offsets — which is what
        // makes "identical or disjoint" a property of the writer rather than a hope about the callers.
        // The unit rides inside it for the same reason it rides inside an edit: half a token is not a
        // word, and a link stopping short of one would leave a dead tail beside it.
        if (entry.link) {
            links.push({ span: { start, end: source.length }, ref: entry.link });
        }
    }
    return { source, edits, ornaments, links };
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

/** Replace the whole ref, for the writers that state a look rather than one field of one. */
function patchTransformRef<P extends { transform?: StoryTransformRef }>(payload: P, next: StoryTransformRef | undefined): P {
    return { ...payload, transform: next };
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

// ---------------------------------------------------------------------------
// What a word points at
// ---------------------------------------------------------------------------

/**
 * The five resolvers below, and the one rule they share: **a link is only recorded when the reference
 * resolved right now**, against the very lookups that produced the word being printed.
 *
 * That pairing is the whole safety property. The line already prints an unresolvable reference as
 * something readable — the last name the author saw, a localised "unknown scene", the "this image is
 * gone" phrase — and every one of those is a word that points at nothing. Deriving the link from the
 * same lookup that decided the spelling is what stops a link ever being offered on one of them,
 * without a second list of "which names are real" to keep in step.
 */

/** A row in the projected row's own scene, when the id still answers to one. */
function blockLink(lookups: StoryCommandLineLookups, blockId: string | undefined): Pick<Arg, "link"> {
    return blockId && lookups.scene?.blocks[blockId] ? { link: { kind: "block", blockId } } : {};
}

/** The character an id names, when the project still holds one — the same lookup the word came from. */
function characterLink(lookups: StoryCommandLineLookups, characterId: string | undefined): Pick<Arg, "link"> {
    return characterId && lookups.character(characterId) ? { link: { kind: "character", characterId } } : {};
}

/**
 * The asset an id names, when the library still holds one.
 *
 * Gated on the lookup rather than on the id being set, because {@link assetWord} prints the "this
 * image is gone" phrase for an id that resolves to nothing — a word, and emphatically not a way to
 * open the file it is telling the author about.
 */
function assetLink(lookups: StoryCommandLineLookups, assetId: string | null | undefined): Pick<Arg, "link"> {
    return typeof assetId === "string" && lookups.assetName?.(assetId) ? { link: { kind: "asset", assetId } } : {};
}

/**
 * The row that DECLARES the stage object a subject addresses, when this scene still holds one.
 *
 * Two ways in, in the order the compiler itself resolves the object:
 *
 *  - the reference's own `sourceBlockId`, which is the stable anchor and follows renames;
 *  - failing that, the object's NAME against the declaration index — the answer for a document
 *    written before references existed, and for a reference whose anchor has gone dangling. Both
 *    resolve by name at runtime, so the index is not a guess here; it is what the row addresses.
 *
 * A built-in gets nothing: `bgm`, the scene background and the two default layers are stage
 * singletons the engine holds without any row declaring them, so there is no row to open.
 */
function stageObjectLink(
    lookups: StoryCommandLineLookups,
    kind: StoryCommandStageObjectKind,
    ref: { builtin?: string; sourceBlockId?: string } | undefined,
    name: string | undefined,
): Pick<Arg, "link"> {
    if (ref?.builtin) {
        return {};
    }
    const bound = blockLink(lookups, ref?.sourceBlockId);
    if (bound.link) {
        return bound;
    }
    const key = name?.trim().toLowerCase();
    return blockLink(lookups, key ? lookups.commandContext?.stageObjectSources?.[kind]?.[key] : undefined);
}

/**
 * The row that declares an ambience overlay, wherever in the story it is.
 *
 * The one link that may leave this scene, because the overlay is the one stage object that outlives
 * one: a `/hide rain` is very often written in a scene that never mentions rain otherwise, and being
 * taken to the row that started it is exactly what an author is asking for there.
 *
 * The row's own reference is still tried first and still wins, on the same terms as every other
 * subject - it is the stable anchor and it follows a rename - but only when it points into THIS
 * scene, which is all a bare block id can address. Anything else resolves by name through the
 * story-wide index, which is also how the compiler resolves it.
 */
function vfxLink(
    lookups: StoryCommandLineLookups,
    ref: { builtin?: string; sourceBlockId?: string } | undefined,
    name: string | undefined,
): Pick<Arg, "link"> {
    const bound = blockLink(lookups, ref?.sourceBlockId);
    if (bound.link) {
        return bound;
    }
    const key = name?.trim().toLowerCase();
    const declared = key ? lookups.commandContext?.vfxSources?.[key] : undefined;
    return declared ? { link: { kind: "block", blockId: declared.blockId, sceneId: declared.sceneId } } : {};
}

/**
 * The `label` row a `/goto` lands on, when this scene declares one by that name.
 *
 * Matched EXACTLY, case included, and resolved through the same scan the compiler validates with -
 * `Scene.constructLabels` keys a plain map on the declared string, so folding case here would offer
 * a jump to a row the engine would not have taken. The first declaration wins, which is again the
 * engine's rule: a duplicate name is reported as a duplicate, never resolved by position.
 */
function labelLink(lookups: StoryCommandLineLookups, targetLabel: string | undefined): Pick<Arg, "link"> {
    const name = targetLabel?.trim();
    if (!name) {
        return {};
    }
    const found = listSceneLabels(lookups.scene).find(label => label.name === name);
    return found ? { link: { kind: "block", blockId: found.blockId } } : {};
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

/**
 * An asset slot — the row's own library, by kind. Writes the id; the row goes on printing the name.
 *
 * `allowSets` says the same thing the param's own `allowSets` says, and has to agree with it: this
 * dropdown and the typed line write the SAME field, so a set the line resolves and this refuses to
 * list is a value the author can type and not pick, while the reverse is one they can pick and not
 * type back. `assetChoices` is the single answer both of them ask.
 *
 * The one slot that says no is the transition's rule image: it writes into the transition ref rather
 * than into `payload.assetId`, so assembly never resolves a set for it.
 */
function pickAsset(
    payload: { assetId?: string },
    lookups: StoryCommandLineLookups,
    kind: "image" | "audio" | "video",
    apply: (assetId: string) => StoryBlock["payload"],
    options?: { allowSets?: true },
): Pick<Arg, "choices" | "apply" | "editValue"> | null {
    const context = lookups.commandContext;
    if (!context) {
        return null;
    }
    const assets = assetChoices(context, kind, options?.allowSets);
    if (assets.length === 0) {
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

/**
 * The name a subject was re-pointed to, as the resolver would have handed it over had the author
 * typed it: the object plus the row that declares it, when the scene holds one.
 *
 * The declaring row is what a reference anchors to, and a context built without a scene has no such
 * index (`stageObjectSources` is optional for exactly that reason) - so the reference degrades to a
 * name, which is what every document written before references carries anyway.
 */
function stageObjectChoice(
    lookups: StoryCommandLineLookups,
    kind: StoryCommandStageObjectKind,
    name: string,
): Extract<StoryCommandTargetValue, { type: "stageObject" }> {
    const sourceBlockId = lookups.commandContext?.stageObjectSources?.[kind]?.[name.trim().toLowerCase()];
    return { type: "stageObject", objectKind: kind, name, known: true, ...(sourceBlockId ? { sourceBlockId } : {}) };
}

/**
 * Re-pointing a subject from the row rewrites the REFERENCE, not only the name.
 *
 * It always had to: the reference is what the compiler resolves, so a patch leaving the old anchor in
 * place moved the word on screen and nothing else. The row reading its subject off that reference is
 * what makes the omission visible - the line would have gone on printing the object just replaced.
 *
 * Written through the same helpers a typed line builds its payload with, so a subject picked from a
 * row is indistinguishable from one an author typed.
 */
function retargetDisplayable<P extends { objectName: string; target?: StoryDisplayableTargetRef }>(
    payload: P,
    lookups: StoryCommandLineLookups,
    kind: Extract<StoryCommandStageObjectKind, "image" | "text" | "layer">,
    name: string,
): P {
    return { ...payload, objectName: name, target: displayableTargetRef(stageObjectChoice(lookups, kind, name)) };
}

/**
 * {@link retargetDisplayable} for the `Actionable` handles — a clip, an overlay, a sound.
 *
 * `bgm` is why this one dispatches rather than always calling `actionableTargetRef`: the reserved
 * word names the built-in music channel, not a handle that happens to be called after it, and
 * `audioTargetRef` is where that rule already lives.
 */
function retargetActionable<P extends { objectName?: string; target?: StoryActionableTargetRef }>(
    payload: P,
    lookups: StoryCommandLineLookups,
    kind: Extract<StoryCommandStageObjectKind, "video" | "audio" | "vfx">,
    name: string,
): P {
    const choice = stageObjectChoice(lookups, kind, name);
    return {
        ...payload,
        objectName: name,
        target: kind === "audio" ? audioTargetRef(choice) : actionableTargetRef(choice),
    };
}

/** The `at=` word a row's position spells, or nothing when it is not one of the three placements. */
function placementOf(transform: StoryTransformRef | undefined): string | undefined {
    return placementWordFor(transform?.to?.position) ?? undefined;
}

/**
 * A stage object's `t=` — the reveal/conceal word, but never a placement (that slot is `at=`).
 *
 * Reads the CHANNEL the bag states rather than a stored preset name, which is the whole point of v18:
 * the row says what it does to the sprite and the word is derived from that, so a value set through
 * the inspector reads back as the line an author would have typed for it.
 */
function revealWord(transform: StoryTransformRef | undefined, direction: "reveal" | "conceal" | "nvl"): string | undefined {
    return transitionWordForTransform(direction, transform) ?? undefined;
}

/**
 * A whole-screen `rule=` — the picture a rule transition plays in the order of.
 *
 * Printed only when the row actually holds one, so every other transition's line is unchanged. The
 * value is the asset's own name and it is pickable, which is what keeps the row the line that
 * produced it rather than a description of it.
 */
function ruleArg(
    payload: Extract<StoryActionPayload, { action: "setBackground" }> | StoryJumpPayload,
    lookups: StoryCommandLineLookups,
): Arg | null {
    const ruleAssetId = payload.transition?.ruleAssetId;
    return arg("rule", assetWord(lookups, ruleAssetId), {
        ...(pickAsset({ ...(ruleAssetId ? { assetId: ruleAssetId } : {}) }, lookups, "image",
            next => patchTransition(payload, { kind: "ruleReveal", ruleAssetId: next })) ?? {}),
        ...assetLink(lookups, ruleAssetId),
    });
}

/**
 * `hold=` — the seconds the change sits at its extreme, printed only when the row states one.
 *
 * Beside `d=` and never inside it: the hold is taken out of the duration, so the two numbers are a
 * pair an author reads together. A row that has never been given one prints nothing here and gets
 * the transition's own default, which is how every existing line stays byte-identical.
 */
function holdArg<P extends { transition?: StoryTransitionRef }>(payload: P): Arg | null {
    return arg("hold", seconds(payload.transition?.holdMs), {
        apply: next => patchTransition(payload, { holdMs: msOf(next) }),
    });
}

/** A whole-screen or character `t=` — the stored kind, named by the word an author would type. */
function transitionWord(kind: StoryTransitionRef["kind"] | undefined, context: "scene" | "character" | "expression"): string | undefined {
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
    // its subject inline is a row whose plate is free to say what is being done to them. The link is
    // the third thing on that one word and a third intention again: not which character this row is
    // about (the pick) nor what they look like (the face), but who they ARE — the cast member, which
    // is a project record rather than anything in this scene.
    const who = {
        ...(pickCharacter(payload, lookups) ?? {}),
        ...(payload.characterId ? { ornament: { kind: "character" as const, id: payload.characterId } } : {}),
        ...characterLink(lookups, payload.characterId),
    };
    // A character's entrance and exit are driven by the TRANSFORM's duration, not the transition's —
    // the same field `hide()` reads (see `getQuickParams`), so that is the one an edit must write.
    const duration = arg("d", seconds(payload.transform?.durationMs), {
        apply: next => patchTransform(payload, { durationMs: msOf(next) }),
    });
    const placement = arg("pos", placementOf(payload.transform), {
        enum: true,
        apply: next => patchTransformRef(payload, applyPlacementToTransform(payload.transform, next)),
    });
    // `in=` / `out=` are the TRANSFORM's preset, the one the engine animates a character's entrance
    // and exit with and the one the inspector's own 变换 → 预设 edits. The `transition` ref beside it
    // is only read on `expression` (a portrait swap), so a row that showed it here was reporting a
    // field nothing would play — and disagreeing with the inspector about the very same question.
    // The key says the direction because the verb already decided it (M2: it was `t=`, which read as
    // the `t=` on `/bg` and named a different kind of thing entirely).
    const reveal = (direction: "reveal" | "conceal") => arg(direction === "reveal" ? "in" : "out", revealWord(payload.transform, direction), {
        enum: true,
        apply: next => patchTransformRef(payload, applyTransitionWordToTransform(payload.transform, direction, next)),
    });
    // `/face` is the one character row the engine plays a `StoryTransitionRef` on - it swaps the
    // image source, and `char(src, transition)` is what the compiler emits. So BOTH of these read and
    // write `payload.transition`, never the transform: `duration` above is the transform's, the field
    // an entrance and an exit animate through, and binding a swap's `d=` there would give the author
    // a number that edits cleanly and changes nothing on stage.
    const swapTransition = arg("t", transitionWord(payload.transition?.kind, "expression"), {
        enum: true,
        apply: next => patchTransition(payload, { kind: transitionKindFor("expression", next) ?? "fadeIn" }),
    });
    const swapDuration = arg("d", seconds(payload.transition?.durationMs), {
        apply: next => patchTransition(payload, { durationMs: msOf(next) }),
    });
    const swapHold = holdArg(payload);
    switch (payload.operation) {
        case "enter":
            return {
                commandId,
                args: [positional("target", name, who), form, placement, reveal("reveal"), duration],
            };
        case "exit":
            return { commandId, args: [positional("target", name, who), reveal("conceal"), duration] };
        case "move":
            // `/move` is retired: a move is a position, which is a prop of the one bag, so the row
            // reads back as the row that writes one. `/transform` names its subject `target`.
            return { commandId, args: [positional("target", name, who), placement, duration] };
        case "expression":
            return { commandId, args: [positional("character", name, who), form, swapTransition, swapDuration, swapHold] };
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
    const name = actionableSubjectWord(lookups.scene, payload.target, "audio", payload.objectName) || undefined;
    const asset = assetWord(lookups, payload.assetId);
    const track = payload.audioTrackId && lookups.audioTrackName ? lookups.audioTrackName(payload.audioTrackId) : null;
    const fade = arg("fade", seconds(payload.fadeMs), { apply: next => ({ ...payload, fadeMs: msOf(next) }) });
    const clip = { ...(pickAsset(payload, lookups, "audio", next => ({ ...payload, assetId: next }), { allowSets: true }) ?? {}), ...assetLink(lookups, payload.assetId) };
    // The handle a control verb addresses: any sound already on stage, plus the reserved `bgm`.
    const handle = {
        ...(pickStageObject(lookups, "audio", name, next => retargetActionable(payload, lookups, "audio", next)) ?? {}),
        ...stageObjectLink(lookups, "audio", payload.target, name),
    };
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
    const waitForEnd = arg("wait", booleanValue(payload.waitForEnd), { apply: next => ({ ...payload, waitForEnd: next === "true" }) });
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
                    waitForEnd,
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

/**
 * The subject comes from the REFERENCE, not from the row's own `objectName` — the rule
 * `displayableSubjectWord` states, and the shape every stage-object sentence below shares. A row
 * printing its stored copy of the name kept saying `poster` after the create row was renamed to `bg`,
 * while the compiler had already followed the reference. A `create` row carries no reference and so
 * prints the name it is defining, which is the same fallback an older document takes.
 */
function imageSentence(
    payload: Extract<StoryActionPayload, { action: "image" }>,
    lookups: StoryCommandLineLookups,
    commandId: string,
): Sentence | null {
    const name = displayableSubjectWord(lookups.scene, payload.target, payload.objectName) || undefined;
    const asset = assetWord(lookups, payload.assetId);
    // `pos=` and `in=` write the SAME field — a transform holds one preset — which is why the reader
    // prints whichever one the stored preset spells and never both.
    const placement = arg("pos", placementOf(payload.transform), {
        enum: true,
        apply: next => patchTransformRef(payload, applyPlacementToTransform(payload.transform, next)),
    });
    const duration = arg("d", seconds(payload.transform?.durationMs), {
        apply: next => patchTransform(payload, { durationMs: msOf(next) }),
    });
    const reveal = (direction: "reveal" | "conceal") => arg(direction === "reveal" ? "in" : "out", revealWord(payload.transform, direction), {
        enum: true,
        apply: next => patchTransformRef(payload, applyTransitionWordToTransform(payload.transform, direction, next)),
    });
    const swapAsset = {
        ...(pickAsset(payload, lookups, "image", next => ({ ...payload, assetId: next, color: undefined }), { allowSets: true }) ?? {}),
        ...assetLink(lookups, payload.assetId),
    };
    const object = {
        ...(pickStageObject(lookups, "image", name, next => retargetDisplayable(payload, lookups, "image", next)) ?? {}),
        ...stageObjectLink(lookups, "image", payload.target, name),
    };
    if (payload.operation === "create") {
        // The NAME here is the one later rows address, so it is not offered; the asset is.
        return {
            commandId,
            args: [positional("image", asset ?? payload.color, swapAsset), arg("name", name), placement, reveal("reveal"), duration],
        };
    }
    if (payload.operation === "setSource") {
        // `char(src, transition)` is what this row compiles to, so it plays a transition exactly the
        // way `/face` does - and until these slots existed, one set in the inspector was a setting the
        // line could not say.
        return {
            commandId,
            args: [
                positional("target", name, object),
                positional("content", asset ?? payload.color, swapAsset),
                arg("t", transitionWord(payload.transition?.kind, "expression"), {
                    enum: true,
                    apply: next => patchTransition(payload, { kind: transitionKindFor("expression", next) ?? "fadeIn" }),
                }),
                arg("d", seconds(payload.transition?.durationMs), {
                    apply: next => patchTransition(payload, { durationMs: msOf(next) }),
                }),
                holdArg(payload),
            ],
        };
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
    const name = displayableSubjectWord(lookups.scene, payload.target, payload.objectName) || undefined;
    const object = {
        ...(pickStageObject(lookups, "text", name, next => retargetDisplayable(payload, lookups, "text", next)) ?? {}),
        ...stageObjectLink(lookups, "text", payload.target, name),
    };
    switch (payload.operation) {
        case "create":
            // `name=` before the greedy content: the one ordering rule the grammar imposes, and the
            // line has to be written in an order that parses back.
            return {
                commandId,
                args: [
                    arg("name", name),
                    arg("pos", placementOf(payload.transform), {
                        enum: true,
                        apply: next => patchTransformRef(payload, applyPlacementToTransform(payload.transform, next)),
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
                    arg(direction === "reveal" ? "in" : "out", revealWord(payload.transform, direction), {
                        enum: true,
                        apply: next => patchTransformRef(payload, applyTransitionWordToTransform(payload.transform, direction, next)),
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
    const resolved = payload.operation === "create"
        ? null
        : resolveStoryLayerRef(lookups.scene, layerActionTargetRef(payload.target, payload.objectName));
    const name = payload.operation === "create"
        ? payload.objectName?.trim() || undefined
        : resolved?.name || undefined;
    if (payload.operation === "create" || payload.operation === "setZIndex") {
        return {
            commandId,
            args: [positional("name", name), arg("z", numberValue(payload.zIndex), { apply: next => ({ ...payload, zIndex: Number(next) }) })],
        };
    }
    // The declaring `/layer` row, on the same terms as every other stage object: the ref's anchor
    // first, then the name against the declaration index for a document written before anchors. A
    // DEFAULT layer resolves to neither, and rightly — `backgroundLayer` is a reserved word for a
    // layer the engine ships, so there is no row anywhere that made it.
    const link = resolved?.kind === "custom"
        ? stageObjectLink(lookups, "layer", { ...(resolved.sourceBlockId ? { sourceBlockId: resolved.sourceBlockId } : {}) }, name)
        : {};
    // A layer reference stores a stable `sourceBlockId` binding that follows renames; re-pointing it
    // by name would drop that anchor, so a layer target is read here and re-bound in the inspector.
    if (payload.operation === "transform") {
        return { commandId, args: [positional("target", name, link), ...transformArgs(payload, lookups)] };
    }
    return { commandId, args: [positional("target", name, link)] };
}

function videoSentence(
    payload: Extract<StoryActionPayload, { action: "video" }>,
    lookups: StoryCommandLineLookups,
    commandId: string,
): Sentence | null {
    const name = actionableSubjectWord(lookups.scene, payload.target, "video", payload.objectName) || undefined;
    const object = {
        ...(pickStageObject(lookups, "video", name, next => retargetActionable(payload, lookups, "video", next)) ?? {}),
        ...stageObjectLink(lookups, "video", payload.target, name),
    };
    if (payload.operation === "create") {
        return {
            commandId,
            args: [
                positional("video", assetWord(lookups, payload.assetId), {
                    ...(pickAsset(payload, lookups, "video", next => ({ ...payload, assetId: next }), { allowSets: true }) ?? {}),
                    ...assetLink(lookups, payload.assetId),
                }),
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
    const name = actionableSubjectWord(lookups.scene, payload.target, "vfx", payload.objectName) || undefined;
    const duration = arg("d", seconds(payload.durationMs), { apply: next => ({ ...payload, durationMs: msOf(next) }) });
    if (payload.operation === "create") {
        return {
            commandId,
            args: [
                // A seeded overlay says its weather WORD in the slot a clip would name, because that
                // is what the author typed and what the line has to take back: printed as a clip that
                // is not there, the row read as an overlay with no source at all, and re-typing it
                // produced exactly that. No picker on this branch - the source select in the
                // inspector is what swaps a seed for a clip, and it clears the parameters of
                // whichever it left behind, which a slot-level pick could not do.
                payload.seed
                    ? positional("clip", payload.seed.seed, { enum: true })
                    : positional("clip", assetWord(lookups, payload.assetId), {
                        ...(pickAsset(payload, lookups, "video", next => ({ ...payload, assetId: next }), { allowSets: true }) ?? {}),
                        ...assetLink(lookups, payload.assetId),
                    }),
                arg("name", name),
                arg("opacity", numberValue(payload.opacity), { apply: next => ({ ...payload, opacity: Number(next) }) }),
            ],
        };
    }
    const object = {
        ...(pickStageObject(lookups, "vfx", name, next => retargetActionable(payload, lookups, "vfx", next)) ?? {}),
        ...vfxLink(lookups, payload.target, name),
    };
    if (payload.operation === "setRate") {
        return {
            commandId,
            args: [positional("target", name, object), positional("rate", numberValue(payload.rate), { apply: next => ({ ...payload, rate: Number(next) }) })],
        };
    }
    // `/show` and `/hide` carry the fade an overlay waits out; `/pause` and `/resume` take the name alone.
    const fades = payload.operation === "show" || payload.operation === "hide";
    // Only on the way in: a fade out ends at zero with the clip stopped, so neither has anything
    // to say there - and `/hide` does not take either word.
    const showing = payload.operation === "show";
    return {
        commandId,
        args: [
            positional("target", name, object),
            fades ? duration : null,
            showing ? arg("opacity", numberValue(payload.opacity), { apply: next => ({ ...payload, opacity: Number(next) }) }) : null,
            showing ? arg("rate", numberValue(payload.rate), { apply: next => ({ ...payload, rate: Number(next) }) }) : null,
        ],
    };
}

/**
 * A camera row, as the `/transform camera …` line that would produce it.
 *
 * The same sentence every other transform row has, and since v19 the same payload underneath: a
 * subject, then the channels the bag states. There is nothing camera-shaped left here except which
 * word names the subject and the fact that `reset` is its own verb.
 */
function cameraSentence(
    payload: Extract<StoryActionPayload, { action: "camera" }>,
    lookups: StoryCommandLineLookups,
    commandId: string,
): Sentence {
    const subject = positional("target", "camera");
    if (payload.operation === "reset") {
        // Its own command - `/reset camera` - and the one camera row whose word the whole vocabulary
        // shares with every other subject. Its timing is on the payload, not in a ref, because there
        // is no bag to hang one on.
        return {
            commandId,
            args: [subject, arg("d", seconds(payload.durationMs), { apply: next => ({ ...payload, durationMs: msOf(next) }) })],
        };
    }
    if (payload.transform?.mode === "animation") {
        // A Story Motion states its shot in a binding rather than in props, so the line says which
        // mode the row is in and the shot's name rides the inspector.
        return { commandId, args: [subject, arg("motion", "true")] };
    }
    return { commandId, args: [subject, ...transformArgs(payload, lookups)] };
}

/**
 * The prop bag as line args, with each printed value wired back to the channel it came from./**
 * The prop bag as line args, with each printed value wired back to the channel it came from.
 *
 * Shared by every row that carries a transform, which since M2 is every displayable row: the props
 * and the timing are one vocabulary and one table (`commands/transformVocabulary.ts`), read forwards
 * by the spec's `build` and backwards here. There is no per-command list of "which props this row can
 * show" - a row shows what its bag states.
 */
function transformArgs<P extends StoryBlock["payload"] & { transform?: StoryTransformRef }>(
    payload: P,
    lookups: StoryCommandLineLookups,
): Arg[] {
    const transform = payload.transform;
    const assetName = (assetId: string): string | undefined => assetWord(lookups, assetId);
    const propArg = (entry: TransformPropArg): Arg => arg(entry.key, entry.value, {
        ...(entry.enum ? { enum: true } : {}),
        // `mask` prints the asset's name while the bag stores its id, so it has no writer here and is
        // re-pointed from the inspector's picker instead. It is still the one prop on the bag that
        // NAMES a project file, so it is the one prop that points at one.
        ...(entry.key === "mask" ? assetLink(lookups, transform?.to?.maskAssetId) : {
            apply: (next: string) => patchTransformRef(payload, { ...(transform ?? {}), to: patchTransformProp(transform?.to, entry.key, next) }),
        }),
    })!;
    const timingArg = (entry: TransformPropArg): Arg => arg(entry.key, entry.value, {
        ...(entry.enum ? { enum: true } : {}),
        ...(entry.key === "from" ? {} : {
            apply: (next: string) => patchTransformRef(payload, patchTransformTiming(transform, entry.key, next)),
        }),
    })!;
    return [
        ...transformPropArgs(transform?.to, assetName).map(propArg),
        ...transformTimingArgs(transform).map(timingArg),
    ];
}

function displayableSentence(
    payload: Extract<StoryActionPayload, { action: "displayable" }>,
    lookups: StoryCommandLineLookups,
    commandId: string,
): Sentence | null {
    const label = displayableTargetWord(lookups, payload.target);
    // A displayable row whose subject is a CHARACTER wears that character's face, exactly as the
    // character payload's rows do. The row is the same sentence about the same person, and M2 moved
    // several of them onto this arm (`/move` became `/transform <who> pos=`) - a face that vanished
    // on the way would have made the change look like a different kind of row.
    const who = { ...displayableFace(lookups, payload.target, label), ...displayableLink(lookups, payload.target, label) };
    // `/front hero`, whole. The subject is the only thing this row states: there is no bag to print
    // and no `d=` to offer, so anything else here would be a token the line cannot carry back.
    if (payload.operation === "bringToFront") {
        return { commandId, args: [positional("target", label, who)] };
    }
    // Ending a loop is a `/transform` line whose whole content is the flag and how long the way back
    // takes. No bag is printed because a `stopLoop` row holds none - see the spec's refusal.
    if (payload.operation === "stopLoop") {
        return {
            commandId,
            args: [
                positional("target", label, who),
                arg("stopLoop", "true"),
                arg("d", seconds(payload.transform?.durationMs), {
                    apply: next => patchTransform(payload, { durationMs: msOf(next) }),
                }),
            ],
        };
    }
    if (payload.operation === "transform" || payload.operation === "loop") {
        // The flag is what makes the row read as the thing it is - a motion that keeps going rather
        // than a pose the scene waits for - so it is printed first, next to the subject.
        const looping = payload.operation === "loop" ? [arg("loop", "true")] : [];
        // A Story Motion states its shot in a binding rather than in props, so the line says which
        // mode the row is in and the motion's name rides the inspector - the same shape the retired
        // `/camera motion` had.
        if (payload.transform?.mode === "animation") {
            return { commandId, args: [positional("target", label, who), ...looping, arg("motion", "true")] };
        }
        // The whole neutral bag, and only the whole one, is a `/reset`. A partial clear prints as the
        // `=none` that produced it (`/transform hero mask=none`), which is the same row and the
        // spelling the vocabulary calls canonical.
        if (payload.operation === "transform" && isNeutralStoryTransformProps(payload.transform?.to)) {
            return {
                commandId: "reset",
                args: [
                    positional("target", label, who),
                    arg("d", seconds(payload.transform?.durationMs), {
                        apply: next => patchTransform(payload, { durationMs: msOf(next) }),
                    }),
                ],
            };
        }
        return { commandId, args: [positional("target", label, who), ...looping, ...transformArgs(payload, lookups)] };
    }
    const direction = payload.operation === "show" ? "reveal" : "conceal";
    return {
        commandId,
        args: [
            positional("target", label, who),
            arg(direction === "reveal" ? "in" : "out", revealWord(payload.transform, direction), {
                enum: true,
                apply: next => patchTransformRef(payload, applyTransitionWordToTransform(payload.transform, direction, next)),
            }),
            arg("d", seconds(payload.transform?.durationMs), {
                apply: next => patchTransform(payload, { durationMs: msOf(next) }),
            }),
        ],
    };
}

/**
 * Which cast member a displayable row's subject is, when the subject is a character at all.
 *
 * Two ways in, the anchor first: a `sourceBlockId` still pointing at the row that walked them on
 * carries the id outright, and only failing that is the printed word matched against the cast. The
 * fallback is the older of the two and is a NAME match, so it is right exactly as often as the name
 * is unique - which is why it is the fallback.
 */
function displayableCharacterId(
    lookups: StoryCommandLineLookups,
    target: Extract<StoryActionPayload, { action: "displayable" }>["target"],
    label: string | undefined,
): string | undefined {
    const source = target.sourceBlockId ? lookups.scene?.blocks[target.sourceBlockId] : undefined;
    if (source?.kind === "action" && source.payload.action === "character" && source.payload.characterId) {
        return source.payload.characterId;
    }
    const needle = label?.trim().toLowerCase();
    if (!needle) {
        return undefined;
    }
    return (lookups.commandContext?.characters ?? [])
        .find(entry => entry.name.trim().toLowerCase() === needle)?.id;
}

/** The face ornament for a displayable row addressing a character, or nothing for any other subject. */
function displayableFace(
    lookups: StoryCommandLineLookups,
    target: Extract<StoryActionPayload, { action: "displayable" }>["target"],
    label: string | undefined,
): Pick<Arg, "ornament"> {
    if (target.kind !== "character") {
        return {};
    }
    const characterId = displayableCharacterId(lookups, target, label);
    return characterId ? { ornament: { kind: "character", id: characterId } } : {};
}

/**
 * What a displayable row's subject points at: the cast member, or the row that declares the object.
 *
 * The one arm that dispatches on the target's KIND, because this is the one subject slot that can
 * hold either sort of thing - `/front hero` and `/front Alice` are the same sentence about two
 * different kinds of subject, and they lead to two different places. A built-in leads nowhere: the
 * scene background and the two default layers are singletons the engine holds without any row.
 */
function displayableLink(
    lookups: StoryCommandLineLookups,
    target: Extract<StoryActionPayload, { action: "displayable" }>["target"],
    label: string | undefined,
): Pick<Arg, "link"> {
    if (target.builtin) {
        return {};
    }
    if (target.kind === "character") {
        return characterLink(lookups, displayableCharacterId(lookups, target, label));
    }
    // A reference written before `kind` existed can still carry an anchor, so the anchor is tried
    // whatever the kind says; only the name fallback needs to know which index to look in.
    const bound = blockLink(lookups, target.sourceBlockId);
    return bound.link ? bound : target.kind ? stageObjectLink(lookups, target.kind, undefined, label) : {};
}

/**
 * The word a displayable target is written as on a line.
 *
 * A built-in prints its RESERVED WORD, not its label: "Background layer" is two tokens and the target
 * slot takes one, so a row printing the label would produce a line the parser splits in half. The
 * reserved word is what the slot answers to and what the candidate menu offers, so it is the only
 * spelling that round-trips.
 */
function displayableTargetWord(
    lookups: StoryCommandLineLookups,
    target: Extract<StoryActionPayload, { action: "displayable" }>["target"],
): string | undefined {
    if (target.builtin) {
        return target.builtin;
    }
    return resolveDisplayableTargetRef(lookups.scene, target).label || undefined;
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
                    positional("image", assetWord(lookups, payload.assetId) ?? payload.color, {
                        // A colour background has no asset to pick from, so it keeps its text.
                        ...(payload.assetId ? pickAsset(payload, lookups, "image", next => ({ ...payload, assetId: next, color: undefined }), { allowSets: true }) ?? {} : {}),
                        ...assetLink(lookups, payload.assetId),
                    }),
                    arg("t", transitionWord(payload.transition?.kind, "scene"), {
                        enum: true,
                        apply: next => patchTransition(payload, { kind: transitionKindFor("scene", next) ?? "dissolve" }),
                    }),
                    ruleArg(payload, lookups),
                    arg("d", seconds(payload.transition?.durationMs), {
                        apply: next => patchTransition(payload, { durationMs: msOf(next) }),
                    }),
                    holdArg(payload),
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
            return cameraSentence(payload, lookups, commandId);
        case "displayable":
            // All three, and there is no fourth: v18 folded the twelve appearance operations into
            // `transform` + a prop bag, and M2 gave every prop in that bag a spelling.
            return displayableSentence(payload, lookups, commandId);
        case "setVariable": {
            const variables = lookups.commandContext?.variables ?? [];
            return {
                commandId,
                args: [
                    positional("variable", variableRefShortLabel(payload.target, lookups), {
                        ...(variables.length === 0 ? {} : {
                            // Keyed by the ref's own key, since a variable is a scope plus an id rather
                            // than a name — two scopes may hold the same word.
                            choices: variables.map(entry => ({ value: storyVariableRefKey(entry.ref), label: entry.name })),
                            editValue: storyVariableRefKey(payload.target),
                            apply: (next: string) => {
                                const found = variables.find(entry => storyVariableRefKey(entry.ref) === next);
                                return found ? { ...payload, target: found.ref } : payload;
                            },
                        }),
                        // The ref, and only the ref: a scene variable is declared by a row in this
                        // scene while a project one is declared in the registry, so where each opens
                        // is a navigation decision rather than a fact the line can state. Gated on the
                        // name having RESOLVED, since the alternative spelling is the localised
                        // fallback word — a row saying "variable" points at nothing.
                        ...(resolveStoryVariableName(payload.target, lookups) !== null
                            ? { link: { kind: "variable" as const, target: payload.target } }
                            : {}),
                    }),
                    positional("value", payload.expression?.source ?? String(payload.value)),
                ],
            };
        }
        case "wait":
            return {
                commandId,
                args: [payload.mode === "duration"
                    // The house set rides along, so the common pauses are one click rather
                    // than a number to type.
                    ? positional("seconds", seconds(payload.durationMs), {
                        presets: WAIT_PRESET_SECONDS,
                        apply: next => ({ ...payload, mode: "duration", durationMs: msOf(next) }),
                    })
                    : positional("seconds", "click")],
            };
        case "nvl":
            // NVL's `transition` is a transform ref (preset-based), not a `StoryTransitionRef` — the
            // one place the two shapes swap names, which is why it writes its own patch.
            return {
                commandId,
                args: [
                    arg("in", revealWord(payload.transition, "nvl"), {
                        enum: true,
                        apply: next => ({ ...payload, transition: applyTransitionWordToTransform(payload.transition, "nvl", next) }),
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
        case "plugin":
            // Unreachable in practice - `storyVerbCommandId` has already returned null above, because
            // a plugin's action is not in the command registry and cannot be: the registry is a closed
            // union the parser, the manual and four derived tables all read, and a command that comes
            // and goes with an install would put a hole in every one of them. The arm exists so this
            // switch stays exhaustive, which is what makes the next payload added here a compile
            // error rather than a row that silently renders as nothing.
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
                    // Off the same resolution the printed word came from, which is what keeps the
                    // "unknown scene" and "no scene" phrases from ever being a way through.
                    ...(payload.targetSceneId && resolveStorySceneName(lookups.scenes, payload.targetSceneId) !== null
                        ? { link: { kind: "scene" as const, sceneId: payload.targetSceneId } }
                        : {}),
                }),
                arg("t", transitionWord(payload.transition?.kind, "scene"), {
                    enum: true,
                    apply: next => patchTransition(payload, { kind: transitionKindFor("scene", next) ?? "dissolve" }),
                }),
                ruleArg(payload, lookups),
                arg("d", seconds(payload.transition?.durationMs), {
                    apply: next => patchTransition(payload, { durationMs: msOf(next) }),
                }),
                holdArg(payload),
                // Printed only when it is on, and spelled out as `return=true` the way every bare
                // flag reads back. A row that has never been flagged prints the line it has always
                // printed, so an existing project's jumps are untouched by the flag existing.
                arg("return", payload.returnable ? "true" : undefined, {
                    apply: next => ({ ...payload, returnable: next === "true" ? true : undefined }),
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
                args: [positional("target", payload.targetLabel, {
                    ...(labels.length === 0 ? {} : {
                        choices: choicesOf(labels),
                        ...(payload.targetLabel ? { editValue: payload.targetLabel } : {}),
                        apply: (next: string) => ({ ...payload, targetLabel: next }),
                    }),
                    ...labelLink(lookups, payload.targetLabel),
                })],
            };
        }
        if (block.payload.control === "cut") {
            const payload = block.payload;
            // The authored variants: the same list the slot offers, so switching from the row cannot
            // write a value the line could not have been typed with.
            const tags = (lookups.commandContext?.appTags ?? []).filter(tag => tag.id !== APP_TAG_ID_RELEASE);
            // Named, never the stored id - and blank when no variant answers to it, which is a
            // deleted one. The row then prints `/cut`, i.e. a cut point that names nothing, which is
            // what it has become.
            const name = tags.find(tag => tag.id === payload.appTagId)?.name ?? "";
            return {
                commandId: "cut",
                args: [positional("tag", name, tags.length === 0 ? {} : {
                    choices: tags.map(tag => ({ value: tag.id, label: tag.name })),
                    ...(payload.appTagId ? { editValue: payload.appTagId } : {}),
                    apply: next => ({ ...payload, appTagId: next }),
                })],
            };
        }
        // The name is written straight, exactly as a label's is: it is the author's own words, it is
        // what the line was typed with, and it is the only part of the row a line can carry - the
        // page the ending lands on is picked in the inspector.
        if (block.payload.control === "ending") {
            return { commandId: "ending", args: [positional("name", block.payload.name)] };
        }
        if (block.payload.control === "quit") {
            const payload = block.payload;
            const pages = lookups.commandContext?.surfaces ?? [];
            // Named, never the stored id - and blank when no page answers to it, which is a deleted
            // one. The row then prints `/quit`, i.e. a quit that names nowhere, which is what it has
            // become and what `story/quit-page-missing` reports.
            const name = pages.find(page => page.id === payload.surfaceId)?.name ?? "";
            return {
                commandId: "quit",
                args: [positional("page", name, pages.length === 0 ? {} : {
                    choices: pages.map(page => ({ value: page.id, label: page.name })),
                    ...(payload.surfaceId ? { editValue: payload.surfaceId } : {}),
                    apply: next => ({ ...payload, surfaceId: next }),
                })],
            };
        }
        // Containers lead with their own pill and hold children; a one-line command would be a header
        // that lies about what the row is.
        return null;
    }
    if (block.kind === "declaration") {
        return declarationSentence(block.payload);
    }
    // Prose, notes and invalid drafts all read as themselves already.
    return null;
}

/**
 * A declaration row as the line that declares it — `/local hp 100 type=number desc='Player health'`.
 *
 * This row was the last one printing a *description* (`hp: number = 100`) after every other row had
 * moved to printing its line, and the carve-out that kept it there does not survive contact with its
 * own reason: "no command owns this row". `/local` owns it exactly the way `/hide` owns a hide row —
 * it is the command that built it, `declarationFromArgs` is a pure reader of the same args, and the
 * round trip in `storyCommandLine.test.ts` proves the line rebuilds the payload. The rows that still
 * answer `null` above fail a test this one passes: a container header holds children, and a
 * `/blueprint` line has no arguments to carry what the row says.
 *
 * The prose reading cost the author two things a line does not: the type came out as the internal
 * `number` in an editor set to Chinese (the row said a word the author cannot type, in a language
 * they are not writing in), and the description was simply not shown — a row that says less than the
 * line that made it.
 *
 * `type=` is always written, even where the author left it out. A declaration's type is INFERRED from
 * the default when it is omitted (`/local hp 100` is a number), so the row printing it is the row
 * saying what the editor decided — the one thing an author most needs to see confirmed, and the same
 * reason `/hide Alice` reads back with the transition it defaulted to.
 */
function declarationSentence(payload: StoryDeclarationPayload): Sentence {
    return {
        commandId: DECLARATION_COMMANDS[payload.scope],
        args: [
            // The name is printed, never offered: unlike a stage object's name it is safe to change
            // (v6 references resolve by the row's id, not by spelling), but it is still text with no
            // closed list behind it — the same slot `/rename`'s new name fills.
            positional("name", payload.name),
            declarationDefaultArg(payload.defaultValue),
            arg("type", payload.valueType, {
                enum: true,
                // The default follows the type, exactly as the inspector's dropdown makes it follow:
                // one shared rule, or a retype would leave a different value behind depending on
                // which surface the author did it from — and `hp: boolean = 100` is a variable whose
                // own line contradicts itself.
                apply: next => ({
                    ...payload,
                    valueType: next as StoryVariableValueType,
                    defaultValue: declarationDefaultForType(next as StoryVariableValueType),
                }),
            }),
            arg("desc", payload.description),
        ],
    };
}

/**
 * A declaration's stored default as the token that reads back to it, or `null` when it declares none.
 *
 * Written with its KEY (`初始值=false`) even though the slot is positional, and it is the only arg in
 * the table that is. The name is the row's subject; everything after it is a modifier, and a bare
 * `false` sitting between the name and `类型=布尔` was the one token on the line with nothing to say
 * what it was. Keys are the author's own setting to hide (`editor.hideParamNames`), which is what
 * makes spelling this one out the safe default rather than an imposition.
 *
 * Built directly rather than through {@link arg} for one value: the EMPTY string. `arg()` reads `""`
 * as "nothing to say" and drops the arg, and dropping this one would declare a different variable —
 * an absent default is never seeded at all (a saved one seeds `null`), while an empty one seeds the
 * empty string, and `""` is exactly what a retype to `string` leaves behind. {@link quoteValue} is
 * what makes it a legal token.
 *
 * Everything that is not a string goes through `JSON.stringify`, which writes numbers, booleans,
 * `null`, lists and objects in the one syntax `parseLiteral` reads back.
 */
function declarationDefaultArg(value: StoryLiteralValue | undefined): Arg | null {
    if (value === undefined) {
        return null;
    }
    return { param: "default", value: typeof value === "string" ? value : JSON.stringify(value) };
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
    //
    // A row whose command was RETIRED has neither: no def, so no localized spelling and no localized
    // keys either, and the whole line comes out in the source vocabulary. It still has to say the verb
    // the author would have typed — a `saved` declaration surviving in a frozen project reads
    // `/save Honest type=boolean`, not `/declareVar Honest type=boolean`, which is a name from the
    // inside of this module and is also what the script export would put in the file.
    //
    // That line no longer re-parses, and must not: re-importing it would recreate a project-scope
    // declaration inside a story document, which is the shape the retirement exists to remove.
    const verb = def ? localizedCommandToken(def) : retiredCommandToken(sentence.commandId) ?? sentence.commandId;
    return writeLine(def, verb, sentence.args);
}
