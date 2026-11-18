import { describe, expect, it, vi } from "vitest";
import { encodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { UI_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/document";
import { countBlueprintBroadcastListeners, dispatchBlueprintBroadcastEvent } from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { collectInteractionDiagnostics } from "./interactionDiagnostics";

const SURFACE_ID = "surface-1";

/** Hidden and 10x10, so an element the player is meant to reach earns two of the three findings. */
function unreachable(id: string, type: string): UIElement {
    return {
        id,
        type,
        name: "Start",
        parentId: "root",
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10, opacity: 1, visible: false },
        props: {},
    };
}

function documentWith(element: UIElement): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [{
            id: SURFACE_ID,
            name: "Page",
            host: "app",
            kind: "appSurface",
            designSize: { width: 1920, height: 1080 },
            rootElementId: "root",
        }],
        elements: {
            root: {
                id: "root",
                type: "nl.container",
                parentId: null,
                childrenIds: [element.id],
                layout: { x: 0, y: 0, width: 1920, height: 1080, opacity: 1, visible: true },
                props: {},
            },
            [element.id]: element,
        },
    };
}

/**
 * A widget wired the way the editor wires one: an owner record points at a private blueprint, and
 * the slot is decided by the head node in it rather than by anything on the element.
 */
function blueprintDocumentWiring(elementId: string, headNodeType: string): BlueprintDocument {
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        ownerRecords: {
            [encodeBlueprintOwnerKey({ kind: "widgetMain", surfaceId: SURFACE_ID, elementId: elementId })]: {
                blueprintId: "bp-1",
            },
        },
        blueprints: {
            "bp-1": {
                id: "bp-1",
                name: "Button logic",
                owner: { kind: "widgetMain", surfaceId: SURFACE_ID, elementId },
                graphs: {
                    events: {
                        layer: {
                            id: "layer",
                            name: "Anything at all",
                            graph: { nodes: { head: { id: "head", type: headNodeType } }, edges: [] },
                        },
                    },
                    functions: {},
                },
            },
        },
    } as unknown as BlueprintDocument;
}

/**
 * The page's own blueprint, holding an element literal for `elementId` - the way a tab button shows
 * its panel. `owned: false` leaves it without an owner record, which is a blueprint that never runs.
 */
function withPageNaming(document: BlueprintDocument, elementId: string, owned = true): BlueprintDocument {
    const owner = { kind: "surfaceMain", surfaceId: SURFACE_ID };
    return {
        ...document,
        ownerRecords: {
            ...document.ownerRecords,
            ...(owned ? { [encodeBlueprintOwnerKey(owner as never)]: { blueprintId: "bp-page" } } : {}),
        },
        blueprints: {
            ...document.blueprints,
            "bp-page": {
                id: "bp-page",
                name: "Page",
                owner,
                graphs: {
                    events: {
                        open: {
                            id: "open",
                            name: "Open the panel",
                            graph: {
                                nodes: {
                                    panel: {
                                        id: "panel",
                                        type: "blueprint.element.ref",
                                        params: { surfaceId: SURFACE_ID, elementId, elementType: "nl.container" },
                                    },
                                },
                                edges: [],
                            },
                        },
                    },
                    functions: {},
                },
            },
        },
    } as unknown as BlueprintDocument;
}

function idsFor(element: UIElement, blueprintDocument?: BlueprintDocument): string[] {
    return collectInteractionDiagnostics(documentWith(element), [element], {
        surfaceId: SURFACE_ID,
        blueprintDocument,
    }).map(finding => finding.id);
}

