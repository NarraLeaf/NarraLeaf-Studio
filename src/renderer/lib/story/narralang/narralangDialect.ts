/**
 * The lexical half of NarraLang: one table saying how every structure in
 * {@link ./narralangShape} is spelled.
 *
 * Design doc: `docs/plans/2026-08-15-001-plan-narralang.md`.
 *
 * ## Why this is data and not code
 *
 * A project's script is something its author reads all day, and the words in it are a matter of
 * taste before they are a matter of correctness - `show` or `enter`, `at left` or `to left`, `:` or
 * braces, `{i}` or `[i]`. Every one of those was hard-coded in the printer's switch, so changing any
 * of them meant editing the printer and re-testing the whole surface. Here they are a value: a
 * dialect is passed in, the renderer walks it, and swapping the value swaps the language.
 *
 * ## Bidirectional on purpose
 *
 * Each slot entry declares three things - where it sits, the word that introduces it, and the kind
 * of value that follows. That is exactly what a matcher needs to run the table backwards, so the
 * parser (M3) reads this same table rather than growing a second vocabulary that can disagree with
 * this one. Nothing here may therefore encode a rule the reverse direction could not follow: no slot
 * is positional-and-optional after another optional one of the same kind, and no two slots on a verb
 * share a lead word.
 *
 * ## No locale, ever
 *
 * These are spellings, not translations. A dialect belongs to the *project*, not to the person
 * reading Studio, so two collaborators on different UI languages export byte-identical files. Nothing
 * in this file may reach `translate` or the localised command tables.
 */

import type { StoryTextMarks } from "@shared/types/story";

import type { NarralangSlot, NarralangValueKind, NarralangVerb, NarralangWord } from "./narralangShape";

// --- Types ----------------------------------------------------------------------------------------

export type NarralangSlotSyntax = {
    readonly slot: NarralangSlot;
    /**
     * The word introducing the value, space-joined before it. Absent for a positional slot.
     *
     * Prepositional rather than `key=value` throughout: this surface is optimised for reading, and
     * the command line already owns the other shape.
     */
    readonly lead?: string;
    /**
     * Punctuation glued to the END of the preceding token rather than space-joined - the speaker
     * separator, and the colon between a declared name and its type.
     */
    readonly attach?: string;
    /** What follows the lead. Several kinds when the slot genuinely accepts a choice. */
    readonly value: NarralangValueKind | readonly NarralangValueKind[];
    /**
     * Print the slot even when it renders to nothing.
     *
     * Only the dialogue text sets it, and for a structural reason: a dialogue row whose text is empty
     * still has to keep its speaker separator, or the line re-reads as narration by the author who
     * typed a name and nothing else.
     */
    readonly keepEmpty?: boolean;
};

export type NarralangVerbSyntax = {
    /**
     * The words that open the statement, space-separated; empty for the prose forms, which is what
     * makes narration the default line rather than a marked one.
     *
     * The FIRST word is what makes a line a statement, so it is also what prose has to be escaped
     * against - {@link narralangDialectKeywords} derives that set from here rather than keeping a
     * second list that could fall behind.
     */
    readonly keyword: string;
    readonly slots: readonly NarralangSlotSyntax[];
};

export type NarralangMarkSyntax = {
    readonly mark: keyof StoryTextMarks;
    readonly tag: string;
    /** How the mark's argument prints; absent when the tag takes none. */
    readonly arg?: "raw" | "number";
};

export type NarralangTextSyntax = {
    /** The two fences a tag sits between. */
    readonly open: string;
    readonly close: string;
    /** Marks the closing half of a pair: open + this + tag + close. */
    readonly closeSigil: string;
    /**
     * Outer-to-inner. The order IS the nesting order, so two exports of one segment agree byte for
     * byte instead of depending on key order in the stored marks object.
     */
    readonly marks: readonly NarralangMarkSyntax[];
    readonly pause: string;
    readonly interpolation: string;
    /** Stands in for a value no script can say. Unreachable in a scene the gate lets through. */
    readonly unknown: string;
};

