import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_GAME_IS_DLC_INSTALLED } from "@shared/types/blueprint/graph";
import { countDlcGraphReferences } from "./dlcReferences";

/**
 * What decides whether changing a DLC's id asks first: a graph that picks the DLC by id is one of
 * the two things in a project that stop naming it when the id changes.
 */

function documentWith(nodes: Record<string, { type: string; params?: Record<string, unknown> }>, owned = true): BlueprintDocument {
    return {
        ownerRecords: owned ? { "surfaceMain:title": { blueprintId: "bp-title" } } : {},
        blueprints: {
            "bp-title": {
                id: "bp-title",
                name: "Title",
                owner: { kind: "surfaceMain", surfaceId: "title" },
                graphs: {
                    events: {
                        "ev-1": {
                            id: "ev-1",
                            graph: {
                                nodes: Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, { id, ...node }])),
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

describe("countDlcGraphReferences", () => {
    it("counts every node that picks the DLC by its id", () => {
        const document = documentWith({
            a: { type: BLUEPRINT_NODE_TYPE_GAME_IS_DLC_INSTALLED, params: { dlcId: "extra" } },
            b: { type: BLUEPRINT_NODE_TYPE_GAME_IS_DLC_INSTALLED, params: { dlcId: "extra" } },
            c: { type: BLUEPRINT_NODE_TYPE_GAME_IS_DLC_INSTALLED, params: { dlcId: "voice" } },
        });

        expect(countDlcGraphReferences(document, "extra")).toBe(2);
        expect(countDlcGraphReferences(document, "voice")).toBe(1);
    });

    it("answers zero for a DLC nothing picks yet, including an unpicked node", () => {
        const document = documentWith({
            a: { type: BLUEPRINT_NODE_TYPE_GAME_IS_DLC_INSTALLED, params: {} },
        });

        expect(countDlcGraphReferences(document, "dlc")).toBe(0);
        expect(countDlcGraphReferences(null, "dlc")).toBe(0);
    });

    it("does not count a graph no page or widget owns, which the game never runs", () => {
        const document = documentWith({
            a: { type: BLUEPRINT_NODE_TYPE_GAME_IS_DLC_INSTALLED, params: { dlcId: "extra" } },
        }, false);

        expect(countDlcGraphReferences(document, "extra")).toBe(0);
    });
});
