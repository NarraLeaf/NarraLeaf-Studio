import type { ReactNode } from "react";
import type { LiveGame } from "narraleaf-react";
import type { DevModeBundle } from "@shared/types/devMode";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { BlueprintOpenExternalRequest, BlueprintOpenExternalResult } from "@shared/types/blueprint/externalLink";
import type { BlueprintNetworkFetchRequest, BlueprintNetworkFetchResult } from "@shared/types/blueprint/network";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { BlueprintPersistentStoreAdapter } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import type { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import type { NlrActionIdBinding, StoryAssetKind } from "@/lib/ui-editor/runtime/game/storyCompiler";
import type { PuppetBackendModuleSource } from "@/lib/ui-editor/runtime/game/puppetBackendHost";
import type { SaveLoadOutcome } from "./saveLoad";

export type GameAppLogLevel = "info" | "warning" | "error";

/**
 * How a runtime issue was traced back to a story row — which is also how much the attribution is
 * worth, so a host can say so rather than presenting a guess as a fact:
 *
 *  - `compile`: the compiler named the block itself while translating it. Exact.
 *  - `playHead`: the row the engine was last executing when the failure surfaced. Right for anything
 *    that throws while a row is running, and a near miss for anything asynchronous — the row named
 *    is where playback WAS, which is a real place to start looking and not a claim about the cause.
 *  - `session`: nothing was running that could be blamed (a boot failure, a reload failure). No row.
 *  - `interface`: a Game UI blueprint threw. It has no story row at all — the author was not writing
 *    a story when they wrote it — so the place it names is a SURFACE (see
 *    {@link GameAppRuntimeIssue.surfaceId}) and the row fields stay empty.
 */
export type GameAppIssueOrigin = "compile" | "playHead" | "session" | "interface";

/**
 * A runtime failure with its authored origin attached. See {@link GameAppHost.reportIssue}.
 *
 * `blockId` is a Studio block id, deliberately not a scene id or a line number: the runtime knows
 * which block it was compiling or running and nothing beyond that. Turning a block into "line 37 of
 * Scene 2" needs the story document, which only a host with the project open has — so the runtime
 * reports the fact and the host does the locating.
 */
export type GameAppRuntimeIssue = {
    level: Extract<GameAppLogLevel, "warning" | "error">;
    message: string;
    origin: GameAppIssueOrigin;
    /** Studio story block this came from; absent when nothing could be attributed. */
    blockId?: string;
    /**
     * UI surface this came from — the other kind of place a failure can have, and the only one an
     * `interface` issue has. Carried as an id for the same reason `blockId` is: the runtime knows
     * which surface it was running and nothing about what the author named it.
     */
    surfaceId?: string;
    /** The underlying stack, when there was one. Kept for the cases a location cannot explain. */
    stack?: string;
};

/** Raw save record as stored by the host (Studio IPC or the game runtime bridge). */
export type GameAppSaveRecord = {
    savedGame: unknown;
    metadata: {
        user?: unknown;
        /** ISO timestamps written by the store; absent on records it could not stamp. */
        createdAt?: string;
        updatedAt?: string;
    };
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
    /**
     * Surface to show when the running story falls off the end, resolved for the variant this build
     * was produced as. Blank or absent keeps the behaviour every build had before it existed: the
     * story stops and the stage stays where it is.
     *
     * A host supplies it from what it was given, never from a default. There is no page to fall back
     * on - a screen nobody authored is worse than no screen - and a demo whose cut point IS its
     * ending may legitimately want the stage left alone.
     */
    endingSurfaceId?: string | null;
    /** Gate for boot side effects (appBoot, NLR boot preload, keyboard). Preview: pack+assets ready. */
    ready: boolean;
    /** What the NLR boot preload does: direct story launch or menu (default scene preheat). */
    bootAction: GameAppBootAction;
    persistenceAdapter: BlueprintPersistentStoreAdapter | null;
    onDebugEvent?: (event: BlueprintDebugEvent) => void;
    /**
     * Install the blueprint breakpoint debugger for this session. Only Dev Mode sets it; a
     * packaged game and the workspace story preview leave it off, so nothing in those builds can
     * stop a graph at a node. See `useBlueprintRuntimeCore`.
     */
    debuggerEnabled?: boolean;
    disposeMessage: string;
    log: (level: GameAppLogLevel, message: string) => void;
    /**
     * The same failures `log` carries, plus where in the author's story they came from.
     *
     * `log` takes a string, so everything a host could use to point at the offending row — the block
     * the compiler blamed, the row the play head was on — was being flattened into prose and thrown
     * away. A stack trace tells an author which of OUR functions threw; it never tells them that
     * line 37's `/show` names a character that no longer exists, which is the only fact they can act
     * on. This channel exists so a host that HAS the story open can say that.
     *
     * Optional, and additive: every issue reported here is also logged, so a host that omits this
     * (the packaged game — it has no editor to point into) loses nothing it had before.
     */
    reportIssue?: (issue: GameAppRuntimeIssue) => void;
    resolveStoryAssetUrl: (
        assetId: string,
        assetType?: StoryAssetKind,
    ) => Promise<string | null | undefined> | string | null | undefined;
    saveStore: GameAppSaveStore;
    /**
     * The author-supplied drawing backends for the engine's puppet seam, if this host can serve
     * any. Studio ships no renderer for animated characters and cannot: the ones authors want are
     * licensed in terms a source-available application cannot meet, so the author brings their own
     * and the host's only job is to find it. Where it looks is the host's business — a Dev Mode
     * window reads the open project, a packaged game reads what was published with it.
     *
     * Omitted by hosts with nowhere to look. Rejecting is fine: the game starts without puppets,
     * and any puppet on stage degrades to an empty box (see `loadPuppetBackends`).
     */
    listPuppetBackendModules?: () => Promise<PuppetBackendModuleSource[]>;
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
    /**
     * Issue one Fetch node request. Where it goes is the host's business, and the three shells
     * differ: Dev Mode and the packaged desktop game hand it to their main process, which is the
     * only origin not subject to CORS and the only place the project's Allow HTTP setting can be
     * enforced; the web export has no main process and uses the browser's own `fetch`.
     *
     * Omitted by hosts with nowhere to send it (the workspace story preview). The node then reports
     * a `networkError` saying so, which is the same degradation the sound family takes when there is
     * no running game to play through.
     */
    networkFetch?: (request: BlueprintNetworkFetchRequest) => Promise<BlueprintNetworkFetchResult>;
    /**
     * Open one web address in the player's browser, for the Open Link node.
     *
     * Where the check happens is the host's business, and every shell puts it in the process that
     * performs the act: Dev Mode and the packaged desktop game hand the request to their main
     * process, the web export decides in the page because there is nothing else. What none of them
     * do is trust this side — the renderer says which address, never whether.
     *
     * Omitted by hosts with nowhere to send it (the workspace story preview). The node then reports
     * a failure saying so, the same degradation {@link networkFetch} takes.
     */
    openExternal?: (request: BlueprintOpenExternalRequest) => Promise<BlueprintOpenExternalResult>;
};

/** A read-only view of the current execution stacks (root + in-flight async branches). */
export type StoryRuntimeStackView = ReturnType<LiveGame["getStackSnapshot"]>;

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
    /**
     * Resolved Storable namespace names for the running story's scopes, exactly as they key the
     * save file's `game.store`. They carry the engine's own prefix (`persistent:` / `local:`), so a
     * reader of a save blob matches these strings rather than rebuilding one.
     *
     * `visited` is the reserved record of entered scenes and picked options (see `storyVisited.ts`).
     * It is not a variable scope an author writes to, but it travels inside the save alongside the
     * ones that are, and the Saves panel is where it becomes readable.
     */
    getVariableNamespaces: () => {
        saved: string | null;
        visited: string | null;
        sceneLocal: Record<string, string>;
    };
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
    /**
     * Studio block id → backlog token, for every line this session has actually played and that
     * the engine kept a restore snapshot for. Read from the live backlog on each call (it is the
     * single source of truth: it accumulates as playback advances and is trimmed by a restore), and
     * keyed back to blocks through the compiled action bindings. Empty when no game is running.
     */
    getPlayedBlockTokens: () => Record<string, string>;
    /**
     * Restore the running game to a played backlog line (see {@link getPlayedBlockTokens}): exact,
     * immediate and replay-free, because the entry carries its own state snapshot. Returns false
     * when no game runs, the token is unknown, or the engine build has no snapshot restore — the
     * caller then falls back to a cold {@link relaunch}.
     */
    restoreToHistoryToken: (token: string) => boolean;
    /**
     * Relaunch the current story in-window (cold jump, snapshot switch, scene launch). `sceneId`
     * defaults to the running scene; omitted `startBlockId` enters at the scene top; omitted
     * `snapshotId` uses declared defaults.
     */
    relaunch: (options: { sceneId?: string; startBlockId?: string; snapshotId?: string }) => Promise<void>;
};

