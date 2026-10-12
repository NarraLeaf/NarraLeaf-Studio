/**
 * The preference nodes on a settings screen opened from the title, before any game runs.
 *
 * Every `Get`/`Set` preference node asks the host for the live game's preference store, and there is
 * none until a story starts - so such a screen used to refuse every row with "needs a running game"
 * and show the node defaults, while the volume sliders next to them looked fine. What is pinned here
 * is the whole path a player takes: a getter on the title answers the kept value, a setter on the
 * title keeps it, the game that starts next plays with it, and a value moved in game reads back on
 * the title. Inside a running game the live store still answers, exactly as before.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it, vi } from "vitest";
import type { LiveGame } from "narraleaf-react";
import {
    BLUEPRINT_NODE_TYPE_GAME_GET_AUTO_FORWARD_DELAY,
    BLUEPRINT_NODE_TYPE_GAME_GET_BGM_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_GET_SENTENCE_SPEED,
    BLUEPRINT_NODE_TYPE_GAME_GET_SKIPPING,
    BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_READ_TEXT,
    BLUEPRINT_NODE_TYPE_GAME_IS_DIALOG_SHOWN,
    BLUEPRINT_NODE_TYPE_GAME_SET_AUTO_FORWARD_DELAY,
    BLUEPRINT_NODE_TYPE_GAME_SET_BGM_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED,
    BLUEPRINT_NODE_TYPE_GAME_SET_SKIPPING,
    BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_READ_TEXT,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import { DEFAULT_PLAYER_PREFERENCES, type PlayerPreferences } from "@shared/types/preference";
import { executeGraph } from "@/lib/ui-editor/behavior-graph/GraphExecutor";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { AUDIO_BUS_VOLUMES_PERSISTENCE_KEY, attachAudioBusPersistence } from "./audioBusRuntime";
import { createChoiceMenus } from "./choiceMenus";
import { createDialogClickTargets } from "./dialogClickTargets";
import { createLiveGameUiCallbacks } from "./gameUiSlots";
import {
    PLAYER_PREFERENCES_PERSISTENCE_KEY,
    attachPlayerPreferences,
    createDetachedPlayerPreferences,
    type PreferenceStoreLike,
} from "./preferenceRuntime";
import { needsRunningGame } from "./runtimeRefusals";

/** A stand-in for the engine's `Preference`: a keyed map with a change event. */
function fakePreferenceStore(initial: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = { ...initial };
    const listeners = new Set<(key: string, value: unknown) => void>();
    const store: PreferenceStoreLike & {
        getPreference: (key: string) => unknown;
        setPreference: (key: string, value: unknown) => void;
        values: Record<string, unknown>;
    } = {
        values,
        getPreferences: () => ({ ...values }),
        getPreference: key => values[key],
        importPreferences: incoming => {
            for (const [key, value] of Object.entries(incoming)) {
                values[key] = value;
                listeners.forEach(listener => listener(key, value));
            }
        },
        setPreference: (key, value) => {
            values[key] = value;
            listeners.forEach(listener => listener(key, value));
        },
        onPreferenceChange: listener => {
            listeners.add(listener);
            return { cancel: () => listeners.delete(listener) };
        },
    };
    return store;
}

/** A stand-in for `game.audioBuses`, where the three seeded buses are the bus-backed volumes. */
function fakeMixer() {
    const volumes: Record<string, number> = {};
    return {
        volumes,
        setVolumes: (incoming: Readonly<Record<string, number>>) => Object.assign(volumes, incoming),
        getVolumes: () => ({ ...volumes }),
        onVolumeChange: () => ({ cancel: () => undefined }),
    };
}

const AUTHORED: PlayerPreferences = { ...DEFAULT_PLAYER_PREFERENCES, cps: 20, autoForwardDelay: 2500 };

/**
 * A Game App as far as the preference nodes can see it: the window's persistent store, a slot for
 * the live game, and the host callbacks built the way `GameApp` builds them.
 */
