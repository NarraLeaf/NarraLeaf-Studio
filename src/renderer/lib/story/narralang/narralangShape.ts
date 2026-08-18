/**
 * The structural half of a NarraLang line.
 *
 * Design doc: `docs/plans/2026-08-15-001-plan-narralang.md`.
 *
 * A shape says WHICH statement a payload is and WHAT it carries; it never says how any of it is
 * spelled. `show 爱丽丝 smile at left over 0.3` is, here, the verb `characterEnter` with a `subject`,
 * an `appearance`, a `placement` of `left` and a `transformDuration` of 300ms - no `show`, no `at`,
 * no `0.3`. Every one of those words lives in {@link ./narralangDialect}, and swapping that table is
 * what lets a project rename a verb, move a modifier onto a different preposition, or fence rich text
 * with `[i]` instead of `{i}` without a line of the printer changing.
 *
 * Two properties this file is shaped to hold:
 *
 *  1. **No spelling in a slot value.** A placement is the word `left`, not the string `"at left"`.
 *     The moment a value carries its own preposition the dialect stops being able to move it.
 *  2. **Every slot declares a type.** The dialect pairs each slot with a preposition and a value
 *     kind, so the same table a printer walks forwards is one a parser can walk backwards - the
 *     matcher for M3 reads "after `at`, expect a word" off exactly these declarations.
 */

import type {
    StoryLiteralValue,
    StoryTextMarks,
    StoryVariableScope,
    StoryVariableValueType,
    StoryVfxBlendMode,
} from "@shared/types/story";
import type { StoryTransitionWord } from "@/apps/workspace/modules/story/scene-editor/commands/transitions";

// --- Verbs ----------------------------------------------------------------------------------------

/**
 * Every statement NarraLang can say, as a structural name.
 *
 * One verb per *meaning*, not per keyword: `characterEnter` and `imageShow` are separate verbs that
 * the default dialect happens to spell with the same word, because a dialect must be free to split
 * them and a matcher has to tell them apart by their arguments anyway. The inverse is also true -
 * `audioMute` and `audioUnmute` are two verbs rather than one carrying a boolean, since the thing
 * that differs between them is a word and words are the dialect's business.
 */
export type NarralangVerb =
    // Prose. These three have no keyword at all in the default dialect: prose is the default line.
    | "narration"
    | "dialogue"
    | "choice"
    | "choiceOption"
    // Scene
    | "background"
    | "jump"
    | "wait"
    | "nvl"
    // Characters
    | "characterEnter"
    | "characterExit"
    | "characterMove"
    | "characterExpression"
    | "characterRename"
    | "characterMotion"
    | "characterSkin"
    | "characterParams"
    // Audio
    | "audioPlay"
    | "audioStop"
    | "audioPause"
    | "audioResume"
    | "audioVolume"
    | "audioRate"
    | "audioMute"
    | "audioUnmute"
    | "audioSeek"
    // Data
    | "variableSet"
    | "declaration"
    // Images
    | "imageCreate"
    | "imageSource"
    | "imageShow"
    | "imageHide"
    // Stage text
    | "textCreate"
    | "textSet"
    | "textSize"
    | "textColor"
    | "textShow"
    | "textHide"
    // Layers
    | "layerCreate"
    | "layerZIndex"
    | "layerShow"
    | "layerHide"
    | "layerTransform"
    // Video
    | "videoCreate"
    | "videoSeek"
    | "videoShow"
    | "videoHide"
    | "videoPlay"
    | "videoPause"
    | "videoResume"
    | "videoStop"
    // Vfx
    | "vfxCreate"
    | "vfxRate"
    | "vfxShow"
    | "vfxHide"
    | "vfxPause"
    | "vfxResume"
    // The raw effect channel every stage object shares
    | "displayableShow"
    | "displayableHide"
    | "displayableTransform"
    | "displayableMask"
    | "displayableClearMask"
    | "displayableClip"
    | "displayableClearClip"
    | "displayableFilter"
    | "displayableClearFilter"
    | "displayableBackdrop"
    | "displayableBlend"
    | "displayableDarken"
    | "displayableReveal"
    | "displayableClose"
    | "displayableWipe"
    // Camera & screen
    | "cameraPan"
    | "cameraZoom"
    | "cameraRotate"
    | "cameraDarken"
    | "cameraLook"
    | "cameraReset"
    | "cameraMotion"
    | "screenBlink"
    | "screenVignette"
    // Control
    | "conditionIf"
    | "conditionElseIf"
    | "conditionElse"
    | "sequence"
    | "parallel"
    | "race"
    | "repeat"
    | "label"
    | "goto"
    | "break"
    | "cut";