export type NarralangDialect = {
    /** Identifies the dialect in a report or a project setting. Never printed into a script. */
    readonly id: string;
    /** One level of nesting. Indentation is the only nesting mechanism NarraLang has. */
    readonly indent: string;
    /**
     * Opens the one block a file has that is not a row: the scene itself.
     *
     * Not a verb, because no payload produces it - it is the header the printer writes around a
     * scene's rows. Here rather than in the printer so a dialect that renames every other word does
     * not leave this one behind.
     */
    readonly sceneKeyword: string;
    /**
     * How a row that takes children announces them.
     *
     * `close` is `null` for a layout language, where indentation alone closes the block. A dialect
     * that opens with a brace sets it, and the walk emits it at the parent's level once the children
     * are done.
     */
    readonly block: { readonly open: string; readonly close: string | null };
    readonly prefix: {
        /** Opens a note row. */
        readonly note: string;
        /**
         * Marks a row the compiler skips, with its whole subtree, while it keeps its payload.
         *
         * A prefix rather than a modifier because it applies to every row kind including prose, and
         * because "this line does not run" is the first thing a reader needs to know about the line.
         */
        readonly disabled: string;
        /** Addresses a stage singleton (the scene background, the two built-in layers). */
        readonly builtin: string;
    };
    readonly escape: string;
    /** Splits a speaker from the line they say. */
    readonly speakerSeparator: string;
    readonly quote: {
        /** Wraps a name that cannot be bare. Single quotes are the entity-reference form elsewhere. */
        readonly name: readonly [string, string];
        /** Wraps a string literal, which must never be readable as a name. */
        readonly string: readonly [string, string];
    };
    /**
     * Spellings for the closed vocabularies. A word with no entry prints as its structural name, so
     * only the ones the language deliberately abbreviates need listing.
     */
    readonly words: Readonly<Partial<Record<NarralangWord, string>>>;
    readonly verbs: Readonly<Record<NarralangVerb, NarralangVerbSyntax>>;
    readonly text: NarralangTextSyntax;
};

// --- The default dialect --------------------------------------------------------------------------

/**
 * Shared by every verb whose row carries a transform.
 *
 * A transform says two different things depending on its preset: a placement is *where*, and a
 * reveal/conceal preset is *how*. The two are mutually exclusive in a shape, so both sit here and
 * whichever the extractor filled is the one that prints.
 */
const TRANSFORM_TAIL: readonly NarralangSlotSyntax[] = [
    { slot: "placement", lead: "at", value: "word" },
    { slot: "transformTransition", lead: "with", value: "timedWord" },
    { slot: "transformDuration", lead: "over", value: "seconds" },
    { slot: "transformEasing", lead: "ease", value: "name" },
];

/**
 * Shared by every verb whose row carries a transition.
 *
 * Kept apart from the transform tail because a character entrance carries both, and both end in a
 * duration and an easing - one pair of slots would collide on exactly that row.
 */
const TRANSITION_TAIL: readonly NarralangSlotSyntax[] = [
    { slot: "transition", lead: "with", value: "timedWord" },
    { slot: "transitionEasing", lead: "ease", value: "name" },
];

/** The plain effect timing the raw `displayable` and `camera` channels share. */
const TIMING: readonly NarralangSlotSyntax[] = [
    { slot: "duration", lead: "over", value: "seconds" },
    { slot: "easing", lead: "ease", value: "name" },
];

const SUBJECT: NarralangSlotSyntax = { slot: "subject", value: "name" };

/** A `displayable` row addresses a stage object by name or a singleton under the built-in sigil. */
const DISPLAYABLE_SUBJECT: NarralangSlotSyntax = { slot: "subject", value: ["name", "builtin"] };

/** An audio row addresses a named handle, or the bus when the row names none. */
const AUDIO_SUBJECT: NarralangSlotSyntax = { slot: "subject", value: ["name", "word"] };

const SPEAKER_SEPARATOR = ":";

