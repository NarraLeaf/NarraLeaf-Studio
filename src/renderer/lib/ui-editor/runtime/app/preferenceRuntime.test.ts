import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAYER_PREFERENCES, normalizePlayerPreferences } from "@shared/types/preference";
import { AUDIO_BUS_VOLUMES_PERSISTENCE_KEY } from "./audioBusRuntime";
import {
    PLAYER_PREFERENCES_PERSISTENCE_KEY,
    attachPlayerPreferences,
    createDetachedPlayerPreferences,
    readPersistedPlayerPreferences,
    startPlaythroughPreferences,
    type PreferenceStoreLike,
} from "./preferenceRuntime";

/** A stand-in for the engine's `Preference`: a keyed map with a change event. */
function fakePreferenceStore(initial: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = { ...initial };
    const listeners = new Set<(key: string, value: unknown) => void>();
    const store: PreferenceStoreLike & {
        set: (key: string, value: unknown) => void;
        values: Record<string, unknown>;
    } = {
        values,
        getPreferences: () => ({ ...values }),
        importPreferences: incoming => {
            for (const [key, value] of Object.entries(incoming)) {
                values[key] = value;
                listeners.forEach(listener => listener(key, value));
            }
        },
        onPreferenceChange: listener => {
            listeners.add(listener);
            return { cancel: () => listeners.delete(listener) };
        },
        set: (key, value) => {
            values[key] = value;
            listeners.forEach(listener => listener(key, value));
        },
    };
    return store;
}

describe("readPersistedPlayerPreferences", () => {
    // Sparse on purpose: an absent key has to mean "the author's default still applies", or raising
    // a starting value would never reach a player who has been in the settings screen once.
    it("keeps only the keys that were actually stored", () => {
        expect(readPersistedPlayerPreferences({ cps: 30 })).toEqual({ cps: 30 });
    });

    it("normalizes what it does keep", () => {
        expect(readPersistedPlayerPreferences({ bgmVolume: 12, voiceEndMode: "nope" }))
            .toEqual({ bgmVolume: 1, voiceEndMode: "stop" });
    });

    it("ignores keys it has never heard of, and unusable shapes", () => {
        expect(readPersistedPlayerPreferences({ warpFactor: 9 })).toEqual({});
        expect(readPersistedPlayerPreferences(null)).toEqual({});
        expect(readPersistedPlayerPreferences([1, 2])).toEqual({});
        expect(readPersistedPlayerPreferences("cps=30")).toEqual({});
    });

    // Stores written before the hide stopped being kept still carry the last one a player left on.
    it("skips a stored hide of the dialogue box", () => {
        expect(readPersistedPlayerPreferences({ showDialog: false, cps: 30 })).toEqual({ cps: 30 });
    });
});

