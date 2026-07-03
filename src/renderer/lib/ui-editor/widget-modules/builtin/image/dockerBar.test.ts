import { describe, expect, it, vi } from "vitest";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import type { UIElement } from "@shared/types/ui-editor/document";
import { createInitialImageAppearanceFromProps } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { createImageDockerBarItems } from "./dockerBar";

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

function createDocumentService(element: UIElement) {
    const document = {
        elements: {
            [element.id]: element,
        },
        surfaces: [],
    };

    return {
        getDocument: () => document,
        updateElementProps: (elementId: string, propsPatch: Record<string, unknown>) => {
            const target = document.elements[elementId];
            target.props = {
                ...(target.props ?? {}),
                ...propsPatch,
            };
        },
    };
}

function getAppearanceImageFill(model: AppearanceModel) {
    return model.variants[0]?.propertyGroups.find(group => group.key === "imageFill")?.rows[0]?.value;
}

describe("createImageDockerBarItems", () => {
    it("preserves the effective appearance image asset when changing fit mode", () => {
        const element = createImageElement({
            fillType: "image",
            imageFill: { mode: "cover", assetId: null },
            appearance: createInitialImageAppearanceFromProps({
                fillType: "image",
                imageFill: { mode: "cover", assetId: "appearance-asset" },
            }),
        });
        const documentService = createDocumentService(element);
        const items = createImageDockerBarItems({
            element,
            documentService: documentService as never,
        });
        const fitItem = items.find(item => item.id === "docker-image-fill-mode");

        if (!fitItem || fitItem.kind !== "select") {
            throw new Error("Missing image fit Docker Bar select");
        }

        fitItem.onChange("contain");

        expect(element.props?.imageFill).toMatchObject({
            mode: "contain",
            assetId: "appearance-asset",
        });
        expect(getAppearanceImageFill(element.props?.appearance as AppearanceModel)).toMatchObject({
            mode: "contain",
            assetId: "appearance-asset",
        });
    });

    it("exits crop interaction when changing fit mode away from crop", () => {
        const element = createImageElement({
            fillType: "image",
            imageFill: { mode: "crop", assetId: "asset-1" },
        });
        const documentService = createDocumentService(element);
        const setInteractionOverride = vi.fn();
        const items = createImageDockerBarItems({
            element,
            documentService: documentService as never,
            stateService: {
                getInteractionOverride: () => ({
                    kind: "imageCrop",
                    surfaceId: "surface-1",
                    elementId: element.id,
                    source: "test",
                }),
                setInteractionOverride,
            } as never,
            surfaceId: "surface-1",
        });
        const fitItem = items.find(item => item.id === "docker-image-fill-mode");

        if (!fitItem || fitItem.kind !== "select") {
            throw new Error("Missing image fit Docker Bar select");
        }

        fitItem.onChange("contain");

        expect(setInteractionOverride).toHaveBeenCalledWith(null);
        expect(element.props?.imageFill).toMatchObject({
            mode: "contain",
            assetId: "asset-1",
        });
    });
});
