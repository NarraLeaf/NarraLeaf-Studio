import type { DevModeBundle } from "./devMode";
import type { DevModeSaveRecord } from "./devModeSave";
import type { NormalizedPluginManifestV2 } from "./plugins";
import type { StoryId } from "./story";
import type { UISurfaceId } from "./ui-editor/document";

export const GAME_RUNTIME_PACK_SCHEMA_VERSION = 2 as const;
export const GAME_RUNTIME_BRIDGE_KEY = "__NLS_GAME_RUNTIME__" as const;
export const GAME_RUNTIME_PROTOCOL = "nlgame" as const;

export type GameRuntimeLaunchEntry =
    | {
          kind: "surface";
          surfaceId: UISurfaceId;
      }
    | {
          kind: "story";
          storyId: StoryId;
          sceneId: string;
          surfaceId?: UISurfaceId;
      };

export type PreviewStatus =
    | "idle"
    | "preparing"
    | "compiling"
    | "launching"
    | "running"
    | "stopping"
    | "error";

export type GameRuntimeAssetSource = "local" | "remote-cache";

export type GameRuntimeAssetManifestEntry = {
    id: string;
    type: string;
    name: string;
    source: GameRuntimeAssetSource;
    relativePath: string;
    originalRelativePath?: string;
    hash?: string;
    ext?: string;
    mimeType?: string;
};

export type GameRuntimeProjectIconPlatform = "macos" | "windows" | "linux";

export type GameRuntimeProjectIcon = {
    platform: GameRuntimeProjectIconPlatform;
    relativePath: string;
    originalRelativePath: string;
    sourceName?: string;
    mediaType?: string;
};

/**
 * A plugin runtime entry shipped inside the pack. The full normalized
 * manifest is embedded so game environments can construct the same
 * RuntimePluginApp identity that Dev Mode builds from the install registry.
 */
export type GameRuntimePackPluginEntry = {
    manifest: NormalizedPluginManifestV2;
    /** Path of the plugin's prebundled runtime ESM entry relative to the app dir, e.g. plugins/{id}/runtime.js. */
    entryRelativePath: string;
};

export type GameRuntimePackV1 = {
    schemaVersion: typeof GAME_RUNTIME_PACK_SCHEMA_VERSION;
    generatedAt: string;
    mode: "preview" | "production";
    runtimeVersion: string;
    project: {
        name: string;
        identifier?: string;
        version?: string;
        metadata?: Record<string, unknown>;
        icon?: GameRuntimeProjectIcon;
    };
    entry: GameRuntimeLaunchEntry;
    bundle: DevModeBundle;
    assets: {
        items: Record<string, GameRuntimeAssetManifestEntry>;
    };
    /** Runtime entries of the plugins packaged with this game. */
    plugins: GameRuntimePackPluginEntry[];
    /**
     * Network policy for the packaged/previewed game. Absent on packs produced
     * before this field existed — the runtime treats a missing value as the
     * secure default ({@link GameRuntimeNetworkConfig} all disabled).
     */
    network?: GameRuntimeNetworkConfig;
    preview?: {
        controlPort: number;
        controlToken: string;
    };
};

export type GameRuntimeNetworkConfig = {
    /**
     * When false (default), the renderer is confined to the app protocol and
     * every HTTP/HTTPS/WebSocket request is blocked (CSP + main-process
     * webRequest). When true, remote resources over HTTP/HTTPS are permitted.
     */
    allowHttp: boolean;
};

export type GameRuntimeSaveBridge = {
    write(id: string, savedGame: unknown, capture?: string, metadata?: unknown): Promise<void>;
    read(id: string): Promise<GameRuntimeSaveRecord | null>;
    listIds(): Promise<string[]>;
    readPreview(id: string): Promise<string | null>;
    delete(id: string): Promise<{ deleted: boolean }>;
};

export type GameRuntimeSaveRecord = DevModeSaveRecord;

export type GameRuntimePersistenceBridge = {
    getAll(): Promise<Record<string, unknown>>;
    getValue(key: string): Promise<unknown>;
    setValue(key: string, value: unknown): Promise<void>;
    removeValue(key: string): Promise<void>;
};

export type GameRuntimePreloadBridge = {
    readPack(): Promise<GameRuntimePackV1>;
    assetUrl(assetId: string): string;
    log(level: "info" | "warning" | "error", message: string): void;
    close(): Promise<void>;
    save: GameRuntimeSaveBridge;
    persistence: GameRuntimePersistenceBridge;
};

declare global {
    interface Window {
        [GAME_RUNTIME_BRIDGE_KEY]?: GameRuntimePreloadBridge;
    }
}
