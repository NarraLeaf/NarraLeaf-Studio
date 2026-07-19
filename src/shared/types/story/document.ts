import type { StoryExpression } from "./expression";

export const STORY_LIBRARY_INDEX_SCHEMA_VERSION = 1 as const;
// v4 adds the `invalid` block kind and dialogue's `speakerName`. Both are additive - v3 documents
// load unchanged - but a v3 Studio would silently drop an unresolved command line and render a
// temp-speaker line with no speaker, so the bump makes it refuse the document instead.
// v5 replaces the expression condition's inert `source: string` with a parsed `StoryExpression`, and
// adds `setVariable.expression` / the `expression` interpolation. Only the condition needs migrating
// (the other two are additive); a v4 Studio reading a v5 document would see a condition object it
// cannot evaluate, so the bump makes it refuse rather than test false forever.
export const STORY_DOCUMENT_SCHEMA_VERSION = 5 as const;
/** Story animation index/asset schema version (independent of the story document version). */
export const STORY_ANIMATION_SCHEMA_VERSION = 1 as const;

export type StoryLibraryIndexVersion = typeof STORY_LIBRARY_INDEX_SCHEMA_VERSION;
export type StoryDocumentVersion = typeof STORY_DOCUMENT_SCHEMA_VERSION;
export type StoryAnimationSchemaVersion = typeof STORY_ANIMATION_SCHEMA_VERSION;

export type StoryId = string;
export type StoryAnimationAssetId = string;
export type StoryChapterId = string;
export type StorySceneId = string;
export type StoryBlockId = string;
export type StoryTextId = string;

export type StoryLibraryIndex = {
    schemaVersion: StoryLibraryIndexVersion;
    stories: StoryLibraryEntry[];
    defaultStoryId?: StoryId;
    meta?: StoryMeta;
};

export type StoryLibraryEntry = {
    id: StoryId;
    name: string;
    documentPath: string;
    createdAt: string;
    updatedAt: string;
    importSource?: StoryImportSource;
    exportMeta?: StoryExportMeta;
};

export type StoryImportSource = {
    kind: "package" | "project" | "manual";
    label?: string;
    importedAt?: string;
};

export type StoryExportMeta = {
    packageFormat?: string;
    exportedAt?: string;
    sourceStoryId?: StoryId;
};

export type StoryDocument = {
    schemaVersion: StoryDocumentVersion;
    id: StoryId;
    name: string;
    entrySceneId?: StorySceneId;
    chapters: StoryChapter[];
    scenes: Record<StorySceneId, StoryScene>;
    /** Document-level saved variables (per save-file, backed by NLR Storable). */
    savedVariables?: Record<string, StorySavedVariableDefinition>;
    meta?: StoryMeta;
};

export type StoryMeta = {
    createdAt?: string;
    updatedAt?: string;
    [key: string]: unknown;
};

export type StoryChapter = {
    id: StoryChapterId;
    name: string;
    sceneIds: StorySceneId[];
    meta?: StoryMeta;
};

export type StoryScene = {
    id: StorySceneId;
    name: string;
    runtimeName: string;
    description?: string;
    defaultBackgroundAssetId?: string;
    rootBlockIds: StoryBlockId[];
    blocks: Record<StoryBlockId, StoryBlock>;
    /** Per-scene variables (backed by NLR Scene.local). */
    sceneVariables?: Record<string, StorySceneVariableDefinition>;
    meta?: StoryMeta;
};

export type StorySceneUpdate = {
    name?: string;
    description?: string;
    defaultBackgroundAssetId?: string | null;
};

/**
 * Story-declarable variable classes:
 *  - "scene": per-scene, backed by NLR `Scene.local` (survives save/load); declared on `StoryScene`.
 *  - "saved": per save-file, backed by NLR `Storable`; declared on `StoryDocument`; serializable-only.
 *  - "persistent": app-level, shared with UI blueprints (`BlueprintDocument.persistentVariables`),
 *     referenced by stable `storageKey`; serializable-only. Not stored in the story document.
 * The blueprint-local "var" class is a Blueprint concern (`Blueprint.members.variables`), not a story scope.
 */
