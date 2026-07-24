import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { Services } from "../services";
import { UIBlueprintLifecycleCoordinator } from "./UIBlueprintLifecycleCoordinator";

function element(input: {
    id: string;
    type: string;
    parentId: string | null;
    childrenIds?: string[];
    name?: string;
}): UIElement {
    return {
        id: input.id,
        type: input.type,
        name: input.name,
        parentId: input.parentId,
        childrenIds: input.childrenIds ?? [],
        layout: { x: 0, y: 0, width: 100, height: 100, visible: true, opacity: 1 },
    };
}

function documentWithElements(rootElementId: string, elements: Record<string, UIElement>): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "ui-doc",
        name: "UI",
        surfaces: [
            {
                id: "surface-a",
                name: "Surface A",
                host: "app",
                kind: "appSurface",
                designSize: { width: 1280, height: 720 },
                rootElementId,
            },
        ],
        elements,
        meta: {},
    };
}

function createHarness(document: UIDocument) {
    const blueprintDocument: BlueprintDocument = {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {},
        ownerRecords: {},
        meta: {},
    };
    const ensuredWidgets: Array<{
        surfaceId: string;
        elementId: string;
        displayName?: string;
        widgetType?: string;
    }> = [];
    const coordinator = new UIBlueprintLifecycleCoordinator();

    coordinator.setContext({
        project: {} as any,
        services: {
            get(serviceId: Services) {
                if (serviceId === Services.UIDocument) {
                    return {
                        getDocument: () => document,
                    };
                }
                if (serviceId === Services.LocalBlueprint) {
                    return {
                        getBlueprintDocument: () => blueprintDocument,
                        ensureSurfaceMain: () => "surface-bp",
                        removeSurfaceAndWidgetOwners: () => undefined,
                        ensureWidgetMain: (
                            surfaceId: string,
                            elementId: string,
                            displayName?: string,
                            widgetType?: string,
                        ) => {
                            ensuredWidgets.push({ surfaceId, elementId, displayName, widgetType });
                            return `bp-${surfaceId}-${elementId}`;
                        },
                        removeWidgetMain: () => undefined,
                        ensureComponentWidgetMain: () => "component-widget-bp",
                        removeComponentWidgetMain: () => undefined,
                        removeWidgetValueBlueprint: () => undefined,
                    };
                }
                throw new Error(`Unexpected service ${serviceId}`);
            },
        } as any,
    });

    return { coordinator, ensuredWidgets };
}

describe("UIBlueprintLifecycleCoordinator", () => {
    it("syncs widget owners from shared widget logic without widget module registry state", () => {
        const doc = documentWithElements("root-a", {
            "root-a": element({
                id: "root-a",
                type: "nl.root",
                parentId: null,
                childrenIds: ["container-a"],
                name: "Root",
            }),
            "container-a": element({
                id: "container-a",
                type: "nl.container",
                parentId: "root-a",
                name: "Container",
            }),
        });
        const { coordinator, ensuredWidgets } = createHarness(doc);

        coordinator.syncFromUidoc();

        expect(ensuredWidgets).toEqual([
            {
                surfaceId: "surface-a",
                elementId: "container-a",
                displayName: "Container",
                widgetType: "nl.container",
            },
        ]);
    });

    it("syncs a private widget owner when the widget is the surface root", () => {
        const doc = documentWithElements("container-root", {
            "container-root": element({
                id: "container-root",
                type: "nl.container",
                parentId: null,
                name: "Root Container",
            }),
        });
        const { coordinator, ensuredWidgets } = createHarness(doc);

        coordinator.syncFromUidoc();

        expect(ensuredWidgets).toEqual([
            {
                surfaceId: "surface-a",
                elementId: "container-root",
                displayName: "Root Container",
                widgetType: "nl.container",
            },
        ]);
    });
});