describe("attachPlayerPreferences", () => {
    it("applies the authored defaults to a store with nothing saved", async () => {
        const preference = fakePreferenceStore();
        await attachPlayerPreferences({
            preference,
            defaults: normalizePlayerPreferences({ cps: 40, skipReadText: true }),
            read: async () => undefined,
            write: async () => undefined,
        });
        expect(preference.values.cps).toBe(40);
        expect(preference.values.skipReadText).toBe(true);
        expect(preference.values.bgmVolume).toBe(DEFAULT_PLAYER_PREFERENCES.bgmVolume);
    });

    it("lets what the player saved win over the authored default", async () => {
        const preference = fakePreferenceStore();
        await attachPlayerPreferences({
            preference,
            defaults: normalizePlayerPreferences({ cps: 40, bgmVolume: 0.5 }),
            read: async () => ({ cps: 12 }),
            write: async () => undefined,
        });
        expect(preference.values.cps).toBe(12);
        // Untouched by the player, so the author's number is what they get.
        expect(preference.values.bgmVolume).toBe(0.5);
    });

    it("writes nothing while restoring", async () => {
        const write = vi.fn();
        const preference = fakePreferenceStore();
        await attachPlayerPreferences({
            preference,
            defaults: normalizePlayerPreferences({ cps: 40 }),
            read: async () => ({ cps: 12 }),
            write,
        });
        expect(write).not.toHaveBeenCalled();
    });

    it("persists the whole known set after a change", async () => {
        const write = vi.fn();
        const preference = fakePreferenceStore();
        await attachPlayerPreferences({
            preference,
            read: async () => undefined,
            write,
        });
        preference.set("cps", 33);
        expect(write).toHaveBeenCalledTimes(1);
        const [key, value] = write.mock.calls[0];
        expect(key).toBe(PLAYER_PREFERENCES_PERSISTENCE_KEY);
        const { showDialog: _notKept, ...kept } = DEFAULT_PLAYER_PREFERENCES;
        expect(value).toEqual({ ...kept, cps: 33 });
    });

    it("neither restores nor keeps a hidden dialogue box", async () => {
        const write = vi.fn();
        const preference = fakePreferenceStore();
        await attachPlayerPreferences({
            preference,
            read: async () => ({ showDialog: false }),
            write,
        });
        expect(preference.values.showDialog).toBe(true);
        preference.set("showDialog", false);
        expect(write).not.toHaveBeenCalled();
    });

    it("ignores a change to something that is not a preference of ours", async () => {
        const write = vi.fn();
        const preference = fakePreferenceStore();
        await attachPlayerPreferences({ preference, read: async () => undefined, write });
        preference.set("someEngineOnlyKey", 1);
        expect(write).not.toHaveBeenCalled();
    });

    it("stops writing once disposed", async () => {
        const write = vi.fn();
        const preference = fakePreferenceStore();
        const dispose = await attachPlayerPreferences({ preference, read: async () => undefined, write });
        dispose();
        preference.set("cps", 33);
        expect(write).not.toHaveBeenCalled();
    });

    // An unreadable store is a player who starts at the author's defaults, not a game that fails
    // to boot: this runs on the path to the first painted frame.
    it("still applies the defaults when the store cannot be read", async () => {
        const preference = fakePreferenceStore();
        const log = vi.fn();
        await attachPlayerPreferences({
            preference,
            defaults: normalizePlayerPreferences({ cps: 40 }),
            read: async () => { throw new Error("store offline"); },
            write: async () => undefined,
            log,
        });
        expect(preference.values.cps).toBe(40);
        expect(log).toHaveBeenCalledWith("warning", expect.stringContaining("store offline"));
    });

    // `autoForwardDelay` is game config in the engine, not a preference, so a value in the store
    // paces nothing until it is copied across. These two are that copy.
    it("applies the auto forward wait to the engine at boot", async () => {
        const preference = fakePreferenceStore();
        const configureEngine = vi.fn();
        await attachPlayerPreferences({
            preference,
            defaults: normalizePlayerPreferences({ autoForwardDelay: 1200 }),
            read: async () => ({ autoForwardDelay: 800 }),
            write: async () => undefined,
            configureEngine,
        });
        // The player's stored value, not the author's default: the same precedence every other
        // preference has.
        expect(configureEngine).toHaveBeenLastCalledWith({ autoForwardDelay: 800 });
    });

    it("re-applies it whenever it changes", async () => {
        const preference = fakePreferenceStore();
        const configureEngine = vi.fn();
        await attachPlayerPreferences({
            preference,
            read: async () => undefined,
            write: async () => undefined,
            configureEngine,
        });
        configureEngine.mockClear();
        preference.set("autoForwardDelay", 2500);
        expect(configureEngine).toHaveBeenCalledWith({ autoForwardDelay: 2500 });
        // A change to anything else costs nothing.
        configureEngine.mockClear();
        preference.set("cps", 33);
        expect(configureEngine).not.toHaveBeenCalled();
    });

    it("is a no-op against an engine build with no preference store", async () => {
        const dispose = await attachPlayerPreferences({
            preference: undefined,
            read: async () => undefined,
            write: async () => undefined,
        });
        expect(() => dispose()).not.toThrow();
    });
});

