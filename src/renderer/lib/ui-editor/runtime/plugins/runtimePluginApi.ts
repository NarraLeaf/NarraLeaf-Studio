/**
 * Public surface of the `narraleaf-studio/runtime` host API.
 *
 * Runtime plugin entries are prebundled ESM files loaded in every game
 * execution environment (Dev Mode window, Preview, Production). They are game
 * code: no Studio services, no privileged facade. This module must stay inside
 * `@/lib/ui-editor/` so the standalone game runtime bundle can include it
 * (see project/build/build-runtime.js allowedPrefixes).
 */

import type { GameMenuSpec } from "@shared/types/gameMenu";
import type { ReactElement, ReactNode } from "react";
import type { PluginIdentity } from "@shared/types/pluginPermissions";
import type { NormalizedPluginManifestV2 } from "@shared/types/plugins";
import type {
    BlueprintOpenExternalRequest,
    BlueprintOpenExternalResult,
} from "@shared/types/blueprint/externalLink";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import type { BehaviorNodeExecuteResult } from "../../behavior-graph/BehaviorNodeRegistry";
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
 * What a plugin's widget renderer is handed for one drawing of one element.
 *
 * Deliberately *not* the host's `ElementRendererProps`, for the same reason
 * {@link RuntimeBlueprintNodeContext} is not the host's execution context: that type
 * carries `hostAdapter`, and through it every host API - saves, localization, quit, the
 * running sound mixer - none of which the plugin's manifest declared or the user
 * approved. What a widget needs and a node does not is the element it is drawing, the
 * document around it, and a way to raise its own event slots; those are here. Everything
 * else is reached through the same capability-gated {@link RuntimePluginGame} the rest of
 * the plugin uses.
 *
 * `dispatchEvent` and `game` are optional so that one render function written against
 * this type can also be a studio widget module's `render`, which is handed the editor's
 * wider props: on the editor canvas there is no running game and no blueprint to raise an
 * event on, so both are honestly absent there. The reverse does not hold - a function
 * written against the editor's props cannot be a runtime renderer, because `hostAdapter`
 * is not there to read.
 */
export type RuntimeWidgetRendererProps = {
    /** The element being drawn: this widget's own authored props, layout and extra. */
    element: UIElement;
    /** The surface it is being drawn on. */
    surface: UISurface;
    /**
     * The whole interface document.
     *
     * Authored content rather than a host power - the game is already drawing it - and a
     * structural widget cannot be written without it: resolving a widget's own parts and
     * descendants means looking them up here, which is what the built-in list and switch do.
     */
    document: UIDocument;
    /** This element's children, already rendered, unless the widget places its own. */
    children?: ReactNode;
    /** Stable suffix distinguishing repeated drawings of one authored element. */
    instanceKey?: string;
    /** The row this drawing belongs to, when the widget renders inside a list item template. */
    listItemScope?: UIListItemScope | null;
    /**
     * Place this element's children, rather than taking the pre-rendered {@link children}.
     * A widget that repeats one authored template calls this once per row with that row's
     * scope and its own instance key.
     */
    renderChildren?: (options?: {
        childrenIds?: string[];
        listItemScope?: UIListItemScope | null;
        instanceKey?: string;
        elementOverrides?: Record<string, UIElement>;
    }) => ReactNode[];
    /** Read-only views of the state tables the author's blueprints write. */
    runtimeData?: {
        surfaceState?: { get(key: string): unknown };
        globalState?: { get(key: string): unknown };
        /** Props the current page was opened with; fixed for the life of the page instance. */
        pageProps?: Readonly<Record<string, unknown>>;
    };
    /**
     * Raise one of this element's own event slots, running whatever the author wired to it.
     *
     * The only route a plugin widget has to the author's graph, and the reason the host's
     * blueprint runtime cannot simply be withheld: the dispatcher that turns a click into
     * `mouseClick` reads a static table of built-in widget types, so a plugin type is not in
     * it and nothing else will ever fire the slot.
     *
     * Bound to the element being drawn - a widget cannot raise an event on another one - and
     * to the scope it is being drawn in, so a dispatch from inside a repeated row addresses
     * that row. Pass `options` only to address a different row than the one being drawn.
     *
     * A new function on every render, like anything bound to the current drawing: call it
     * from a handler, and keep it in a ref rather than in an effect's dependency list.
     */
    dispatchEvent?: (
        eventName: string,
        payload?: Record<string, unknown>,
        options?: { listItemScope?: UIListItemScope | null; instanceKey?: string },
    ) => Promise<void>;
    /** The very same object `setup(app)` received as `app.game`. */
    game?: RuntimePluginGame;
};

/**
 * Runtime-side widget binding: the game-facing render function for a widget
 * element type. The props are narrowed on the way in - see
 * {@link RuntimeWidgetRendererProps}.
 */
