import type { BlueprintDebugEvent } from "./blueprint/debug";
import type { BlueprintDocument, SharedBlueprintAsset } from "./blueprint/document";
import type { PersistentVariableRuntimeTable } from "./variables/registry";
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

/** Play-head row forwarded from a Dev Mode window to its project's workspace (WI-2 editor sync). */
export type DevModeStoryRowPayload = {
    projectPath: string;
    storyId: string;
    sceneId: string;
    blockId: string;
};

/** The workspace-side story-row highlight, forwarded from Dev Mode (no projectPath on delivery). */
export type DevModeStoryRowHighlight = {
    storyId: string;
    sceneId: string;
    blockId: string;
};

export type DevModeCharacterSummary = {
    id: string;
    /** Author-facing display name. Empty when the character is unnamed - never falls back to `id`, which is a UUID. */
    name: string;
    appearance: CharacterAppearanceSummary;
    /** Dialog avatar used when no differential resolves one (speaking off-stage, or nothing baked). */
    defaultAvatarAssetId?: string | null;
};

/**
 * One differential's dialog avatar as the compiler sees it. `baked` present means a derived PNG
 * exists under `resources/characters/avatars/` for this key; `overrideAssetId` is the author's own
 * artwork and wins over it.
 */
export type CharacterAvatarSummaryEntry = {
    baked?: boolean;
    overrideAssetId?: string | null;
};

/**
 * A character's appearance as everything outside the character service sees it: the compiler, the
 * story editor's badges, the dev-mode bundle. Ids are what rows store and what the engine receives
 * as tags; `name` is only ever displayed.
 */
export type CharacterAppearanceSummary =
    | {
          kind: "preset";
          poses: { id: string; name: string; assetId: string | null }[];
          defaultPoseId: string | null;
          /** Dialog avatars keyed by pose id. */
          avatars?: Record<string, CharacterAvatarSummaryEntry>;
      }
    | {
          kind: "layered";
          canvas: { width: number; height: number } | null;
          axes: { id: string; name: string; tags: { id: string; name: string }[]; defaultTagId: string | null }[];
          /** Axes the avatar varies with; absent means every axis. */
          avatarAxisIds?: string[];
          /** Dialog avatars keyed by the tag combination (see `characterAvatarKey`). */
          avatars?: Record<string, CharacterAvatarSummaryEntry>;
          /** Bottom to top, matching the stacking order the engine draws. */
          layers: {
              id: string;
              name: string;
              axisId: string | null;
              assetId?: string | null;
              options?: Record<string, string | null>;
              hidden?: boolean;
          }[];
      }
    | {
          /**
           * A box the author's own runtime draws inside. Studio ships no backend and reads none of
           * `options` — see `PuppetAppearance` for why that is a licensing requirement rather than
           * a simplification. No avatar table: a puppet has no authoring-time differentials to key
           * one on, so `defaultAvatarAssetId` is its dialog avatar.
           */
          kind: "puppet";
          /** The model bundle; resolved to its entry-file URL, siblings resolved off it by the engine. */
          assetId: string | null;
          /** Backend name, matching a folder under the project's `runtimes/puppet/`. */
          backend: string;
          /** A sibling of the bundle's declared entry to use instead of it; null = that entry. */
          entry: string | null;
          /** Stage box size in logical pixels; null = the stage size. */
          size: { width: number; height: number } | null;
          /** Handed to the backend verbatim. */
          options: Record<string, unknown>;
      };

export type DevModeStoryLibrary = {
    index: StoryLibraryIndex;
    documents: Record<StoryId, StoryDocument>;
    characters: DevModeCharacterSummary[];
    animations: Record<StoryAnimationAssetId, StoryAnimationAsset>;
    /**
     * `assetId → author-facing asset name`, for the media types a story row can name (image / audio /
     * video). Names only — the bytes travel through the compiler, and this table exists so the Dev
     * Mode debug panel can read a row the way the editor does: `Set background outside_s.jpg` rather
     * than `Set background 4b645b59-1723-4ac9-98ab-e6859b837bef` (U4 WI-1).
     */
    assetNames: Record<string, string>;
};

export type DevModeStartStoryRequest = {
    storyId: StoryId;
    sceneId: string;
    /** Row-precise "play from here": enter the game pre-posed at this block and play forward. */
    startBlockId?: string;
    /** Scene Snapshot (变量快照) whose variable overrides seed the launch. */
    snapshotId?: string;
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
        /**
         * Project-level persistent variables (M-VAR registry), baked from `editor/variables.json`.
         * The runtime reads persistent definitions from here, not from `localBlueprints` - the field
         * left the blueprint document when the registry landed. Keyed by variable id (= the node
         * `persistentVariableId`).
         */
        persistentVariables: PersistentVariableRuntimeTable;
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