export type StoryVariableScope = "scene" | "saved" | "persistent";
export type StoryVariableValueType = "boolean" | "number" | "string" | "json";
export type StoryStageObjectKind = "image" | "text" | "layer" | "video";
export type StoryDisplayableTargetKind = Exclude<StoryStageObjectKind, "video"> | "character";

/** Declaration for a scene variable (backed by NLR `Scene.local`). */
export type StorySceneVariableDefinition = {
    id: string;
    /** Author-facing, proper-case label. Displayed to users; the id/storageKey are never shown. */
    name: string;
    valueType: StoryVariableValueType;
    defaultValue?: StoryLiteralValue;
    /** Stable runtime key; defaults to `id` and never changes on rename so saves stay valid. */
    storageKey: string;
    meta?: StoryMeta;
};

/** Declaration for a saved variable (per save-file, backed by NLR `Storable`). Serializable-only. */
export type StorySavedVariableDefinition = {
    id: string;
    name: string;
    valueType: StoryVariableValueType;
    defaultValue?: StoryLiteralValue;
    /** Stable runtime key within the saved namespace; defaults to `id`, unchanged on rename. */
    storageKey: string;
    meta?: StoryMeta;
};

export type StoryLiteralValue = string | number | boolean | null | StoryLiteralValue[] | { [key: string]: StoryLiteralValue };

// --- Legacy (schema v1) shapes, retained only as migration input. ---
export type StoryVariableScopeLegacy = "studioGlobal" | "gamePersistent" | "sceneLocal";

export type StoryVariableDefinitionLegacy = {
    id: string;
    name: string;
    scope: StoryVariableScopeLegacy;
    valueType: StoryVariableValueType;
    defaultValue?: StoryLiteralValue;
    meta?: StoryMeta;
};

export type StoryPersistentDefinitionLegacy = {
    namespace: string;
    defaultContent: Record<string, StoryLiteralValue>;
    meta?: StoryMeta;
};

export type StoryBlockKind = "nodeAction" | "action" | "control" | "jump" | "code" | "note" | "invalid";

export type StoryBlock =
    | StoryNodeActionBlock
    | StoryActionBlock
    | StoryControlBlock
    | StoryJumpBlock
    | StoryCodeBlock
    | StoryNoteBlock
    | StoryInvalidBlock;

export type StoryBlockBase<TKind extends StoryBlockKind, TPayload> = {
    id: StoryBlockId;
    kind: TKind;
    parentId: StoryBlockId | null;
    childrenIds: StoryBlockId[];
    payload: TPayload;
    diagnosticsMeta?: StoryDiagnosticsMeta;
};

export type StoryNodeActionBlock = StoryBlockBase<"nodeAction", StoryNodeActionPayload>;
export type StoryActionBlock = StoryBlockBase<"action", StoryActionPayload>;
export type StoryControlBlock = StoryBlockBase<"control", StoryControlPayload>;
export type StoryJumpBlock = StoryBlockBase<"jump", StoryJumpPayload>;
export type StoryCodeBlock = StoryBlockBase<"code", StoryCodePayload>;
export type StoryNoteBlock = StoryBlockBase<"note", StoryNotePayload>;
export type StoryInvalidBlock = StoryBlockBase<"invalid", StoryInvalidPayload>;

/**
 * A command line the author left unresolved - they dismissed the candidates, or nothing matched, and
 * the text does not parse into an action.
 *
 * It is deliberately not a note and not narration: it has no runtime behaviour, and it is an *error*,
 * not a comment. Committing one of these is how the editor refuses to silently turn a half-typed
 * `/set` into a line of prose the author never meant to write - the text survives verbatim in
 * `source`, re-editing the row resumes command entry from it, and nothing about it is quiet: preview
 * skips it with an error diagnostic, and a production build refuses to compile at all.
 */
