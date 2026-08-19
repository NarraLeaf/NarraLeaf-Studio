import type {
    StoryExpression,
    StoryExprType,
    StoryLiteralValue,
    StoryVariableRef,
    StoryVariableValueType,
} from "@shared/types/story";
import type { StoryExpressionIssue } from "@shared/utils/storyExpressionParser";

/**
 * The value vocabulary of the command pipeline: what a resolved arg is, what project context it
 * resolved against, and what can go wrong.
 *
 * Types only, dependency-free within the pipeline. Extracted from the resolution layer so command
 * specs (which `build` from values) and the resolver (which produces them) can both import the
 * shapes without a cycle. Behaviour stays in `storyCommandResolution.ts`.
 */

export type StoryCommandSpan = { start: number; end: number };

export type StoryCommandNamedRef = { id: string; name: string };

/**
 * A named appearance of one character. `axisId` is present exactly when the character is layered,
 * which is what tells a row whether the id it stores is a pose or a tag — and, for a tag, which
 * axis it belongs to.
 */
export type StoryCommandAppearanceRef = { id: string; name: string; axisId?: string };

/**
 * The three state channels a puppet character's backend answers to (NLR `PuppetState`).
 *
 * They are the three ideas every 2D character renderer has, which is why they are named here rather
 * than left to a backend: `expression` already had a verb (`/face`), the other two got one each.
 */
export type StoryPuppetChannel = "motion" | "expression" | "skin";

export type StoryCommandVariableEntry = {
    name: string;
    ref: StoryVariableRef;
    valueType: StoryVariableValueType;
    /** The declared default - what `/reset` restores. */
    defaultValue?: StoryLiteralValue;
};

/** The kinds of named object a command can address by `objectName`. */
export type StoryCommandStageObjectKind = "image" | "text" | "layer" | "video" | "audio" | "vfx";

/** What a generic verb's target may be: a character, or a stage object of some kind. */
export type StoryCommandTargetKind = "character" | StoryCommandStageObjectKind;

/**
 * The stage singletons a target slot may name by a RESERVED WORD rather than by a name on stage.
 *
 * All three are Displayables the engine addresses without a creator block - `story.camera`, and the
 * two layers every `Scene` ships with - so there is nothing in the scene for a name lookup to find
 * and nothing an author could rename. A word is the only handle they can have, which is why they are
 * reserved here rather than seeded into `stageObjects`: a name in that list is one the author chose,
 * and one of these can never be.
 *
 * `background` (the scene's background image) rides along for the same reason the two layers do - it
 * is the third entry in `StoryDisplayableBuiltin`, it is a Displayable, and the property inspector's
 * target field has always offered all three. Leaving it out would have made the command line reach a
 * strict subset of what the inspector reaches, which is the split this milestone exists to close.
 */
export type StoryReservedTargetName = "camera" | "background" | "backgroundLayer" | "displayableLayer";

/** Every reserved word, in the order a candidate list offers them. */
export const STORY_RESERVED_TARGETS: readonly StoryReservedTargetName[] = [
    "camera",
    "background",
    "backgroundLayer",
    "displayableLayer",
];

/** The object names on stage, per kind - the candidate source for target params. */
export type StoryCommandStageObjects = Readonly<Record<StoryCommandStageObjectKind, readonly string[]>>;

export const EMPTY_STORY_COMMAND_STAGE_OBJECTS: StoryCommandStageObjects = {
    image: [], text: [], layer: [], video: [], audio: [], vfx: [],
};

/**
 * The reserved audio-object name addressing the background-music channel. The sound
 * control family defaults its omitted target to this, and the compiler routes it to the BGM handle
 * rather than a named `Sound`.
 */
export const BGM_OBJECT_NAME = "bgm";