describe("collectInteractionDiagnostics", () => {
    /**
     * The regression this file exists for. These rules were written when a handler lived on the
     * element itself, and were never taught the owner record that replaced it - so for four months
     * they saw nothing at all on any widget the editor had wired, which is all of them.
     */
    it("reports a widget wired through its own blueprint", () => {
        const element = unreachable("btn", "nl.button");

        expect(idsFor(element, blueprintDocumentWiring("btn", "blueprint.event.head.mouseClick")))
            .toEqual(["ix:hidden-events:btn", "ix:small-hit:btn"]);
    });

    it("uses the rendered absolute size for a flipped hit area", () => {
        const element = unreachable("btn", "nl.button");
        element.layout = { ...element.layout, visible: true, width: -10, height: 10 };

        expect(idsFor(element, blueprintDocumentWiring("btn", "blueprint.event.head.mouseClick")))
            .toEqual(["ix:small-hit:btn"]);
    });

    /**
     * The half of the slot list these rules must NOT read. A graph that runs on mount says nothing
     * about whether the player can reach the element, so scenery that initialises itself is not an
     * unreachable button - and the reading these rules used to do, having no slot list to consult,
     * reported it as one.
     */
    it("says nothing about a widget whose only graph runs on mount", () => {
        const element = unreachable("btn", "nl.button");

        expect(idsFor(element, blueprintDocumentWiring("btn", "blueprint.event.head.init"))).toEqual([]);
    });

    it("says nothing about a widget that owns no blueprint at all", () => {
        expect(idsFor(unreachable("btn", "nl.button"), blueprintDocumentWiring("other", "blueprint.event.head.mouseClick")))
            .toEqual([]);
    });

    /**
     * Whether anything answers a player is written only in the blueprint document, so a caller with
     * none to hand gets silence rather than a guess - the rules would otherwise report every widget
     * on the page as an unreachable button.
     */
    it("claims nothing when no blueprint document is supplied", () => {
        expect(idsFor(unreachable("btn", "nl.button"), undefined)).toEqual([]);
    });

    it.each([
        "blueprint.event.head.onAnyBroadcast",
        "blueprint.event.head.onBroadcast",
        "blueprint.event.head.fullscreenChanged",
        "blueprint.event.head.windowFocusChanged",
        "blueprint.event.head.savedVariableChanged",
        "blueprint.event.head.persistentVariableChanged",
    ])("does not treat an ambient %s listener as a reachable control", head => {
        expect(idsFor(unreachable("btn", "nl.button"), blueprintDocumentWiring("btn", head))).toEqual([]);
    });

    it.each([
        "blueprint.event.head.keyDown",
        "blueprint.event.head.keyUp",
        "blueprint.event.head.gamepadButtonDown",
        "blueprint.event.head.gamepadButtonUp",
    ])("does not use hit area or opacity for a %s listener", head => {
        const element = unreachable("btn", "nl.button");
        element.layout = { ...element.layout, visible: true, opacity: 0 };

        expect(idsFor(element, blueprintDocumentWiring("btn", head))).toEqual([]);
    });

    it("still reports a hidden keyboard listener because it is not mounted", () => {
        expect(idsFor(unreachable("btn", "nl.button"), blueprintDocumentWiring("btn", "blueprint.event.head.keyDown")))
            .toEqual(["ix:hidden-events:btn"]);
    });

    it("keeps pointer findings when a widget also listens to an ambient event", () => {
        const bp = blueprintDocumentWiring("btn", "blueprint.event.head.mouseClick");
        bp.blueprints["bp-1"].graphs.events.broadcast = {
            id: "broadcast", name: "Broadcast",
            graph: { nodes: { head: { id: "head", type: "blueprint.event.head.onBroadcast" } }, edges: [] },
        };

        expect(idsFor(unreachable("btn", "nl.button"), bp))
            .toEqual(["ix:hidden-events:btn", "ix:small-hit:btn"]);
    });

    it("does not treat a broadcast payload wire as an executable handler", () => {
        const bp = blueprintDocumentWiring("btn", "blueprint.event.head.mouseClick");
        bp.blueprints["bp-1"].graphs.events.broadcast = {
            id: "broadcast", name: "Broadcast",
            graph: {
                nodes: { head: { id: "head", type: "blueprint.event.head.onBroadcast" } },
                edges: [{ from: { nodeId: "head", port: "data" }, to: { nodeId: "other", port: "value" } }],
            },
        };

        expect(idsFor(unreachable("btn", "nl.button"), bp))
            .toEqual(["ix:hidden-events:btn", "ix:small-hit:btn"]);
    });

    it("recognises a hidden widget that a broadcast can reveal through its own blueprint", async () => {
        const element = unreachable("btn", "nl.button");
        const document = documentWith(element);
        const bp = blueprintDocumentWiring("btn", "blueprint.event.head.mouseClick");
        bp.blueprints["bp-1"].graphs.events.broadcast = {
            id: "broadcast", name: "Reveal",
            graph: {
                nodes: {
                    head: { id: "head", type: "blueprint.event.head.onBroadcast", params: { event: "reveal" } },
                    show: { id: "show", type: "blueprint.button.setVisible", params: { visible: true } },
                },
                edges: [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "show", port: "in" } }],
            },
        };

        expect(countBlueprintBroadcastListeners({ document, blueprintDocument: bp, surfaceId: SURFACE_ID, eventName: "reveal" })).toBe(1);
        const setVisible = vi.fn().mockResolvedValue(undefined);
        const hostAdapter = {
            host: "app",
            blueprintRuntime: { hostApi: { widget: { getCommonProperties: () => ({ visible: false }), setVisible } } },
        } as unknown as UIHostAdapter;
        await dispatchBlueprintBroadcastEvent({
            document, blueprintDocument: bp, persistentVariables: {}, surfaceId: SURFACE_ID,
            eventName: "reveal", data: null, hostAdapter, debug: new DebugBridge(),
            getSurfaceState: () => undefined, setSurfaceState: () => undefined,
        });
        expect(setVisible).toHaveBeenCalledWith("btn", true);
        expect(idsFor(element, bp)).toEqual(["ix:small-hit:btn"]);
    });

    it("keeps a hidden widget's own script layer as a possible source of visibility changes", () => {
        const bp = blueprintDocumentWiring("btn", "blueprint.event.head.mouseClick");
        bp.blueprints["bp-1"].graphs.events.script = {
            id: "script", name: "Script", script: { scriptRef: "scripts/button.ts" },
        };

        expect(idsFor(unreachable("btn", "nl.button"), bp)).toEqual(["ix:small-hit:btn"]);
    });

    /**
     * The starter's Extra page, in miniature: its lists and its picture viewer rest hidden and are
     * shown by the page's blueprint, so on the canvas they are exactly a hidden widget with handlers.
     * Reporting them put two warning boxes over the whole page of a template nobody had touched.
     */
    describe("a widget the game shows", () => {
        const clickable = () => blueprintDocumentWiring("btn", "blueprint.event.head.mouseClick");

        it("is not reported as hidden when a blueprint names it", () => {
            expect(idsFor(unreachable("btn", "nl.button"), withPageNaming(clickable(), "btn")))
                .toEqual(["ix:small-hit:btn"]);
        });

        it("is not reported as transparent when a blueprint names it", () => {
            const faded = unreachable("btn", "nl.button");
            faded.layout = { ...faded.layout, visible: true, opacity: 0 };

            expect(idsFor(faded, withPageNaming(clickable(), "btn"))).toEqual(["ix:small-hit:btn"]);
        });

        it("is not reported as hidden when its visibility is bound", () => {
            const bound = { ...unreachable("btn", "nl.button"), valueBindings: { "layout.visible": { kind: "listItemField", fieldId: "unlocked" } } } as UIElement;

            expect(idsFor(bound, clickable())).toEqual(["ix:small-hit:btn"]);
        });

        /** No owner record means the runtime never resolves the blueprint, so nothing it names is shown. */
        it("is still reported when the blueprint naming it never runs", () => {
            expect(idsFor(unreachable("btn", "nl.button"), withPageNaming(clickable(), "btn", false)))
                .toEqual(["ix:hidden-events:btn", "ix:small-hit:btn"]);
        });

        it("is still reported when the blueprint names a different widget", () => {
            expect(idsFor(unreachable("btn", "nl.button"), withPageNaming(clickable(), "other")))
                .toEqual(["ix:hidden-events:btn", "ix:small-hit:btn"]);
        });
    });
});