export type StoryInvalidPayload = {
    /** The raw line as typed, so re-entering the row resumes command entry from exactly it. */
    source: string;
};

export type StoryNodeActionPayload =
    | {
          action: "narration";
          text: StoryTextSegment;
      }
    | {
          action: "dialogue";
          characterId?: string;
          /**
           * A speaker with no Studio character behind it, carried as a bare name.
           *
           * NarraLeaf's dialogue box does not bind to Studio's `Character` abstraction - it displays
           * whatever name its `Character` instance carries - so an unknown name is a perfectly valid
           * line, not an error. That is what lets the speaker picker always offer the typed name back
           * as a candidate: "nothing matched" stops being a state the editor has to have an answer
           * for. Ignored when `characterId` resolves.
           */
          speakerName?: string;
          text: StoryTextSegment;
          voiceAssetId?: string;
          /** Auto-pause after the line: `true` waits for a click, a number waits that many ms. */
          pauseAfter?: boolean | number;
      }
    | {
          action: "choice";
          prompt?: StoryTextSegment;
      }
    | {
          action: "choiceOption";
          text: StoryTextSegment;
          hiddenWhen?: StoryConditionRef;
          disabledWhen?: StoryConditionRef;
      };

export type StoryActionPayload =
    | {
          action: "setBackground";
          assetId?: string;
          color?: string;
          transition?: StoryTransitionRef;
      }
    | {
          action: "character";
          operation: "enter" | "move" | "exit" | "expression";
          characterId?: string;
          assetId?: string;
          objectName?: string;
          formName?: string;
          variants?: StoryCharacterVariantSelection;
          transition?: StoryTransitionRef;
          transform?: StoryTransformRef;
      }
    | {
          action: "audio";
          operation:
              | "setBgm"
              | "playSound"
              | "stopSound"
              | "pauseSound"
              | "resumeSound"
              | "setVolume"
              | "setRate"
              | "muteSound";
          objectName?: string;
          assetId?: string;
          fadeMs?: number;
          volume?: number;
          rate?: number;
          muted?: boolean;
          loop?: boolean;
      }
    | {
          action: "setVariable";
          target: StoryVariableRef;
          value: StoryLiteralValue;
          /**
           * A computed right-hand side (`/set gold gold + 1`). **When present it wins**, and `value`
           * is only the last literal the row held - never read by the compiler.
           *
           * Why not fold the literal case in here too: `/set gold 100` is the overwhelmingly common
           * row, `value` is what the inspector's literal editor binds to, and every document written
           * before expressions existed already stores it. So a bare literal stays a bare literal and
           * this field is the escape hatch - which keeps the migration empty and the blast radius of
           * expressions confined to rows that actually use one.
           */
          expression?: StoryExpression;
      }
    | {
          action: "wait";
          mode: "duration" | "click";
          durationMs?: number;
      }
    | {
          action: "image";
          operation: "create" | "setSource" | "show" | "hide";
          objectName: string;
          assetId?: string;
          color?: string;
          layer?: StoryLayerRef;
          autoFit?: boolean;
          transition?: StoryTransitionRef;
          transform?: StoryTransformRef;
      }
    | {
          action: "displayable";
          operation:
              | "show"
              | "hide"
              | "transform"
              | "mask"
              | "clearMask"
              | "clip"
              | "clearClip"
              | "filter"
              | "clearFilter"
              | "darken"
              | "circleReveal"
              | "circleClose"
              | "wipe";
          target: StoryDisplayableTargetRef;
          transform?: StoryTransformRef;
          /** Image mask source (image asset) for the `mask` operation. */
          maskAssetId?: string;
          /** CSS clip-path for the `clip` operation. */
          clipPath?: string;
          /** CSS filter for the `filter` operation. */
          filter?: string;
          /** Darkness 0..1 for the `darken` operation (image/character targets only). */
          darkness?: number;
          /** Shared effect timing. */
          durationMs?: number;
          easing?: string;
          /** Effect-specific params, e.g. circle center/from/to or wipe direction/reverse. */
          effectProps?: Record<string, StoryLiteralValue>;
      }
    | {
          action: "text";
          operation: "create" | "setText" | "show" | "hide" | "setFontSize" | "setFontColor";
          objectName: string;
          text?: string;
          fontSize?: number;
          fontColor?: string;
          layer?: StoryLayerRef;
          transform?: StoryTransformRef;
      }
    | {
          action: "layer";
          operation: "create" | "setZIndex" | "show" | "hide" | "transform";
          objectName: string;
          /**
           * Which layer non-`create` ops act on - a built-in (`background`/`displayable`) or a custom
           * layer bound by its create block. `create` names a new custom layer via `objectName`.
           */
          target?: StoryLayerRef;
          zIndex?: number;
          transform?: StoryTransformRef;
      }
    | {
          action: "video";
          operation: "create" | "show" | "hide" | "play";
          objectName: string;
          assetId?: string;
          muted?: boolean;
      }
    | {
          action: "nvl";
          transition?: StoryTransformRef;
      }
    | {
          action: "screenEffect";
          effect: "blink" | "vignette";
          durationMs?: number;
          holdMs?: number;
          color?: string;
          opacity?: number;
          easing?: string;
      }
    | {
          action: "blueprint";
          /** Owner blueprint id of the implicit Story Action Blueprint bound 1:1 to this action. */
          blueprintId: string;
      };

