import { describe, expect, it } from "vitest";
import type { UISurface } from "@shared/types/ui-editor/document";
import {
    getCssBackgroundAlpha,
    getEditorSurfaceAreaBackgroundColor,
    shouldShowEditorSurfaceLowOpacityOutline,
} from "./surfaceBackground";

function createSurface(backgroundColor?: string, kind: UISurface["kind"] = "appSurface"): UISurface {
    const base = {
        id: "surface",
        name: "Surface",
        designSize: { width: 320, height: 180 },
        rootElementId: "root",
        settings: backgroundColor === undefined ? undefined : { backgroundColor },
    };

    if (kind === "stageSurface") {
        return {
            ...base,
            host: "player",
            kind,
            mount: { kind: "slot", slotId: "onStage" },
        };
    }

    return {
        ...base,
        host: "app",
        kind,
    };
}

describe("surfaceBackground", () => {
    it("extracts opacity from authored CSS background colors", () => {
        expect(getCssBackgroundAlpha("transparent")).toBe(0);
        expect(getCssBackgroundAlpha("rgba(10, 20, 30, 0.19)")).toBe(0.19);
        expect(getCssBackgroundAlpha("rgb(10 20 30 / 19%)")).toBe(0.19);
        expect(getCssBackgroundAlpha("#11223332")).toBeLessThan(0.2);
        expect(getCssBackgroundAlpha("#11223333")).toBe(0.2);
        expect(getCssBackgroundAlpha("#112233")).toBe(1);
    });

    it("shows the editor outline only when the effective surface background is below 20 percent opacity", () => {
        expect(shouldShowEditorSurfaceLowOpacityOutline(createSurface(undefined, "appSurface"))).toBe(false);
        expect(shouldShowEditorSurfaceLowOpacityOutline(createSurface(undefined, "stageSurface"))).toBe(true);
        expect(shouldShowEditorSurfaceLowOpacityOutline(createSurface("rgba(10, 20, 30, 0.19)"))).toBe(true);
        expect(shouldShowEditorSurfaceLowOpacityOutline(createSurface("rgba(10, 20, 30, 0.2)"))).toBe(false);
    });

    it("keeps the white editor backing limited to fully transparent Game UI surfaces", () => {
        expect(getEditorSurfaceAreaBackgroundColor(createSurface("transparent", "stageSurface"))).toBe("#ffffff");
        expect(getEditorSurfaceAreaBackgroundColor(createSurface("rgba(10, 20, 30, 0.1)", "stageSurface"))).toBeUndefined();
        expect(getEditorSurfaceAreaBackgroundColor(createSurface("transparent", "appSurface"))).toBeUndefined();
    });
});