describe("startPlaythroughPreferences", () => {
    it("brings back a box the last playthrough left hidden", () => {
        const preference = fakePreferenceStore({ ...DEFAULT_PLAYER_PREFERENCES, showDialog: false });
        startPlaythroughPreferences(preference);
        expect(preference.values.showDialog).toBe(true);
    });

    // The author's value is the state a game starts in, which is what the Player defaults row says.
    it("starts the box the way the author set it", () => {
        const preference = fakePreferenceStore({ ...DEFAULT_PLAYER_PREFERENCES });
        startPlaythroughPreferences(preference, normalizePlayerPreferences({ showDialog: false }));
        expect(preference.values.showDialog).toBe(false);
    });

    it("leaves every other preference alone", () => {
        const preference = fakePreferenceStore({ ...DEFAULT_PLAYER_PREFERENCES, cps: 33, showDialog: false });
        startPlaythroughPreferences(preference, normalizePlayerPreferences({ cps: 40 }));
        expect(preference.values.cps).toBe(33);
    });

    it("announces nothing when the game already agrees", () => {
        const preference = fakePreferenceStore({ ...DEFAULT_PLAYER_PREFERENCES });
        const heard = vi.fn();
        preference.onPreferenceChange(heard);
        startPlaythroughPreferences(preference);
        expect(heard).not.toHaveBeenCalled();
    });

    it("is a no-op against an engine build with no preference store", () => {
        expect(() => startPlaythroughPreferences(undefined)).not.toThrow();
    });
});

/** A synchronous key-value store standing in for the window's copy of scope persistence. */
function memoryStore(initial: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = { ...initial };
    return {
        values,
        read: (key: string) => values[key],
        write: vi.fn(async (key: string, value: unknown) => {
            values[key] = value;
        }),
    };
}

