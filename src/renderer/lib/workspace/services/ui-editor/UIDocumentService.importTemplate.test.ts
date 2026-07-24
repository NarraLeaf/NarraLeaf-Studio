import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { Services } from "../services";
import { UIDocumentService } from "./UIDocumentService";

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
