import { describe, expect, it } from "vitest";
import {
    BACKGROUND_EDITOR_ALPHA_VAR,
    BACKGROUND_KEYS,
    BACKGROUND_SIDEBAR_ALPHA_VAR,
    DEFAULT_BACKGROUND,
    backgroundPlateAlpha,
    backgroundPlateStyle,
    readBackgroundSettings,
} from "./backgroundSettings";

function read(stored: Record<string, unknown>) {
    return readBackgroundSettings(key => stored[key]);
}

describe("readBackgroundSettings: plates", () => {
    it("leaves the editor clear and the docks solid on a profile that has never set them", () => {
        const settings = read({ [BACKGROUND_KEYS.image]: "a.png" });
        expect(settings.editorFill).toBe(false);
        expect(settings.sidebarFill).toBe(true);
        expect(settings.sidebarOpacity).toBe(100);
    });

    it("keeps a stored switch and ignores anything that is not a boolean", () => {
        expect(read({ [BACKGROUND_KEYS.editorFill]: true }).editorFill).toBe(true);
        expect(read({ [BACKGROUND_KEYS.sidebarFill]: false }).sidebarFill).toBe(false);
        expect(read({ [BACKGROUND_KEYS.editorFill]: "true" }).editorFill).toBe(false);
        expect(read({ [BACKGROUND_KEYS.sidebarFill]: 0 }).sidebarFill).toBe(true);
    });

    it("clamps an opacity into the slider's range", () => {
        expect(read({ [BACKGROUND_KEYS.editorOpacity]: 250 }).editorOpacity).toBe(100);
        expect(read({ [BACKGROUND_KEYS.sidebarOpacity]: 3 }).sidebarOpacity).toBe(10);
        expect(read({ [BACKGROUND_KEYS.editorOpacity]: 42.4 }).editorOpacity).toBe(42);
        expect(read({ [BACKGROUND_KEYS.editorOpacity]: "nope" }).editorOpacity).toBe(DEFAULT_BACKGROUND.editorOpacity);
        expect(read({ [BACKGROUND_KEYS.sidebarOpacity]: 0 }).sidebarOpacity).toBe(DEFAULT_BACKGROUND.sidebarOpacity);
    });
});

describe("backgroundPlateAlpha", () => {
    it("is fully clear while the plate is off, whatever the slider says", () => {
        expect(backgroundPlateAlpha(false, 100)).toBe("0");
    });

    it("follows the slider while the plate is on", () => {
        expect(backgroundPlateAlpha(true, 60)).toBe("0.6");
    });

    it("is exactly 1 at the top of the range", () => {
        expect(backgroundPlateAlpha(true, 100)).toBe("1");
    });

    it("publishes one property per plate", () => {
        expect(backgroundPlateStyle(DEFAULT_BACKGROUND)).toEqual({
            [BACKGROUND_EDITOR_ALPHA_VAR]: "0",
            [BACKGROUND_SIDEBAR_ALPHA_VAR]: "1",
        });
    });
});
