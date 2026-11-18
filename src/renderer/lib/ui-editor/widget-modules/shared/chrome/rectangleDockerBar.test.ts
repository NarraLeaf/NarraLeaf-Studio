import { Circle } from "lucide-react";
import { describe, expect, it } from "vitest";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { createComponentDocumentServiceAdapter, getComponentEditorSurfaceId } from "@/apps/workspace/modules/ui-editor/editors/componentEditorAdapter";
import { resolveImageRectangleLike } from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import { createImageDockerBarItems } from "@/lib/ui-editor/widget-modules/builtin/image/dockerBar";
import { createPuppetDockerBarItems } from "@/lib/ui-editor/widget-modules/builtin/puppet/dockerBar";
import { createVideoDockerBarItems } from "@/lib/ui-editor/widget-modules/builtin/video/dockerBar";
import { createInitialImageAppearanceFromProps } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { createRectangleDockerBarItems } from "./rectangleDockerBar";

function element(type: string): UIElement {
    return {
        id: "control", type, parentId: "root", childrenIds: [],
        layout: { x: 0, y: 0, width: 100, height: 100 },
        props: { borderRadius: 3, borderWidth: 2, borderRadiusLinked: true, name: "original" },
    } as UIElement;
}

function service(initial: UIElement) {
    const document = { elements: { [initial.id]: initial } };
    return {
        document,
        getDocument: () => document,
        updateElementProps: (id: string, patch: Record<string, unknown>) => {
            const current = document.elements[id];
            document.elements[id] = { ...current, props: { ...current.props, ...patch } };
        },
    };
}

describe("rectangle Docker Bar controls", () => {
    it.each([
        ["video", "nl.video", createVideoDockerBarItems],
        ["Puppet", "nl.puppet", createPuppetDockerBarItems],
    ] as const)("updates %s flat props without replacing a later edit", (_label, type, createItems) => {
        const initial = element(type);
        const documentService = service(initial);
        const items = createItems({ element: initial, documentService: documentService as never });
        const radius = items.find(item => item.id === "docker-border-radius");
        const width = items.find(item => item.id === "docker-border-width");
        if (radius?.kind !== "number" || width?.kind !== "number") throw new Error("missing chrome controls");

        documentService.updateElementProps(initial.id, { name: "updated" });
        radius.onChange(18);
        width.onChange(6);
        expect(documentService.document.elements.control.props).toMatchObject({
            name: "updated", borderRadius: 18, borderRadiusTL: 18, borderRadiusBR: 18, borderWidth: 6,
        });
    });

    it("updates flat props for an image without an appearance model", () => {
        const initial = element("nl.image");
        const documentService = service(initial);
        const radius = createRectangleDockerBarItems({ element: initial, documentService: documentService as never })
            .find(item => item.id === "docker-border-radius");
        if (radius?.kind !== "number") throw new Error("missing radius control");
        radius.onChange(12);
        expect(documentService.document.elements.control.props).toMatchObject({ borderRadius: 12, borderRadiusTL: 12 });
    });

    it("adds a missing radius group to an older image appearance", () => {
        const initial = element("nl.image");
        const appearance = createInitialImageAppearanceFromProps(initial.props!);
        appearance.variants[0].propertyGroups = appearance.variants[0].propertyGroups.filter(group => group.key !== "borderRadius");
        initial.props = { ...initial.props, appearance };
        const documentService = service(initial);
        const radius = createImageDockerBarItems({ element: initial, documentService: documentService as never })
            .find(item => item.id === "docker-border-radius");
        if (radius?.kind !== "number") throw new Error("missing radius control");
        radius.onChange(12);
        const result = documentService.document.elements.control;
        const resolved = resolveImageRectangleLike(result, result.props!.appearance as AppearanceModel, {
            variantOverrideId: null, signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
        });
        expect(resolved.borderRadius).toBe(12);
        expect(resolved.borderWidth).toBe(2);
    });

    it("edits an image inside a component definition through its document adapter", () => {
        const initial = element("nl.image");
        initial.parentId = "host";
        initial.props = { ...initial.props, appearance: createInitialImageAppearanceFromProps(initial.props!) };
        const host = { ...element("test.docker-host"), id: "host", parentId: null, childrenIds: [initial.id] };
        const component = {
            id: "component", name: "Card", rootElementId: "host",
            elements: { host, control: initial } as Record<string, UIElement>,
        };
        const document = { components: [component], surfaces: [], elements: {} } as unknown as UIDocument;
        let revision = 0;
        const base = {
            getDocument: () => document,
            getComponent: () => component,
            getRevision: () => revision,
            updateComponentElementProps: (_componentId: string, id: string, patch: Record<string, unknown>) => {
                const current = component.elements[id];
                component.elements[id] = { ...current, props: { ...current.props, ...patch } };
                revision += 1;
            },
        };
        widgetModuleRegistry.register({
            type: "test.docker-host", displayName: "Host", icon: Circle,
            createDefaultElement: () => ({}), render: () => null,
            listEditorStates: () => [{ id: null, name: "Off" }, { id: "on", name: "On" }],
        });
        try {
            const adapter = createComponentDocumentServiceAdapter(base as never, "component");
            const surfaceId = getComponentEditorSurfaceId("component");
            const items = createImageDockerBarItems({
                element: adapter.getDocument().elements.control,
                documentService: adapter,
                surfaceId,
                stateService: { getEnteredState: () => ({ surfaceId, elementId: "host", variantId: "on" }) } as never,
            });
            const radius = items.find(item => item.id === "docker-border-radius");
            if (radius?.kind !== "number") throw new Error("missing radius control");
            radius.onChange(16);
            const result = component.elements.control;
            const model = result.props!.appearance as AppearanceModel;
            const resolve = (variantOverrideId: string | null) => resolveImageRectangleLike(result, model, {
                variantOverrideId, signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
            }).borderRadius;
            expect(resolve("on")).toBe(16);
            expect(resolve(null)).toBe(3);
        } finally {
            widgetModuleRegistry.unregister("test.docker-host");
        }
    });
});
