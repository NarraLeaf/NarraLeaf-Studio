import type { BlueprintOpenExternalRequest, BlueprintOpenExternalResult } from "./blueprint/externalLink";
import type { BlueprintNetworkFetchRequest, BlueprintNetworkFetchResult } from "./blueprint/network";
import type { DevModeBundle } from "./devMode";
import type { DevModeSaveRecord } from "./devModeSave";
import type { NormalizedPluginManifestV2 } from "./plugins";
import type { StoryId } from "./story";
import type { UISurfaceId } from "./ui-editor/document";

export const GAME_RUNTIME_PACK_SCHEMA_VERSION = 2 as const;
export const GAME_RUNTIME_BRIDGE_KEY = "__NLS_GAME_RUNTIME__" as const;
export const GAME_RUNTIME_PROTOCOL = "nlgame" as const;
/** Main -> renderer push when the window enters or leaves fullscreen. */
export const GAME_RUNTIME_FULLSCREEN_CHANGED_CHANNEL = "runtime:fullscreen:changed" as const;
/**
 * Main -> renderer request when the user asks to close the window, carrying a `requestId`. The
 * renderer runs its blueprints and replies on {@link GAME_RUNTIME_CLOSE_DECISION_CHANNEL} with the
 * same requestId and whether the close may proceed. Lets `On Window Close Requested` intercept.
 */
export const GAME_RUNTIME_CLOSE_REQUESTED_CHANNEL = "runtime:close:requested" as const;
/** Renderer -> main reply to a {@link GAME_RUNTIME_CLOSE_REQUESTED_CHANNEL} request. */
export const GAME_RUNTIME_CLOSE_DECISION_CHANNEL = "runtime:close:decision" as const;
/**
 * Main -> renderer push carrying everything a sidecar says or does that the
 * renderer did not ask for: its `evt` frames, its exit, and the moment the host
 * gives up restarting it. One channel with a discriminated payload rather than
 * three, because all three are the same fan-out and the preload demultiplexes
 * them into per-sidecar listener sets anyway.
 */
export const GAME_RUNTIME_SIDECAR_MESSAGE_CHANNEL = "runtime:sidecar:message" as const;

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

/**
 * Where the packaged bytes came from originally. Provenance only: both kinds ship as ordinary files
 * inside the pack, and the runtime never goes to the network for an asset.
 */
export type GameRuntimeAssetSource = "local" | "remote";

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
    /**
     * Bundle assets only (`type: "model"`), and only on the entry keyed by the bare asset id:
     * the bundle-relative path of its entry file.
     *
     * Its siblings ship as their own manifest entries keyed `{assetId}/{pathInsideBundle}`, so a
     * URL built from `{assetId}/{bundleEntry}` is one the bundle's own relative references resolve
     * against - which is the entire reason a model is one asset rather than N.
     */
    bundleEntry?: string;
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
 * One native child process shipped inside the pack for the platform this build
 * targets, ready for the game's main process to spawn.
 *
 * Flattened out of the plugin's `contributes.sidecars[]` rather than read back
 * from the embedded manifest: the manifest declares binaries for every platform
 * the plugin supports, while a pack carries exactly the one set that was copied
 * into this app dir. Anything the manifest says about other platforms is not a
 * fact about this artifact, so the runtime must not read it as one.
 */
export type GameRuntimePackSidecarEntry = {
    /** `contributes.sidecars[].id`, the name the runtime API addresses it by. */
    id: string;
    /**
     * The executable (or, for `kind: "node"`, the .js file) to run, relative to
     * the app dir - e.g. `sidecars/{pluginId}/{sidecarId}/bin/tool.exe`.
     */
    entry: string;
    /** `executable` spawns the binary directly; `node` runs it under the game's own Electron as Node. */
    kind: "executable" | "node";
    /** `onGameStart` spawns with the window; `onRequest` waits for the first call. */
    autostart: "onGameStart" | "onRequest";
    startupTimeoutMs: number;
    shutdownTimeoutMs: number;
    restart: { maxRetries: number; backoffMs: number };
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
    /**
     * Plugin storage published with the game, keyed by the namespaces declared
     * in `contributes.runtimeData`. Inlined rather than written as pack files:
     * these are small authored catalogs, and inlining keeps them on the same
     * load path as the manifest itself. Absent on packs built before the data
     * channel existed, and on plugins that declare no runtime data.
     */
    data?: Record<string, unknown>;
    /**
     * Native child processes copied into this app dir for the platform it was
     * built for. Absent on packs built before sidecars existed, on plugins that
     * declare none, and on any pack whose target platform the plugin ships no
     * binaries for - the runtime treats all three the same way, as "this game
     * has no sidecar for that id", and the plugin degrades rather than assumes.
     */
    sidecars?: GameRuntimePackSidecarEntry[];
};

