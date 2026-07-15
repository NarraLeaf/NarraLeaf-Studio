import type { ReactNode } from "react";
import type { DevModeBundle } from "@shared/types/devMode";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { BlueprintPersistentStoreAdapter } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import type { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import type { StoryAssetKind } from "@/lib/ui-editor/runtime/game/storyCompiler";

export type GameAppLogLevel = "info" | "warning" | "error";

/** Raw save record as stored by the host (Studio IPC or the game runtime bridge). */
export type GameAppSaveRecord = {
    savedGame: unknown;
    metadata: { user?: unknown };
};

/** Host-side raw save storage. Game-level logic (serialize, capture, reveal) stays in GameApp. */
export type GameAppSaveStore = {
    write(id: string, savedGame: unknown, capture: string | undefined, metadata: unknown): Promise<void>;
    read(id: string): Promise<GameAppSaveRecord | null>;
    readPreview(id: string): Promise<string | null | undefined>;
    remove(id: string): Promise<void>;
    listIds(): Promise<string[]>;
};

/** What the boot preload should do once the NLR environment can mount. */
export type GameAppBootAction =
    | { kind: "story"; storyId: string; sceneId: string }
    | { kind: "surface" };

/**
 * Everything the shared game app orchestrator needs from its host
 * (Studio Dev Mode or the standalone game runtime). Hosts must keep the
 * object identity stable across renders except when a field's value
 * genuinely changes (build it with useMemo).
 */
export type GameAppHost = {
    /** Console/debug log label, e.g. "DevMode" or "Runtime". */
    id: string;
    bundle: DevModeBundle;
    /**
     * Navigation session key. Entries from another session are dropped from
     * the visible set (Dev Mode live reload). Hosts without live reload use
     * a value that only changes when the bundle changes.
     */
    sessionKey: string;
    /** Surface the navigation stack starts on; null falls back to the default app surface. */
    entrySurfaceId: string | null | undefined;
    /** Gate for boot side effects (appBoot, NLR boot preload, keyboard). Preview: pack+assets ready. */
    ready: boolean;
    /** What the NLR boot preload does: direct story launch or menu (default scene preheat). */
    bootAction: GameAppBootAction;
    persistenceAdapter: BlueprintPersistentStoreAdapter | null;
    onDebugEvent?: (event: BlueprintDebugEvent) => void;
    disposeMessage: string;
    log: (level: GameAppLogLevel, message: string) => void;
    resolveStoryAssetUrl: (
        assetId: string,
        assetType?: StoryAssetKind,
    ) => Promise<string | null | undefined> | string | null | undefined;
    saveStore: GameAppSaveStore;
    quitApplication: () => Promise<void>;
    /** Application window fullscreen. Hosts without a real window (story preview) omit these. */
    getFullscreen?: () => Promise<boolean>;
    setFullscreen?: (fullscreen: boolean) => Promise<void>;
    /** Subscribe to fullscreen transitions; returns an unsubscribe function. */
    subscribeFullscreenChanged?: (listener: (isFullscreen: boolean) => void) => () => void;
};

/** Context handed to host-rendered overlays (e.g. the Dev Mode debug panel). */
export type GameAppOverlayContext = {
    core: BlueprintRuntimeCore | null;
    activeSurface: UISurface | null;
    widgetRuntimeStore: WidgetRuntimeStateStore;
};

/** Context handed to the host frame around the game content. */
export type GameAppFrameContext = {
    activeSurface: UISurface;
    gameViewport: { width: number; height: number } | null;
    children: ReactNode;
};