// --- Slots ----------------------------------------------------------------------------------------

/**
 * The named argument positions a verb can fill.
 *
 * Named after what they *are*, never after the word that introduces them: the duration a transform
 * carries is `transformDuration`, not `over`, because a dialect may well introduce it with something
 * else. Reused across verbs wherever the meaning is the same, which is what keeps the dialect table
 * from having to invent a preposition per statement.
 *
 * The three timing families are kept apart on purpose. A character entrance carries a transform tail
 * AND a transition tail, and both end in a duration and an easing; folding them into one pair would
 * make the two collide on the one row where both appear.
 */
export type NarralangSlot =
    // Who / what
    | "subject"
    | "speaker"
    | "appearance"
    | "displayName"
    | "params"
    | "source"
    | "layer"
    | "scene"
    | "label"
    | "variant"
    | "motion"
    | "mask"
    | "voice"
    // Prose
    | "text"
    | "prompt"
    | "pause"
    // Transform tail
    | "placement"
    | "transformTransition"
    | "transformDuration"
    | "transformEasing"
    // Transition tail
    | "transition"
    | "transitionEasing"
    // Plain effect timing
    | "duration"
    | "easing"
    | "hold"
    // Audio
    | "channel"
    | "handle"
    | "volume"
    | "level"
    | "fadeIn"
    | "fadeOut"
    | "loop"
    | "rate"
    | "time"
    // Data
    | "value"
    | "valueType"
    | "scope"
    | "description"
    // Control
    | "test"
    | "showIf"
    | "enableIf"
    | "times"
    | "async"
    // Stage properties
    | "amount"
    | "autoFit"
    | "zIndex"
    | "content"
    | "fontSize"
    | "color"
    | "opacity"
    | "blend"
    | "fit"
    | "muted"
    | "clipPath"
    | "filter"
    | "darkness"
    | "zoom"
    | "rotation"
    // Camera look, and the vignette's falloff. `look` is a `name` rather than a word: the grade
    // library grows, and a closed vocabulary here would mean every new preset needing an entry in
    // NarraLang's word union before an author could write it down.
    | "look"
    | "strength"
    | "inner"
    | "outer";

// --- Words ----------------------------------------------------------------------------------------

/**
 * The closed vocabularies a slot value can hold.
 *
 * A word is an *enum member*, not a spelling: the dialect maps each to whatever it wants printed and
 * falls back to the structural name when it says nothing. That fallback is why most of these read
 * like their default spelling - only the ones the language deliberately abbreviates
 * (`backgroundLayer` → `@bglayer`, `autoFit` → `autofit`) have to be listed there.
 */
export type NarralangWord =
    | StoryTransitionWord
    | StoryVfxBlendMode
    | StoryVariableScope
    | StoryVariableValueType
    /** Stage placement, shared by a transform and a camera pan. */
    | "left"
    | "center"
    | "right"
    /** The audio bus a handle-less audio verb addresses, and the channel `play` opens. */
    | "bgm"
    | "sound"
    /** Stage singletons, printed under the built-in sigil. */
    | "background"
    | "backgroundLayer"
    | "stageLayer"
    /** Standalone modifiers that are present-or-absent rather than valued. */
    | "loop"
    | "once"
    | "muted"
    | "autoFit"
    | "async"
    | "click"
    /** Video fit. */
    | "cover"
    | "contain"
    | "fill";

// --- Values ----------------------------------------------------------------------------------------

/** A rich-text run with every id already resolved to text - see {@link NarralangText}. */
export type NarralangTextRun =
    | { readonly text: string; readonly marks?: StoryTextMarks }
    /** `true` is "wait for a click"; a number is milliseconds. */
    | { readonly pause: number | true }
    /**
     * An inline value. `source` is expression-language text, already resolved - `null` when the
     * document holds something no script can say (a blueprint-computed value), which the coverage
     * pass has already reported on the row.
     */
    | { readonly interpolation: string | null; readonly marks?: StoryTextMarks };