/**
 * A puppet-runtime module shipped inside the pack.
 *
 * A puppet's backend is the author's own code, dropped into the project under
 * `runtimes/puppet/{name}/`, and it is the only thing that can draw the model.
 * A pack that carried the model bundle without it would produce a game whose
 * characters are empty boxes - and nothing in the build would say so, because
 * the engine treats an unregistered backend as a puppet that simply draws
 * nothing. So the module travels with the pack, keyed by the directory name,
 * which is the same string a character's appearance names as its backend.
 */
export type GameRuntimePackPuppetRuntimeEntry = {
    /** The directory name under `runtimes/puppet/`, which is also the backend name authors select. */
    name: string;
    /** Path of the runtime's ESM entry relative to the app dir, e.g. puppet/{name}/index.js. */
    entryRelativePath: string;
    /**
     * Every other file in the runtime's directory, relative to it, so a backend
     * that reads its own siblings finds them. Ordered, and never includes the
     * entry itself.
     */
    files: string[];
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
     * Puppet backends packaged with this game. Absent on packs produced before
     * this field existed, and on projects that installed none - the runtime
     * treats both the same way, as "this game draws no puppets".
     */
    puppetRuntimes?: GameRuntimePackPuppetRuntimeEntry[];
    /**
     * Network policy for the packaged/previewed game. Absent on packs produced
     * before this field existed - the runtime treats a missing value as the
     * secure default ({@link GameRuntimeNetworkConfig} all disabled).
     */
    network?: GameRuntimeNetworkConfig;
    /**
     * Web addresses this build may hand to the player's browser, resolved for the variant it was
     * compiled as. Absent on packs produced before this field existed and on projects that declare
     * none; both mean the same thing, and every shell reads it as "this build opens nothing".
     *
     * A field of its own rather than part of {@link network}, for two reasons. That block is
     * skipped entirely for web exports, and a declaration that vanished on one shell would be a
     * hole in the only thing standing between a graph and the player's browser. And opening a page
     * is not a network permission: nothing is requested and nothing comes back into the game, so
     * this is neither gated on `network.allowHttp` nor disabled with it.
     */
    externalLinks?: string[];
    /**
     * Stage fit + crop anchor. Absent on packs produced before this field existed, which the runtime
     * reads as `contain` — the behaviour every one of those packs shipped with.
     */
    viewport?: GameRuntimeViewportConfig;
    preview?: {
        controlPort: number;
        controlToken: string;
    };
};

/**
 * How the stage meets a screen of a different aspect ratio, from `app.mobile`.
 *
 * Carried on every pack rather than only mobile ones: the pack is built once and the mobile shells
 * serve the very same site (see `webShell.ts`), so there is no mobile-specific pack to put it on.
 * WHERE it applies is decided at run time — the mobile entry document identifies itself, and a
 * preview run is a preview run — not by baking two different sites.
 */
export type GameRuntimeViewportConfig = {
    /** `contain` letterboxes (the default and the historical behaviour); `cover` fills and crops. */
    fit: GameRuntimeViewportFit;
    /** Which part survives the crop. Only meaningful under `cover`. */
    cropAnchorX: GameRuntimeCropAnchorX;
    cropAnchorY: GameRuntimeCropAnchorY;
};

/**
 * The one place this vocabulary is spelled out. The renderer's project-config layer and the pack
 * compiler both validate against these, so a value can never be legal in the editor and unknown to
 * the runtime.
 */