export type RuntimeWidgetRendererDef = {
    type: string;
    render: (props: RuntimeWidgetRendererProps) => ReactElement | null;
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
    /**
     * One line of dialogue finished displaying.
     *
     * `textId` is the line's stable text id - the same key the translation table and the engine's
     * `voiceId` use - or null for a line the host cannot name (a story compiled outside Studio, or
     * a line the compile did not bind). It is the id to record against when a plugin keeps its own
     * account of what the player has heard.
     */
    dialogueEnd: { textId: string | null };
    /** The player picked a choice. */
    choiceMade: { text: string };
    /**
     * A choice menu went on screen, with every option it is offering.
     *
     * The other half of {@link choiceMade}, which only says what was taken. Fires whenever the menu
     * mounts, so a rollback into the same choice reports it again - treat it as "this is on screen
     * now" rather than as a first visit.
     *
     * `index` is the engine's index for the option and is what picking one addresses. Options a
     * condition hid are absent from the list and do NOT shift it, so the indices can have gaps.
     */
    choiceShown: {
        options: { index: number; text: string; disabled: boolean }[];
    };
    /** A character line was shown. */
    characterPrompt: { character: string | null; text: string };
    /**
     * The story started playing an audio asset: a `/bgm` or `/sound` row, or a scene whose
     * configured background music begins as it mounts.
     *
     * Reports the clip the *story* began, not every sound the game makes: a clip a Page starts
     * through `Play Sound` belongs to the interface rather than to the playthrough, and does not
     * appear here.
     *
     * Like `sceneEnter` this follows execution rather than a first visit, so a replay, a rollback
     * or a re-entered scene fires it again. Treat it as "this is playing now" and make what you do
     * with it idempotent.
     */
    audioPlayed: { assetId: string };
    /**
     * The story reached an ending: an `/ending` row ran, or the action stack drained with a save
     * context present.
     *
     * Both, deliberately. An authored ending IS the game ending, so a plugin that watched only the
     * drained stack would stop hearing about endings the moment a project started marking them.
     * {@link endingReached} is the one that can name which ending it was.
     */
    gameEnd: void;
    /**
     * An `/ending` row ran, naming the ending it declares.
     *
     * `endingId` is the row's own id and is stable across a rename, which is what a screen records
     * against; `name` is the author's display text at the moment it was reached. Fires alongside
     * {@link gameEnd} and before the player is put on whatever page the ending lands on.
     *
     * A story that ends by running out of rows fires `gameEnd` and not this: there is no ending to
     * name.
     */
    endingReached: { endingId: string; name: string };
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
    /**
     * One of the project's own localization keys, in the language the game is running in.
     *
     * The same table, chain and fallback the `Get Text` node uses. A plugin that puts the author's
     * wording on screen reads it from here rather than shipping a copy: the copy would be the one
     * string a translator never sees, and it would be wrong in exactly the languages the author
     * added after the plugin was installed. `null` when the project declares no such key.
     */
    text(key: string): string | null;
};

/**
 * `menu` - the whole menu bar above the game, declared at once.
 *
 * Present with the `menu` capability AND on a shell that has a bar: the web export has no menu bar
 * and Dev Mode's window is Studio's own, so `app.game.menu` is simply absent there and
 * `if (app.game.menu)` is the honest test - the same shape `sidecar` uses.
 *
 * `set` replaces the bar entirely; there is no add or remove, because a menu is read as a whole and
 * two plugins each appending to it would produce an order neither of them chose. What the rows say
 * is this plugin's; what they mean, and whether each is ticked or greyed out, is the game's (see
 * `@shared/types/gameMenu`). An empty spec takes the bar away.
 *
 * Rejects when no game is mounted yet - a bar has nothing to be resolved against until then.
 */
export type RuntimePluginMenu = {
    set(spec: GameMenuSpec): Promise<void>;
};

/**
 * What the engine's image cache is holding, against what it is allowed to hold. All sizes in bytes.
 *
 * Restated here rather than re-exported from the engine because a plugin cannot import
 * `narraleaf-react` - the only module specifiers it can resolve are `narraleaf-studio/*` and React.
 * The shape is the engine's `ImageCacheStats`; if that grows a field, this is the second place.
 */
export type RuntimePluginImageCacheStats = {
    /** Sources the cache holds a url for. */
    entries: number;
    /**
     * Bytes of fetched image data the cache is keeping alive.
     *
     * **Zero is a real answer, not a missing one.** A host that serves its own assets hands the
     * player urls instead of bytes, and then the player holds none: what the images cost lives in
     * the browser's cache, outside anything this can count. A reader that shows this as "memory
     * used" will report an improvement that did not happen - see {@link entries}, which still
     * counts, and the decoded figures below, which are the ones with a budget behind them.
     */
    blobBytes: number;
    /** Sources whose decoded bitmap the cache is holding. */
    decodedEntries: number;
    /** Estimated size of those bitmaps, at width x height x 4 bytes each. */
    decodedBytes: number;
    /** Entries nothing may evict right now: shown by a mounted element, or pinned by the scene. */
    pinned: number;
    /** The budgets in force. `Infinity` where the game removed one. */
    budget: {
        blobBytes: number;
        decodedBytes: number;
    };
};

/**
 * `diagnostics` — what the player's caches weigh.
 *
 * Every member answers null before a game session exists, which is the ordinary state during
 * `setup()`. A plugin polls this; there is no change event, because a cache that announced every
 * eviction would cost more to watch than to run.
 */
export type RuntimePluginDiagnostics = {
    /** The engine's image cache, or null when no session is live. */
    imageCache(): RuntimePluginImageCacheStats | null;
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
    /** Present with `"menu"`, and only on a shell that has a menu bar to give. */
    menu?: RuntimePluginMenu;
    /** Present with `"story.compile"`. */
    story?: RuntimePluginStory;
    /** Present with `"diagnostics"`. */
    diagnostics?: RuntimePluginDiagnostics;
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
