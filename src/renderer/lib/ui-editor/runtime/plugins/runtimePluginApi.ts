/**
 * Public surface of the `narraleaf-studio/runtime` host API.
 *
 * Runtime plugin entries are prebundled ESM files loaded in every game
 * execution environment (Dev Mode window, Preview, Production). They are game
 * code: no Studio services, no privileged facade. This module must stay inside
 * `@/lib/ui-editor/` so the standalone game runtime bundle can include it
 * (see project/build/build-runtime.js allowedPrefixes).
 */

import type { ReactElement } from "react";
import type { PluginIdentity } from "@shared/types/pluginPermissions";
import type { NormalizedPluginManifestV2 } from "@shared/types/plugins";
import type {
    BlueprintOpenExternalRequest,
    BlueprintOpenExternalResult,
} from "@shared/types/blueprint/externalLink";
import type { BehaviorNodeExecuteResult } from "../../behavior-graph/BehaviorNodeRegistry";
import type { ElementRendererProps } from "../ElementRendererRegistry";
import type { StoryCompilePass } from "../game/storyCompilePass";

/**
 * The compile-pass vocabulary, re-exported so a plugin author can NAME these types rather than
 * digging them out of `Parameters<StoryCompilePass["scene"]>[0]`. This module is the public
 * `narraleaf-studio/runtime` surface (the plugin-types build reads its exports), so a type that is
 * only reachable through inference is, for an author, a type that does not exist.
 */
export type {
    BlockInjection,
    CompileBlockView,
    EngineAction,
    RuntimeFlag,
    SceneCompileContext,
    StageImage,
    StoryCompilePass,
} from "../game/storyCompilePass";

export type RuntimePluginLogLevel = "info" | "warning" | "error";

/**
 * What a plugin's node execute actually receives.
 *
 * Deliberately *not* the host's `BehaviorNodeExecutionContext`. That type carries
 * `hostAdapter`, through which a node could reach the entire host API — saves,
 * localization, quit — with nothing declared in the manifest and nothing shown to
 * the user at install. Narrowing it here is what makes `contributes` the true
 * account of a plugin's powers: whatever a node can touch, it touches through the
 * same capability-gated {@link RuntimePluginGame} that `setup` was handed.
 */
export type RuntimeBlueprintNodeContext = {
    /** Static parameter values authored on the node. */
    params: Record<string, unknown>;
    /**
     * Read one of this node's declared data input pins, following the wired edge.
     * Lazy, and undefined for unwired or undeclared pins. Call it as
     * `ctx.resolveInput?.(pinId)`.
     */
    resolveInput?: (pinId: string) => unknown;
    /** Event slot being handled, when the node runs inside an event graph. */
    eventName?: string;
    eventPayload?: Record<string, unknown>;
    /** Aborted when the execution is cancelled; honour it in long-running nodes. */
    signal?: AbortSignal;
    /** The very same object `setup(app)` received as `app.game`. */
    game: RuntimePluginGame;
};

export type RuntimeBlueprintNodeExecute = (
    ctx: RuntimeBlueprintNodeContext,
) => BehaviorNodeExecuteResult | void | Promise<BehaviorNodeExecuteResult | void>;

export type { BehaviorNodeExecuteResult as RuntimeBlueprintNodeResult };

/**
 * Runtime-side blueprint node binding: only the execute half. Plugin authors can
 * pass their full editor node objects (a superset shape) from a module shared
 * with the studio entry; extra fields are ignored.
 */
export type RuntimeBlueprintNodeDef = {
    type: string;
    displayName?: string;
    execute: RuntimeBlueprintNodeExecute;
};

/**
 * Runtime-side widget binding: the game-facing render function for a widget
 * element type. Receives the same props the host passes built-in element
 * renderers, so a plugin can reuse its studio widget module's render function
 * from a shared module.
 */
export type RuntimeWidgetRendererDef = {
    type: string;
    render: (props: ElementRendererProps) => ReactElement | null;
};