export type StoryControlPayload =
    | {
          control: "condition";
      }
    | {
          control: "conditionBranch";
          branch: "if" | "elseIf" | "else";
          condition?: StoryConditionRef;
      }
    | {
          control: "sequence" | "parallel" | "race" | "repeat";
          mode?: "do" | "doAsync" | "all" | "allAsync" | "any";
          times?: number;
      };

export type StoryJumpPayload = {
    targetSceneId: StorySceneId;
    transition?: StoryTransitionRef;
};

export type StoryCodePayload = {
    language: "typescript" | "javascript" | "narraleaf";
    source: string;
    folded?: boolean;
    advanced?: boolean;
};

export type StoryNotePayload = {
    text: StoryTextSegment;
};

export type StoryTextSegment = {
    textId: StoryTextId;
    /** Plain-text projection of the segment (concatenation of rich text runs). Always kept in sync. */
    value: string;
    role: "narration" | "dialogue" | "choicePrompt" | "choiceText" | "note";
    /**
     * Optional rich-text runs. When absent the segment is plain (`value`). When present, `value`
     * is the derived plain-text projection and `rich` is the source of truth for styling. Maps to
     * NarraLeaf `Sentence`/`Word`/`Pause` at compile time.
     */
    rich?: StoryRichRun[];
};

export type StoryTextMarks = {
    bold?: boolean;
    italic?: boolean;
    color?: string;
    ruby?: string;
    cps?: number;
    fontSize?: number;
};

/**
 * Inline text interpolation (phase 2): a rich-text run that renders a computed value.
 *  - "variable": the current value of a scene/saved/persistent variable (NLR dynamic word).
 *  - "blueprint": the Return Value of a Story Action Blueprint's On Call graph.
 */
export type StoryInterpolationRef =
    | { kind: "variable"; target: StoryVariableRef }
    | { kind: "blueprint"; blueprintId: string }
    /**
     * A computed inline run - the `{gold + bonus}` an author types mid-sentence. A bare `{gold}`
     * normalizes to `kind: "variable"` instead, so there is exactly one representation of "show this
     * variable" and the existing variable-interpolation UI keeps working unchanged.
     */
    | { kind: "expression"; expression: StoryExpression };

export type StoryRichRun =
    | { text: string; marks?: StoryTextMarks }
    | { pause: number | true }
    /** An inline value (variable/blueprint), stylable like a word: bold/italic/color apply to its text. */
    | { interpolation: StoryInterpolationRef; marks?: StoryTextMarks };

