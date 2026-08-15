import type { BlueprintDebugEvent } from "./blueprint/debug";
import type { BlueprintDocument, SharedBlueprintAsset } from "./blueprint/document";
import type { BrandColor } from "./brand";
import type { PersistentVariableRuntimeTable, SavedVariableRuntimeTable } from "./variables/registry";
import type { GameLocalizationBundle } from "./localization";
import type { PlayerPreferences } from "./preference";
import type { AutoSaveConfiguration } from "./saves";
import type { SaveSchemaRuntimeTable } from "./saveSchema";
import type { GameVoiceBundle } from "./voice";
import type { GameAudioBundle } from "./audio";
import type { GameRuntimeViewportConfig } from "./gameRuntime";
import type { UIDocument } from "./ui-editor/document";
import type { UIGraphDocument } from "./ui-editor/graph";
import type { UISurfaceId } from "./ui-editor/document";
import type { StoryAnimationAsset, StoryAnimationAssetId, StoryDocument, StoryId, StoryLibraryIndex } from "./story";

export type DevModeEntry =
    | {
          kind: "surface";
          surfaceId: UISurfaceId;
          /**
           * Safe-area device preset id to open the window with; omitted / `null` = no overlay.
           *
           * Only the UI Surface editor's canvas launch button sets this. Launching from the top bar
           * is "run it the way a player gets it", so it deliberately carries no design aid. This is
           * the window's *initial* value only: the Interface panel can change it for the rest of the
           * session and nothing is ever written back to the project or to Studio settings.
           */
          safeAreaId?: string | null;
          /**
           * The project's `app.mobile.orientation`, so the window resolves a device inset onto the
           * same edge the editor did. Unlike `safeAreaId` this is not a design aid but plain
           * project context, so BOTH launch paths send it — the Interface panel's picker has to be
           * able to answer correctly in a window the top bar opened.
           */
          mobileOrientation?: "landscape" | "portrait" | "auto";
          /**
           * The project's `app.mobile` stage fit + crop anchor. Sent by BOTH launch paths, unlike
           * `safeAreaId`: cropping is what the game really does on a phone, not a design aid, and a
           * Dev Mode window that letterboxed while the shipped build cropped would be a preview of
           * something nobody plays.
           */
          viewport?: GameRuntimeViewportConfig;
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

/** Play-head row forwarded from a Dev Mode window to its project's workspace. */
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

/**
 * "Take me to this row" — a Dev Mode request to open the row in the workspace's story editor.
 *
 * Deliberately a different channel from {@link DevModeStoryRowPayload}, which follows the play head:
 * that one must never open a tab or steal focus (it fires on every action), while this one exists to
 * do exactly that, because the author asked. Same shape, opposite manners.
 */
export type DevModeStoryRowOpenPayload = {
    projectPath: string;
    storyId: string;
    sceneId: string;
    blockId: string;
};

/** The workspace-side "open this row" request, forwarded from Dev Mode (no projectPath on delivery). */
export type DevModeStoryRowOpenRequest = {
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
    /**
     * The audio bus this character's voice lines play on - a project audio track id, absent when the
     * character sits on the seeded `voice` bus like every character always did.
     *
     * Carried unresolved, exactly as authored: which bus a dangling id degrades to is
     * `resolveAudioTrack`'s answer and depends on the track list the compile is running against, so
     * resolving it here would freeze one answer into the bundle.
     */
    voiceTrackId?: string;
    /**
     * The author's accent colour for this character, verbatim from the profile (a hex string, e.g.
     * `#40A8C4`) and absent when none is set. Two very different surfaces read it, so it is carried
     * unfiltered and each side decides for itself:
     *
     *  - Studio chrome (the story rows, the Dev Mode timeline) puts it through
     *    `isReadableAccentColor` first, because that chrome renders on both themes' surfaces;
     *  - the runtime nametag takes it as authored — the dialogue box is the author's own art, so
     *    Studio has no standing to call a colour unreadable there.
     */
    color?: string;
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
          /**
           * The pose the character rests in, in the engine's own `PuppetState` vocabulary — the
           * three values `IPuppetUserConfig` takes as a puppet's *initial* state. Absent when the
           * author set none, and `null` on a field is the absence of a request rather than "leave
           * whatever is there".
           */
          defaultState?: { motion: string | null; expression: string | null; skin: string | null };
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
     * than `Set background 4b645b59-1723-4ac9-98ab-e6859b837bef`.
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
        /**
         * Project-level SAVED variables (M-VAR registry), baked from the same
         * `editor/variables.json`. Keyed by variable id, exactly like `persistentVariables`.
         *
         * A separate field rather than a scope filter over one table: the two scopes are backed by
         * different stores - saved values ride the playthrough's save file, persistent values live in
         * app-level host persistence - so a consumer that could reach the wrong one would write player
         * progress into the wrong lifetime.
         *
         * These are only half of "every saved variable": the story's own `/save` declaration rows are
         * the other authoring surface, and the compiler unions the two.
         */
        savedVariables: SavedVariableRuntimeTable;
        /**
         * What one save slot carries besides the engine's own record, baked from
         * `editor/save-schema.json`. In pin order, so the write node and the read node grow the same
         * pins in the same sequence from one list.
         *
         * Empty is the normal state for a project that has declared nothing: the save nodes keep
         * their raw `metadata` pin and the runtime writes whatever a graph hands it, exactly as
         * before the schema existed.
         */
        saveSchema: SaveSchemaRuntimeTable;
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
    /**
     * Audio payload: the clip regions (in/out/loop points) marked on audio
     * assets, baked from the `assets/assets.metadata.audio.json` shard, plus the
     * project's audio tracks from `editor/audio-tracks.json`.
     *
     * Carried by the bundle so Dev Mode and the packaged runtime share one
     * channel: the story compiler folds a region into the `Sound` it builds and
     * resolves a row's track to (bus, gain, fades), and the blueprint sound
     * family plus the video widget resolve the same way for what a Surface
     * plays. Optional only for bundles that predate the field; every bundle this
     * Studio assembles carries it, with the built-in tracks when the project has
     * no track file.
     */
    audio?: GameAudioBundle;
    /**
     * Automatic saving, baked from `.nlproj` `app.autoSave`. Always present on a
     * freshly assembled bundle; absent only on ones that predate the feature,
     * which the game app reads as "the defaults" (autosaving is on by default).
     */
    autoSave?: AutoSaveConfiguration;
    /**
     * What the player's settings start at, baked from `.nlproj` `app.preferences`.
     *
     * Always present on a freshly assembled bundle; absent only on ones that
     * predate the feature, which the game app reads as "the engine's own
     * defaults" - i.e. exactly how those bundles already behaved.
     */
    preferences?: PlayerPreferences;
    /**
     * The project's own palette, baked from `editor/brand.json`.
     *
     * Carried by the bundle for the reason localization and audio are: Dev Mode and the packaged
     * runtime are one code path fed by one channel, so a colour that resolves in a preview has to
     * resolve the same way in a shipped game without a second pipeline agreeing to it. And it has
     * to travel *with* the documents rather than be read separately, because a stored colour
     * anywhere in the UI document may be a `nlbrand:<id>` link (see `@shared/brand/brandLink`) -
     * a link is not a colour until there is a palette beside it, and a bundle carrying one without
     * the other is a game whose buttons paint their own fallback.
     *
     * Absent means the bundle predates the feature, which every consumer reads as
     * `BUILTIN_BRAND_COLORS` - the same seed a project that has never opened the Brand surface
     * holds on disk, so an old bundle and a fresh project answer identically. Every bundle this
     * Studio assembles carries it.
     */
    brand?: BrandColor[];
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