/** Removes a subscription. Also tracked by the host, so a failed plugin cannot leak listeners. */
export type RuntimePluginCleanup = () => void;

/**
 * `store` — the plugin's own persistent key/value area, kept beside the player's
 * saves rather than inside them: it survives starting a new game, which is what
 * things like unlocked-content and achievement mirrors need. Keys are namespaced
 * to the plugin. Backed by the game's persistence file on desktop and IndexedDB
 * on the web export.
 */
export type RuntimePluginStore = {
    get<T = unknown>(key: string): Promise<T | null>;
    set<T = unknown>(key: string, value: T): Promise<void>;
    remove(key: string): Promise<void>;
    keys(): Promise<string[]>;
};

/**
 * Payloads for {@link RuntimePluginEvents}. Names are the plugin's vocabulary,
 * not the engine's — several are bridged from engine buses whose own names carry
 * implementation history.
 */
export type RuntimePluginEventMap = {
    /** First-pass preload finished. Replayed: subscribing late still fires. */
    preloadComplete: void;
    /** First scene mounted and painted once. Replayed. */
    firstSceneReady: void;
    /**
     * A scene component mounted. This is a *rendering* event, not "the story
     * reached this scene" — a remount fires it again.
     */
    sceneEnter: { sceneId: string | null };
    sceneExit: { sceneId: string | null };
    /** One line of dialogue finished displaying. */
    dialogueEnd: void;
    /** The player picked a choice. */
    choiceMade: { text: string };
    /** A character line was shown. */
    characterPrompt: { character: string | null; text: string };
    /** The action stack drained with a save context present. */
    gameEnd: void;
    beforeRestore: void;
    afterRestore: void;
    fullscreenChanged: boolean;
    /** The player asked to close the window. Desktop only — never fires on the web. */
    closeRequested: void;
    saveWritten: { id: string };
};

export type RuntimePluginEvents = {
    on<K extends keyof RuntimePluginEventMap>(
        event: K,
        listener: (payload: RuntimePluginEventMap[K]) => void,
    ): RuntimePluginCleanup;
    /**
     * Whether this environment can ever fire the event. `closeRequested` is false
     * on the web export, for instance. Check it rather than assuming a desktop
     * shell — a listener that never fires is a bug that only shows up on one
     * target.
     */
    available(event: keyof RuntimePluginEventMap): boolean;
};

/** Which table a story variable lives in. */
export type RuntimePluginStateScope = "scene" | "saved" | "persistent";

export type RuntimePluginStateChange = {
    scope: RuntimePluginStateScope;
    key: string;
    previous: unknown;
    next: unknown;
};

/**
 * `state.read` grants `get`/`onChange`; `state.write` additionally grants `set`.
 * The two are separate capabilities because reading a playthrough and rewriting
 * it are very different things to hand a plugin.
 */
export type RuntimePluginState = {
    get<T = unknown>(scope: RuntimePluginStateScope, key: string): T | null;
    /** Present only when `state.write` was declared. */
    set?: (scope: RuntimePluginStateScope, key: string, value: unknown) => void;
    onChange(listener: (change: RuntimePluginStateChange) => void): RuntimePluginCleanup;
};

export type RuntimePluginSaveMetadata = {
    id: string;
    updatedAt?: number;
    metadata?: unknown;
};

/**
 * `saves.read` grants the read half; `saves.write` additionally grants `write`
 * and `load`, which can overwrite or abandon a playthrough — hence the separate,
 * heavier capability.
 */
export type RuntimePluginSaves = {
    listIds(): Promise<string[]>;
    readMetadata(id: string): Promise<RuntimePluginSaveMetadata | null>;
    /** Present only with `saves.write`. Overwrites the slot. */
    write?: (id: string, metadata?: unknown) => Promise<void>;
    /** Present only with `saves.write`. Replaces the running playthrough. */
    load?: (id: string) => Promise<void>;
};