/**
 * Save slots, for a host debug overlay that lists and loads them.
 *
 * Every method is the SAME call the game's own Save/Load nodes make, deliberately: the question the
 * Saves panel answers is "does this save still load", and a debug-only load path would answer it for
 * a code path no player ever takes.
 */
export type GameAppSaveBridge = {
    /** Player slot ids - the authoring view, with the reserved autosave slots filtered out. */
    listIds: () => Promise<string[]>;
    /** The stored record as written: author metadata plus the serialized game. */
    read: (id: string) => Promise<GameAppSaveRecord | null>;
    /**
     * Load a save into the RUNNING game.
     *
     * Resolves whether or not the save was applied: a save the running story cannot take is refused
     * with the run left where it was, and {@link SaveLoadOutcome} says which happened. Nothing has
     * to be put back after a refusal, and relaunching after one would throw away the very run that
     * was preserved.
     */
    load: (id: string) => Promise<SaveLoadOutcome>;
    remove: (id: string) => Promise<void>;
};

/** What every row of the composite stack answers, page lane and layers alike. */
export type GameAppCompositeSlot = {
    /** The navigation key - a page entry's, or the layer's, which is also its runtime scope. */
    key: string;
    surfaceId: string;
    /** The surface's authored name. Null when the running bundle has no surface with that id. */
    surfaceName: string | null;
    /** Whether this slot takes pointer input this frame. */
    interactive: boolean;
    /** True for the one slot the keys belong to, and for no other. */
    keyboardOwner: boolean;
};