function createGameAppPreferences(options: { keepsPreferences?: boolean } = {}) {
    const scope = new ScopeStoreBridge();
    const live: { current: LiveGame | null } = { current: null };
    const booting: { current: PreferenceStoreLike | null } = { current: null };
    const changes: Array<{ key: string; value: unknown; previousValue: unknown }> = [];
    const detachedPreferences = createDetachedPlayerPreferences({
        getDefaults: () => AUTHORED,
        getBootingStore: () => booting.current,
        read: key => scope.persistenceGet(key),
        write: (key, value) => scope.persistenceSet(key, value),
        onChange: (key, value, previousValue) => changes.push({ key, value, previousValue }),
    });
    const callbacks = createLiveGameUiCallbacks({
        requireLiveGame: asker => {
            if (!live.current) {
                throw needsRunningGame(asker);
            }
            return live.current;
        },
        getLiveGame: () => live.current,
        choiceMenus: createChoiceMenus(),
        currentDialogNametagRef: { current: null },
        dialogClickTargets: createDialogClickTargets(),
        ...(options.keepsPreferences === false ? {} : { detachedPreferences }),
    });
    const hostAdapter = {
        host: "player",
        blueprintRuntime: {
            surfaceId: "config",
            hostApi: {
                game: {
                    getPreference: callbacks.onGetGamePreference,
                    setPreference: callbacks.onSetGamePreference,
                    setSentenceSpeed: callbacks.onSetSentenceSpeed,
                },
            },
        },
    } as unknown as UIHostAdapter;

    /** Start a game the way `mountNlrSession` does, and publish it as the live game. */
    const startGame = async () => {
        const store = fakePreferenceStore();
        const mixer = fakeMixer();
        const configureEngine = vi.fn();
        await attachPlayerPreferences({
            preference: store,
            defaults: AUTHORED,
            read: key => scope.persistenceGetAsync(key),
            write: (key, value) => scope.persistenceSet(key, value),
            configureEngine,
        });
        await attachAudioBusPersistence({
            mixer,
            read: key => scope.persistenceGetAsync(key),
            write: (key, value) => scope.persistenceSet(key, value),
        });
        live.current = { game: { preference: store } } as unknown as LiveGame;
        return { store, mixer, configureEngine };
    };

    return { scope, live, booting, changes, hostAdapter, startGame, callbacks };
}

/** Run one getter node and return what its output pin carried. */
async function readNode(hostAdapter: UIHostAdapter, type: string, pinId: string): Promise<unknown> {
    const blueprintLocals: Record<string, unknown> = {};
    await executeGraph({
        graph: {
            id: `read-${pinId}`,
            entries: { main: { start: { nodeId: "capture", port: "in" } } },
            nodes: {
                getter: { id: "getter", type, params: {} },
                capture: { id: "capture", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "value" } },
            },
            edges: [{ from: { nodeId: "getter", port: pinId }, to: { nodeId: "capture", port: "value" } }],
        },
        entry: { start: { nodeId: "capture", port: "in" } },
        hostAdapter,
        blueprintLocals,
    });
    return blueprintLocals.value;
}

/** Run one setter node with its value pin given inline. */
async function writeNode(hostAdapter: UIHostAdapter, type: string, pinId: string, value: unknown): Promise<void> {
    await executeGraph({
        graph: {
            id: `write-${pinId}`,
            entries: { main: { start: { nodeId: "setter", port: "in" } } },
            nodes: { setter: { id: "setter", type, params: { [pinId]: value } } },
            edges: [],
        },
        entry: { start: { nodeId: "setter", port: "in" } },
        hostAdapter,
    });
}

