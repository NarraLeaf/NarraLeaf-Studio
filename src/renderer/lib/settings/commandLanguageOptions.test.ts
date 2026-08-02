import { describe, expect, it } from "vitest";
import { LOCALIZED_COMMANDS_DEFAULT, resolveCommandLocale } from "./commandLanguageOptions";

/**
 * The switch has two states and one rule: off means English, anything else means the interface
 * language. "Anything else" is the interesting half — an unset key (nobody has toggled it) and a
 * garbage value both have to mean ON, because that is where every author was before this setting
 * existed and losing a preference must not silently change what their editor speaks.
 */
describe("resolveCommandLocale", () => {
    it("follows the interface language while translation is on", () => {
        expect(resolveCommandLocale(true, "zh")).toBe("zh");
        expect(resolveCommandLocale(true, "en")).toBe("en");
    });

    it("pins to English while translation is off", () => {
        // The case the whole switch exists for: Chinese menus, English commands.
        expect(resolveCommandLocale(false, "zh")).toBe("en");
        expect(resolveCommandLocale(false, "en")).toBe("en");
    });

    it("treats an unset or unusable value as on", () => {
        expect(LOCALIZED_COMMANDS_DEFAULT).toBe(true);
        expect(resolveCommandLocale(undefined, "zh")).toBe("zh");
        expect(resolveCommandLocale(null, "zh")).toBe("zh");
        expect(resolveCommandLocale("false", "zh")).toBe("zh");
        expect(resolveCommandLocale(0, "zh")).toBe("zh");
    });
});