/**
 * `ui.overlay` — draw above the game.
 *
 * The plugin returns an element and the *host* renders it: the game environment
 * deliberately withholds `react-dom/client`, so a plugin cannot mount its own
 * React root (a second root would fight the host's over the same tree).
 *
 * Stacking, precisely: above the game stage, below the app surfaces (menus, save
 * screens, authored pages) — but **above the dialogue box**, which is not what
 * you would want. The engine renders say/NVL inside its `Player`, and the only
 * injection point a host has is `Player`'s children, emitted after it; there is
 * no DOM position beneath the dialogue for a host layer to take. Putting an
 * overlay where dialogue happens will cover it. Fixing that needs an
 * engine-side overlay slot.
 */
export type RuntimePluginOverlay = {
    mount(render: () => ReactElement | null): RuntimePluginCleanup;
};

/** `locale` — the game's display language, and a subscription for switches. */
export type RuntimePluginLocale = {
    readonly current: string;
    onChange(listener: (locale: string) => void): RuntimePluginCleanup;
};

/** `assets` — turn an asset id from the pack into a URL this shell can load. */
export type RuntimePluginAssets = {
    url(assetId: string): string;
};

/**
 * `navigation` — send the player out of the game, to an address this plugin declared.
 *
 * Present exactly when `contributes.externalLinks` is non-empty: declaring the patterns *is* the
 * request, the same shape `sidecar` uses, so there is no separate capability string to forget. A
 * plugin that declared nothing has no `app.game.navigation` at all rather than a method that
 * refuses, which keeps `if (app.game.navigation)` the honest test.
 *
 * **Declaring is not deciding.** The address still has to match one of this plugin's own patterns,
 * and that check happens in whichever process performs the act - the packaged game's main process,
 * Studio's main process in Dev Mode, the page itself on the web export - never here. This method is
 * a request, and `outcome: "refused"` is the ordinary answer to one that names an address the
 * manifest never covered.
 *
 * Rejects nothing and throws nothing: like the Open Link node it reports through the result, so a
 * plugin branches on the outcome instead of wrapping the call.
 */
export type RuntimePluginNavigation = {
    openExternal(request: BlueprintOpenExternalRequest): Promise<BlueprintOpenExternalResult>;
};

/** A live connection to one declared sidecar process. */
export type RuntimePluginSidecarHandle = {
    /** Send a method call and await its reply. Rejects if the sidecar dies mid-flight. */
    request<T = unknown>(method: string, params?: unknown): Promise<T>;
    /** Fire-and-forget. */
    notify(method: string, params?: unknown): void;
    onEvent(listener: (method: string, params: unknown) => void): RuntimePluginCleanup;
    onExit(listener: (info: { code: number | null; signal: string | null }) => void): RuntimePluginCleanup;
    stop(): Promise<void>;
};

/**
 * `app.game.sidecar` exists exactly when `contributes.sidecars` is non-empty —
 * declaring the sidecar is the request, so there is no separate capability to
 * forget. It is still absent on the web and mobile shells, which have no process
 * to spawn: check {@link available} instead of assuming a desktop build.
 */
export type RuntimePluginSidecars = {
    available(sidecarId: string): boolean;
    /** Idempotent: repeated calls return the same running handle. */
    start(sidecarId: string): Promise<RuntimePluginSidecarHandle>;
};

/**
 * `story` - take part in compiling the project's stories.
 *
 * The one namespace here that acts *before* the game runs rather than during it: a pass is called
 * while each scene is compiled, and what it returns is part of the story the player then plays. See
 * `storyCompilePass.ts` for the context a pass is handed and for why it is as small as it is.
 */
export type RuntimePluginStory = {
    /**
     * Register a pass. Idempotent by pass id, so a host that runs setup twice does not double every
     * action the pass injects.
     */
    registerCompilePass(pass: StoryCompilePass): void;
};

