import { afterEach, describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { Services } from "../services";
import { UIBlueprintLifecycleCoordinator } from "./UIBlueprintLifecycleCoordinator";
import { widgetMainOwnerKey } from "./blueprint/ownerKeys";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";

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

function createHarness(document: UIDocument, ownerRecords: BlueprintDocument["ownerRecords"] = {}) {
    const blueprintDocument: BlueprintDocument = {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {},
        ownerRecords,
        meta: {},
    };
    const removedWidgets: string[] = [];
    const ensuredWidgets: Array<{
        surfaceId: string;
        elementId: string;
        displayName?: string;
        widgetType?: string;
    }> = [];
    const coordinator = new UIBlueprintLifecycleCoordinator();

    const context = {
        project: {} as any,
        services: {
            get(serviceId: Services) {
                if (serviceId === Services.UIDocument) {
                    return {
                        getDocument: () => document,
                        setAfterMutateHook: () => undefined,
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
                        removeWidgetMain: (_surfaceId: string, elementId: string) => {
                            removedWidgets.push(elementId);
                        },
                        ensureComponentWidgetMain: () => "component-widget-bp",
                        removeComponentWidgetMain: () => undefined,
                        removeWidgetValueBlueprint: () => undefined,
                    };
                }
                throw new Error(`Unexpected service ${serviceId}`);
            },
        } as any,
    };
    coordinator.setContext(context as any);

    return { coordinator, context, ensuredWidgets, removedWidgets };
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

describe("UIBlueprintLifecycleCoordinator with plugin widgets", () => {
    const PLUGIN_ID = "probe.coordinator";
    const RATING = `${PLUGIN_ID}.rating`;

    afterEach(() => {
        widgetModuleRegistry.unregister(RATING);
    });

    function pageWithRating(): UIDocument {
        return documentWithElements("root-a", {
            "root-a": element({ id: "root-a", type: "nl.root", parentId: null, childrenIds: ["rating-a"] }),
            "rating-a": element({ id: "rating-a", type: RATING, parentId: "root-a", name: "Rating" }),
        });
    }

    it("gives a plugin widget that declares a blueprint one of its own, as a built-in gets", () => {
        widgetModuleRegistry.register({
            type: RATING,
            displayName: "Rating",
            icon: (() => null) as never,
            logicApi: { supportsPrivateBlueprint: true, events: [], commands: [], readableState: [], writableProps: [] },
            createDefaultElement: () => ({}),
            render: () => null,
        }, { ownerPluginId: PLUGIN_ID });
        const { coordinator, ensuredWidgets } = createHarness(pageWithRating());

        coordinator.syncFromUidoc();

        expect(ensuredWidgets.map(entry => entry.elementId)).toEqual(["rating-a"]);
    });

    it("gives one to a plugin widget already on the page when its plugin loads", async () => {
        const { coordinator, context, ensuredWidgets } = createHarness(pageWithRating());
        coordinator.activate(context as any);
        expect(ensuredWidgets).toEqual([]);

        // Nothing in the document changes: the plugin arriving is what changes the answer.
        widgetModuleRegistry.register({
            type: RATING,
            displayName: "Rating",
            icon: (() => null) as never,
            logicApi: { supportsPrivateBlueprint: true, events: [], commands: [], readableState: [], writableProps: [] },
            createDefaultElement: () => ({}),
            render: () => null,
        }, { ownerPluginId: PLUGIN_ID });
        await Promise.resolve();

        expect(ensuredWidgets.map(entry => entry.elementId)).toEqual(["rating-a"]);
        coordinator.dispose(context as any);
    });

    it("keeps the blueprint of a plugin widget whose plugin is not loaded", () => {
        // The author wrote this graph while the plugin was on. With it off nothing can say whether
        // the widget takes a blueprint, and collecting it would delete their work on a guess.
        const { coordinator, removedWidgets } = createHarness(pageWithRating(), {
            [widgetMainOwnerKey("surface-a", "rating-a")]: { blueprintId: "bp-rating" },
        });

        coordinator.syncFromUidoc();

        expect(removedWidgets).toEqual([]);
    });

    it("still collects the blueprint of a built-in widget that takes none", () => {
        const { coordinator, removedWidgets } = createHarness(pageWithRating(), {
            [widgetMainOwnerKey("surface-a", "root-a")]: { blueprintId: "bp-root" },
        });

        coordinator.syncFromUidoc();

        expect(removedWidgets).toEqual(["root-a"]);
    });
});