/** A layer of the composite stack, with the facts only a layer has. */
export type GameAppCompositeLayer = GameAppCompositeSlot & {
    modal: boolean;
    dismissible: boolean;
    /** Mutual-exclusion group, or null when the layer is in none. */
    group: string | null;
    /** The runtime scope that showed it; the layer closes when that scope does. */
    ownerScopeId: string;
    /**
     * Whether it is actually on screen.
     *
     * False for a layer the render dropped, which happens when the running bundle has no surface
     * with its id. The stack still holds it, so it still occupies its group and still answers
     * `isPresent`, while nothing about it is visible or clickable.
     */
    onScreen: boolean;
};

/** A layer waiting for its group to be given back. */
export type GameAppCompositeQueuedLayer = {
    key: string;
    surfaceId: string;
    surfaceName: string | null;
    modal: boolean;
    group: string | null;
    ownerScopeId: string;
};

/**
 * The whole composite, as the debug panel reads it.
 *
 * Assembled where the composite is assembled, and never recomputed by a reader: input ownership has
 * exactly one arbiter (`resolveCompositeInput`), and a panel that worked out for itself who holds
 * the keyboard would be reporting its own second opinion at precisely the moment the author is
 * trying to find out why the first one is not what they expected.
 */
export type GameAppCompositeView = {
    /** The entry the page lane is settling on, or null while it has none. */
    page: GameAppCompositeSlot | null;
    /** Layers bottom to top. */
    layers: readonly GameAppCompositeLayer[];
    /** Queued layers in arrival order. */
    queued: readonly GameAppCompositeQueuedLayer[];
    /** True while a removed layer is still animating out. */
    exitPending: boolean;
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
    /** Save-slot access for the Saves panel, on the game's own paths. */
    saves: GameAppSaveBridge;
    /** Everything on screen at once and who owns input, for the Layers panel. */
    composite: GameAppCompositeView;
};

/** Context handed to the host frame around the game content. */
export type GameAppFrameContext = {
    activeSurface: UISurface;
    gameViewport: { width: number; height: number } | null;
    children: ReactNode;
};
