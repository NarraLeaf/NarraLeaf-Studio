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

/** The object names on stage, per kind - the candidate source for target params. */
export type StoryCommandStageObjects = Readonly<Record<StoryCommandStageObjectKind, readonly string[]>>;

export const EMPTY_STORY_COMMAND_STAGE_OBJECTS: StoryCommandStageObjects = {
    image: [], text: [], layer: [], video: [], audio: [], vfx: [],
};

/**
 * The reserved audio-object name addressing the background-music channel (bible B4). The sound
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
    images: [], audio: [], videos: [], characters: [], tempSpeakers: [], scenes: [], audioTracks: [], labels: [], variables: [], appearanceByCharacterId: {},
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
    /** `name` is the author-facing name as declared - the compound-assignment sugar re-emits it into the desugared source. */
    | { kind: "variable"; ref: StoryVariableRef; valueType: StoryVariableValueType; name: string; defaultValue?: StoryLiteralValue }
    | { kind: "enum"; value: string }
    | { kind: "keyword"; value: string }
    | { kind: "number"; value: number }
    | { kind: "boolean"; value: boolean }
    | { kind: "literal"; value: StoryLiteralValue }
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
    | { code: "unknownVariable"; span: StoryCommandSpan; value: string }
    | { code: "unknownForm"; span: StoryCommandSpan; value: string; characterName: string }
    /** `/motion Alice run` - Alice is drawn by Studio, so she has no runtime state to request. */
    | { code: "notPuppetCharacter"; span: StoryCommandSpan; value: string }
    /** A generic verb's subject matching neither a character nor anything on stage. */
    | { code: "unknownTarget"; span: StoryCommandSpan; value: string }
    /** Two things share this name, so the line does not say which one. */
    | { code: "ambiguousName"; span: StoryCommandSpan; value: string }
    /** Two args a one-op-per-block command cannot honour together. */
    | { code: "conflictingParams"; span: StoryCommandSpan; keys: readonly string[] }
    /** An enum value this command's variant of the shared vocabulary does not support (`/bg t=zoom`). */
    | { code: "unsupportedOption"; span: StoryCommandSpan; value: string; allowed: readonly string[] }
    /** Carries the whole underlying {@link StoryExpressionIssue} - its params make the message worth having. */
    | { code: "expressionError"; span: StoryCommandSpan; value: string; issue: StoryExpressionIssue }
    /** `/if gold` - parses fine, but a condition that is not a comparison is nearly always unfinished. */
    | { code: "expressionNotBoolean"; span: StoryCommandSpan; value: string; received: StoryExprType }
    /** `/set gold "rich"` where `gold` is a number - the expression's result type cannot be stored. */
    | { code: "expressionTypeMismatch"; span: StoryCommandSpan; value: string; expected: StoryVariableValueType; received: StoryExprType }
    /** `/local gold` where a variable of that name already exists in that scope. */
    | { code: "duplicateVariable"; span: StoryCommandSpan; value: string }
    /** `/set += 1` - a compound assignment with no variable to compound against. */
    | { code: "compoundWithoutTarget"; span: StoryCommandSpan; value: string };

export type StoryCommandResolution = {
    args: StoryCommandResolvedArgs;
    issues: StoryCommandResolutionIssue[];
};