export type StoryVariableRef =
    | { scope: "scene"; variableId: string }
    | { scope: "saved"; variableId: string }
    | { scope: "persistent"; storageKey: string };

/** Legacy (schema v1) free-form variable reference, retained for migration + picker safety-net. */
export type StoryVariableRefLegacy = {
    scope: StoryVariableScopeLegacy;
    namespace?: string;
    key: string;
};

/**
 * The stage singletons every scene has without a creator block: the scene background image
 * (`Scene.background`) and NarraLeaf-React's two built-in layers. All are Displayables, so any of
 * them can be a transform / show / hide / effect target.
 */
export type StoryDisplayableBuiltin = "background" | "backgroundLayer" | "displayableLayer";

export type StoryDisplayableTargetRef = {
    kind?: StoryDisplayableTargetKind;
    name: string;
    /**
     * Stable identity of the displayable: the id of the action block that introduced it
     * (character enter / image / text / layer). Displayables can only be declared statically,
     * so this always points at a real creator block. When present it is the source of truth -
     * the current stage name is resolved from that block, so the reference survives renames.
     * `name` remains as a legacy fallback and last-known label when the source is unresolvable.
     */
    sourceBlockId?: StoryBlockId;
    /**
     * A built-in stage singleton (scene background / built-in layer) that has no creator block.
     * When set it is the source of truth; `name`/`kind`/`sourceBlockId` are display fallbacks only.
     */
    builtin?: StoryDisplayableBuiltin;
};

/**
 * Reference to the render layer an image/text is placed on. Layers can only be declared statically
 * (by a `layer` create block) or be one of NarraLeaf-React's two built-in scene layers, so every
 * valid target is discoverable by scanning the scene - never free-text.
 *  - "default": one of NLR `Scene.backgroundLayer` (z-index -1) / `Scene.displayableLayer` (z-index
 *    0, the default). An absent ref is equivalent to `{ kind: "default", layer: "displayable" }`.
 *  - "custom": a user-declared layer, bound to the stable id of the `layer` create block. The
 *    block's current name is resolved at every read site so the reference survives renames; `name`
 *    is only a legacy fallback / last-known label (also the sole binding for pre-v3 documents whose
 *    layer name never matched a create block).
 */
export type StoryLayerRef =
    | { kind: "default"; layer: "background" | "displayable" }
    | { kind: "custom"; sourceBlockId?: StoryBlockId; name?: string };

export type StoryCharacterVariantSelection = string[] | Record<string, string>;

export type StoryConditionRef =
    | {
          kind: "variable";
          target: StoryVariableRef;
          operator: "isTrue" | "isFalse" | "equals" | "notEquals" | "exists";
          value?: StoryLiteralValue;
      }
    | {
          /**
           * Blueprint-backed condition: the boolean is computed by an implicit Story Action Blueprint's
           * "On Call" graph (owner kind `storyAction`, mode `condition`), mirroring how a blueprint
           * interpolation evaluates a value. The graph's `Return Value` is typed boolean and coerced
           * with `Boolean(...)` at evaluation. `blueprintId` is created lazily on first edit.
           */
          kind: "blueprint";
          blueprintId: string;
      }
    | {
          /**
           * Expression-backed condition: `/if gold >= 100`. Carries a parsed {@link StoryExpression},
           * not raw script - the tree is built once when the row commits, so the compiler evaluates
           * rather than parses and a condition cannot fail to compile on data that already saved.
           *
           * Schema v4 stored a bare `source: string` here and every consumer refused it (the compiler
           * returned a constant false). v5 re-parses that source on load; anything that no longer
           * resolves becomes an `invalid` tree, which faults visibly instead of silently testing false.
           */
          kind: "expression";
          expression: StoryExpression;
      };

