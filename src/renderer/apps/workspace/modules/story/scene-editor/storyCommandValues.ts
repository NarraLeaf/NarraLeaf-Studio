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

export type StoryCommandVariableEntry = {
    name: string;
    ref: StoryVariableRef;
    valueType: StoryVariableValueType;
    /** The declared default - what `/reset` restores. */
    defaultValue?: StoryLiteralValue;
};

/** The five kinds of named object a command can address by `objectName`. */
export type StoryCommandStageObjectKind = "image" | "text" | "layer" | "video" | "audio";

/** What a generic verb's target may be: a character, or a stage object of some kind. */
export type StoryCommandTargetKind = "character" | StoryCommandStageObjectKind;

/** The object names on stage, per kind - the candidate source for target params. */
export type StoryCommandStageObjects = Readonly<Record<StoryCommandStageObjectKind, readonly string[]>>;

export const EMPTY_STORY_COMMAND_STAGE_OBJECTS: StoryCommandStageObjects = {
    image: [], text: [], layer: [], video: [], audio: [],
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
    variables: readonly StoryCommandVariableEntry[];
    /** Form / appearance names per character id - the candidates for a form slot, which only exist once the character resolves. */
    formsByCharacterId: Readonly<Record<string, readonly string[]>>;
    /** Named objects on stage in the current scene, per kind. */
    stageObjects: StoryCommandStageObjects;
};

export const EMPTY_STORY_COMMAND_CONTEXT: StoryCommandContext = {
    images: [], audio: [], videos: [], characters: [], tempSpeakers: [], scenes: [], variables: [], formsByCharacterId: {},
    stageObjects: EMPTY_STORY_COMMAND_STAGE_OBJECTS,
};

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
    | { kind: "characterForm"; formName: string }
    | { kind: "scene"; sceneId: string }
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
    | { code: "unknownVariable"; span: StoryCommandSpan; value: string }
    | { code: "unknownForm"; span: StoryCommandSpan; value: string; characterName: string }
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
