import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_UI_PAGE_ANIMATION_SETTINGS } from "@shared/types/ui-editor/pageAnimation";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    getUIComponentLink,
    type UIElement,
    type UIDocument,
    type UIStageSurface,
} from "@shared/types/ui-editor/document";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
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

    it("preserves explicit Page animation wait choices while Game UI defaults to transparent", () => {
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
        expect(gameUi.settings?.backgroundColor).toBe("transparent");
        expect(gameUi.kind === "stageSurface" ? gameUi.mount.slotId : null).toBe("onStage");
    });

    it("creates Dialog Game UI with slot mount and private widget template", () => {
        const { service } = createHarness();

        const dialog = service.createSurface({
            kind: "stageSurface",
            host: "player",
            name: "Dialog",
            stageMount: { kind: "slot", slotId: "dialog" },
        }) as UIStageSurface;
        const doc = service.getDocument();
        const root = doc.elements[dialog.rootElementId]!;
        const panel = doc.elements[root.childrenIds[0]!]!;
        const stack = doc.elements[panel.childrenIds[0]!]!;
        const children = stack.childrenIds.map(id => doc.elements[id]!.type);

        expect(dialog.mount.slotId).toBe("dialog");
        expect(dialog.settings?.backgroundColor).toBe("transparent");
        expect(panel.type).toBe("nl.container");
        expect(children).toEqual(["nl.dialog.nametag", "nl.dialog.sentence"]);
    });

    it("returns the existing active Game UI when creating a duplicate slot", () => {
        const { service } = createHarness();

        const first = service.createSurface({
            kind: "stageSurface",
            host: "player",
            name: "Dialog",
            stageMount: { kind: "slot", slotId: "dialog" },
        });
        const second = service.createSurface({
            kind: "stageSurface",
            host: "player",
            name: "Dialog Duplicate",
            stageMount: { kind: "slot", slotId: "dialog" },
        });

        const dialogSurfaces = service.getDocument().surfaces.filter(surface =>
            surface.kind === "stageSurface" && surface.mount.slotId === "dialog"
        );
        expect(second.id).toBe(first.id);
        expect(dialogSurfaces).toHaveLength(1);
        expect(dialogSurfaces[0]?.name).toBe("Dialog");
    });

    it("migrates legacy stage mounts and slot aliases", () => {
        const { service } = createHarness();
        const base = service.getDocument();
        const migrated = (service as any).migrateIfNeeded({
            ...base,
            schemaVersion: 9,
            surfaces: [
                base.surfaces[0]!,
                {
                    id: "legacy-menu",
                    name: "Menu",
                    host: "player",
                    kind: "stageSurface",
                    designSize: { width: 1280, height: 720 },
                    rootElementId: base.surfaces[0]!.rootElementId,
                    settings: {},
                    mount: { kind: "slot", slotId: "menu" },
                },
                {
                    id: "legacy-layer",
                    name: "Layer",
                    host: "player",
                    kind: "stageSurface",
                    designSize: { width: 1280, height: 720 },
                    rootElementId: base.surfaces[0]!.rootElementId,
                    settings: {},
                    mount: { kind: "layer" },
                },
                {
                    id: "legacy-missing",
                    name: "Missing",
                    host: "player",
                    kind: "stageSurface",
                    designSize: { width: 1280, height: 720 },
                    rootElementId: base.surfaces[0]!.rootElementId,
                    settings: {},
                    mount: { kind: "slot", slotId: "unknown" },
                },
            ],
        } as UIDocument) as UIDocument;

        const slots = new Map(
            migrated.surfaces
                .filter((surface): surface is UIStageSurface => surface.kind === "stageSurface")
                .map(surface => [surface.id, surface.mount.slotId]),
        );
        expect(migrated.schemaVersion).toBe(UI_DOCUMENT_SCHEMA_VERSION);
        expect(slots.get("legacy-menu")).toBe("choice");
        expect(slots.get("legacy-layer")).toBe("onStage");
        expect(slots.get("legacy-missing")).toBe("onStage");
        for (const surface of migrated.surfaces.filter((surface): surface is UIStageSurface => surface.kind === "stageSurface")) {
            expect(surface.mount.kind).toBe("slot");
            expect(surface.settings?.backgroundColor).toBe("transparent");
        }
    });

    it("renames the main Page display name while preserving the main surface id", () => {
        const { service } = createHarness();
        const mainSurface = service.getDocument().surfaces.find(surface => surface.id === MAIN_APP_SURFACE_ID);

        expect(mainSurface).toBeDefined();
        service.renameSurface(MAIN_APP_SURFACE_ID, "Title Screen");
        expect(mainSurface?.name).toBe("Title Screen");

        service.updateSurface(MAIN_APP_SURFACE_ID, surface => {
            surface.id = "drifted-main-surface";
            surface.name = "Start";
        });
        expect(mainSurface?.id).toBe(MAIN_APP_SURFACE_ID);
        expect(mainSurface?.name).toBe("Start");

        (service as any).ensureMainSurface(service.getDocument());
        expect(mainSurface?.id).toBe(MAIN_APP_SURFACE_ID);
        expect(mainSurface?.name).toBe("Start");
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
