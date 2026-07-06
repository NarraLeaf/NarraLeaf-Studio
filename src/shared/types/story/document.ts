export const STORY_LIBRARY_INDEX_SCHEMA_VERSION = 1 as const;
export const STORY_DOCUMENT_SCHEMA_VERSION = 1 as const;

export type StoryLibraryIndexVersion = typeof STORY_LIBRARY_INDEX_SCHEMA_VERSION;
export type StoryDocumentVersion = typeof STORY_DOCUMENT_SCHEMA_VERSION;

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
    studioGlobals?: Record<string, StoryVariableDefinition>;
    gamePersistents?: Record<string, StoryPersistentDefinition>;
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
    localVariables?: Record<string, StoryVariableDefinition>;
    meta?: StoryMeta;
};

export type StorySceneUpdate = {
    name?: string;
    description?: string;
    defaultBackgroundAssetId?: string | null;
};

export type StoryVariableScope = "studioGlobal" | "gamePersistent" | "sceneLocal";
export type StoryVariableValueType = "boolean" | "number" | "string" | "json";
export type StoryStageObjectKind = "image" | "text" | "layer" | "video";
export type StoryDisplayableTargetKind = Exclude<StoryStageObjectKind, "video"> | "character";

export type StoryVariableDefinition = {
    id: string;
    name: string;
    scope: StoryVariableScope;
    valueType: StoryVariableValueType;
    defaultValue?: StoryLiteralValue;
    meta?: StoryMeta;
};

export type StoryPersistentDefinition = {
    namespace: string;
    defaultContent: Record<string, StoryLiteralValue>;
    meta?: StoryMeta;
};

export type StoryLiteralValue = string | number | boolean | null | StoryLiteralValue[] | { [key: string]: StoryLiteralValue };

export type StoryBlockKind = "nodeAction" | "action" | "control" | "jump" | "code" | "note";

export type StoryBlock =
    | StoryNodeActionBlock
    | StoryActionBlock
    | StoryControlBlock
    | StoryJumpBlock
    | StoryCodeBlock
    | StoryNoteBlock;

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

export type StoryNodeActionPayload =
    | {
          action: "narration";
          text: StoryTextSegment;
      }
    | {
          action: "dialogue";
          characterId?: string;
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
          layerName?: string;
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
          layerName?: string;
          transform?: StoryTransformRef;
      }
    | {
          action: "layer";
          operation: "create" | "setZIndex" | "show" | "hide" | "transform";
          objectName: string;
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

export type StoryRichRun =
    | { text: string; marks?: StoryTextMarks }
    | { pause: number | true };

export type StoryVariableRef = {
    scope: StoryVariableScope;
    namespace?: string;
    key: string;
};

export type StoryDisplayableTargetRef = {
    kind?: StoryDisplayableTargetKind;
    name: string;
    /**
     * Stable identity of the displayable: the id of the action block that introduced it
     * (character enter / image / text / layer). Displayables can only be declared statically,
     * so this always points at a real creator block. When present it is the source of truth —
     * the current stage name is resolved from that block, so the reference survives renames.
     * `name` remains as a legacy fallback and last-known label when the source is unresolvable.
     */
    sourceBlockId?: StoryBlockId;
};

export type StoryCharacterVariantSelection = string[] | Record<string, string>;

export type StoryConditionRef =
    | {
          kind: "variable";
          target: StoryVariableRef;
          operator: "isTrue" | "isFalse" | "equals" | "notEquals" | "exists";
          value?: StoryLiteralValue;
      }
    | {
          kind: "expression";
          source: string;
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
    kind: "none" | "dissolve" | "fadeIn" | "maskCircle" | "maskWipe" | "darkness" | "custom";
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
    schemaVersion: StoryDocumentVersion;
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
    schemaVersion: StoryDocumentVersion;
    id: StoryAnimationAssetId;
    name: string;
    targetKind: StoryDisplayableTargetKind;
    timeline?: StoryAnimationTimeline;
    sequences: StoryAnimationSequence[];
    config?: StoryAnimationConfig;
    /**
     * Editor-only image asset rendered as the motion target in the Story Motion preview.
     * This is a visualization hint and is NOT an animation target binding — it is
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
