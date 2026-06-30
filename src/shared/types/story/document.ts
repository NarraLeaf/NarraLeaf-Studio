export const STORY_LIBRARY_INDEX_SCHEMA_VERSION = 1 as const;
export const STORY_DOCUMENT_SCHEMA_VERSION = 1 as const;

export type StoryLibraryIndexVersion = typeof STORY_LIBRARY_INDEX_SCHEMA_VERSION;
export type StoryDocumentVersion = typeof STORY_DOCUMENT_SCHEMA_VERSION;

export type StoryId = string;
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
          operation: "show" | "hide" | "transform";
          target: StoryDisplayableTargetRef;
          transform?: StoryTransformRef;
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
    value: string;
    role: "narration" | "dialogue" | "choicePrompt" | "choiceText" | "note";
};

export type StoryVariableRef = {
    scope: StoryVariableScope;
    namespace?: string;
    key: string;
};

export type StoryDisplayableTargetRef = {
    kind?: StoryDisplayableTargetKind;
    name: string;
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
    animationId?: string;
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

export type StoryPackageCapability = {
    supported: false;
    reason: "not_implemented";
};
