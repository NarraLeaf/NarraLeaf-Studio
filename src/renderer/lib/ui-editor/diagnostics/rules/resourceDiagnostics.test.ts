import { describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { UI_VIDEO_ELEMENT_TYPE } from "@shared/types/ui-editor/video";
import { createInitialImageAppearanceFromProps } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { collectResourceDiagnostics } from "./resourceDiagnostics";

function createImageElement(props: Record<string, unknown>): UIElement {
    return {
        id: "image-1",
        type: "nl.image",
        name: "Image",
        parentId: null,
        childrenIds: [],
        layout: {
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            opacity: 1,
            visible: true,
        },
        props,
    };
}

describe("collectResourceDiagnostics", () => {
    it("does not warn when an image asset is stored in appearance", () => {
        const element = createImageElement({
            fillType: "image",
            imageFill: { mode: "cover", assetId: null },
            appearance: createInitialImageAppearanceFromProps({
                fillType: "image",
                imageFill: { mode: "cover", assetId: "appearance-asset" },
            }),
        });

        expect(collectResourceDiagnostics([element])).toEqual([]);
    });

    it("warns when an image fill has no effective asset", () => {
        const element = createImageElement({
            fillType: "image",
            imageFill: { mode: "cover", assetId: null },
            appearance: createInitialImageAppearanceFromProps({
                fillType: "image",
                imageFill: { mode: "cover", assetId: null },
            }),
        });

        expect(collectResourceDiagnostics([element])).toEqual([
            expect.objectContaining({
                id: "res:image:image-1",
                severity: "warning",
                message: "Image widget “Image” has no image asset",
            }),
        ]);
    });

    it("warns when a video widget has no clip", () => {
        const element: UIElement = {
            id: "video-1",
            type: UI_VIDEO_ELEMENT_TYPE,
            name: "Intro",
            parentId: null,
            childrenIds: [],
            layout: { x: 0, y: 0, width: 480, height: 270, opacity: 1, visible: true },
            props: { assetId: null },
        };

        expect(collectResourceDiagnostics([element])).toEqual([
            expect.objectContaining({
                id: "res:video:video-1",
                severity: "warning",
                message: "Video widget “Intro” has no clip",
            }),
        ]);
    });

    it("does not treat a missing poster as a missing resource", () => {
        // The poster is optional by design; warning about it would train authors to ignore the rule.
        const element: UIElement = {
            id: "video-2",
            type: UI_VIDEO_ELEMENT_TYPE,
            name: "Intro",
            parentId: null,
            childrenIds: [],
            layout: { x: 0, y: 0, width: 480, height: 270, opacity: 1, visible: true },
            props: { assetId: "clip-1", posterAssetId: null },
        };

        expect(collectResourceDiagnostics([element])).toEqual([]);
    });
});
