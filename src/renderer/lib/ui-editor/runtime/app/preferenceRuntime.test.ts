import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAYER_PREFERENCES, normalizePlayerPreferences } from "@shared/types/preference";
import {
    PLAYER_PREFERENCES_PERSISTENCE_KEY,
    attachPlayerPreferences,
    readPersistedPlayerPreferences,
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
        expect(value).toEqual({ ...DEFAULT_PLAYER_PREFERENCES, cps: 33 });
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
