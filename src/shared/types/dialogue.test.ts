import { describe, expect, it } from "vitest";
import {
    AUTO_FORWARD_DEFAULT_PAUSE_MAX,
    AUTO_FORWARD_DEFAULT_PAUSE_MIN,
    DEFAULT_DIALOGUE_CONFIGURATION,
    normalizeDialogueConfiguration,
    TEXT_REVEAL_DURATION_MAX,
    TEXT_REVEAL_DURATION_MIN,
} from "./dialogue";
import { PLAYER_PREFERENCE_KEYS, RUNTIME_PREFERENCE_KEYS } from "./preference";

describe("normalizeDialogueConfiguration", () => {
    it("answers with the engine's own value for a project that has never set one", () => {
        expect(normalizeDialogueConfiguration(undefined)).toEqual(DEFAULT_DIALOGUE_CONFIGURATION);
        expect(normalizeDialogueConfiguration(null)).toEqual(DEFAULT_DIALOGUE_CONFIGURATION);
        expect(normalizeDialogueConfiguration("1500")).toEqual(DEFAULT_DIALOGUE_CONFIGURATION);
        expect(normalizeDialogueConfiguration({})).toEqual(DEFAULT_DIALOGUE_CONFIGURATION);
        expect(normalizeDialogueConfiguration({ autoForwardDefaultPause: Number.NaN }))
            .toEqual(DEFAULT_DIALOGUE_CONFIGURATION);
    });

    it("keeps an authored value, in whole milliseconds", () => {
        expect(normalizeDialogueConfiguration({ autoForwardDefaultPause: 250 }).autoForwardDefaultPause).toBe(250);
        expect(normalizeDialogueConfiguration({ autoForwardDefaultPause: 250.6 }).autoForwardDefaultPause).toBe(251);
    });

    it("clamps rather than falls back, so a stored value out of range is still the author's", () => {
        expect(normalizeDialogueConfiguration({ autoForwardDefaultPause: -1 }).autoForwardDefaultPause)
            .toBe(AUTO_FORWARD_DEFAULT_PAUSE_MIN);
        expect(normalizeDialogueConfiguration({ autoForwardDefaultPause: 1e9 }).autoForwardDefaultPause)
            .toBe(AUTO_FORWARD_DEFAULT_PAUSE_MAX);
    });

    /**
     * The reason this configuration exists rather than a fifteenth preference. A settings screen
     * reads the preference table; a value on it would be the player's to change and would be
     * written into every player's stored preferences, which is not what a pause in the script is.
     */
    it("is not a preference on either table", () => {
        expect([...PLAYER_PREFERENCE_KEYS, ...RUNTIME_PREFERENCE_KEYS])
            .not.toContain("autoForwardDefaultPause");
    });
});

describe("normalizeDialogueConfiguration: text reveal", () => {
    it("types text at full strength for a project that has never set one", () => {
        expect(normalizeDialogueConfiguration(undefined).textRevealDuration).toBe(0);
        expect(normalizeDialogueConfiguration({}).textRevealDuration).toBe(0);
        expect(normalizeDialogueConfiguration({ textRevealDuration: "120" }).textRevealDuration).toBe(0);
    });

    it("keeps an authored value, in whole milliseconds", () => {
        expect(normalizeDialogueConfiguration({ textRevealDuration: 120 }).textRevealDuration).toBe(120);
        expect(normalizeDialogueConfiguration({ textRevealDuration: 119.6 }).textRevealDuration).toBe(120);
    });

    it("clamps rather than falls back", () => {
        expect(normalizeDialogueConfiguration({ textRevealDuration: -5 }).textRevealDuration)
            .toBe(TEXT_REVEAL_DURATION_MIN);
        expect(normalizeDialogueConfiguration({ textRevealDuration: 1e6 }).textRevealDuration)
            .toBe(TEXT_REVEAL_DURATION_MAX);
    });

    /**
     * The reason each field is normalized on its own. A project written while this section held
     * one setting carries only that one, and reading it back must not cost the other its value -
     * nor may one unreadable field take the whole section down with it.
     */
    it("reads each field without the other", () => {
        expect(normalizeDialogueConfiguration({ textRevealDuration: 120 }))
            .toEqual({ autoForwardDefaultPause: 1000, textRevealDuration: 120 });
        expect(normalizeDialogueConfiguration({ autoForwardDefaultPause: 250, textRevealDuration: Number.NaN }))
            .toEqual({ autoForwardDefaultPause: 250, textRevealDuration: 0 });
    });
});
