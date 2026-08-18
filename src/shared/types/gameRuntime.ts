import type { BlueprintOpenExternalRequest, BlueprintOpenExternalResult } from "./blueprint/externalLink";
import type { BlueprintPointerMoveRequest, BlueprintPointerMoveResult } from "./blueprint/pointer";
import type { NetworkAccessPolicy, NetworkPluginAllowlistEntry } from "./networkAllowlist";
import type { BlueprintNetworkFetchRequest, BlueprintNetworkFetchResult } from "./blueprint/network";
import type { DevModeBundle } from "./devMode";
import type { DevModeSaveHeader, DevModeSaveRecord } from "./devModeSave";
import type { SaveCompatibilityStamp } from "./saveCompatibility";
import type {
    GameProgressExportRequest,
    GameProgressExportResult,
    GameProgressImportResult,
} from "./gameProgress";
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

/**
 * What the pack records about one asset.
 *
 * Every field except `relativePath` describes the asset rather than locating it, and a shipped game
 * is compiled without them: see {@link GameRuntimePackV1.assets}. Code that reads one must therefore
 * treat it as a hint that may be absent, never as the answer to "what is this file" - the runtime
 * learns that from the bytes it just read.
 */
export type GameRuntimeAssetManifestEntry = {
    id: string;
    type?: string;
    name?: string;
    source?: GameRuntimeAssetSource;
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
    /**
     * What the author filled in for this plugin's `contributes.buildConfig` fields, resolved for
     * the variant this pack was compiled as and keyed by field key. It is how a plugin's runtime
     * learns the storefront id or account name its build was configured with; without it the
     * declarations reach the build dialog and stop there.
     *
     * A `secret` field is never here. The project holds a handle for one, not the value, and this
     * record ships to every player - see `resolveShippedPluginBuildConfig`, which is the only thing
     * that fills it in. Neither is a platform-scoped field yet: one pack serves several platforms,
     * and those values are keyed per platform.
     *
     * Absent on packs built before this channel existed, on plugins that declare no fields, and
     * when nothing was filled in - all three mean the same thing to the plugin, which is that it
     * was told nothing and must degrade.
     */
    buildConfig?: Record<string, string>;
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
    /**
     * What the pack says about its assets - which is as close to nothing as each build can manage.
     *
     * A protected build ships `items` **empty**. Its store names every asset entry after the asset
     * id alone, so the bytes are reachable by derivation from an id the caller already holds, and
     * there is no list to read: an attacker who has replaced the main process still cannot ask the
     * pack what the game contains. An unprotected build keeps `items`, because nothing is being
     * protected there and its loose files carry their own names anyway - but even then a
     * distribution build carries only what locating the bytes needs, never `name`,
     * `originalRelativePath` or `hash`.
     *
     * Preview and test packs keep the manifest whole so the dev-mode surfaces can name what they
     * report. The runtime never resolves bytes through it either way - a protected store always
     * derives - so the two cannot drift into "works in preview, broken when shipped".
     */
    assets: {
        items: Record<string, GameRuntimeAssetManifestEntry>;
        /**
         * The ids that name a model bundle rather than a single file. Ids only - no paths, no
         * names, nothing about what is inside one.
         *
         * The renderer needs this because a model mounts from a different URL shape than an ordinary
         * asset (`.../asset/{id}/`, with the trailing slash, so the engine's `resolveSibling` lands
         * inside the bundle instead of beside it), and the seam that builds it is synchronous - it
         * cannot go and ask. Membership is the least that answers "which shape", and an id already
         * occurs in the story payload that has to ship, so this discloses nothing new.
         *
         * The entry file's *path* used to be here too, which meant a shipped game named every
         * character's model file. It lives in the payload now, at an address derived from the id
         * (see `gameRuntimeBundleModelEntry`), so it can only be fetched by someone who already
         * knows which model they want.
         */
        modelBundles?: string[];
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
     * What this build does when it stops working. Absent on packs produced before this field
     * existed, which the runtime reads as {@link DEFAULT_GAME_CRASH_POLICY} - the behaviour those
     * packs shipped with.
     *
     * Carried on every pack, web included, unlike {@link network}: a crash is not a shell
     * mechanism, and a policy that applied to the desktop build but not the web one would be a
     * setting that means different things depending on where the author looks.
     */
    crash?: GameRuntimeCrashConfig;
    /**
     * The page this build shows when its story falls off the end, resolved for the variant it was
     * compiled as.
     *
     * Absent on packs produced before this field existed, on projects that picked none, and on a
     * variant that states it shows nothing. All three mean the same thing to the runtime and it is
     * the behaviour every build had before this field: the story stops and the stage stays where it
     * is. There is deliberately no default page - a screen nobody authored is worse than no screen.
     */
    endingSurfaceId?: string;
    /**
     * What this build needs in order to accept a patch.
     *
     * `verificationKey` is the public half of the project's distribution key. It
     * verifies and cannot produce, so it ships in the clear; a patch that carries
     * a proof is read only when that proof checks out against it.
     *
     * Absent on every build made without a distribution key, and on packs produced
     * before this field existed. Both mean the same thing: this build reads no
     * patch that claims to come from anywhere, because it has no way to tell.
     */
    addOns?: {
        verificationKey: string;
    };
    /**
     * The one string every edition of this title shares, naming the file progress is carried in.
     *
     * Resolved from the identity the RELEASE tag carries whatever variant this pack is - see
     * `@shared/types/gameProgress`. That is the whole point: a demo overrides `identifier` and
     * therefore writes its saves somewhere the full game cannot read, and this key is what the two
     * agree on regardless.
     *
     * Absent on packs produced before this field existed. The shells read that as "this build
     * cannot carry progress" and both nodes fail with a reason, rather than inventing a key - a
     * guessed one would be a second answer to a question whose only value is that there is one.
     */
    progressKey?: string;
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

/**
 * What a shipped game does when it stops working, chosen per project.
 *
 * The three answers are not about how much the player is told, they are about who the build is
 * for. A build the author is testing wants the failure on screen. A build in a player's hands
 * usually wants the message without the stack, since a stack trace is not something they can act
 * on and the log keeps it for whoever they report it to. A build running unattended - a demo on a
 * stand, a kiosk - wants to be playable again without anybody pressing anything.
 *
 * The failure reaches the log under all three. That is not a policy, it is the floor.
 */
/**
 * How the main process tells a freshly loaded page that it is replacing one that died.
 *
 * A query parameter because nothing else survives: there is no renderer left to send a message to,
 * and the window is about to be thrown away and rebuilt. The value is the description to show; the
 * page decides whether to show it, having learned the policy from its own process argument.
 */
export const GAME_RUNTIME_CRASH_QUERY_PARAM = "nlcrash";

export const GAME_CRASH_POLICIES = ["details", "log", "restart"] as const;

export type GameCrashPolicy = typeof GAME_CRASH_POLICIES[number];

/**
 * What a project that has never chosen gets, and what every build made before this field existed
 * behaved as: the failure on screen, behind a disclosure.
 */
export const DEFAULT_GAME_CRASH_POLICY: GameCrashPolicy = "details";

/** Coerce an unknown (persisted, or from an older pack) value into a policy. */
export function normalizeGameCrashPolicy(value: unknown): GameCrashPolicy {
    return GAME_CRASH_POLICIES.includes(value as GameCrashPolicy)
        ? value as GameCrashPolicy
        : DEFAULT_GAME_CRASH_POLICY;
}

export type GameRuntimeCrashConfig = {
    policy: GameCrashPolicy;
};

export type GameRuntimeNetworkConfig = {
    /**
     * When false (default), the renderer is confined to the app protocol and
     * every HTTP/HTTPS/WebSocket request is blocked (CSP + main-process
     * webRequest). When true, remote resources over HTTP/HTTPS are permitted.
     */
    allowHttp: boolean;
    /**
     * How much of the network the build may reach once {@link allowHttp} is on.
     *
     * Absent is `"any"`, which is what every pack written before this field
     * existed carries and what those builds shipped with. See
     * `@shared/types/networkAllowlist` for why the wide state is the default.
     */
    policy?: NetworkAccessPolicy;
    /** The author's own entries. Only consulted when {@link policy} is `"allowlist"`. */
    allowlist?: string[];
    /**
     * Hosts the plugins in this build declared and the author approved at
     * install, kept attributed rather than merged into {@link allowlist}: the
     * two are removed by different acts, and a merged list could not say which.
     */
    pluginAllowlist?: NetworkPluginAllowlistEntry[];
};

export type GameRuntimeSaveBridge = {
    write(
        id: string,
        savedGame: unknown,
        capture?: string,
        metadata?: unknown,
        /** What produced the save; omitted leaves the record unstamped. */
        compatibility?: SaveCompatibilityStamp,
        /** Seconds of play behind the save; omitted leaves the record without a reading. */
        playtimeSeconds?: number,
    ): Promise<void>;
    read(id: string): Promise<GameRuntimeSaveRecord | null>;
    listIds(): Promise<string[]>;
    /** Every slot's header, without any slot's game or capture. See `GameAppSaveStore.listHeaders`. */
    listHeaders(): Promise<GameRuntimeSaveHeader[]>;
    readPreview(id: string): Promise<string | null>;
    delete(id: string): Promise<{ deleted: boolean }>;
};

export type GameRuntimeSaveRecord = DevModeSaveRecord;

export type GameRuntimeSaveHeader = DevModeSaveHeader;

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

/**
 * Moving the player's real cursor, for the Move Mouse family.
 *
 * Desktop only, and honestly so: the web export answers `unsupported` rather than emulating the
 * act, because a page cannot move the pointer and a drawn stand-in would be a different feature
 * wearing this one's name. Non-desktop builds are warned about at build time, so an author learns
 * it from the console rather than from a player.
 */
export type GameRuntimePointerBridge = {
    move(request: BlueprintPointerMoveRequest): Promise<BlueprintPointerMoveResult>;
};

export type GameRuntimeExternalLinkBridge = {
    open(request: BlueprintOpenExternalRequest): Promise<BlueprintOpenExternalResult>;
    /**
     * The same act on a plugin's behalf, decided against a different declaration.
     *
     * A separate method rather than an optional field on the request, because the two are separate
     * regimes and a single entry point taking "who is asking" would make the caller's word part of
     * how the project's own declaration is read. Here the plugin id selects *which* declaration
     * applies and can only ever select one that shipped: the far side looks the id up in
     * `pack.plugins[].manifest.contributes.externalLinks`, so an id naming nothing in the pack
     * declares nothing and an id naming another plugin reaches that plugin's approved patterns and
     * no further.
     */
    openForPlugin(
        pluginId: string,
        request: BlueprintOpenExternalRequest,
    ): Promise<BlueprintOpenExternalResult>;
};

/**
 * Carrying a playthrough between two editions of one title, for the Export/Import Progress nodes.
 *
 * Present on every shell, and satisfied differently by each: the desktop shells hand the act to
 * their main process, which owns the filesystem; the web export refuses, because a page has none
 * and pretending to have written would be the one answer worse than saying no.
 *
 * The renderer states what the playthrough holds and never where it goes. Which file is written is
 * decided by the process that writes it, from `pack.progressKey` - a caller that could name the
 * file could name another title's.
 */
export type GameRuntimeProgressBridge = {
    write(request: GameProgressExportRequest): Promise<GameProgressExportResult>;
    read(): Promise<GameProgressImportResult>;
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
    /**
     * End this shell and bring it straight back at boot.
     *
     * Asked for when the game cannot be corrected in place - today, a language changed while a
     * playthrough was running, which invalidates the text already drawn, the backlog holding it,
     * the voice under it and the assets held for the scene. The run is parked in a save first and
     * loaded back by the boot that follows; see the renderer's `localeRestart`.
     *
     * Every shell can do this honestly, which is why it sits beside {@link close} rather than
     * behind {@link capabilities}: the desktop shell relaunches its process, and the web export
     * reloads its page, which for a shell that IS a page is the same act.
     */
    restart(): Promise<void>;
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
    /**
     * What this build does when it stops working, if the shell knows before the pack is read.
     *
     * The desktop shell does: main reads the pack and passes the policy as a process argument, so
     * the crash screen is correct from the first frame - which matters, because the crash it is
     * most likely to draw is one that happened while the pack was still being read. The web export
     * has no such channel and answers `null` until {@link readPack} lands, which the renderer
     * treats as "not known yet" rather than as a policy.
     */
    crashPolicy: GameCrashPolicy | null;
    /**
     * Where this shell writes its log, so the crash screen can say where the report is.
     *
     * The one thing a player can do about a crash is hand the file to whoever can read it, and
     * they cannot do that without being told where it is. `null` on the web export, which has no
     * log file at all - its shell prints to the browser console, and there is no path to name.
     */
    logPath: string | null;
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
    /** The Move Mouse family's request. Present on every shell; the web one always declines. */
    pointer: GameRuntimePointerBridge;
    /**
     * One Export/Import Progress node request.
     *
     * Present on every shell, unlike {@link sidecar}: a web export genuinely cannot do this, but it
     * has to SAY so on the node's failure branch rather than have the field disappear - an author
     * whose page silently lost the node would ship a button that does nothing.
     */
    progress: GameRuntimeProgressBridge;
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
