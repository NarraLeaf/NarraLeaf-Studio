import { describe, expect, it } from "vitest";
import {
    AUTO_FORWARD_DEFAULT_PAUSE_MAX,
    AUTO_FORWARD_DEFAULT_PAUSE_MIN,
    DEFAULT_DIALOGUE_CONFIGURATION,
    normalizeDialogueConfiguration,
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