export type StoryCommandContext = {
    images: readonly StoryCommandNamedRef[];
    audio: readonly StoryCommandNamedRef[];
    videos: readonly StoryCommandNamedRef[];
    characters: readonly StoryCommandNamedRef[];
    /**
     * Bare speaker names already used somewhere in this story. They back no character record, so they
     * carry no id - but they are what the speaker picker offers between the real characters and the
     * name being typed, and the command line must offer the same list.
     */
    tempSpeakers: readonly string[];
    scenes: readonly StoryCommandNamedRef[];
    /**
     * Every choice option in the STORY, by the text the player reads - what `picked(…)` resolves
     * against.
     *
     * Document-wide rather than scene-scoped, because the whole use is cross-scene: "did they turn
     * her down back in the prologue" is asked three chapters later. The `id` is the option row's
     * `block.id`, which is exactly the key the visited record stores.
     */
    choiceOptions: readonly StoryCommandNamedRef[];
    /**
     * The `mode:"value"` Story Action Blueprints an expression may call - what `bonus()` resolves
     * against.
     *
     * Only `value`: an `action` blueprint may use latent nodes and has no return, and a `condition`
     * one belongs to the single condition slot that owns it. Value blueprints are the ones the
     * authoring-time gate already holds to synchronous, pure nodes, which is what makes them safe to
     * evaluate inside an expression.
     */
    valueBlueprints: readonly StoryCommandNamedRef[];
    /**
     * The project's audio tracks, by the name the author gave them - what `/bgm theme track=Ambience`
     * resolves against.
     *
     * By name, not by bus: a track IS the vocabulary now, and offering "bgm / sound / voice" on the
     * line would reintroduce the second, unrelated channel vocabulary this round exists to delete.
     */
    audioTracks: readonly StoryCommandNamedRef[];
    /**
     * The `label` rows of the CURRENT scene, in declaration order - what `/goto` may address.
     * Scene-scoped like the engine's own matching, and scanned by the same function the compiler
     * validates with, so the two can never disagree about which names exist.
     */
    labels: readonly string[];
    /**
     * The project's build variants, by the name the author gave them - release first.
     *
     * Always non-empty: the release variant exists in every project, so a slot that takes one always
     * has something to offer and can never be a dropdown with nothing in it.
     */
    appTags: readonly StoryCommandNamedRef[];
    variables: readonly StoryCommandVariableEntry[];
    /** Per character: its poses (preset) or every tag across its axes (layered). */
    appearanceByCharacterId: Readonly<Record<string, readonly StoryCommandAppearanceRef[]>>;
    /**
     * The characters a runtime draws (`puppet` appearance) - the ones whose motion / expression / skin
     * are named by the model rather than enumerated in the project.
     *
     * A flat id list rather than an appearance map because that is the whole of what the command layer
     * needs to know: a puppet character has NO authoring-time differentials to list, so there is
     * nothing to key. What it does have is asked of the live model, which this layer cannot reach.
     */
    puppetCharacterIds: readonly string[];
    /**
     * What each puppet character's model said it contains, for the characters whose model has been
     * asked and answered.
     *
     * **A missing key and an empty list are different facts, and the difference is load-bearing.**
     * Missing means nobody has an answer — no runtime installed on this machine, a backend that
     * implements no `describe()`, a model that failed to load, or simply a lookup still in flight.
     * Present means the model spoke. Only a present entry licenses saying a name is wrong; a missing
     * one may only stay quiet, because the name the author typed is probably right and it is Studio
     * that cannot check it.
     *
     * Kept apart from {@link appearanceByCharacterId} on purpose: that map's elements are project
     * refs with ids that survive a rename, while a puppet name is the model's own string and has no
     * id to point at. Merging them would blur exactly the distinction `/face`'s two branches rest on.
     */
    puppetByCharacterId: Readonly<Record<string, StoryPuppetVocabulary>>;
    /** Named objects on stage in the current scene, per kind. */
    stageObjects: StoryCommandStageObjects;
};

/**
 * One puppet model's vocabulary, as the story editor consumes it.
 *
 * A narrowing of the engine's `PuppetDescription` to the parts an authoring surface offers: the
 * three named channels and the numeric parameters. `size` is left out because a story row never
 * asks about the box, and keeping it out is what lets this type be built in a test without the
 * engine.
 */
export type StoryPuppetVocabulary = {
    motions: readonly string[];
    expressions: readonly string[];
    skins: readonly string[];
    params: readonly StoryPuppetParamSpec[];
};

/** A numeric parameter a model reported, bounds included — enough to draw a control that cannot go out of range. */
export type StoryPuppetParamSpec = {
    id: string;
    min: number;
    max: number;
    default: number;
};

export const EMPTY_STORY_COMMAND_CONTEXT: StoryCommandContext = {
    images: [], audio: [], videos: [], characters: [], tempSpeakers: [], scenes: [], choiceOptions: [], valueBlueprints: [],
    audioTracks: [], labels: [], appTags: [], variables: [], appearanceByCharacterId: {},
    puppetCharacterIds: [],
    puppetByCharacterId: {},
    stageObjects: EMPTY_STORY_COMMAND_STAGE_OBJECTS,
};

