import { beforeEach, describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { UI_VIDEO_ELEMENT_TYPE, defaultVideoWidgetProps } from "@shared/types/ui-editor/video";
import {
    getVideoPreviewRestartGeneration,
    isVideoPreviewPlaying,
    resetVideoPreviewPlayback,
} from "@/lib/ui-editor/interaction/videoPreviewPlayback";
import { createVideoDockerBarItems, createVideoMultiSelectDockerBarItems } from "./dockerBar";

function createVideoElement(props: Record<string, unknown> = {}): UIElement {
    return {
        id: "video-1",
        type: UI_VIDEO_ELEMENT_TYPE,
        name: "Video",
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 480, height: 270, opacity: 1, visible: true },
        props: { ...defaultVideoWidgetProps, ...props },
    };
}

function createDocumentService(element: UIElement) {
    const document = { elements: { [element.id]: element }, surfaces: [] };
    return {
        getDocument: () => document,
        updateElementProps: (elementId: string, propsPatch: Record<string, unknown>) => {
            const target = document.elements[elementId];
            target.props = { ...(target.props ?? {}), ...propsPatch };
        },
    };
}

function build(element: UIElement) {
    const documentService = createDocumentService(element);
    return {
        documentService,
        items: createVideoDockerBarItems({ element, documentService: documentService as never }),
    };
}

beforeEach(() => {
    resetVideoPreviewPlayback();
});

describe("createVideoDockerBarItems", () => {
    it("writes the chosen fit through the live element", () => {
        const element = createVideoElement({ assetId: "clip-1" });
        const { items } = build(element);
        const fit = items.find(item => item.id === "docker-video-object-fit");

        if (!fit || fit.kind !== "select") {
            throw new Error("Missing video fit Docker Bar select");
        }
        expect(fit.value).toBe("contain");

        fit.onChange("cover");
        expect(element.props?.objectFit).toBe("cover");
    });

    it("ignores a fit value outside the widget's own vocabulary", () => {
        const element = createVideoElement({ assetId: "clip-1" });
        const { items } = build(element);
        const fit = items.find(item => item.id === "docker-video-object-fit");

        if (!fit || fit.kind !== "select") {
            throw new Error("Missing video fit Docker Bar select");
        }

        fit.onChange("scale-down");
        expect(element.props?.objectFit).toBe("contain");
    });

    it("keeps the preview toggle out of the document", () => {
        // The ruling is that canvas playback is editor state. If it leaked into props it would enter
        // the undo stack and, worse, ship: every player would get whatever the author left playing.
        const element = createVideoElement({ assetId: "clip-1" });
        const { items } = build(element);
        const propsBefore = { ...element.props };
        const toggle = items.find(item => item.id === "docker-video-preview-toggle");

        if (!toggle || toggle.kind !== "button") {
            throw new Error("Missing video preview toggle");
        }
        expect(toggle.active).toBe(false);

        toggle.onClick();

        expect(isVideoPreviewPlaying(element.id)).toBe(true);
        expect(element.props).toEqual(propsBefore);

        // The bar is rebuilt on the store change; the fresh item is the one that shows "playing".
        const rebuilt = createVideoDockerBarItems({
            element,
            documentService: createDocumentService(element) as never,
        }).find(item => item.id === "docker-video-preview-toggle");
        expect(rebuilt?.kind === "button" && rebuilt.active).toBe(true);
    });

    it("counts each restart request so a repeat click is not swallowed", () => {
        const element = createVideoElement({ assetId: "clip-1" });
        const { items } = build(element);
        const restart = items.find(item => item.id === "docker-video-preview-restart");

        if (!restart || restart.kind !== "button") {
            throw new Error("Missing video restart button");
        }

        const before = getVideoPreviewRestartGeneration(element.id);
        restart.onClick();
        restart.onClick();

        expect(getVideoPreviewRestartGeneration(element.id)).toBe(before + 2);
    });

    it("disables the transport when there is no clip to preview", () => {
        const { items } = build(createVideoElement({ assetId: null }));
        const transport = items.filter(item => item.id.startsWith("docker-video-preview"));

        expect(transport).toHaveLength(2);
        expect(transport.every(item => item.kind === "button" && item.disabled === true)).toBe(true);
    });

    it("still offers the shared chrome items", () => {
        const { items } = build(createVideoElement({ assetId: "clip-1" }));

        expect(items.map(item => item.id)).toContain("docker-border-radius");
        expect(items.map(item => item.id)).toContain("docker-border-width");
    });
});

describe("createVideoMultiSelectDockerBarItems", () => {
    it("drops the preview transport and keeps the document-editing items", () => {
        const element = createVideoElement({ assetId: "clip-1" });
        const documentService = createDocumentService(element);
        const ids = createVideoMultiSelectDockerBarItems({
            element,
            documentService: documentService as never,
        }).map(item => item.id);

        expect(ids).toContain("docker-video-object-fit");
        expect(ids).toContain("docker-border-radius");
        expect(ids.some(id => id.startsWith("docker-video-preview"))).toBe(false);
    });
});
