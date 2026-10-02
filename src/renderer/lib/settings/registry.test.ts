import { describe, expect, it } from "vitest";
import { WINDOW_ICON_DEFAULT, WINDOW_ICON_IDS, WINDOW_ICON_KEY } from "@shared/constants/windowIcon";
import { getSettingByKey, shownSettingValue } from "./registry";

describe("shownSettingValue", () => {
    const windowIcon = getSettingByKey(WINDOW_ICON_KEY)!;

    it("shows the default when nothing is stored", () => {
        expect(shownSettingValue(windowIcon, undefined)).toBe(WINDOW_ICON_DEFAULT);
    });

    it("shows a stored option as itself", () => {
        for (const id of WINDOW_ICON_IDS) {
            expect(shownSettingValue(windowIcon, id)).toBe(id);
        }
    });

    it("shows an app icon id no option carries as the option the main process wears for it", () => {
        // `default` is on every profile from before the Narra icon: conf wrote the default it
        // then was to disk. Shown raw, the dropdown printed the id itself.
        expect(shownSettingValue(windowIcon, "default")).toBe(WINDOW_ICON_DEFAULT);
        expect(shownSettingValue(windowIcon, "gone")).toBe(WINDOW_ICON_DEFAULT);
        expect(shownSettingValue(windowIcon, 42)).toBe(WINDOW_ICON_DEFAULT);
    });

    it("leaves a value alone for an entry that resolves nothing", () => {
        const theme = getSettingByKey("ui.themeMode")!;
        expect(theme.resolveStoredValue).toBeUndefined();
        expect(shownSettingValue(theme, "dark")).toBe("dark");
        expect(shownSettingValue(theme, undefined)).toBe(theme.defaultValue);
    });
});

describe("the app icon row", () => {
    it("names every icon it offers through a translation, never by its id", () => {
        const windowIcon = getSettingByKey(WINDOW_ICON_KEY)!;
        expect(windowIcon.options).toEqual([...WINDOW_ICON_IDS]);
        expect(Object.keys(windowIcon.optionLabelKeys ?? {}).sort()).toEqual([...WINDOW_ICON_IDS].sort());
    });
});
