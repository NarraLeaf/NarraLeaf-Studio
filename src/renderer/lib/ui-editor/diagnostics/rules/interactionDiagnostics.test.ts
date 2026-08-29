import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { UI_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/document";
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
            [`widgetMain:${SURFACE_ID}:${elementId}`]: {
                activeBlueprintId: "bp-1",
                privateBlueprintIds: ["bp-1"],
            },
        },
        blueprints: {
            "bp-1": {
                id: "bp-1",
                name: "Button logic",
                owner: { kind: "widgetMain", surfaceId: SURFACE_ID, elementId },
                program: {
                    kind: "graph",
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
});