describe("preference nodes before a game runs", () => {
    it("read the persisted value rather than refusing", async () => {
        const app = createGameAppPreferences();
        await app.scope.persistenceSet(PLAYER_PREFERENCES_PERSISTENCE_KEY, {
            cps: 42,
            autoForwardDelay: 1800,
            skipReadText: true,
        });

        expect(await readNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_GET_SENTENCE_SPEED, "cps")).toBe(42);
        expect(await readNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_GET_AUTO_FORWARD_DELAY, "autoForwardDelay")).toBe(1800);
        expect(await readNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_READ_TEXT, "skipReadText")).toBe(true);
    });

    it("read the author's default for a preference the player has never moved", async () => {
        const app = createGameAppPreferences();
        expect(await readNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_GET_SENTENCE_SPEED, "cps")).toBe(20);
        expect(await readNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_GET_AUTO_FORWARD_DELAY, "autoForwardDelay")).toBe(2500);
        expect(await readNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_IS_DIALOG_SHOWN, "isShown")).toBe(true);
        // A run that has not started is not skipping.
        expect(await readNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_GET_SKIPPING, "skipping")).toBe(false);
    });

    it("keep what they set, and the game that starts next plays with it", async () => {
        const app = createGameAppPreferences();

        await writeNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED, "cps", 35);
        await writeNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_SET_AUTO_FORWARD_DELAY, "autoForwardDelay", 1200);
        await writeNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_READ_TEXT, "skipReadText", true);
        await writeNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_SET_BGM_VOLUME, "bgmVolume", 0.4);

        expect(app.scope.persistenceGet(PLAYER_PREFERENCES_PERSISTENCE_KEY)).toEqual({
            cps: 35,
            autoForwardDelay: 1200,
            skipReadText: true,
            bgmVolume: 0.4,
        });
        // Read back on the same screen, before any game.
        expect(await readNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_GET_SENTENCE_SPEED, "cps")).toBe(35);
        expect(await readNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_GET_BGM_VOLUME, "bgmVolume")).toBe(0.4);
        expect(app.changes.map(change => change.key)).toEqual(["cps", "autoForwardDelay", "skipReadText", "bgmVolume"]);

        const { store, mixer, configureEngine } = await app.startGame();
        expect(store.values.cps).toBe(35);
        expect(store.values.skipReadText).toBe(true);
        expect(store.values.autoForwardDelay).toBe(1200);
        // The engine reads the auto-forward wait from its config, which is what actually paces lines.
        expect(configureEngine).toHaveBeenLastCalledWith({ autoForwardDelay: 1200 });
        // The bus map is restored after the preferences, so it must agree with the title's slider.
        expect(mixer.volumes.bgm).toBe(0.4);
    });

    it("reach a game that is still mounting behind the title", async () => {
        const app = createGameAppPreferences();
        const mounting = fakePreferenceStore({ ...AUTHORED });
        app.booting.current = mounting;

        await writeNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED, "cps", 28);

        expect(mounting.values.cps).toBe(28);
    });

    it("read back on the title what was changed in game", async () => {
        const app = createGameAppPreferences();
        const { store } = await app.startGame();

        store.setPreference("cps", 55);
        store.setPreference("autoForwardDelay", 4000);
        app.live.current = null;

        expect(await readNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_GET_SENTENCE_SPEED, "cps")).toBe(55);
        expect(await readNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_GET_AUTO_FORWARD_DELAY, "autoForwardDelay")).toBe(4000);
    });

    it("still refuse what only a game in progress can do", async () => {
        const app = createGameAppPreferences();
        await expect(writeNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_SET_SKIPPING, "skipping", true))
            .rejects.toThrow("This node needs a running game.");
    });

    it("refuse as before on a host that keeps nothing between games", async () => {
        const app = createGameAppPreferences({ keepsPreferences: false });
        await expect(readNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_GET_SENTENCE_SPEED, "cps"))
            .rejects.toThrow("This node needs a running game.");
        await expect(writeNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED, "cps", 30))
            .rejects.toThrow("“Set Sentence Speed” needs a running game.");
    });
});

describe("preference nodes inside a running game", () => {
    it("read and write the live store, not the kept one", async () => {
        const app = createGameAppPreferences();
        const { store } = await app.startGame();
        store.values.cps = 61;
        const persistenceSet = vi.spyOn(app.scope, "persistenceSet");

        expect(await readNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_GET_SENTENCE_SPEED, "cps")).toBe(61);

        await writeNode(app.hostAdapter, BLUEPRINT_NODE_TYPE_GAME_SET_AUTO_FORWARD_DELAY, "autoForwardDelay", 700);
        expect(store.values.autoForwardDelay).toBe(700);
        // Kept by the game's own subscription, as before: the whole known map, not a detached write.
        expect(persistenceSet).toHaveBeenCalledTimes(1);
        expect(persistenceSet.mock.calls[0][0]).toBe(PLAYER_PREFERENCES_PERSISTENCE_KEY);
        expect(app.changes).toEqual([]);
        expect(app.scope.persistenceGet(AUDIO_BUS_VOLUMES_PERSISTENCE_KEY)).toBeUndefined();
    });
});
