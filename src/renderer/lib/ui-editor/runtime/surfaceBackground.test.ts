import { describe, expect, it } from "vitest";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { UISurfaceBackgroundImage } from "@shared/types/ui-editor/surfaceBackgroundImage";
import {
    GAME_OVERLAY_BACKGROUND_ALPHA,
    getCssBackgroundAlpha,
    getEditorSurfaceAreaBackgroundColor,
    getSurfaceBackgroundImage,
    getSurfaceLayerBackgroundImageOpacity,
    shouldShowEditorSurfaceLowOpacityOutline,
    surfaceBackgroundImageStyle,
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

describe("surface background image", () => {
    const withBackgroundImage = (backgroundImage: unknown): UISurface => {
        const surface = createSurface("#ffffff");
        return {
            ...surface,
            settings: {
                ...surface.settings,
                backgroundImage: backgroundImage as UISurfaceBackgroundImage,
            },
        };
    };

    it("reads a stored background image and defaults an unusable fill mode", () => {
        expect(getSurfaceBackgroundImage(createSurface("#ffffff"))).toBeNull();
        expect(getSurfaceBackgroundImage(withBackgroundImage({ assetId: "  ", fillMode: "tile" }))).toBeNull();
        expect(getSurfaceBackgroundImage(withBackgroundImage({ assetId: "asset-1", fillMode: "crop" }))).toEqual({
            assetId: "asset-1",
            fillMode: "cover",
        });
        expect(getSurfaceBackgroundImage(withBackgroundImage({ assetId: "asset-1", fillMode: "tile" }))).toEqual({
            assetId: "asset-1",
            fillMode: "tile",
        });
    });

    it("maps each fill mode onto the background CSS that draws it", () => {
        expect(surfaceBackgroundImageStyle("blob:one", "cover")).toMatchObject({
            backgroundSize: "cover",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "center",
        });
        expect(surfaceBackgroundImageStyle("blob:one", "contain")).toMatchObject({ backgroundSize: "contain" });
        expect(surfaceBackgroundImageStyle("blob:one", "stretch")).toMatchObject({ backgroundSize: "100% 100%" });
        expect(surfaceBackgroundImageStyle("blob:one", "tile")).toMatchObject({
            backgroundRepeat: "repeat",
            backgroundSize: "auto",
            backgroundPosition: "top left",
        });
    });

    it("escapes the url so a quoted asset path cannot break out of the CSS value", () => {
        expect(surfaceBackgroundImageStyle('blob:a"b\\c', "cover").backgroundImage)
            .toBe('url("blob:a\\"b\\\\c")');
    });

    it("thins the picture for a page presented over a running game, by the same amount as its colour", () => {
        expect(getSurfaceLayerBackgroundImageOpacity("appPage")).toBe(1);
        expect(getSurfaceLayerBackgroundImageOpacity("gameOverlay")).toBe(GAME_OVERLAY_BACKGROUND_ALPHA);
    });
});