export type StoryTransformPreset =
    | "none"
    | "left"
    | "center"
    | "right"
    | "custom"
    | "fadeIn"
    | "fadeOut"
    | "slideLeft"
    | "slideRight"
    | "slideUp"
    | "slideDown"
    | "zoom"
    | "scale"
    | "rotate"
    | "opacity"
    | "darken"
    | "circleReveal"
    | "circleClose"
    | "wipe";

export type StoryTransformRef = {
    mode?: "preset" | "animation";
    preset?: StoryTransformPreset;
    durationMs?: number;
    easing?: string;
    props?: Record<string, StoryLiteralValue>;
    animationId?: StoryAnimationAssetId;
};

export type StoryTransitionRef = {
    kind:
        | "none"
        | "dissolve"
        | "fadeIn"
        | "maskCircle"
        | "maskWipe"
        | "softWipe"
        | "blinds"
        | "slide"
        | "softIris"
        | "blurDissolve"
        | "throughColor"
        | "darkness"
        | "custom";
    durationMs?: number;
    easing?: string;
    props?: Record<string, StoryLiteralValue>;
};

export type StoryDiagnosticsMeta = {
    sourceLine?: number;
    sourceColumn?: number;
    tags?: string[];
};

export type StoryAnimationIndex = {
    schemaVersion: StoryAnimationSchemaVersion;
    animations: StoryAnimationIndexEntry[];
    meta?: StoryMeta;
};

export type StoryAnimationIndexEntry = {
    id: StoryAnimationAssetId;
    name: string;
    targetKind: StoryDisplayableTargetKind;
    documentPath: string;
    createdAt: string;
    updatedAt: string;
};

export type StoryAnimationAsset = {
    schemaVersion: StoryAnimationSchemaVersion;
    id: StoryAnimationAssetId;
    name: string;
    targetKind: StoryDisplayableTargetKind;
    timeline?: StoryAnimationTimeline;
    sequences: StoryAnimationSequence[];
    config?: StoryAnimationConfig;
    /**
     * Editor-only image asset rendered as the motion target in the Story Motion preview.
     * This is a visualization hint and is NOT an animation target binding - it is
     * ignored by the compiler and never affects the produced Transform.
     */
    previewAssetId?: string;
    /** Editor-only image asset rendered as the stage background in the Story Motion preview. */
    previewBackgroundAssetId?: string;
    meta?: StoryMeta;
};

export type StoryAnimationConfig = {
    repeat?: number;
    repeatDelayMs?: number;
};

export type StoryAnimationSequence = {
    id: string;
    props: StoryTransformSequenceProps;
    options?: StoryAnimationSequenceOptions;
};

export type StoryAnimationTimeline = {
    fps?: number;
    durationMs?: number;
    tracks: StoryAnimationTrack[];
};

export type StoryAnimationTrackProperty = keyof StoryTransformSequenceProps;

export type StoryAnimationTrack = {
    id: string;
    property: StoryAnimationTrackProperty;
    keyframes: StoryAnimationKeyframe[];
};

export type StoryAnimationKeyframe = {
    id: string;
    timeMs: number;
    value: StoryAnimationKeyframeValue;
    easing?: string;
};

export type StoryAnimationKeyframeValue = StoryAlignPositionValue | number | string;

export type StoryTransformSequenceProps = {
    position?: StoryAlignPositionValue;
    opacity?: number;
    zoom?: number;
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
    fontColor?: string;
    maskImage?: string;
    maskSize?: string;
    maskPosition?: string;
    maskRepeat?: string;
    maskMode?: string;
    clipPath?: string;
    filter?: string;
    backdropFilter?: string;
    mixBlendMode?: string;
};

export type StoryAlignPositionValue = {
    xalign?: number;
    yalign?: number;
    xoffset?: number;
    yoffset?: number;
};

export type StoryAnimationSequenceOptions = {
    durationMs?: number;
    easing?: string;
    delayMs?: number;
    at?: number | `+${number}` | `-${number}`;
};

export type StoryPackageCapability = {
    supported: false;
    reason: "not_implemented";
};