/** The names a puppet character offers on one channel, or `[]` when its model has not been asked. */
export function puppetChannelNames(
    context: Pick<StoryCommandContext, "puppetByCharacterId">,
    characterId: string | undefined,
    channel: StoryPuppetChannel,
): readonly string[] {
    const vocabulary = characterId ? context.puppetByCharacterId[characterId] : undefined;
    if (!vocabulary) {
        return [];
    }
    switch (channel) {
        case "motion":
            return vocabulary.motions;
        case "expression":
            return vocabulary.expressions;
        case "skin":
            return vocabulary.skins;
    }
}

/** The resolved subject of a generic verb - what `/show poster` dispatches its block type on. */
export type StoryCommandTargetValue =
    | { type: "character"; characterId: string; name: string }
    /**
     * A stage singleton named by its reserved word. Carries no `known` flag: a reserved word either
     * IS one of the four or was never resolved as one, so there is no free-name case to record.
     */
    | { type: "reserved"; name: StoryReservedTargetName }
    | {
          type: "stageObject";
          objectKind: StoryCommandStageObjectKind;
          name: string;
          /** False for a free-typed name matching nothing on stage - legal only where one kind is possible. */
          known: boolean;
      };

export type StoryCommandValue =
    | { kind: "asset"; assetId: string }
    | { kind: "color"; color: string }
    | { kind: "character"; characterId: string }
    /** A name backing no character - legal only where the param opted in via `allowTemp`. */
    | { kind: "speakerName"; speakerName: string }
    /**
     * A named appearance of the owning character: a pose id for a preset character, a tag id for a
     * layered one. `label` is what the author typed, kept for the diagnostic when nothing matched.
     *
     * (The `characterForm` grammar token predates the appearance rework and no longer names a form;
     * renaming it reaches a dozen files plus the i18n catalogues, so it is deferred — see the L1 card.)
     */
    | { kind: "characterForm"; refId: string | null; label: string; axisId?: string }
    /**
     * A state name of a puppet-kind character's backend, on one of its three channels. Carries no id
     * because there is none to carry: the vocabulary lives in the model, not in the project.
     */
    | { kind: "puppetName"; channel: StoryPuppetChannel; name: string }
    /** A numeric parameter of a puppet character's model, by the id the model gave it. */
    | { kind: "puppetParam"; id: string }
    | { kind: "scene"; sceneId: string }
    /** A project audio track, resolved from its name to the stable id the payload stores. */
    | { kind: "audioTrack"; trackId: string }
    /** A label declared in this scene - stored as declared, so it matches what the engine sees. */
    | { kind: "label"; name: string }
    /**
     * A build variant, resolved from its name to the stable id the payload stores.
     *
     * The id, not the name, is what a row keeps - so renaming a variant leaves every row that names
     * it pointing at the same variant, and deleting one leaves those rows resolving to release rather
     * than to nothing.
     */
    | { kind: "appTag"; appTagId: string }
    /** `name` is the author-facing name as declared - the compound-assignment sugar re-emits it into the desugared source. */
    | { kind: "variable"; ref: StoryVariableRef; valueType: StoryVariableValueType; name: string; defaultValue?: StoryLiteralValue }
    | { kind: "enum"; value: string }
    | { kind: "keyword"; value: string }
    | { kind: "number"; value: number }
    | { kind: "boolean"; value: boolean }
    /**
     * A scalar the author typed. `source` is the text it was read from, kept because the reading is
     * lossy now that `[1, 2]` becomes a real list: a slot told it wants a string needs the words back,
     * and re-serializing the parsed value would hand back a normalized spelling nobody typed.
     */
    | { kind: "literal"; value: StoryLiteralValue; source: string }
    /** A parsed expression. `source` is the desugared text (`gold + (1)` for `+= 1`), which is what gets stored. */
    | { kind: "expression"; expression: StoryExpression; source: string }
    | { kind: "text"; value: string }
    /** A generic verb's subject, resolved and kind-dispatched. */
    | { kind: "target"; target: StoryCommandTargetValue };

export type StoryCommandResolvedArgs = Readonly<Record<string, StoryCommandValue>>;