export const NARRALANG_DEFAULT_DIALECT: NarralangDialect = {
    id: "narralang",
    indent: "  ",
    sceneKeyword: "scene",
    block: { open: ":", close: null },
    prefix: { note: "#", disabled: "~", builtin: "@" },
    escape: "\\",
    speakerSeparator: SPEAKER_SEPARATOR,
    quote: { name: ["'", "'"], string: ['"', '"'] },
    words: {
        // Only the words whose spelling differs from their structural name. Everything else - `left`,
        // `fade`, `loop`, `screen` - is already spelled the way the shape names it.
        backgroundLayer: "bglayer",
        stageLayer: "stagelayer",
        autoFit: "autofit",
    },
    text: {
        open: "{",
        close: "}",
        closeSigil: "/",
        // The vocabulary NarraLeaf's own `Sentence` markup uses, so an author who has written a
        // dialogue line in the engine reads this without a second table to learn.
        marks: [
            { mark: "bold", tag: "b" },
            { mark: "italic", tag: "i" },
            { mark: "color", tag: "color", arg: "raw" },
            { mark: "fontSize", tag: "size", arg: "number" },
            { mark: "cps", tag: "cps", arg: "number" },
            // Innermost, because it annotates the base text rather than styling it.
            { mark: "ruby", tag: "ruby", arg: "raw" },
        ],
        pause: "p",
        interpolation: "=",
        unknown: "?",
    },
    verbs: {
        // --- Prose ---------------------------------------------------------------------------------
        narration: { keyword: "", slots: [{ slot: "text", value: "text" }] },
        dialogue: {
            keyword: "",
            slots: [
                { slot: "speaker", value: "name" },
                // The rare per-line attributes sit BEFORE the separator, where the parse is
                // unambiguous without quoting the text.
                { slot: "voice", lead: "voice", value: "name" },
                { slot: "pause", lead: "pause", value: ["word", "seconds"] },
                { slot: "text", attach: SPEAKER_SEPARATOR, value: "text", keepEmpty: true },
            ],
        },
        choice: { keyword: "menu", slots: [{ slot: "prompt", value: "text" }] },
        choiceOption: {
            keyword: "",
            slots: [
                { slot: "text", value: "text" },
                { slot: "showIf", lead: "show if", value: "expression" },
                { slot: "enableIf", lead: "enable if", value: "expression" },
            ],
        },

        // --- Scene ---------------------------------------------------------------------------------
        background: { keyword: "bg", slots: [{ slot: "source", value: ["name", "color"] }, ...TRANSITION_TAIL] },
        jump: { keyword: "jump", slots: [{ slot: "scene", value: "name" }, ...TRANSITION_TAIL] },
        wait: { keyword: "wait", slots: [{ slot: "amount", value: ["word", "seconds"] }] },
        nvl: { keyword: "nvl", slots: TRANSFORM_TAIL },

        // --- Characters ----------------------------------------------------------------------------
        characterEnter: {
            keyword: "show",
            slots: [SUBJECT, { slot: "appearance", value: "names" }, ...TRANSFORM_TAIL, ...TRANSITION_TAIL],
        },
        characterExit: { keyword: "hide", slots: [SUBJECT, ...TRANSFORM_TAIL, ...TRANSITION_TAIL] },
        characterMove: { keyword: "move", slots: [SUBJECT, ...TRANSFORM_TAIL] },
        characterExpression: { keyword: "face", slots: [SUBJECT, { slot: "appearance", value: "names" }] },
        characterRename: { keyword: "rename", slots: [SUBJECT, { slot: "displayName", value: "name" }] },
        characterMotion: { keyword: "motion", slots: [SUBJECT, { slot: "appearance", value: "names" }] },
        characterSkin: { keyword: "skin", slots: [SUBJECT, { slot: "appearance", value: "names" }] },
        characterParams: { keyword: "param", slots: [SUBJECT, { slot: "params", value: "pairs" }] },

        // --- Audio ---------------------------------------------------------------------------------
        audioPlay: {
            keyword: "play",
            slots: [
                { slot: "channel", value: "word" },
                { slot: "source", value: "name" },
                { slot: "handle", lead: "as", value: "name" },
                { slot: "volume", lead: "volume", value: "number" },
                { slot: "fadeIn", lead: "fadein", value: "seconds" },
                { slot: "loop", value: "word" },
                { slot: "rate", lead: "rate", value: "number" },
            ],
        },
        audioStop: { keyword: "stop", slots: [AUDIO_SUBJECT, { slot: "fadeOut", lead: "fadeout", value: "seconds" }] },
        audioPause: { keyword: "pause", slots: [AUDIO_SUBJECT, { slot: "fadeOut", lead: "fadeout", value: "seconds" }] },
        audioResume: { keyword: "resume", slots: [AUDIO_SUBJECT, { slot: "fadeIn", lead: "fadein", value: "seconds" }] },
        audioVolume: {
            keyword: "volume",
            slots: [AUDIO_SUBJECT, { slot: "level", value: "number" }, { slot: "duration", lead: "over", value: "seconds" }],
        },
        audioRate: { keyword: "rate", slots: [AUDIO_SUBJECT, { slot: "rate", value: "number" }] },
        audioMute: { keyword: "mute", slots: [AUDIO_SUBJECT] },
        audioUnmute: { keyword: "unmute", slots: [AUDIO_SUBJECT] },
        audioSeek: { keyword: "seek", slots: [AUDIO_SUBJECT, { slot: "time", value: "seconds" }] },

        // --- Data ----------------------------------------------------------------------------------
        variableSet: {
            keyword: "set",
            slots: [SUBJECT, { slot: "value", lead: "=", value: ["expression", "literal"] }],
        },
        declaration: {
            keyword: "var",
            slots: [
                SUBJECT,
                { slot: "valueType", attach: ":", value: "word" },
                { slot: "value", lead: "=", value: "literal" },
                { slot: "scope", lead: "in", value: "word" },
                { slot: "description", lead: "desc", value: "string" },
            ],
        },

        // --- Images --------------------------------------------------------------------------------
        imageCreate: {
            keyword: "image create",
            slots: [
                SUBJECT,
                { slot: "source", value: ["name", "color"] },
                { slot: "layer", lead: "on", value: ["name", "builtin"] },
                { slot: "autoFit", value: "word" },
                ...TRANSFORM_TAIL,
            ],
        },
        imageSource: { keyword: "image source", slots: [SUBJECT, { slot: "source", value: ["name", "color"] }] },
        imageShow: { keyword: "show", slots: [SUBJECT, ...TRANSFORM_TAIL, ...TRANSITION_TAIL] },
        imageHide: { keyword: "hide", slots: [SUBJECT, ...TRANSFORM_TAIL, ...TRANSITION_TAIL] },

        // --- Stage text ----------------------------------------------------------------------------
        textCreate: {
            keyword: "text create",
            slots: [
                SUBJECT,
                { slot: "content", value: "string" },
                { slot: "layer", lead: "on", value: ["name", "builtin"] },
                ...TRANSFORM_TAIL,
            ],
        },
        textSet: { keyword: "text set", slots: [SUBJECT, { slot: "content", value: "string" }] },
        textSize: { keyword: "text size", slots: [SUBJECT, { slot: "fontSize", value: "number" }] },
        textColor: { keyword: "text color", slots: [SUBJECT, { slot: "color", value: "color" }] },
        textShow: { keyword: "show", slots: [SUBJECT, ...TRANSFORM_TAIL] },
        textHide: { keyword: "hide", slots: [SUBJECT, ...TRANSFORM_TAIL] },

        // --- Layers --------------------------------------------------------------------------------
        layerCreate: { keyword: "layer create", slots: [SUBJECT, { slot: "zIndex", lead: "zindex", value: "number" }] },
        layerZIndex: { keyword: "layer zindex", slots: [SUBJECT, { slot: "zIndex", value: "number" }] },
        layerShow: { keyword: "show", slots: [DISPLAYABLE_SUBJECT] },
        layerHide: { keyword: "hide", slots: [DISPLAYABLE_SUBJECT] },
        layerTransform: { keyword: "transform", slots: [DISPLAYABLE_SUBJECT, ...TRANSFORM_TAIL] },

        // --- Video ---------------------------------------------------------------------------------
        videoCreate: {
            keyword: "video create",
            slots: [SUBJECT, { slot: "source", value: "name" }, { slot: "muted", value: "word" }],
        },
        videoSeek: { keyword: "video seek", slots: [SUBJECT, { slot: "time", value: "seconds" }] },
        videoShow: { keyword: "show", slots: [SUBJECT] },
        videoHide: { keyword: "hide", slots: [SUBJECT] },
        videoPlay: { keyword: "video play", slots: [SUBJECT] },
        videoPause: { keyword: "video pause", slots: [SUBJECT] },
        videoResume: { keyword: "video resume", slots: [SUBJECT] },
        videoStop: { keyword: "video stop", slots: [SUBJECT] },

        // --- Vfx -----------------------------------------------------------------------------------
        vfxCreate: {
            keyword: "vfx create",
            slots: [
                SUBJECT,
                { slot: "source", value: "name" },
                { slot: "blend", lead: "blend", value: "word" },
                { slot: "opacity", lead: "opacity", value: "number" },
                { slot: "fit", lead: "fit", value: "word" },
                { slot: "zIndex", lead: "zindex", value: "number" },
                { slot: "rate", lead: "rate", value: "number" },
                { slot: "loop", value: "word" },
            ],
        },
        vfxRate: { keyword: "vfx rate", slots: [SUBJECT, { slot: "rate", value: "number" }] },
        vfxShow: { keyword: "show", slots: [SUBJECT, { slot: "duration", lead: "over", value: "seconds" }] },
        vfxHide: { keyword: "hide", slots: [SUBJECT, { slot: "duration", lead: "over", value: "seconds" }] },
        vfxPause: { keyword: "vfx pause", slots: [SUBJECT] },
        vfxResume: { keyword: "vfx resume", slots: [SUBJECT] },

        // --- The raw effect channel ------------------------------------------------------------------
        displayableShow: { keyword: "show", slots: [DISPLAYABLE_SUBJECT, ...TRANSFORM_TAIL] },
        displayableHide: { keyword: "hide", slots: [DISPLAYABLE_SUBJECT, ...TRANSFORM_TAIL] },
        displayableTransform: { keyword: "transform", slots: [DISPLAYABLE_SUBJECT, ...TRANSFORM_TAIL] },
        displayableMask: { keyword: "mask", slots: [DISPLAYABLE_SUBJECT, { slot: "mask", value: "name" }, ...TIMING] },
        displayableClearMask: { keyword: "clearmask", slots: [DISPLAYABLE_SUBJECT, ...TIMING] },
        displayableClip: { keyword: "clip", slots: [DISPLAYABLE_SUBJECT, { slot: "clipPath", value: "string" }, ...TIMING] },
        displayableClearClip: { keyword: "clearclip", slots: [DISPLAYABLE_SUBJECT, ...TIMING] },
        displayableFilter: { keyword: "filter", slots: [DISPLAYABLE_SUBJECT, { slot: "filter", value: "string" }, ...TIMING] },
        displayableClearFilter: { keyword: "clearfilter", slots: [DISPLAYABLE_SUBJECT, ...TIMING] },
        displayableBackdrop: { keyword: "backdrop", slots: [DISPLAYABLE_SUBJECT, { slot: "filter", value: "string" }, ...TIMING] },
        displayableBlend: { keyword: "blend", slots: [DISPLAYABLE_SUBJECT, { slot: "blend", value: "word" }, ...TIMING] },
        displayableDarken: { keyword: "darken", slots: [DISPLAYABLE_SUBJECT, { slot: "darkness", value: "number" }, ...TIMING] },
        displayableReveal: { keyword: "reveal", slots: [DISPLAYABLE_SUBJECT, ...TIMING] },
        displayableClose: { keyword: "close", slots: [DISPLAYABLE_SUBJECT, ...TIMING] },
        displayableWipe: { keyword: "wipe", slots: [DISPLAYABLE_SUBJECT, ...TIMING] },

        // --- Camera & screen -------------------------------------------------------------------------
        // `camera pan` takes its placement bare: the verb already said the row is about where the view
        // sits, so the preposition the transform tail needs would only be noise here.
        cameraPan: { keyword: "camera pan", slots: [{ slot: "placement", value: "word" }, ...TIMING] },
        cameraZoom: { keyword: "camera zoom", slots: [{ slot: "zoom", value: "number" }, ...TIMING] },
        cameraRotate: { keyword: "camera rotate", slots: [{ slot: "rotation", value: "number" }, ...TIMING] },
        cameraDarken: { keyword: "camera darken", slots: [{ slot: "darkness", value: "number" }, ...TIMING] },
        // The grade name rides bare after the verb, the way `camera pan`'s placement does - the verb
        // has already said the row is about colour, so a preposition would only be noise. `filter`
        // is a quoted string because it is CSS, not a name, and must never re-read as one.
        cameraLook: {
            keyword: "camera look",
            slots: [
                { slot: "look", value: "name" },
                { slot: "strength", lead: "strength", value: "number" },
                { slot: "filter", lead: "filter", value: "string" },
                ...TIMING,
            ],
        },
        cameraReset: { keyword: "camera reset", slots: TIMING },
        cameraMotion: { keyword: "camera motion", slots: [{ slot: "motion", value: "name" }] },
        // `in` and `out` are the one grammar both screen effects share: `over` is the whole move, and
        // each half overrides its own end of it.
        //
        // `opacity` stays on `blink` even though the engine's `BlinkOptions` has none and the compile
        // therefore ignores it. Nothing writes it any more - the inspector stopped offering a control
        // that could not do anything - but a document authored before that does carry it, and a
        // grammar without the slot would drop it on the way through the script view. Silently losing
        // an author's value is worse than printing one the engine will not read.
        screenBlink: {
            keyword: "blink",
            slots: [
                { slot: "duration", lead: "over", value: "seconds" },
                { slot: "fadeIn", lead: "in", value: "seconds" },
                { slot: "fadeOut", lead: "out", value: "seconds" },
                { slot: "hold", lead: "hold", value: "seconds" },
                { slot: "color", lead: "color", value: "color" },
                { slot: "opacity", lead: "opacity", value: "number" },
                { slot: "easing", lead: "ease", value: "name" },
            ],
        },
        screenVignette: {
            keyword: "vignette",
            slots: [
                { slot: "duration", lead: "over", value: "seconds" },
                { slot: "fadeIn", lead: "in", value: "seconds" },
                { slot: "fadeOut", lead: "out", value: "seconds" },
                { slot: "inner", lead: "inner", value: "number" },
                { slot: "outer", lead: "outer", value: "number" },
                { slot: "hold", lead: "hold", value: "seconds" },
                { slot: "color", lead: "color", value: "color" },
                { slot: "opacity", lead: "opacity", value: "number" },
                { slot: "easing", lead: "ease", value: "name" },
            ],
        },

        // --- Control -------------------------------------------------------------------------------
        conditionIf: { keyword: "if", slots: [{ slot: "test", value: "expression" }] },
        conditionElseIf: { keyword: "elif", slots: [{ slot: "test", value: "expression" }] },
        conditionElse: { keyword: "else", slots: [] },
        sequence: { keyword: "sequence", slots: [{ slot: "async", value: "word" }] },
        parallel: { keyword: "parallel", slots: [{ slot: "async", value: "word" }] },
        race: { keyword: "race", slots: [{ slot: "async", value: "word" }] },
        repeat: {
            keyword: "repeat",
            // `times` and `test` are the two mutually exclusive forms of the same loop, so listing both
            // costs nothing: a shape fills exactly one.
            slots: [
                { slot: "times", value: "number" },
                { slot: "test", lead: "until", value: "expression" },
                { slot: "async", value: "word" },
            ],
        },
        label: { keyword: "label", slots: [{ slot: "label", value: "name" }] },
        goto: { keyword: "goto", slots: [{ slot: "label", value: "name" }] },
        break: { keyword: "break", slots: [] },
        cut: { keyword: "cut", slots: [{ slot: "variant", value: "name" }] },
    },
};

// --- Derived ----------------------------------------------------------------------------------------

const KEYWORD_CACHE = new WeakMap<NarralangDialect, ReadonlySet<string>>();

/**
 * Every word that may open a statement in this dialect.
 *
 * Derived rather than declared, because the printer's escape has to see exactly the set the reader's
 * "first token is a keyword" rule sees. A hand-kept second list is how a renamed verb quietly stops
 * being escaped in prose: the line `enter the room` becomes a statement the moment `enter` is a verb,
 * and nothing would have told anyone.
 */
export function narralangDialectKeywords(dialect: NarralangDialect): ReadonlySet<string> {
    const cached = KEYWORD_CACHE.get(dialect);
    if (cached) {
        return cached;
    }
    const words = new Set<string>();
    for (const syntax of Object.values(dialect.verbs)) {
        const first = syntax.keyword.split(" ")[0] ?? "";
        if (first !== "") {
            words.add(first);
        }
    }
    KEYWORD_CACHE.set(dialect, words);
    return words;
}

/** A word's spelling in this dialect, falling back to its structural name. */
export function narralangWord(dialect: NarralangDialect, word: NarralangWord): string {
    return dialect.words[word] ?? word;
}
