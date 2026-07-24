import type { ReactNode } from "react";
import type { LiveGame } from "narraleaf-react";
import type { DevModeBundle } from "@shared/types/devMode";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { BlueprintPersistentStoreAdapter } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import type { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import type { NlrActionIdBinding, StoryAssetKind } from "@/lib/ui-editor/runtime/game/storyCompiler";

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
    | {
          kind: "story";
          storyId: string;
          sceneId: string;
          /** Row to enter the game at (row-precise "play from here"); omitted = the scene start. */
          startBlockId?: string;
          /** Scene Snapshot whose variable values seed the launch (Phase 2); omitted = declared defaults. */
          snapshotId?: string;
      }
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
    /**
     * Subscribe to window-close requests (the user asked to close the window). The main process
     * holds the close open until the listener resolves: `true` lets the window close, `false`
     * cancels it. The listener runs the blueprint dispatch and reports whether a handler cancelled
     * the close. Returns an unsubscribe function. Hosts without a real window (story preview) omit it.
     */
    subscribeCloseRequested?: (listener: () => Promise<boolean> | boolean) => () => void;
};

/** A read-only view of the current execution stacks (root + in-flight async branches). */
export type StoryRuntimeStackView = ReturnType<LiveGame["getStackSnapshot"]>;

export type StoryRuntimeFastForwardResult = {
    reason: "menu" | "end" | "maxSteps" | "action";
    reachedTarget?: boolean;
};

/**
 * Read/write bridge over the running story's live runtime, handed to host debug overlays (the Dev
 * Mode story-runtime panel). Modeled on the blueprint `scopeBridge`: the overlay reads snapshots and
 * subscribes rather than touching the engine directly. All methods degrade to null / no-op when no
 * story game is currently running, and stay valid across in-window relaunches (the bridge follows
 * whichever LiveGame is live).
 */
export type GameAppStoryRuntimeBridge = {
    /** The running story's launch request (id, scene, and the row/snapshot it entered at), or null. */
    getStoryContext: () => {
        storyId: string;
        sceneId: string;
        startBlockId?: string;
        snapshotId?: string;
    } | null;
    /** action↔block bindings of the running compiled story (empty when none). */
    getActionIdBindings: () => readonly NlrActionIdBinding[];
    /** Resolved Storable namespace names for the running story's variable scopes. */
    getVariableNamespaces: () => { saved: string | null; sceneLocal: Record<string, string> };
    /** Most recently executed action id (engine play head), or null before the first action. */
    getCurrentActionId: () => string | null;
    /**
     * Subscribe to the play head (`event:action.current`). Fires for every action, branch actions
     * included; filter by your own id set. Returns an unsubscribe function. Stable across relaunches.
     */
    subscribeCurrentAction: (listener: (actionId: string | null) => void) => () => void;
    /** Read-only execution-stack snapshot, or null when no game is running. */
    getStackSnapshot: () => StoryRuntimeStackView | null;
    /** Read a Storable namespace as a plain record of raw values, or null if absent / no game. */
    readStorableNamespace: (namespaceName: string) => Record<string, unknown> | null;
    /** Write a raw value into a Storable namespace (scene/saved scopes). No-op if the ns is absent. */
    writeStorableValue: (namespaceName: string, key: string, value: unknown) => boolean;
    /** Fast-forward the running game until an action surfaces (hot jump). Rejects if no game runs. */
    fastForwardToActionId: (actionId: string) => Promise<StoryRuntimeFastForwardResult>;
    /**
     * Relaunch the current story in-window (cold jump, snapshot switch, scene launch). `sceneId`
     * defaults to the running scene; omitted `startBlockId` enters at the scene top; omitted
     * `snapshotId` uses declared defaults.
     */
    relaunch: (options: { sceneId?: string; startBlockId?: string; snapshotId?: string }) => Promise<void>;
};

/** Context handed to host-rendered overlays (e.g. the Dev Mode debug panel). */
export type GameAppOverlayContext = {
    core: BlueprintRuntimeCore | null;
    activeSurface: UISurface | null;
    widgetRuntimeStore: WidgetRuntimeStateStore;
    /**
     * Fast-forward the running game to the next menu, keeping full history. Rejects if no game is
     * currently running (see `requireActiveLiveGame`).
     */
    fastForwardToNextChoice: () => Promise<void>;
    /** Read/write bridge over the running story runtime for the story-runtime debug panel. */
    storyRuntime: GameAppStoryRuntimeBridge;
};

/** Context handed to the host frame around the game content. */
export type GameAppFrameContext = {
    activeSurface: UISurface;
    gameViewport: { width: number; height: number } | null;
    children: ReactNode;
};
