/**
 * A loading state painted in the wrong colour is the defect this replaced, only quieter: the game
 * still changes colour the moment it appears. These hold the order the answer is looked for in.
 *
 * Comments in English per project convention.
 */
import { afterEach, describe, expect, it } from "vitest";
import { setActiveBrandPalette } from "@shared/brand/brandRegistry";
import { BUILTIN_BRAND_COLORS } from "@shared/types/brand";
import type { UISurface } from "@shared/types/ui-editor/document";
import {
    RUNTIME_BOOT_FALLBACK_ACCENT,
    RUNTIME_BOOT_FALLBACK_BACKGROUND,
    resolveRuntimeBootColors,
} from "./bootAppearance";

function surface(backgroundColor: string | undefined): UISurface {
    return {
        id: "title",
        name: "Title",
        host: "app",
        kind: "appSurface",
        designSize: { width: 1280, height: 720 },
        rootElementId: "root",
        ...(backgroundColor === undefined ? {} : { settings: { backgroundColor } }),
    } as UISurface;
}

afterEach(() => {
    setActiveBrandPalette(BUILTIN_BRAND_COLORS);
});

describe("the colours a game waits in", () => {
    it("takes the entry screen's own background, resolved through the palette", () => {
        setActiveBrandPalette([
            ...BUILTIN_BRAND_COLORS,
            { id: "surface.sunken", value: "#0A090D" },
        ]);
        expect(resolveRuntimeBootColors(surface("nlbrand:surface.sunken")).background).toBe("#0A090D");
    });

    it("falls back to the project's own background where the entry screen has none", () => {
        // A stage surface, or an author's page authored transparent: there is no colour there to
        // match, and black is not an answer anybody chose.
        setActiveBrandPalette(BUILTIN_BRAND_COLORS);
        expect(resolveRuntimeBootColors(surface("transparent")).background).toBe("#101317");
        expect(resolveRuntimeBootColors(null).background).toBe("#101317");
    });

    it("follows the project when the project changes its background", () => {
        setActiveBrandPalette(
            BUILTIN_BRAND_COLORS.map(color => (color.id === "background" ? { ...color, value: "#FFF8F0" } : color)),
        );
        expect(resolveRuntimeBootColors(null).background).toBe("#FFF8F0");
    });

    it("draws the indicator in the colour the palette calls legible against that background", () => {
        setActiveBrandPalette(
            BUILTIN_BRAND_COLORS.map(color => (color.id === "foreground" ? { ...color, value: "#221100" } : color)),
        );
        // Not white: a pale game would have an indicator nobody can see.
        expect(resolveRuntimeBootColors(null).accent).toBe("#221100");
    });

    it("has an answer for a palette that resolves to nothing", () => {
        setActiveBrandPalette([]);
        expect(resolveRuntimeBootColors(null)).toEqual({
            background: RUNTIME_BOOT_FALLBACK_BACKGROUND,
            accent: RUNTIME_BOOT_FALLBACK_ACCENT,
        });
    });
});