describe("createDetachedPlayerPreferences", () => {
    // What a settings screen opened from the title reads: the value a game started now would hold.
    it("reads the player's stored choice over the author's default, and the default where none is stored", () => {
        const store = memoryStore({ [PLAYER_PREFERENCES_PERSISTENCE_KEY]: { cps: 42, skipReadText: true } });
        const kept = createDetachedPlayerPreferences({
            getDefaults: () => ({ ...DEFAULT_PLAYER_PREFERENCES, cps: 20, autoForwardDelay: 1800 }),
            read: store.read,
            write: store.write,
        });

        expect(kept.get("cps")).toBe(42);
        expect(kept.get("skipReadText")).toBe(true);
        expect(kept.get("autoForwardDelay")).toBe(1800);
        expect(kept.get("gameSpeed")).toBe(DEFAULT_PLAYER_PREFERENCES.gameSpeed);
    });

    it("falls back to the engine's defaults when the bundle carries none", () => {
        const store = memoryStore();
        const kept = createDetachedPlayerPreferences({ getDefaults: () => undefined, read: store.read, write: store.write });
        expect(kept.get("autoForwardDelay")).toBe(DEFAULT_PLAYER_PREFERENCES.autoForwardDelay);
    });

    // The boot path restores the bus map after the preference map, so for the three bus-backed
    // volumes the bus map is what a game starts with - and what the title screen has to show.
    it("answers a bus-backed volume from the bus map, which the boot path restores last", () => {
        const store = memoryStore({
            [PLAYER_PREFERENCES_PERSISTENCE_KEY]: { bgmVolume: 0.9, globalVolume: 0.7 },
            [AUDIO_BUS_VOLUMES_PERSISTENCE_KEY]: { bgm: 0.3 },
        });
        const kept = createDetachedPlayerPreferences({ getDefaults: () => undefined, read: store.read, write: store.write });
        expect(kept.get("bgmVolume")).toBe(0.3);
        expect(kept.get("globalVolume")).toBe(0.7);
    });

    // Sparse, like the boot path reads it: freezing every author default into the store would stop
    // a later change to a default from reaching this player.
    it("writes only the preference that moved on top of what is stored", async () => {
        const store = memoryStore({ [PLAYER_PREFERENCES_PERSISTENCE_KEY]: { cps: 42 } });
        const kept = createDetachedPlayerPreferences({ getDefaults: () => undefined, read: store.read, write: store.write });

        await kept.set("autoForwardDelay", 1200);

        expect(store.values[PLAYER_PREFERENCES_PERSISTENCE_KEY]).toEqual({ cps: 42, autoForwardDelay: 1200 });
        expect(store.values[AUDIO_BUS_VOLUMES_PERSISTENCE_KEY]).toBeUndefined();
    });

    it("normalises what it writes, as the boot path would on reading it", async () => {
        const store = memoryStore();
        const kept = createDetachedPlayerPreferences({ getDefaults: () => undefined, read: store.read, write: store.write });
        await kept.set("bgmVolume", 7);
        expect(store.values[PLAYER_PREFERENCES_PERSISTENCE_KEY]).toEqual({ bgmVolume: 1 });
    });

    it("writes a bus-backed volume to the bus map as well, so an older bus value cannot win at boot", async () => {
        const store = memoryStore({ [AUDIO_BUS_VOLUMES_PERSISTENCE_KEY]: { bgm: 0.3, "voice/narrator": 0.5 } });
        const kept = createDetachedPlayerPreferences({ getDefaults: () => undefined, read: store.read, write: store.write });

        await kept.set("bgmVolume", 0.8);

        expect(store.values[PLAYER_PREFERENCES_PERSISTENCE_KEY]).toEqual({ bgmVolume: 0.8 });
        expect(store.values[AUDIO_BUS_VOLUMES_PERSISTENCE_KEY]).toEqual({ bgm: 0.8, "voice/narrator": 0.5 });
        expect(kept.get("bgmVolume")).toBe(0.8);
    });

    it("hands a write to a game that is still mounting, which has already restored the old value", async () => {
        const store = memoryStore();
        const booting = fakePreferenceStore({ ...DEFAULT_PLAYER_PREFERENCES });
        const kept = createDetachedPlayerPreferences({
            getDefaults: () => undefined,
            read: store.read,
            write: store.write,
            getBootingStore: () => booting,
        });

        await kept.set("cps", 33);

        expect(booting.values.cps).toBe(33);
    });

    it("announces a change, and stays quiet for a write that changes nothing", async () => {
        const store = memoryStore({ [PLAYER_PREFERENCES_PERSISTENCE_KEY]: { cps: 30 } });
        const onChange = vi.fn();
        const kept = createDetachedPlayerPreferences({ getDefaults: () => undefined, read: store.read, write: store.write, onChange });

        await kept.set("cps", 30);
        expect(onChange).not.toHaveBeenCalled();
        await kept.set("cps", 45);
        expect(onChange).toHaveBeenCalledWith("cps", 45, 30);
    });

    // A playthrough preference describes a game on screen; with none there is nothing to keep.
    it("reads the box's starting state but keeps no write to it", async () => {
        const store = memoryStore();
        const kept = createDetachedPlayerPreferences({
            getDefaults: () => ({ ...DEFAULT_PLAYER_PREFERENCES, showDialog: false }),
            read: store.read,
            write: store.write,
        });

        expect(kept.canRead("showDialog")).toBe(true);
        expect(kept.canWrite("showDialog")).toBe(false);
        expect(kept.get("showDialog")).toBe(false);
        await kept.set("showDialog", true);
        expect(store.write).not.toHaveBeenCalled();
        expect(kept.canRead("skipping")).toBe(false);
    });

    // The round trip both ways through the one store the boot path uses.
    it("is what a game starts with, and reads back what a game wrote", async () => {
        const store = memoryStore();
        const kept = createDetachedPlayerPreferences({ getDefaults: () => undefined, read: store.read, write: store.write });
        await kept.set("cps", 36);
        await kept.set("autoForwardDelay", 900);

        const game = fakePreferenceStore();
        const configureEngine = vi.fn();
        await attachPlayerPreferences({ preference: game, read: store.read, write: store.write, configureEngine });
        expect(game.values.cps).toBe(36);
        expect(configureEngine).toHaveBeenLastCalledWith({ autoForwardDelay: 900 });

        game.set("skipReadText", true);
        expect(kept.get("skipReadText")).toBe(true);
        expect(kept.get("cps")).toBe(36);
    });
});
