import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UISurface } from "@shared/types/ui-editor/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { Services } from "../services";
import { IMPORT_PLACEMENT_FROM_SOURCE, resolveImportedSurfacePlacement, UIDocumentService } from "./UIDocumentService";

/** Minimal harness: a UIDocumentService wired to stub Uuid + LocalBlueprint
 * services, seeded with a fresh empty document (one main app surface). */
function createHarness() {
    let nextId = 0;
    const service = new UIDocumentService();
    const blueprintDocument: any = {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {},
        ownerRecords: {},
        meta: {},
    };
    const upsertBlueprint = (id: string, owner: any) => {
        blueprintDocument.blueprints[id] = blueprintDocument.blueprints[id] ?? {
            id,
            name: id,
            owner,
            frontend: "visual",
            programKind: "graph",
            program: { kind: "graph", graphs: { events: {}, functions: {} } },
            members: { variables: {}, fields: {}, functions: {} },
            bindings: {},
        };
        const ownerKey = JSON.stringify(owner);
        blueprintDocument.ownerRecords[ownerKey] = {
            activeBlueprintId: id,
            privateBlueprintIds: [id],
            initializedFrontend: "visual",
        };
        return id;
    };
    const localBlueprintService = {
        applyBlueprintMutation: (mutator: (doc: any) => void) => mutator(blueprintDocument),
        getBlueprintDocument: () => blueprintDocument,
        ensureWidgetMain: (surfaceId: string, elementId: string) =>
            upsertBlueprint(`wm-${elementId}`, { kind: "widgetMain", surfaceId, elementId }),
        ensureWidgetValueBlueprint: (input: { surfaceId: string; elementId: string; propPath: string }) =>
            upsertBlueprint(`wv-${input.elementId}-${input.propPath}`, {
                kind: "widgetValue",
                surfaceId: input.surfaceId,
                elementId: input.elementId,
                propPath: input.propPath,
            }),
    };
    service.setContext({
        project: { resolve: (name: string) => name } as any,
        services: {
            get(serviceId: Services) {
                if (serviceId === Services.Uuid) {
                    return { generate: () => `gen-${++nextId}` };
                }
                if (serviceId === Services.Project) {
                    return { getProjectConfig: () => ({ metadata: { resolution: { width: 1280, height: 720 } } }) };
                }
                if (serviceId === Services.LocalBlueprint) {
                    return localBlueprintService;
                }
                throw new Error(`Unexpected service ${serviceId}`);
            },
        } as any,
    });
    (service as any).document = (service as any).createEmptyDocument();
    return { service, blueprintDocument };
}

/** A current-schema template document: one app surface, a root with an image
 * child that references an asset by id. */
function templateDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "tpl-doc",
        name: "Template",
        surfaces: [{
            id: "src-surface",
            name: "Source",
            host: "app",
            kind: "appSurface",
            designSize: { width: 1280, height: 720 },
            rootElementId: "src-root",
        }],
        components: [],
        elements: {
            "src-root": {
                id: "src-root",
                type: "nl.root",
                name: "Root",
                parentId: null,
                childrenIds: ["src-img"],
                layout: { x: 0, y: 0, width: 1280, height: 720, visible: true, opacity: 1 },
            },
            "src-img": {
                id: "src-img",
                type: "nl.image",
                name: "Background",
                parentId: "src-root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 400, height: 300, visible: true, opacity: 1 },
                props: { imageFill: { mode: "cover", assetId: "src-asset-1" } },
            },
        },
        meta: {},
    } as UIDocument;
}

/**
 * A page copied in another project: one Game UI on the `dialog` slot, plus the widget blueprint
 * that belongs to an element on it. Blueprints are the part that cannot travel on the surface -
 * they are filed against `(surfaceId, elementId)` - so the import has to re-key them.
 */
function copiedGameUiDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "src-doc",
        name: "Source",
        surfaces: [{
            id: "src-dialog",
            name: "Dialogue",
            host: "player",
            kind: "stageSurface",
            designSize: { width: 1280, height: 720 },
            rootElementId: "src-dialog-root",
            mount: { kind: "slot", slotId: "dialog" },
        }],
        components: [],
        elements: {
            "src-dialog-root": {
                id: "src-dialog-root",
                type: "nl.root",
                name: "Root",
                parentId: null,
                childrenIds: ["src-button"],
                layout: { x: 0, y: 0, width: 1280, height: 720, visible: true, opacity: 1 },
            },
            "src-button": {
                id: "src-button",
                type: "nl.container",
                name: "Button",
                parentId: "src-dialog-root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 100, height: 40, visible: true, opacity: 1 },
                extra: { componentLink: { componentId: "src-component" } },
            },
        },
        meta: {},
    } as unknown as UIDocument;
}