/**
 * Where a piece of author text sits on the line. The four contexts escape different things, and
 * getting one wrong is silent: an unescaped speaker separator in narration re-reads as a speaker, an
 * unescaped one at the end of a choice option eats the option's own block marker.
 */
export type NarralangProseContext =
    /** A narration row, or the text half of a dialogue row's line. */
    | "narration"
    /** The text after the speaker separator - it has already done its job, keywords cannot open. */
    | "dialogueText"
    /** A choice option, which always ends in the marker that opens its body. */
    | "option"
    /** A note row, printed after the note prefix. */
    | "note";

export type NarralangText = {
    readonly context: NarralangProseContext;
    readonly runs: readonly NarralangTextRun[];
};

/**
 * A slot's value.
 *
 * Every arm is a *type*, and the dialect's slot declaration names the same arm - which is what makes
 * the table readable in both directions: printing turns a `seconds` into `0.5`, and matching knows
 * that after this slot's preposition it must read a number of seconds.
 */
export type NarralangValue =
    /** An author-facing name. Quoted or not according to the dialect's rules; never an id. */
    | { readonly kind: "name"; readonly name: string }
    /** A list of names, printed one after another (a character's pose and tags). */
    | { readonly kind: "names"; readonly names: readonly string[] }
    /** A stage singleton, printed under the dialect's built-in sigil. */
    | { readonly kind: "builtin"; readonly word: NarralangWord }
    /** A member of a closed vocabulary. */
    | { readonly kind: "word"; readonly word: NarralangWord }
    /** A word that optionally carries a duration, as a transition does: `fade 0.5`. */
    | { readonly kind: "timedWord"; readonly word: NarralangWord; readonly ms?: number }
    /** A string literal. Always quoted, so it is never mistaken for a name. */
    | { readonly kind: "string"; readonly value: string }
    | { readonly kind: "number"; readonly value: number }
    /** A duration in milliseconds. Printed in seconds, the unit the whole surface uses. */
    | { readonly kind: "seconds"; readonly ms: number }
    /** A CSS colour, which is already its own spelling and is printed verbatim. */
    | { readonly kind: "color"; readonly value: string }
    /** Any of the four literal types a variable can hold. */
    | { readonly kind: "literal"; readonly value: StoryLiteralValue }
    /**
     * Expression-language source. Not NarraLang's own grammar and therefore not the dialect's to
     * re-spell: an expression is text the author typed into the expression editor, and a condition
     * lowered from a structured ref is lowered into the same language on purpose.
     */
    | { readonly kind: "expression"; readonly source: string }
    /** `ParamAngleX 12 ParamAngleY -4` - a puppet's parameter block. */
    | { readonly kind: "pairs"; readonly entries: readonly { readonly key: string; readonly value: number }[] }
    | { readonly kind: "text"; readonly text: NarralangText };

export type NarralangValueKind = NarralangValue["kind"];

export type NarralangSlots = Partial<Record<NarralangSlot, NarralangValue | undefined>>;

// --- Shapes ---------------------------------------------------------------------------------------

/**
 * One row's structure.
 *
 * The two "prints nothing" arms are not the same thing and the difference is visible in the output.
 * A `transparent` row hands its children to its own level, which is what makes `if` / `elif` / `else`
 * siblings in the text while they are children in the document. A `silent` row printed nothing
 * because it *has* no spelling, and its children keep the level they would have had.
 */
export type NarralangShape =
    | {
          readonly form: "statement";
          readonly verb: NarralangVerb;
          readonly slots: NarralangSlots;
          /** The row takes children, so the line ends in the dialect's block marker. */
          readonly opensBlock?: boolean;
      }
    | { readonly form: "note"; readonly text: NarralangText }
    /** A row carried through verbatim - an unparsed command line, which must not be re-read as script. */
    | { readonly form: "raw"; readonly source: string }
    | { readonly form: "silent" }
    | { readonly form: "transparent" };
