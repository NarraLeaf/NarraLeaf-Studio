import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_UI_PAGE_ANIMATION_SETTINGS } from "@shared/types/ui-editor/pageAnimation";
import { getUIComponentLink, type UIElement } from "@shared/types/ui-editor/document";
import { Services } from "../services";
import { UIDocumentService } from "./UIDocumentService";

function createHarness() {
    let nextId = 0;
    const service = new UIDocumentService();
    service.setContext({
        project: {
            resolve: (name: string) => name,
        } as any,
        services: {
            get(serviceId: Services) {
                if (serviceId === Services.Uuid) {
                    return { generate: () => `generated-id-${++nextId}` };
                }
                if (serviceId === Services.Project) {
                    return { getProjectConfig: () => ({ metadata: { resolution: { width: 1280, height: 720 } } }) };
                }
                throw new Error(`Unexpected service ${serviceId}`);
            },
        } as any,
    });

    const initialDocument = (service as any).createEmptyDocument();
    (service as any).document = initialDocument;

    return { service, initialDocument };
}

describe("UIDocumentService surface creation", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it("creates app Pages with blocking exit animation enabled by default", () => {
        const { service, initialDocument } = createHarness();

        expect(initialDocument.surfaces[0]?.settings?.pageAnimation).toEqual(DEFAULT_UI_PAGE_ANIMATION_SETTINGS);
        expect(initialDocument.surfaces[0]?.settings?.pageAnimation?.exitBlocking).toBe(true);

        const page = service.createSurface({
            kind: "appSurface",
            host: "app",
            name: "Settings",
        });

        expect(page.settings?.pageAnimation).toEqual(DEFAULT_UI_PAGE_ANIMATION_SETTINGS);
        expect(page.settings?.pageAnimation?.exitBlocking).toBe(true);
    });

    it("preserves explicit Page animation wait choices and leaves Game UI creation unchanged", () => {
        const { service } = createHarness();

        const page = service.createSurface({
            kind: "appSurface",
            host: "app",
            name: "Fast Page",
            settings: {
                backgroundColor: "#111111",
                pageAnimation: {
                    ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
                    exitBlocking: false,
                },
            },
        });
        const gameUi = service.createSurface({
            kind: "stageSurface",
            host: "player",
            name: "Dialog",
        });

        expect(page.settings?.backgroundColor).toBe("#111111");
        expect(page.settings?.pageAnimation?.exitBlocking).toBe(false);
        expect(gameUi.settings?.pageAnimation).toBeUndefined();
    });
});

describe("UIDocumentService component library", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it("keeps linked instances layout-only and materializes them on unlink", () => {
        const { service } = createHarness();
        const doc = service.getDocument();
        const surface = doc.surfaces[0]!;
        const rootId = surface.rootElementId;

        const button: UIElement = {
            id: "button",
            type: "nl.button",
            name: "CTA Source",
            parentId: rootId,
            childrenIds: ["text"],
            layout: { x: 10, y: 20, width: 120, height: 44 },
            props: { label: "Main CTA" },
        };
        const text: UIElement = {
            id: "text",
            type: "nl.text",
            name: "Label",
            parentId: button.id,
            childrenIds: [],
            layout: { x: 8, y: 8, width: 80, height: 20 },
        };
        doc.elements[rootId]!.childrenIds.push(button.id);
        doc.elements[button.id] = button;
        doc.elements[text.id] = text;
        const component = service.createComponentFromElements(surface.id, [button.id], "CTA")!;

        const instance = service.createComponentInstance(rootId, component.id, {
            x: 300,
            y: 50,
            width: 180,
            height: 64,
        });
        expect(getUIComponentLink(service.getDocument().elements[instance.id])).toEqual({
            componentId: component.id,
            linked: true,
        });

        service.updateElementLayout(instance.id, {
            x: 320,
            opacity: 0.25,
            visible: false,
            lockAspectRatio: true,
        });
        service.updateElementProps(instance.id, { label: "Override" });
        service.updateElementExtra(instance.id, { custom: true });
        service.renameElement(instance.id, "Renamed Instance");

        const linked = service.getDocument().elements[instance.id]!;
        expect(linked.layout.x).toBe(320);
        expect(linked.layout.opacity).toBe(1);
        expect(linked.layout.visible).toBe(true);
        expect(linked.layout.lockAspectRatio).toBeUndefined();
        expect(linked.props).toBeUndefined();
        expect(linked.name).toBe("CTA");
        expect(linked.extra).toEqual({ componentLink: { componentId: component.id, linked: true } });
        expect(() =>
            service.ensureElementBlueprintValueBinding(instance.id, "label", { valueType: "string" }),
        ).toThrow(/Linked component instances/);

        const materializedIds = service.unlinkComponentInstance(instance.id);
        const materializedRoot = service.getDocument().elements[instance.id]!;
        expect(materializedIds).toContain(instance.id);
        expect(materializedIds.length).toBe(2);
        expect(getUIComponentLink(materializedRoot)).toBeNull();
        expect(materializedRoot.layout).toMatchObject({ x: 320, y: 50, width: 180, height: 64 });
        expect(materializedRoot.props).toMatchObject({ label: "Main CTA" });
        expect(materializedRoot.childrenIds).toHaveLength(1);
        expect(materializedRoot.childrenIds[0]).not.toBe(text.id);
    });

    it("wraps multi-selection components in a relative container root", () => {
        const { service } = createHarness();
        const doc = service.getDocument();
        const surface = doc.surfaces[0]!;
        const rootId = surface.rootElementId;
        const first: UIElement = {
            id: "first",
            type: "nl.container",
            name: "First",
            parentId: rootId,
            childrenIds: [],
            layout: { x: 20, y: 30, width: 100, height: 40 },
        };
        const second: UIElement = {
            id: "second",
            type: "nl.text",
            name: "Second",
            parentId: rootId,
            childrenIds: [],
            layout: { x: 170, y: 90, width: 80, height: 24 },
        };
        doc.elements[rootId]!.childrenIds.push(first.id, second.id);
        doc.elements[first.id] = first;
        doc.elements[second.id] = second;

        const component = service.createComponentFromElements(surface.id, [first.id, second.id], "Group")!;
        const componentRoot = component.elements[component.rootElementId]!;
        const componentChildren = componentRoot.childrenIds.map(id => component.elements[id]!);

        expect(componentRoot.type).toBe("nl.container");
        expect(componentRoot.layout).toMatchObject({ x: 0, y: 0, width: 230, height: 84 });
        expect(componentChildren.map(element => element.type)).toEqual(["nl.container", "nl.text"]);
        expect(componentChildren[0].layout).toMatchObject({ x: 0, y: 0 });
        expect(componentChildren[1].layout).toMatchObject({ x: 150, y: 60 });
    });
});