export type StoryCommandResolutionIssue =
    | { code: "unknownAsset"; span: StoryCommandSpan; value: string; assetType: "image" | "audio" | "video" }
    | { code: "unknownCharacter"; span: StoryCommandSpan; value: string }
    | { code: "unknownScene"; span: StoryCommandSpan; value: string }
    /** `/bgm theme track=Ambience` with no `Ambience` track - it would silently land on Music instead. */
    | { code: "unknownAudioTrack"; span: StoryCommandSpan; value: string }
    /** `/goto intro` with no `intro` label in this scene - the engine would refuse to build. */
    | { code: "unknownLabel"; span: StoryCommandSpan; value: string }
    /** A build variant the project does not have. Naming one would decide nothing at build time. */
    | { code: "unknownAppTag"; span: StoryCommandSpan; value: string }
    | { code: "unknownVariable"; span: StoryCommandSpan; value: string }
    | { code: "unknownForm"; span: StoryCommandSpan; value: string; characterName: string }
    /** `/motion Alice run` - Alice is drawn by Studio, so she has no runtime state to request. */
    | { code: "notPuppetCharacter"; span: StoryCommandSpan; value: string }
    /** A generic verb's subject matching neither a character nor anything on stage. */
    | { code: "unknownTarget"; span: StoryCommandSpan; value: string }
    /**
     * The name resolved, and to the wrong KIND of thing: `/transform petals` on an ambience overlay.
     *
     * Its own code rather than `unknownTarget`, because the two send an author to opposite places.
     * "I cannot find it" says check the spelling; this says the spelling was right and the verb is
     * wrong - a `Vfx` and a `Video` are engine `Actionable`s with no transform pipeline at all, so
     * no amount of retyping makes a transform reach one. The slot RESOLVES these kinds precisely so
     * it can say that, which is why they sit in `refuses` rather than being left out of `accepts`.
     *
     * Several verbs raise it (`/transform`, `/reset`, `/front`) and they refuse different kinds, so
     * `kind` is the whole payload the message has to work from - see the reason renderer, which picks
     * the advice by it and quotes the verb from the line rather than naming one here.
     */
    | { code: "unsupportedTarget"; span: StoryCommandSpan; value: string; kind: StoryCommandTargetKind }
    /** Two things share this name, so the line does not say which one. */
    | { code: "ambiguousName"; span: StoryCommandSpan; value: string }
    /** Two args a one-op-per-block command cannot honour together. */
    | { code: "conflictingParams"; span: StoryCommandSpan; keys: readonly string[] }
    /**
     * A key the command declares, filled against a target that has no such channel: `opacity=` on the
     * camera, `color=` on an image.
     *
     * The key is offered by the command because the command reaches several kinds of subject and the
     * grammar cannot see which one a line resolved to - the same shape `/show t=` has, where the union
     * of every context's words parses and the spec rejects the ones this target cannot honour. Naming
     * the kind is what makes the report actionable: the author does not have to guess whether the key
     * is wrong or the target is.
     */
    | { code: "unsupportedParam"; span: StoryCommandSpan; key: string; kind: string }
    /**
     * `/repeat 3 until="hp <= 0"` - a count AND a stop condition. Its own code rather than
     * `conflictingParams` because the fix is the opposite one: those two args split into two lines,
     * these two are two ways of saying the same thing and one has to go.
     */
    | { code: "repeatTimesAndUntil"; span: StoryCommandSpan }
    /** An enum value this command's variant of the shared vocabulary does not support (`/bg t=zoom`). */
    | { code: "unsupportedOption"; span: StoryCommandSpan; value: string; allowed: readonly string[] }
    /** Carries the whole underlying {@link StoryExpressionIssue} - its params make the message worth having. */
    | { code: "expressionError"; span: StoryCommandSpan; value: string; issue: StoryExpressionIssue }
    /** `/if gold` - parses fine, but a condition that is not a comparison is nearly always unfinished. */
    | { code: "expressionNotBoolean"; span: StoryCommandSpan; value: string; received: StoryExprType }
    /**
     * `/set gold "rich"` where `gold` is a number - the expression's result type cannot be stored.
     *
     * Two names, because the message has two roles to fill and they are NOT interchangeable:
     * `variable` is the assignment target (the thing that *holds* `expected`), `value` is the
     * expression source under the span (the thing that *produces* `received`). Wording the message
     * with only `value` is what made it say the expression held the variable's type.
     */
    | { code: "expressionTypeMismatch"; span: StoryCommandSpan; value: string; variable: string; expected: StoryVariableValueType; received: StoryExprType }
    /** `/local gold` where a variable of that name already exists in that scope. */
    | { code: "duplicateVariable"; span: StoryCommandSpan; value: string }
    /** `/local AppTag` - a name the expression language reads as something other than a variable. */
    | { code: "reservedVariableName"; span: StoryCommandSpan; value: string }
    /** `/set += 1` - a compound assignment with no variable to compound against. */
    | { code: "compoundWithoutTarget"; span: StoryCommandSpan; value: string };

export type StoryCommandResolution = {
    args: StoryCommandResolvedArgs;
    issues: StoryCommandResolutionIssue[];
};
