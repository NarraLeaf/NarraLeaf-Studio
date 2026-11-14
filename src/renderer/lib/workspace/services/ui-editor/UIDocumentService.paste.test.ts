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
import { createBlueprintFnRef } from "./blueprint/fnCatalog";

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
        commandLineRun: false,
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
    it("points a pasted slider's structural parts at the pasted children", () => {
        const { service, surfaceId, rootId } = createHarness();
        const slider = {
            ...element("slider", "nl.slider", rootId),
            childrenIds: ["track", "handle"],
            props: { trackElementId: "track", handleElementId: "handle" },
        };
        const track = element("track", "nl.container", slider.id, { sliderSlot: "track" });
        const handle = element("handle", "nl.container", slider.id, { sliderSlot: "handle" });
        const payload: UIEditorClipboardPayload = {
            ...payloadOf(surfaceId, slider),
            elements: { slider, track, handle },
        };

        const result = service.pasteClipboardPayload(surfaceId, rootId, null, payload);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const pasted = service.getDocument().elements[result.newRootIds[0]];
        expect(pasted.props?.trackElementId).toBe(pasted.childrenIds[0]);
        expect(pasted.props?.handleElementId).toBe(pasted.childrenIds[1]);
        expect(slider.props).toEqual({ trackElementId: "track", handleElementId: "handle" });
    });

    it("points a pasted list's scrollbar at the pasted track and thumb", () => {
        const { service, surfaceId, rootId } = createHarness();
        const list = {
            ...element("list", "nl.list", rootId),
            childrenIds: ["track", "thumb"],
            props: { scrollbar: { trackElementId: "track", thumbElementId: "thumb" } },
        };
        const track = element("track", "nl.container", list.id, { listSlot: "scrollbarTrack" });
        const thumb = element("thumb", "nl.container", list.id, { listSlot: "scrollbarThumb" });
        const payload: UIEditorClipboardPayload = { ...payloadOf(surfaceId, list), elements: { list, track, thumb } };

        const result = service.pasteClipboardPayload(surfaceId, rootId, null, payload);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const pasted = service.getDocument().elements[result.newRootIds[0]];
        expect(pasted.props?.scrollbar).toMatchObject({ trackElementId: pasted.childrenIds[0], thumbElementId: pasted.childrenIds[1] });
    });

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

    it("points the copied widget's own function call at the copied blueprint", () => {
        const { service, blueprintDocument, surfaceId, rootId } = createHarness();
        const source = element("source", "nl.text", rootId);
        const sourceBlueprint = createMainBlueprint({
            id: "source-bp",
            name: "Source logic",
            owner: { kind: "widgetMain", surfaceId, elementId: "source" },
        });
        sourceBlueprint.graphs.events = {
            main: { id: "main", graph: { nodes: {
                head: { id: "head", type: "blueprint.fn.head" },
                call: { id: "call", type: "blueprint.fn.call", params: { fnRef: createBlueprintFnRef("source-bp", "head") } },
            }, edges: [] } },
        };

        const result = service.pasteClipboardPayload(surfaceId, rootId, null, payloadOf(surfaceId, source, sourceBlueprint));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const id = blueprintDocument.ownerRecords[widgetMainOwnerKey(surfaceId, result.newRootIds[0])].blueprintId;
        expect(blueprintDocument.blueprints[id].graphs.events.main.graph?.nodes?.call.params?.fnRef)
            .toBe(createBlueprintFnRef(id, "head"));
    });

    it("points a copied widget at the function of another widget copied with it", () => {
        const { service, blueprintDocument, surfaceId, rootId } = createHarness();
        const first = element("first", "nl.text", rootId);
        const second = element("second", "nl.text", rootId);
        const firstBlueprint = createMainBlueprint({ id: "first-bp", name: "First", owner: { kind: "widgetMain", surfaceId, elementId: "first" } });
        const secondBlueprint = createMainBlueprint({ id: "second-bp", name: "Second", owner: { kind: "widgetMain", surfaceId, elementId: "second" } });
        firstBlueprint.graphs.events = {
            main: { id: "main", graph: { nodes: {
                call: { id: "call", type: "blueprint.fn.call", params: { fnRef: createBlueprintFnRef("second-bp", "head") } },
            }, edges: [] } },
        };
        const payload: UIEditorClipboardPayload = {
            v: 1,
            sourceSurfaceId: surfaceId,
            topLevelElementIds: ["first", "second"],
            elements: { first, second },
            widgetMainBlueprints: { "first-bp": firstBlueprint, "second-bp": secondBlueprint },
            widgetValueBlueprints: {},
        };

        const result = service.pasteClipboardPayload(surfaceId, rootId, null, payload);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const firstId = blueprintDocument.ownerRecords[widgetMainOwnerKey(surfaceId, result.newRootIds[0])].blueprintId;
        const secondId = blueprintDocument.ownerRecords[widgetMainOwnerKey(surfaceId, result.newRootIds[1])].blueprintId;
        expect(blueprintDocument.blueprints[firstId].graphs.events.main.graph?.nodes?.call.params?.fnRef)
            .toBe(createBlueprintFnRef(secondId, "head"));
    });
});

describe("pasting a widget's part back into the widget", () => {
    /** A Slider whose handle was deleted: the track is still there, the prop still names the handle. */
    function sliderWithoutHandle() {
        const harness = createHarness();
        const doc = harness.service.getDocument();
        doc.elements.slider = {
            ...element("slider", "nl.slider", harness.rootId),
            childrenIds: ["track"],
            props: { value: 50, trackElementId: "track", handleElementId: "deleted-handle" },
        };
        doc.elements.track = element("track", "nl.container", "slider", { sliderSlot: "track" });
        doc.elements[harness.rootId].childrenIds.push("slider");
        return { ...harness, sliderId: "slider" };
    }

    it("fills the free slot, keeps the part's place inside its widget, and points the widget at it", () => {
        const { service, surfaceId, sliderId } = sliderWithoutHandle();
        const handle = element("copied-handle", "nl.container", "other-slider", { sliderSlot: "handle" });

        const result = service.pasteClipboardPayload(surfaceId, sliderId, null, payloadOf(surfaceId, handle));

        expect(result.ok).toBe(true);
        const [pastedId] = result.ok ? result.newRootIds : [];
        const doc = service.getDocument();
        expect(doc.elements[pastedId].parentId).toBe(sliderId);
        expect(doc.elements[pastedId].layout).toMatchObject({ x: 30, y: 8 });
        expect(doc.elements[sliderId].props?.handleElementId).toBe(pastedId);
    });

    it("refuses an ordinary element, and a part for a slot that is already filled", () => {
        const { service, surfaceId, sliderId } = sliderWithoutHandle();
        const text = element("copied-text", "nl.text", null);
        const track = element("copied-track", "nl.container", null, { sliderSlot: "track" });

        expect(service.pasteClipboardPayload(surfaceId, sliderId, null, payloadOf(surfaceId, text)))
            .toEqual({ ok: false, reason: "invalid_target" });
        expect(service.pasteClipboardPayload(surfaceId, sliderId, null, payloadOf(surfaceId, track)))
            .toEqual({ ok: false, reason: "invalid_target" });
    });
});
