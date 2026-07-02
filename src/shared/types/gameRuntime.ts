import type { DevModeBundle } from "./devMode";
import type { DevModeSaveRecord } from "./devModeSave";
import type { StoryId } from "./story";
import type { UISurfaceId } from "./ui-editor/document";

export const GAME_RUNTIME_PACK_SCHEMA_VERSION = 1 as const;
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
    preview?: {
        controlPort: number;
        controlToken: string;
    };
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
