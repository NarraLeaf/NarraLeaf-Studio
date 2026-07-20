import type { BlueprintDebugEvent } from "./blueprint/debug";
import type { BlueprintDocument, SharedBlueprintAsset } from "./blueprint/document";
import type { GameLocalizationBundle } from "./localization";
import type { GameVoiceBundle } from "./voice";
import type { UIDocument } from "./ui-editor/document";
import type { UIGraphDocument } from "./ui-editor/graph";
import type { UISurfaceId } from "./ui-editor/document";
import type { StoryAnimationAsset, StoryAnimationAssetId, StoryDocument, StoryId, StoryLibraryIndex } from "./story";

export type DevModeEntry =
    | {
          kind: "surface";
          surfaceId: UISurfaceId;
      }
    | {
          kind: "story";
          storyId: StoryId;
          sceneId: string;
          /** Row to enter the game at; omitted = the scene start. */
          blockId?: string;
          /** Scene Snapshot whose variable values seed the launch (Phase 2). */
          snapshotId?: string;
          /** Legacy source-locator fields; unused by the current boot path. */
          scriptId?: string;
          filePath?: string;
          line?: number;
          checkpointId?: string;
      }
    | {
          kind: "extension";
          extensionId: string;
          payload?: Record<string, unknown>;
      };

export type DevModeStatus =
    | "idle"
    | "starting"
    | "compiling"
    | "running"
    | "reloading"
    | "error"
    | "stopping";

export type DevModeConsoleLogLevel = "verbose" | "info" | "success" | "warning" | "error";

export type DevModeConsoleLogPayload = {
    level: DevModeConsoleLogLevel;
    message: string;
    source?: string;
    timestamp?: number;
};

export type DevModeBlueprintDebugEventPayload = {
    projectPath: string;
    event: BlueprintDebugEvent;
};

export type DevModeCharacterSummary = {
    id: string;
    /** Author-facing display name. Empty when the character is unnamed - never falls back to `id`, which is a UUID. */
    name: string;
    defaultForm?: string | null;
    forms?: DevModeCharacterFormSummary[];
};

export type DevModeCharacterFormSummary = {
    name: string;
    groups: DevModeCharacterVariantGroupSummary[];
    variantAssets: Record<string, { assetId: string; name?: string }>;
};

export type DevModeCharacterVariantGroupSummary = {
    name: string;
    defaultVariant: string | null;
    variants: { name: string }[];
};

export type DevModeStoryLibrary = {
    index: StoryLibraryIndex;
    documents: Record<StoryId, StoryDocument>;
    characters: DevModeCharacterSummary[];
    animations: Record<StoryAnimationAssetId, StoryAnimationAsset>;
};

export type DevModeStartStoryRequest = {
    storyId: StoryId;
    sceneId: string;
    /** Row-precise "play from here": enter the game pre-posed at this block and play forward. */
    startBlockId?: string;
};

export type DevModeBundle = {
    bundleId: string;
    revision: number;
    timestamp: string;
    ui: {
        uidoc: UIDocument;
        /** UI graph document; instance blueprints live in {@link UIGraphDocument.blueprintDocument} and are mirrored in `localBlueprints`. */
        uigraphs: UIGraphDocument;
        /** Instance {@link BlueprintDocument} (same object as `uigraphs.blueprintDocument`); explicit for Dev Mode consumers. */
        localBlueprints: BlueprintDocument;
        /** Shared blueprint assets loaded from project asset metadata + content files. */
        sharedBlueprints: SharedBlueprintAsset[];
    };
    story?: StoryDocument;
    storyLibrary?: DevModeStoryLibrary;
    /**
     * Game localization payload (config + per-locale translation tables), assembled
     * from `.nlproj` `app.localization` + `editor/localization/*.json`. Carried by
     * the bundle so Dev Mode and the packaged runtime share one channel. Absent
     * when the project has no localization set up.
     */
    localization?: GameLocalizationBundle;
    /**
     * Game voice payload (config + per-language unit id → asset id tables),
     * assembled from `.nlproj` `app.voice` + `editor/voice/*.json`. Carried by
     * the bundle so Dev Mode and the packaged runtime share one channel; the
     * compiler resolves the asset ids to URLs. Absent when the project has no
     * voice set up.
     */
    voice?: GameVoiceBundle;
    scripts?: Record<string, unknown>;
    compiled?: Record<string, unknown>;
    meta?: Record<string, unknown>;
    /**
     * Blueprint M5: IIFE bundle JS per TypeScript blueprint id (local + shared), executed in Dev Mode before runtime.
     */
    blueprintCompiledScripts?: Record<string, string>;
    /** When present and false, blueprint script compilation failed (strict block). */
    blueprintScriptsCompileOk?: boolean;
    blueprintScriptsCompileErrors?: string[];
};