export const GAME_RUNTIME_VIEWPORT_FITS = ["contain", "cover"] as const;
export const GAME_RUNTIME_CROP_ANCHORS_X = ["left", "center", "right"] as const;
export const GAME_RUNTIME_CROP_ANCHORS_Y = ["top", "center", "bottom"] as const;

export type GameRuntimeViewportFit = typeof GAME_RUNTIME_VIEWPORT_FITS[number];
export type GameRuntimeCropAnchorX = typeof GAME_RUNTIME_CROP_ANCHORS_X[number];
export type GameRuntimeCropAnchorY = typeof GAME_RUNTIME_CROP_ANCHORS_Y[number];

/**
 * Meta name the mobile entry document uses to identify its shell to the runtime bundle.
 *
 * Lives here, next to the config it gates, so the producer (`buildWebIndexHtml`) and the consumer
 * (`isMobileShellDocument`) cannot drift — a rename on one side alone would silently turn the stage
 * crop off on every phone, with nothing to fail.
 */
export const WEB_SHELL_VARIANT_META = "nl-shell";

export const DEFAULT_GAME_RUNTIME_VIEWPORT_CONFIG: GameRuntimeViewportConfig = {
    fit: "contain",
    cropAnchorX: "center",
    cropAnchorY: "center",
};

/**
 * Read a project's `app.mobile` blob into a complete viewport config.
 *
 * Anything unrecognized falls back to `contain`/centre rather than throwing: this runs while
 * compiling a pack, and a project with a hand-edited config should letterbox, not fail to build.
 */
export function normalizeGameRuntimeViewportConfig(value: unknown): GameRuntimeViewportConfig {
    const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const pick = <T extends string>(candidate: unknown, allowed: readonly T[], fallback: T): T =>
        allowed.includes(candidate as T) ? candidate as T : fallback;
    return {
        fit: pick(record.fit, GAME_RUNTIME_VIEWPORT_FITS, DEFAULT_GAME_RUNTIME_VIEWPORT_CONFIG.fit),
        cropAnchorX: pick(record.cropAnchorX, GAME_RUNTIME_CROP_ANCHORS_X, DEFAULT_GAME_RUNTIME_VIEWPORT_CONFIG.cropAnchorX),
        cropAnchorY: pick(record.cropAnchorY, GAME_RUNTIME_CROP_ANCHORS_Y, DEFAULT_GAME_RUNTIME_VIEWPORT_CONFIG.cropAnchorY),
    };
}

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

/** Unsolicited news about one sidecar, pushed on {@link GAME_RUNTIME_SIDECAR_MESSAGE_CHANNEL}. */
export type GameRuntimeSidecarMessage =
    | {
          kind: "event";
          pluginId: string;
          sidecarId: string;
          method: string;
          params: unknown;
      }
    | {
          kind: "exit";
          pluginId: string;
          sidecarId: string;
          code: number | null;
          signal: string | null;
      }
    | {
          /**
           * The host has stopped restarting this sidecar for the rest of the
           * process. Separate from `exit` because the two answer different
           * questions: an exit may still be followed by a restart, this never
           * is, and it is what flips `sidecar.available()` to false.
           */
          kind: "unavailable";
          pluginId: string;
          sidecarId: string;
          reason: string;
      };

/**
 * Child-process hosting, present only on shells that have child processes. The
 * web export omits it outright, which is what removes `app.game.sidecar` there.
 *
 * There is deliberately no `available()` here: the plugin API answers that
 * synchronously, and the pack the renderer already holds is the authority on
 * which sidecars this build shipped (plus the `unavailable` push above for the
 * ones the host has given up on). An async probe would only add a race.
 *
 * `pluginId` is passed by the caller and CANNOT be authenticated - every plugin
 * in the renderer shares one realm (see the note on the main-process handlers).
 * The real boundary is that the host only ever spawns what the pack declares.
 */