/**
 * The game-side plugin surface.
 *
 * Everything below the always-present five is **capability-gated**: a domain the
 * manifest did not declare is *absent from this object*, not a method that
 * throws. That is the whole contract — the install prompt lists exactly the
 * domains present here, so what the user approved and what the plugin can do are
 * the same set by construction.
 */
export type RuntimePluginGame = {
    blueprintNodes: {
        register(def: RuntimeBlueprintNodeDef): void;
        registerMany(defs: RuntimeBlueprintNodeDef[]): void;
    };
    widgets: {
        register(def: RuntimeWidgetRendererDef): void;
        registerMany(defs: RuntimeWidgetRendererDef[]): void;
    };
    /**
     * Read-only access to plugin storage published with the game, for the
     * namespaces declared in `contributes.runtimeData`. Synchronous: the
     * data travels with the pack, so there is nothing to await.
     *
     * Returns null when the namespace was not declared, the project never
     * wrote it, or the game predates the data being published. Callers must
     * degrade gracefully rather than assume authored data exists.
     */
    data: {
        readJson<T = unknown>(namespace: string): T | null;
    };
    /**
     * What the author filled in for this plugin's `contributes.buildConfig` fields, for the
     * variant this build was compiled as. Synchronous for the reason `data` is: the values
     * travel with the pack.
     *
     * Always present, like `data`, and for the same reason - declaring a field grants the plugin
     * nothing, so there is no capability here to gate on. Only this plugin's own fields are
     * readable; another plugin's values are not in the entry this reads.
     *
     * Returns null for a key the manifest never declared, for a `secret` field (the value stays
     * on the machine that typed it and is not in any build), for one the author left blank, and
     * outside a compiled build. A plugin must treat every one of those as "not configured" rather
     * than assume a value exists.
     */
    config: {
        get(key: string): string | null;
    };
    log(level: RuntimePluginLogLevel, message: string): void;

    /** Present with `contributes.runtimeCapabilities: ["store"]`. */
    store?: RuntimePluginStore;
    /** Present with `"events"`. */
    events?: RuntimePluginEvents;
    /** Present with `"state.read"` (and `set` with `"state.write"`). */
    state?: RuntimePluginState;
    /** Present with `"saves.read"`. */
    saves?: RuntimePluginSaves;
    /** Present with `"ui.overlay"`. */
    ui?: { overlay: RuntimePluginOverlay };
    /** Present with `"assets"`. */
    assets?: RuntimePluginAssets;
    /** Present with `"locale"`. */
    locale?: RuntimePluginLocale;
    /** Present with `"story.compile"`. */
    story?: RuntimePluginStory;
    /** Present when `contributes.sidecars` is non-empty. */
    sidecar?: RuntimePluginSidecars;
    /** Present when `contributes.externalLinks` is non-empty. */
    navigation?: RuntimePluginNavigation;
};

export type RuntimePluginApp = {
    plugin: PluginIdentity;
    manifest: NormalizedPluginManifestV2;
    game: RuntimePluginGame;
};

/**
 * Game environments load once per process; there is no unload lifecycle, so
 * setup has no cleanup return (unlike the studio entry's PluginSetup).
 */
export type RuntimePluginSetup = (app: RuntimePluginApp) => void | Promise<void>;

export type RuntimePluginDefinition = {
    setup: RuntimePluginSetup;
};

const RUNTIME_PLUGIN_DEFINITION_MARKER = "__nlsRuntimePluginDefinition";

export function defineRuntimePlugin(definition: RuntimePluginDefinition): RuntimePluginDefinition {
    if (!definition || typeof definition.setup !== "function") {
        throw new Error("Runtime plugin definition requires a setup(app) function");
    }
    return Object.freeze({
        ...definition,
        [RUNTIME_PLUGIN_DEFINITION_MARKER]: true,
    });
}

export function isRuntimePluginDefinition(value: unknown): value is RuntimePluginDefinition {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as Record<string, unknown>)[RUNTIME_PLUGIN_DEFINITION_MARKER] === true &&
        typeof (value as RuntimePluginDefinition).setup === "function"
    );
}
