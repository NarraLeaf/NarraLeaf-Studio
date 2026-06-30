import { describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
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
});