export type GameRuntimeSidecarBridge = {
    /** Spawn and hand-shake if needed. Idempotent; rejects if the sidecar cannot run. */
    start(pluginId: string, sidecarId: string): Promise<void>;
    stop(pluginId: string, sidecarId: string): Promise<void>;
    request(pluginId: string, sidecarId: string, method: string, params?: unknown): Promise<unknown>;
    notify(pluginId: string, sidecarId: string, method: string, params?: unknown): void;
    onEvent(
        pluginId: string,
        sidecarId: string,
        listener: (method: string, params: unknown) => void,
    ): () => void;
    onExit(
        pluginId: string,
        sidecarId: string,
        listener: (info: { code: number | null; signal: string | null }) => void,
    ): () => void;
    onUnavailable(
        listener: (info: { pluginId: string; sidecarId: string; reason: string }) => void,
    ): () => void;
};

export type GameRuntimePersistenceBridge = {
    getAll(): Promise<Record<string, unknown>>;
    getValue(key: string): Promise<unknown>;
    setValue(key: string, value: unknown): Promise<void>;
    removeValue(key: string): Promise<void>;
};

export type GameRuntimeNetworkBridge = {
    fetch(request: BlueprintNetworkFetchRequest): Promise<BlueprintNetworkFetchResult>;
};

export type GameRuntimeExternalLinkBridge = {
    open(request: BlueprintOpenExternalRequest): Promise<BlueprintOpenExternalResult>;
};

export type GameRuntimePreloadBridge = {
    readPack(): Promise<GameRuntimePackV1>;
    assetUrl(assetId: string): string;
    /**
     * Resolve a pack plugin runtime entry (`GameRuntimePackPluginEntry.
     * entryRelativePath`) to a loadable URL. Each shell maps it onto its own
     * transport (custom protocol on desktop, a relative URL on the web), so
     * the renderer never hardcodes a scheme.
     */
    pluginEntryUrl(entryRelativePath: string): string;
    log(level: "info" | "warning" | "error", message: string): void;
    close(): Promise<void>;
    getFullscreen(): Promise<boolean>;
    setFullscreen(fullscreen: boolean): Promise<void>;
    /** Subscribe to window fullscreen transitions. Returns an unsubscribe function. */
    onFullscreenChanged(listener: (isFullscreen: boolean) => void): () => void;
    /**
     * Register a handler consulted when the user asks to close the window. The main process holds
     * the close open until every registered handler resolves, and closes only if all of them
     * answered `true` — any single `false` cancels it. Handlers accumulate rather than replace, so
     * the game's blueprint decider and passive observers (runtime plugins) can coexist; a handler
     * that only wants to watch returns `true`. Returns an unsubscribe fn.
     */
    onCloseRequested(listener: () => boolean | Promise<boolean>): () => void;
    /**
     * What this shell can actually back, where the contract's own shape cannot say so. Every method
     * above exists on every shell; `closeRequested` is the case where one of them is inert (a page
     * cannot reliably intercept a tab closing), and a caller that gates on it must be told rather
     * than left registering a handler that never runs.
     */
    capabilities: {
        /** Whether {@link onCloseRequested} can ever fire. False on the web export. */
        closeRequested: boolean;
    };
    save: GameRuntimeSaveBridge;
    persistence: GameRuntimePersistenceBridge;
    /**
     * One Fetch node request.
     *
     * Present on every shell, and satisfied differently by each - the desktop shell hands it to the
     * main process (no CORS, and the only place `network.allowHttp` can be enforced), the web export
     * uses the browser's own `fetch`. Unlike {@link sidecar} there is no honest absence here: a page
     * can make an HTTP request, so a web build that omitted this would be refusing something it can
     * do.
     */
    network: GameRuntimeNetworkBridge;
    /**
     * One Open Link node request.
     *
     * Present on every shell, and decided differently by each - the desktop shell hands it to the
     * main process, which re-reads the pack and calls the platform opener; the web export decides
     * in the page, because a page is all there is. What every shell shares is the decision itself:
     * only an address the pack declares is opened, and the check is made where the act happens.
     */
    externalLink: GameRuntimeExternalLinkBridge;
    /**
     * Absent on shells with no child processes (the web export). Absence is the
     * whole signal - the runtime plugin host passes no sidecar backend when this
     * is missing, and `app.game.sidecar` then does not exist for plugins.
     */
    sidecar?: GameRuntimeSidecarBridge;
};

declare global {
    interface Window {
        [GAME_RUNTIME_BRIDGE_KEY]?: GameRuntimePreloadBridge;
    }
}
