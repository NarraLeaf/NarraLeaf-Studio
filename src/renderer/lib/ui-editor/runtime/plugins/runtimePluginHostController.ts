/**
 * The environment half of the runtime plugin contract: turns what a game shell
 * can actually do into a {@link RuntimePluginHost}.
 *
 * Two things have to be true at once. The loader needs the host *before* any
 * plugin runs (`setup()` happens during boot, ahead of the game app), and most
 * capabilities are only backable once the game is live (engine events, story
 * variables, overlays). So the controller is built up front from the shell's own
 * primitives — persistence, saves, asset URLs, window events — and the game app
 * attaches the live engine to it later. Backends handed to plugins are stable
 * for the life of the process and indirect through whatever is attached, which
 * is also what makes them survive a Dev Mode hot reload or an in-window
 * relaunch: the plugin's listener stays, the session underneath it is replaced.
 *
 * A capability the shell cannot back is simply not on the controller's `host`,
 * which is how it stays absent from `app.game` (see loadRuntimePlugins).
 *
 * Must stay under `@/lib/ui-editor/` so the standalone game runtime bundle can
 * include it (see project/build/build-runtime.js allowedPrefixes).
 */

import type { Game, LiveGame, Scene } from "narraleaf-react";
import type { DevModeBundle } from "@shared/types/devMode";
import { LOCALE_STORAGE_KEY } from "@shared/types/localization";
import type { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { CompiledNlrStory } from "@/lib/ui-editor/runtime/game/storyCompiler";
import { readNlrCharacterName } from "@/lib/ui-editor/runtime/app/nlrDialogReaders";
import { RuntimePluginOverlayStore } from "./RuntimePluginOverlayLayer";
import type {
    RuntimePluginEventMap,
    RuntimePluginLogLevel,
    RuntimePluginSaveMetadata,
    RuntimePluginStateChange,
    RuntimePluginStateScope,
} from "./runtimePluginApi";
import type {
    RuntimePluginHost,
    RuntimePluginHostUnsubscribe,
    RuntimePluginSidecarBackend,
} from "./runtimePluginHost";
import {
    buildRuntimePluginVariableTables,
    diffStateSnapshots,
    readRuntimePluginVariable,
    snapshotEngineScopes,
    snapshotPersistentScope,
    writeRuntimePluginVariable,
    type RuntimePluginStateSnapshot,
    type RuntimePluginStorySession,
} from "./runtimePluginStoryState";

type EngineToken = { cancel(): void };

/**
 * Everything a shell brings by itself, independent of whether a game is
 * running. Each field is optional and an absent one removes the matching
 * capability from `app.game` — that is the honest report of "this shell cannot
 * do that", as opposed to a method that fails on first call.
 */
export type RuntimePluginShellBackends = {
    /**
     * Player-domain key/value storage (the persistence file on desktop,
     * IndexedDB on the web). Deliberately NOT the save file: plugin storage has
     * to survive starting a new game.
     */
    persistence?: {
        getAll(): Promise<Record<string, unknown>>;
        getValue(key: string): Promise<unknown>;
        setValue(key: string, value: unknown): Promise<void>;
        removeValue(key: string): Promise<void>;
    };
    /**
     * Save access. Reading is pure shell work; writing and loading are not —
     * they need a running engine to serialize from and deserialize into, which
     * does not exist when this object is built. A shell that will mount a game
     * app sets `writable` to say so, and the controller then exposes `write`/
     * `load` backed by whatever the game app attaches (see
     * {@link RuntimePluginHostController.attachSaveActions}). A shell that only
     * lists saves leaves it off, and `saves.write` stays unbacked there.
     */
    saves?: {
        listIds(): Promise<string[]>;
        readMetadata(id: string): Promise<RuntimePluginSaveMetadata | null>;
        writable?: boolean;
    };
    /** Synchronous asset id → URL. Shells that can only resolve async omit it. */
    assetUrl?: (assetId: string) => string;
    subscribeFullscreenChanged?: (listener: (isFullscreen: boolean) => void) => () => void;
    /**
     * Observe (never veto) the user's window-close request. Absent on shells
     * with no such signal — a browser tab, for one — which is exactly what
     * `events.available("closeRequested")` then reports.
     */
    subscribeCloseRequested?: (listener: () => void) => () => void;
    /**
     * Child-process hosting, on the shells that have child processes. Unlike
     * saves, this one needs nothing from the running game - a sidecar's life is
     * the process's, not the playthrough's - so the shell's backend is passed
     * through to plugins unchanged rather than being wrapped in session state.
     * Absent on the web export, which is what removes `app.game.sidecar` there.
     */
    sidecar?: RuntimePluginSidecarBackend;
    log?: (level: RuntimePluginLogLevel, message: string) => void;
};

type EventKey = keyof RuntimePluginEventMap;

/** Events produced by the engine; backed as soon as a game environment exists. */
const ENGINE_EVENTS: readonly EventKey[] = [
    "preloadComplete",
    "firstSceneReady",
    "sceneEnter",
    "sceneExit",
    "dialogueEnd",
    "choiceMade",
    "characterPrompt",
    "gameEnd",
    "beforeRestore",
    "afterRestore",
];

function describeError(error: unknown): string {
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/**
 * Multicast fan-out for bridged events. One plugin's throwing listener must not
 * stop the others from being called, nor propagate back into the engine's own
 * dispatch.
 */
class RuntimePluginEventHub {
    private readonly listeners = new Map<EventKey, Set<(payload: never) => void>>();

    public constructor(private readonly log: (level: RuntimePluginLogLevel, message: string) => void) {}

    public on<K extends EventKey>(
        event: K,
        listener: (payload: RuntimePluginEventMap[K]) => void,
    ): RuntimePluginHostUnsubscribe {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        const entry = listener as (payload: never) => void;
        set.add(entry);
        return () => {
            set.delete(entry);
        };
    }

    public emit<K extends EventKey>(event: K, payload: RuntimePluginEventMap[K]): void {
        const set = this.listeners.get(event);
        if (!set || set.size === 0) {
            return;
        }
        for (const listener of Array.from(set)) {
            try {
                (listener as (value: RuntimePluginEventMap[K]) => void)(payload);
            } catch (error) {
                this.log("error", `runtime plugin listener for "${event}" failed: ${describeError(error)}`);
            }
        }
    }
}

export type RuntimePluginRuntimeAttachment = {
    scope: ScopeStoreBridge;
    bundle: DevModeBundle;
};

export type RuntimePluginSessionAttachment = {
    liveGame: LiveGame;
    compiled: CompiledNlrStory;
};

/**
 * The game app's own save paths, as plugins reach them. Deliberately the very
 * same functions the `Save Game` / `Load Save` blueprint nodes call: a plugin
 * save has to be indistinguishable from an authored one — same serialization,
 * same reveal, same `saveWritten` event — and a second implementation would
 * drift from it the first time either side changed.
 */
export type RuntimePluginSaveActions = {
    write(id: string, metadata?: unknown): Promise<void>;
    load(id: string): Promise<void>;
};

/**
 * Built by each shell, handed to `loadRuntimePlugins` as `options.host`, and
 * driven by the game app as the session comes and goes.
 */
export class RuntimePluginHostController {
    public readonly host: RuntimePluginHost;
    public readonly overlays = new RuntimePluginOverlayStore();

    private readonly hub: RuntimePluginEventHub;
    private readonly stateListeners = new Set<(change: RuntimePluginStateChange) => void>();
    private readonly sessionTokens: EngineToken[] = [];

    private attachment: RuntimePluginRuntimeAttachment | null = null;
    private saveActions: RuntimePluginSaveActions | null = null;
    private session: RuntimePluginStorySession | null = null;
    private sceneIdByScene = new Map<Scene, string>();
    private unsubscribePersistence: (() => void) | null = null;

    private engineSnapshot: { scene: RuntimePluginStateSnapshot; saved: RuntimePluginStateSnapshot } = {
        scene: new Map(),
        saved: new Map(),
    };
    private persistentSnapshot: RuntimePluginStateSnapshot = new Map();
    private pumping = false;
    private pumpQueued = false;

    public constructor(private readonly shell: RuntimePluginShellBackends) {
        this.hub = new RuntimePluginEventHub((level, message) => this.log(level, message));
        this.host = this.buildHost();
    }

    // ---------------------------------------------------------------- lifecycle

    /**
     * The blueprint runtime is up: story variables and the player's language
     * become readable. Returns a detach function for the caller's effect cleanup.
     */
    public attachRuntime(attachment: RuntimePluginRuntimeAttachment): () => void {
        this.attachment = attachment;
        this.unsubscribePersistence?.();
        this.unsubscribePersistence = attachment.scope.subscribePersistence(() => {
            this.pumpPersistentState();
            this.emitLocaleIfChanged();
        });
        this.persistentSnapshot = snapshotPersistentScope(this.session, attachment.scope);
        this.lastLocale = this.readLocale();
        return () => {
            if (this.attachment !== attachment) {
                return;
            }
            this.unsubscribePersistence?.();
            this.unsubscribePersistence = null;
            this.attachment = null;
            this.persistentSnapshot = new Map();
        };
    }

    /**
     * A NarraLeaf environment is live. Called from the game app's
     * `onLiveGameReady`, so it runs again for every relaunch and hot reload;
     * plugin listeners registered at setup keep working across all of them.
     */
    public attachSession(attachment: RuntimePluginSessionAttachment): void {
        this.detachSession();
        const bundle = this.attachment?.bundle;
        if (!bundle) {
            // No blueprint runtime means no bundle to read declaration tables
            // from; the engine events below still work, state does not.
            this.log("warning", "runtime plugin host: game session attached before the blueprint runtime");
        }
        const { liveGame, compiled } = attachment;
        this.session = {
            liveGame,
            compiled,
            tables: bundle
                ? buildRuntimePluginVariableTables(bundle, compiled.storyId)
                : { scene: {}, saved: new Map(), persistent: new Map() },
            activeSceneId: null,
        };
        this.sceneIdByScene = new Map(
            Object.entries(compiled.scenes).map(([sceneId, scene]) => [scene, sceneId] as const),
        );
        this.bindEngineEvents(liveGame);
        this.engineSnapshot = snapshotEngineScopes(this.session);
        this.persistentSnapshot = snapshotPersistentScope(this.session, this.attachment?.scope ?? null);
    }

    public detachSession(): void {
        for (const token of this.sessionTokens.splice(0)) {
            try {
                token.cancel();
            } catch {
                // A session already torn down by the engine; nothing to undo.
            }
        }
        this.session = null;
        this.sceneIdByScene = new Map();
        this.engineSnapshot = { scene: new Map(), saved: new Map() };
    }

    /**
     * Publish the game app's save paths. Held outside the session attachment
     * because they stay valid across relaunches (they resolve the live game per
     * call), and dropped on unmount so a plugin cannot save into a dead tree.
     */
    public attachSaveActions(actions: RuntimePluginSaveActions): () => void {
        this.saveActions = actions;
        return () => {
            if (this.saveActions === actions) {
                this.saveActions = null;
            }
        };
    }

    /** The game wrote a save. Host-side, so it is reported the same on every shell. */
    public emitSaveWritten(id: string): void {
        this.hub.emit("saveWritten", { id });
    }

    /** Wire the shell-owned event sources. Call once, from the shell. */
    public bindShellEvents(): () => void {
        const tokens: Array<() => void> = [];
        if (this.shell.subscribeFullscreenChanged) {
            tokens.push(this.shell.subscribeFullscreenChanged(isFullscreen => {
                this.hub.emit("fullscreenChanged", isFullscreen === true);
            }));
        }
        if (this.shell.subscribeCloseRequested) {
            tokens.push(this.shell.subscribeCloseRequested(() => {
                this.hub.emit("closeRequested", undefined);
            }));
        }
        return () => {
            for (const dispose of tokens.splice(0)) {
                dispose();
            }
        };
    }

    // ------------------------------------------------------------ engine wiring

    private bindEngineEvents(liveGame: LiveGame): void {
        const game: Game = liveGame.game;
        const push = (token: EngineToken | null | undefined): void => {
            if (token) {
                this.sessionTokens.push(token);
            }
        };

        // Replayed by the engine: a plugin that subscribes after the fact still
        // hears about it, so there is no cache to keep here.
        push(game.onPreloadComplete(() => this.hub.emit("preloadComplete", undefined)));
        push(game.onFirstSceneReady(() => this.hub.emit("firstSceneReady", undefined)));

        push(liveGame.onMenuChoose((payload: unknown) => {
            this.hub.emit("choiceMade", { text: readText(payload) });
        }));
        push(liveGame.onCharacterPrompt((payload: unknown) => {
            const record = payload as { character?: unknown } | null | undefined;
            this.hub.emit("characterPrompt", {
                character: readNlrCharacterName(record?.character),
                text: readText(payload),
            });
        }));
        push(liveGame.onCurrentActionChange(() => this.pumpEngineState()));

        push(game.hooks.hook("beforeRestore", () => {
            this.hub.emit("beforeRestore", undefined);
        }));
        push(game.hooks.hook("afterRestore", () => {
            this.hub.emit("afterRestore", undefined);
            // A restore rewrites every variable at once; re-baseline and report.
            this.pumpEngineState();
            this.pumpPersistentState();
        }));

        const gameState = liveGame.getGameState();
        if (!gameState) {
            return;
        }
        push(gameState.events.on("event:state.scene.mount", (scene: Scene) => {
            const sceneId = this.sceneIdByScene.get(scene) ?? null;
            if (this.session) {
                this.session.activeSceneId = sceneId;
                // A new scene brings a fresh scene-local namespace; re-baseline
                // rather than reporting the whole table as "changed".
                this.engineSnapshot = snapshotEngineScopes(this.session);
            }
            this.hub.emit("sceneEnter", { sceneId });
        }));
        push(gameState.events.on("event:state.scene.unmount", (scene: Scene) => {
            const sceneId = this.sceneIdByScene.get(scene) ?? null;
            this.hub.emit("sceneExit", { sceneId });
            if (this.session && this.session.activeSceneId === sceneId) {
                this.session.activeSceneId = null;
                this.engineSnapshot = snapshotEngineScopes(this.session);
            }
        }));
        push(gameState.events.on("event:state.player.lineEnd", () => {
            this.hub.emit("dialogueEnd", undefined);
            this.pumpEngineState();
        }));
        push(gameState.events.on("event:state.end", () => this.hub.emit("gameEnd", undefined)));
    }

    // ------------------------------------------------------------------- state

    /**
     * Recompute the engine-backed scopes and report what moved.
     *
     * The engine has no per-variable change event yet — `Namespace.set` is a
     * plain assignment — so this runs at the points where a story CAN have
     * written a variable: every action boundary, every finished line, a scene
     * change, a restore, and a plugin's own `set`. That is event-driven, not a
     * timer: nothing here fires while the game is idle. When the engine grows a
     * real change event, replace the pump with a subscription and delete the
     * snapshots; `onChange`'s contract does not change.
     */
    private pumpEngineState(): void {
        if (this.stateListeners.size === 0) {
            // Nobody is listening, so there is nothing to diff against and no
            // reason to walk the tables on every action; `onChange` takes its
            // own baseline the moment a listener registers.
            return;
        }
        if (this.pumping) {
            this.pumpQueued = true;
            return;
        }
        this.pumping = true;
        try {
            do {
                this.pumpQueued = false;
                const next = snapshotEngineScopes(this.session);
                const changes = [
                    ...diffStateSnapshots("scene", this.engineSnapshot.scene, next.scene),
                    ...diffStateSnapshots("saved", this.engineSnapshot.saved, next.saved),
                ];
                this.engineSnapshot = next;
                this.emitStateChanges(changes);
            } while (this.pumpQueued);
        } finally {
            this.pumping = false;
        }
    }

    /** Persistent values have a real subscription, so this half is exact. */
    private pumpPersistentState(): void {
        if (this.stateListeners.size === 0) {
            return;
        }
        const scope = this.attachment?.scope ?? null;
        const next = snapshotPersistentScope(this.session, scope);
        const changes = diffStateSnapshots("persistent", this.persistentSnapshot, next);
        this.persistentSnapshot = next;
        this.emitStateChanges(changes);
    }

    private emitStateChanges(changes: RuntimePluginStateChange[]): void {
        if (changes.length === 0) {
            return;
        }
        for (const listener of Array.from(this.stateListeners)) {
            for (const change of changes) {
                try {
                    listener(change);
                } catch (error) {
                    this.log("error", `runtime plugin state listener failed: ${describeError(error)}`);
                }
            }
        }
    }

    // ------------------------------------------------------------------ locale

    private lastLocale = "";

    private readLocale(): string {
        const attachment = this.attachment;
        if (!attachment) {
            return "";
        }
        const stored = attachment.scope.persistenceGet(LOCALE_STORAGE_KEY);
        if (typeof stored === "string" && stored) {
            return stored;
        }
        return attachment.bundle.localization?.sourceLocale ?? "";
    }

    private readonly localeListeners = new Set<(locale: string) => void>();

    private emitLocaleIfChanged(): void {
        const next = this.readLocale();
        if (next === this.lastLocale) {
            return;
        }
        this.lastLocale = next;
        for (const listener of Array.from(this.localeListeners)) {
            try {
                listener(next);
            } catch (error) {
                this.log("error", `runtime plugin locale listener failed: ${describeError(error)}`);
            }
        }
    }

    // -------------------------------------------------------------------- host

    private buildHost(): RuntimePluginHost {
        const host: RuntimePluginHost = {
            events: {
                on: (event, listener) => this.hub.on(event, listener),
                supports: event => this.supportsEvent(event),
            },
            state: {
                get: (scope: RuntimePluginStateScope, key: string) =>
                    readRuntimePluginVariable(this.session, scope, key, this.attachment?.scope ?? null),
                set: (scope: RuntimePluginStateScope, key: string, value: unknown) => {
                    const written = writeRuntimePluginVariable(
                        this.session,
                        scope,
                        key,
                        value,
                        this.attachment?.scope ?? null,
                    );
                    if (!written) {
                        this.log("warning", `runtime plugin state.set ignored: no "${scope}" variable named "${key}"`);
                        return;
                    }
                    // Report the plugin's own write immediately; the persistent
                    // scope reports itself through the bridge subscription.
                    if (scope !== "persistent") {
                        this.pumpEngineState();
                    }
                },
                onChange: listener => {
                    this.stateListeners.add(listener);
                    // Baseline now so the first diff is against what the plugin
                    // could already read, not against an empty table.
                    this.engineSnapshot = snapshotEngineScopes(this.session);
                    this.persistentSnapshot = snapshotPersistentScope(this.session, this.attachment?.scope ?? null);
                    return () => {
                        this.stateListeners.delete(listener);
                    };
                },
            },
            overlay: {
                mount: (ownerPluginId, render) => this.overlays.mount(ownerPluginId, render),
            },
            locale: {
                current: () => this.readLocale(),
                onChange: listener => {
                    this.localeListeners.add(listener);
                    return () => {
                        this.localeListeners.delete(listener);
                    };
                },
            },
        };

        const persistence = this.shell.persistence;
        if (persistence) {
            host.store = {
                get: key => persistence.getValue(key),
                set: (key, value) => persistence.setValue(key, value),
                remove: key => persistence.removeValue(key),
                keys: async () => Object.keys(await persistence.getAll()),
            };
        }
        const saves = this.shell.saves;
        if (saves) {
            host.saves = {
                listIds: () => saves.listIds(),
                readMetadata: id => saves.readMetadata(id),
                // `async` so a missing game app surfaces as a rejected promise,
                // not a synchronous throw a `.catch()` caller would miss.
                ...(saves.writable
                    ? {
                        write: async (id: string, metadata?: unknown) =>
                            this.requireSaveActions("Save Game").write(id, metadata),
                        load: async (id: string) => this.requireSaveActions("Load Save").load(id),
                    }
                    : {}),
            };
        }
        const assetUrl = this.shell.assetUrl;
        if (assetUrl) {
            host.assets = { url: assetId => assetUrl(assetId) };
        }
        if (this.shell.sidecar) {
            host.sidecar = this.shell.sidecar;
        }
        return host;
    }

    /**
     * Rejects rather than queues when no game app is mounted.
     *
     * Queuing would be worse than it looks: a save is a snapshot of a moment,
     * and a `write` held until the next game app would serialize a different
     * playthrough than the one the plugin meant — silently, under the id the
     * player will later load. Failing loudly is recoverable; a wrong save is
     * not. The same argument covers `load`, which has nothing to deserialize
     * into. Plugins are told to check `saves.write` for the capability, not for
     * "is a game running right now", so this stays an ordinary rejected promise
     * they can catch (the built-in Quick Save nodes do exactly that).
     */
    private requireSaveActions(operation: string): RuntimePluginSaveActions {
        const actions = this.saveActions;
        if (!actions) {
            throw new Error(`${operation}: no game is running`);
        }
        return actions;
    }

    private supportsEvent(event: EventKey): boolean {
        if (event === "fullscreenChanged") {
            return Boolean(this.shell.subscribeFullscreenChanged);
        }
        if (event === "closeRequested") {
            return Boolean(this.shell.subscribeCloseRequested);
        }
        if (event === "saveWritten") {
            return true;
        }
        return ENGINE_EVENTS.includes(event);
    }

    private log(level: RuntimePluginLogLevel, message: string): void {
        this.shell.log?.(level, message);
    }
}

function readText(payload: unknown): string {
    const text = (payload as { text?: unknown } | null | undefined)?.text;
    if (typeof text === "string") {
        return text;
    }
    return text == null ? "" : String(text);
}
