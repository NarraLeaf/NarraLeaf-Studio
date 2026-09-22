import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIEditorClipboardPayload } from "@/lib/ui-editor/commands/uiEditorClipboard";
import { Services } from "../services";
import { UIDocumentService } from "./UIDocumentService";
import { createMainBlueprint } from "./blueprint/blueprintFactories";
import { derivedBlueprintId } from "./blueprint/derivedBlueprintId";
import { assertValidBlueprintDocument } from "./blueprint/documentValidation";
import { widgetMainOwnerKey } from "./blueprint/ownerKeys";
import { setPrivateOwnerBlueprint } from "./blueprint/ownerRecords";

/**
 * A document service wired the way the workspace wires it, as far as a paste reaches: the blueprint
 * document is checked after every write, as `LocalBlueprintService.applyBlueprintMutation` checks it,
 * and every element write runs a stand-in for the lifecycle sweep, which gives each element that has
 * no blueprint an empty one on the spot (`UIBlueprintLifecycleCoordinator` via the after-mutate hook).
 */
function createHarness() {
    let nextId = 0;
    const service = new UIDocumentService();
    const blueprintDocument: BlueprintDocument = {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {},
        ownerRecords: {},
        meta: {},
    };
    const applyBlueprintMutation = (mutator: (doc: BlueprintDocument) => void) => {
        mutator(blueprintDocument);
        assertValidBlueprintDocument(blueprintDocument);
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
                    return { applyBlueprintMutation, getBlueprintDocument: () => blueprintDocument };
                }
                throw new Error(`Unexpected service ${serviceId}`);
            },
        } as any,
    });
    (service as any).document = (service as any).createEmptyDocument();
    const surfaceId = service.getDocument().surfaces[0].id;
    const rootId = service.getDocument().surfaces[0].rootElementId;
    service.setAfterMutateHook(() => {
        applyBlueprintMutation(doc => {
            for (const elementId of Object.keys(service.getDocument().elements)) {
                const key = widgetMainOwnerKey(surfaceId, elementId);
                if (!doc.ownerRecords[key]) {
                    const id = derivedBlueprintId(key);
                    doc.blueprints[id] = createMainBlueprint({ id, name: "Widget", owner: { kind: "widgetMain", surfaceId, elementId } });
                    setPrivateOwnerBlueprint(doc, key, id);
                }
            }
        });
    });
    return { service, blueprintDocument, surfaceId, rootId };
}

function element(id: string, type: string, parentId: string | null, extra?: Record<string, unknown>): UIElement {
    return {
        id,
        type,
        parentId,
        childrenIds: [],
        layout: { x: 30, y: 8, width: 24, height: 30, visible: true, opacity: 1 },
        ...(extra ? { extra } : {}),
    };
}

function payloadOf(surfaceId: string, copied: UIElement, blueprint?: ReturnType<typeof createMainBlueprint>): UIEditorClipboardPayload {
    return {
        v: 1,
        sourceSurfaceId: surfaceId,
        topLevelElementIds: [copied.id],
        elements: { [copied.id]: copied },
        widgetMainBlueprints: blueprint ? { [blueprint.id]: blueprint } : {},
        widgetValueBlueprints: {},
    };
}

describe("pasting an element that carries its own blueprint", () => {
    it("leaves the blueprint document valid, with the copy's blueprint in the new element's slot", () => {
        const { service, blueprintDocument, surfaceId, rootId } = createHarness();
        const source = element("source", "nl.text", rootId);
        const sourceBlueprint = createMainBlueprint({
            id: "source-bp",
            name: "Source logic",
            owner: { kind: "widgetMain", surfaceId, elementId: "source" },
        });

        const result = service.pasteClipboardPayload(surfaceId, rootId, null, payloadOf(surfaceId, source, sourceBlueprint));

        expect(result.ok).toBe(true);
        const [pastedId] = result.ok ? result.newRootIds : [];
        expect(() => assertValidBlueprintDocument(blueprintDocument)).not.toThrow();
        const slot = blueprintDocument.ownerRecords[widgetMainOwnerKey(surfaceId, pastedId)];
        expect(blueprintDocument.blueprints[slot.blueprintId].name).toBe("Source logic");
        // The empty blueprint the sweep gave the element while it was being written is gone.
        expect(blueprintDocument.blueprints[derivedBlueprintId(widgetMainOwnerKey(surfaceId, pastedId))]).toBeUndefined();
    });
});