function copiedGameUiGraphs() {
    return {
        blueprintDocument: {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: {
                "src-bp": {
                    id: "src-bp",
                    name: "Button",
                    owner: { kind: "widgetMain", surfaceId: "src-dialog", elementId: "src-button" },
                    frontend: "visual",
                    programKind: "graph",
                    program: { kind: "graph", graphs: { events: {}, functions: {} } },
                },
            },
            ownerRecords: {
                "widgetMain:src-dialog:src-button": {
                    activeBlueprintId: "src-bp",
                    privateBlueprintIds: ["src-bp"],
                },
            },
        },
    };
}

const emptyGraphs = {
    schemaVersion: 2,
    graphs: {},
    blueprintDocument: {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {},
        ownerRecords: {},
        meta: {},
    },
};

describe("UIDocumentService.importTemplateBundle", () => {
    it("appends the template's surface with freshly generated ids", () => {
        const { service } = createHarness();
        const before = service.getDocument().surfaces.length;

        const result = service.importTemplateBundle({
            document: templateDocument(),
            graphs: emptyGraphs,
            placement: { kind: "appSurface" },
        });

        expect(result.importedSurfaces).toHaveLength(1);
        expect(result.skippedSlots).toHaveLength(0);
        const doc = service.getDocument();
        expect(doc.surfaces).toHaveLength(before + 1);

        const imported = result.importedSurfaces[0];
        // Source ids must not leak into the live document.
        expect(imported.id).not.toBe("src-surface");
        expect(doc.elements["src-root"]).toBeUndefined();
        expect(doc.elements["src-img"]).toBeUndefined();
        // The imported root exists under a new id and has no parent.
        const root = doc.elements[imported.rootElementId];
        expect(root).toBeDefined();
        expect(root!.parentId).toBeNull();
    });

    it("applies the declared placement, overriding the source surface kind", () => {
        const { service } = createHarness();

        const result = service.importTemplateBundle({
            document: templateDocument(), // source is an appSurface
            graphs: emptyGraphs,
            placement: { kind: "stageSurface", slotId: "dialog" },
        });

        const imported = result.importedSurfaces[0];
        expect(imported.kind).toBe("stageSurface");
        expect(imported.kind === "stageSurface" ? imported.mount.slotId : null).toBe("dialog");
    });

    it("skips a surface whose target stage slot is already occupied", () => {
        const { service } = createHarness();
        service.createSurface({ kind: "stageSurface", host: "player", name: "Dialog", stageMount: { kind: "slot", slotId: "dialog" } });

        const result = service.importTemplateBundle({
            document: templateDocument(),
            graphs: emptyGraphs,
            placement: { kind: "stageSurface", slotId: "dialog" },
        });

        expect(result.importedSurfaces).toHaveLength(0);
        expect(result.skippedSlots).toEqual(["dialog"]);
    });

    it("remaps referenced asset ids through the provided assetIdMap", () => {
        const { service } = createHarness();

        const result = service.importTemplateBundle({
            document: templateDocument(),
            graphs: emptyGraphs,
            placement: { kind: "appSurface" },
            assetIdMap: { "src-asset-1": "project-asset-9" },
        });

        const doc = service.getDocument();
        const imported = result.importedSurfaces[0];
        const rootChildId = doc.elements[imported.rootElementId]!.childrenIds[0]!;
        const image = doc.elements[rootChildId]!;
        expect((image.props as any).imageFill.assetId).toBe("project-asset-9");
    });
});

describe("resolveImportedSurfacePlacement", () => {
    it("passes a declared placement through untouched", () => {
        const declared = { kind: "stageSurface", slotId: "choice" } as const;
        const surface = { kind: "appSurface" } as UISurface;

        expect(resolveImportedSurfacePlacement(declared, surface)).toBe(declared);
    });

    it("keeps the stage slot a Game UI already had", () => {
        const surface = { kind: "stageSurface", mount: { kind: "slot", slotId: "nvl" } } as UISurface;

        expect(resolveImportedSurfacePlacement(IMPORT_PLACEMENT_FROM_SOURCE, surface))
            .toEqual({ kind: "stageSurface", slotId: "nvl" });
    });

    it("places a page as a page, which has nowhere else to be", () => {
        const surface = { kind: "appSurface" } as UISurface;

        expect(resolveImportedSurfacePlacement(IMPORT_PLACEMENT_FROM_SOURCE, surface))
            .toEqual({ kind: "appSurface" });
    });

    it("falls back to the default slot for a stage surface with no mount", () => {
        const surface = { kind: "stageSurface" } as unknown as UISurface;

        expect(resolveImportedSurfacePlacement(IMPORT_PLACEMENT_FROM_SOURCE, surface))
            .toEqual({ kind: "stageSurface", slotId: "onStage" });
    });
});

