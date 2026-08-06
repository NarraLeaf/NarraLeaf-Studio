import { describe, expect, it } from "vitest";
import {
    DEFAULT_PLAYER_PREFERENCES,
    PLAYER_PREFERENCE_GROUPS,
    PLAYER_PREFERENCE_KEYS,
    PLAYER_PREFERENCE_SPECS,
    normalizePlayerPreference,
    normalizePlayerPreferences,
} from "./preference";

describe("player preference specs", () => {
    // The spec table is what the settings page renders, what the bundle bakes and what the runtime
    // applies. A key present in one of those lists and missing from another is a preference an
    // author can set and the game never reads.
    it("has a spec for every key, keyed by itself", () => {
        for (const key of PLAYER_PREFERENCE_KEYS) {
            expect(PLAYER_PREFERENCE_SPECS[key]?.key).toBe(key);
        }
        expect(Object.keys(PLAYER_PREFERENCE_SPECS).sort()).toEqual([...PLAYER_PREFERENCE_KEYS].sort());
    });

    it("shows every key exactly once across the groups", () => {
        const grouped = PLAYER_PREFERENCE_GROUPS.flatMap(group => group.keys);
        expect(grouped.slice().sort()).toEqual([...PLAYER_PREFERENCE_KEYS].sort());
    });

    // The defaults are quoted twice - once per spec, once as the complete set the bundle falls back
    // to - and a disagreement between them is a project that behaves one way in the editor and
    // another in the game.
    it("agrees with the complete default set", () => {
        for (const key of PLAYER_PREFERENCE_KEYS) {
            expect(DEFAULT_PLAYER_PREFERENCES[key]).toEqual(PLAYER_PREFERENCE_SPECS[key].defaultValue);
        }
    });

    it("keeps every numeric default inside its own range", () => {
        for (const key of PLAYER_PREFERENCE_KEYS) {
            const spec = PLAYER_PREFERENCE_SPECS[key];
            if (spec.kind !== "number") {
                continue;
            }
            expect(spec.defaultValue).toBeGreaterThanOrEqual(spec.min);
            expect(spec.defaultValue).toBeLessThanOrEqual(spec.max);
        }
    });

    // These three are divisors or pacing intervals in the engine; zero is a hang, not a slow game.
    it("refuses to let the pacing values reach zero", () => {
        for (const key of ["gameSpeed", "cps", "skipInterval"] as const) {
            const spec = PLAYER_PREFERENCE_SPECS[key];
            expect(spec.kind).toBe("number");
            expect(spec.kind === "number" && spec.min).toBeGreaterThan(0);
        }
    });
});

describe("normalizePlayerPreference", () => {
    it("keeps a usable value", () => {
        expect(normalizePlayerPreference("cps", 42)).toBe(42);
        expect(normalizePlayerPreference("skipReadText", true)).toBe(true);
        expect(normalizePlayerPreference("voiceEndMode", "fade")).toBe("fade");
    });

    it("clamps rather than rejecting an out-of-range number", () => {
        expect(normalizePlayerPreference("bgmVolume", 4)).toBe(1);
        expect(normalizePlayerPreference("bgmVolume", -1)).toBe(0);
        expect(normalizePlayerPreference("skipInterval", 0)).toBe(1);
    });

    it("falls back to the default for anything unreadable", () => {
        expect(normalizePlayerPreference("cps", "fast")).toBe(10);
        expect(normalizePlayerPreference("cps", Number.NaN)).toBe(10);
        expect(normalizePlayerPreference("skip", "yes")).toBe(true);
        expect(normalizePlayerPreference("voiceEndMode", "explode")).toBe("stop");
        expect(normalizePlayerPreference("autoForward", undefined)).toBe(false);
    });

    // A number typed as a string is what a hand-edited project file produces, and "10" is not a
    // preference the author got wrong - it is the one they wrote.
    it("reads a numeric string as the number it spells", () => {
        expect(normalizePlayerPreference("cps", "25")).toBe(25);
    });
});

describe("normalizePlayerPreferences", () => {
    it("returns the complete set for an absent config", () => {
        expect(normalizePlayerPreferences(undefined)).toEqual(DEFAULT_PLAYER_PREFERENCES);
        expect(normalizePlayerPreferences(null)).toEqual(DEFAULT_PLAYER_PREFERENCES);
        expect(normalizePlayerPreferences("nonsense")).toEqual(DEFAULT_PLAYER_PREFERENCES);
    });

    it("fills the gaps around what the author did set", () => {
        expect(normalizePlayerPreferences({ cps: 30, skipReadText: true })).toEqual({
            ...DEFAULT_PLAYER_PREFERENCES,
            cps: 30,
            skipReadText: true,
        });
    });

    it("drops a key it has never heard of", () => {
        const normalized = normalizePlayerPreferences({ cps: 30, warpFactor: 9 });
        expect(normalized).toEqual({ ...DEFAULT_PLAYER_PREFERENCES, cps: 30 });
        expect(Object.keys(normalized)).toHaveLength(PLAYER_PREFERENCE_KEYS.length);
    });

    // Skipping read text only is off by default and that is the product decision, not an accident:
    // a game that silently refuses to skip is a game whose skip key looks broken.
    it("starts with skip-read-text off", () => {
        expect(normalizePlayerPreferences({}).skipReadText).toBe(false);
    });
});
