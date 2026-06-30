import { describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { createInitialImageAppearanceFromProps } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { beginImageCropEdit } from "./imageCropEdit";

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

function createServices(element: UIElement) {
    const document = {
        elements: {
            [element.id]: element,
        },
        surfaces: [],
    };
    let selection: unknown = null;
    let override: unknown = null;

    return {
        documentService: {
            getDocument: () => document,
            updateElementProps: (elementId: string, propsPatch: Record<string, unknown>) => {
                const target = document.elements[elementId];
                target.props = {
                    ...(target.props ?? {}),
                    ...propsPatch,
                };
            },
        },
        stateService: {
            setUIElementSelection: (next: unknown) => {
                selection = next;
            },
            setInteractionOverride: (next: unknown) => {
                override = next;
            },
            getSelection: () => selection,
            getInteractionOverride: () => override,
        },
        getSelection: () => selection,
        getOverride: () => override,
    };
}

describe("beginImageCropEdit", () => {
    it("enters crop editing without mutating image fill props first", () => {
        const element = createImageElement({
            fillType: "image",
            imageFill: { mode: "cover", assetId: "asset-1" },
        });
        const services = createServices(element);

        const ok = beginImageCropEdit({
            documentService: services.documentService as never,
            stateService: services.stateService as never,
            surfaceId: "surface-1",
            elementId: element.id,
            source: "test",
        });

        expect(ok).toBe(true);
        expect(element.props?.imageFill).toMatchObject({ mode: "cover", assetId: "asset-1" });
        expect(services.getSelection()).toMatchObject({ elementIds: [element.id], primaryId: element.id });
        expect(services.getOverride()).toMatchObject({ kind: "imageCrop", elementId: element.id });
    });

    it("can enter crop editing from an effective image fill in appearance", () => {
        const appearanceProps = {
            fillType: "image",
            imageFill: { mode: "cover", assetId: "appearance-asset" },
        };
        const element = createImageElement({
            fillType: "image",
            imageFill: { mode: "cover", assetId: null },
            appearance: createInitialImageAppearanceFromProps(appearanceProps),
        });
        const services = createServices(element);

        const ok = beginImageCropEdit({
            documentService: services.documentService as never,
            stateService: services.stateService as never,
            surfaceId: "surface-1",
            elementId: element.id,
            source: "test",
        });

        expect(ok).toBe(true);
        expect(element.props?.imageFill).toMatchObject({ mode: "cover", assetId: null });
        expect(services.getOverride()).toMatchObject({ kind: "imageCrop", elementId: element.id });
    });
});