describe("importTemplateBundle: a surface copied from another project", () => {
    it("keeps the kind and the stage slot the surface had over there", () => {
        const { service } = createHarness();

        const result = service.importTemplateBundle({
            document: copiedGameUiDocument(),
            graphs: copiedGameUiGraphs(),
            placement: IMPORT_PLACEMENT_FROM_SOURCE,
        });

        expect(result.skippedSlots).toHaveLength(0);
        const imported = result.importedSurfaces[0]!;
        expect(imported.kind).toBe("stageSurface");
        expect(imported.kind === "stageSurface" ? imported.mount.slotId : null).toBe("dialog");
        expect(imported.name).toBe("Dialogue");
    });

    it("re-ids the surface and its elements so no foreign id reaches the document", () => {
        const { service } = createHarness();

        const result = service.importTemplateBundle({
            document: copiedGameUiDocument(),
            graphs: copiedGameUiGraphs(),
            placement: IMPORT_PLACEMENT_FROM_SOURCE,
        });

        const doc = service.getDocument();
        const imported = result.importedSurfaces[0]!;
        expect(imported.id).not.toBe("src-dialog");
        expect(doc.elements["src-dialog-root"]).toBeUndefined();
        expect(doc.elements["src-button"]).toBeUndefined();
        expect(doc.elements[imported.rootElementId]!.parentId).toBeNull();
    });

    it("re-keys the blueprints that were filed against the old surface and element", () => {
        const { service, blueprintDocument } = createHarness();

        const result = service.importTemplateBundle({
            document: copiedGameUiDocument(),
            graphs: copiedGameUiGraphs(),
            placement: IMPORT_PLACEMENT_FROM_SOURCE,
        });

        const imported = result.importedSurfaces[0]!;
        const newButtonId = service.getDocument().elements[imported.rootElementId]!.childrenIds[0]!;
        const ownerKey = `widgetMain:${imported.id}:${newButtonId}`;
        expect(Object.keys(blueprintDocument.ownerRecords)).toContain(ownerKey);
        expect(blueprintDocument.ownerRecords["widgetMain:src-dialog:src-button"]).toBeUndefined();

        const newBlueprintId = blueprintDocument.ownerRecords[ownerKey].activeBlueprintId;
        expect(newBlueprintId).not.toBe("src-bp");
        expect(blueprintDocument.blueprints[newBlueprintId].owner).toEqual({
            kind: "widgetMain",
            surfaceId: imported.id,
            elementId: newButtonId,
        });
    });

    it("leaves a library component this project does not have named by the instance using it", () => {
        const { service } = createHarness();

        const result = service.importTemplateBundle({
            document: copiedGameUiDocument(),
            graphs: copiedGameUiGraphs(),
            placement: IMPORT_PLACEMENT_FROM_SOURCE,
        });

        const doc = service.getDocument();
        const imported = result.importedSurfaces[0]!;
        const button = doc.elements[doc.elements[imported.rootElementId]!.childrenIds[0]!]!;
        // Kept, never blanked: `ui/component-missing` reports it where it sits, and the link is
        // still correct the moment the author adds that component.
        expect((button.extra as any).componentLink.componentId).toBe("src-component");
    });

    it("does not import a Game UI whose stage slot this project has already filled", () => {
        const { service } = createHarness();
        service.createSurface({
            kind: "stageSurface",
            host: "player",
            name: "Dialog",
            stageMount: { kind: "slot", slotId: "dialog" },
        });
        const before = service.getDocument().surfaces.length;

        const result = service.importTemplateBundle({
            document: copiedGameUiDocument(),
            graphs: copiedGameUiGraphs(),
            placement: IMPORT_PLACEMENT_FROM_SOURCE,
        });

        expect(result.importedSurfaces).toHaveLength(0);
        expect(result.skippedSlots).toEqual(["dialog"]);
        // Nothing was replaced and nothing was moved to a free slot.
        expect(service.getDocument().surfaces).toHaveLength(before);
    });
});
