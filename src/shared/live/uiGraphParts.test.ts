import { describe, expect, it } from "vitest";
import type { UIGraphDocument } from "@shared/types/ui-editor/graph";
import {
    applyUIGraphParts,
    diffUIGraphParts,
    uiBlueprintDigest,
    uiGraphPartsBefore,
    uiGraphPartsNodes,
    uiGraphPartsRestored,
    uiGraphPartsTouched,
    uiGraphPartsUpdates,
    uiGraphShellDigest,
} from "./uiGraphParts";

/**
 * The blueprint document as a set of records.
 *
 * The interface delta's tests one file along, holding to the same property: the delta and the
 * applier are inverses, so a machine that applies what another machine's diff produced ends up
 * holding the same document.
 */

function node(id: string, x = 0): unknown {
    return { id, type: "blueprint.log", params: {}, meta: { editorLayout: { x, y: 0 } } };
}

function document(): UIGraphDocument {
    return {
        schemaVersion: 2,
        graphs: {},
        blueprintDocument: {
            schemaVersion: 10,
            blueprints: {
                "bp-1": {
                    id: "bp-1",
                    name: "Start",
                    owner: { kind: "widgetMain", surfaceId: "s1", elementId: "btn-1" },
                    frontend: "visual",
                    programKind: "graph",
                    program: {
                        kind: "graph",
                        graphs: {
                            eventIds: ["ev-1"],
                            events: {
                                "ev-1": {
                                    id: "ev-1",
                                    name: "Click",
                                    graph: {
                                        nodes: { "n-1": node("n-1"), "n-2": node("n-2", 200) },
                                        edges: [{ from: { nodeId: "n-1", port: "then" }, to: { nodeId: "n-2", port: "in" } }],
                                    },
                                },
                            },
                            functionIds: [],
                            functions: {},
                        },
                    },
                },
                "bp-2": {
                    id: "bp-2",
                    name: "Other",
                    owner: { kind: "globalMain" },
                    frontend: "visual",
                    programKind: "graph",
                    program: { kind: "graph", graphs: { eventIds: [], events: {}, functionIds: [], functions: {} } },
                },
            },
            ownerRecords: {
                "widgetMain:s1:btn-1": { activeBlueprintId: "bp-1", privateBlueprintIds: ["bp-1"] },
            },
        },
    } as unknown as UIGraphDocument;
}

function clone(value: UIGraphDocument): UIGraphDocument {
    return JSON.parse(JSON.stringify(value)) as UIGraphDocument;
}

function eventGraph(doc: UIGraphDocument, blueprintId = "bp-1", graphId = "ev-1") {
    const blueprint = doc.blueprintDocument.blueprints[blueprintId];
    if (blueprint.program.kind !== "graph") {
        throw new Error("not a graph program");
    }
    return blueprint.program.graphs.events[graphId];
}

describe("the blueprint document as a delta of records", () => {
    it("says nothing changed when nothing did", () => {
        expect(diffUIGraphParts(document(), document())).toBeNull();
    });

    it("names one node when one node moved, and nothing else in the graph", () => {
        // ⚠ The whole reason a node is the unit: the largest node in the shipped skeleton is 286
        // bytes, where its blueprint is 25 KB and the message cap is 16 KB.
        const before = document();
        const after = clone(before);
        eventGraph(after).graph!.nodes!["n-2"].meta = { editorLayout: { x: 500, y: 0 } };

        const parts = diffUIGraphParts(before, after)!;
        expect(Object.keys(parts.graphs?.["bp-1"]?.events?.["ev-1"]?.nodes ?? {})).toEqual(["n-2"]);
        expect(parts.graphs?.["bp-1"]?.events?.["ev-1"]?.edges).toBeUndefined();
        expect(parts.blueprints).toBeUndefined();

        const applied = clone(before);
        applyUIGraphParts(applied, parts);
        expect(applied).toEqual(after);
    });

    it("carries a graph's wires whole, because a wire has no identity beyond its two ends", () => {
        // And because the list's order decides which branch of a fan-out runs first: a machine that
        // appended where another inserted would hold a graph that runs differently while agreeing
        // about every wire in it.
        const before = document();
        const after = clone(before);
        eventGraph(after).graph!.edges = [
            { from: { nodeId: "n-2", port: "then" }, to: { nodeId: "n-1", port: "in" } },
        ];

        const parts = diffUIGraphParts(before, after)!;
        expect(parts.graphs?.["bp-1"]?.events?.["ev-1"]?.edges).toHaveLength(1);
        expect(parts.graphs?.["bp-1"]?.events?.["ev-1"]?.nodes).toBeUndefined();

        const applied = clone(before);
        applyUIGraphParts(applied, parts);
        expect(applied).toEqual(after);
    });

    it("carries a blueprint's shell without its graphs, and keeps the graphs it already had", () => {
        const before = document();
        const after = clone(before);
        after.blueprintDocument.blueprints["bp-1"].name = "Renamed";

        const parts = diffUIGraphParts(before, after)!;
        const shell = parts.blueprints?.["bp-1"];
        expect(shell?.name).toBe("Renamed");
        expect(shell?.program.kind === "graph" ? shell.program.graphs : null).not.toHaveProperty("events");

        const applied = clone(before);
        applyUIGraphParts(applied, parts);
        expect(applied).toEqual(after);
    });

    it("keeps a slot it is removing whole, because nothing else holds what was in it", () => {
        const before = document();
        const after = clone(before);
        const graphs = after.blueprintDocument.blueprints["bp-1"].program;
        if (graphs.kind === "graph") {
            delete graphs.graphs.events["ev-1"];
            graphs.graphs.eventIds = [];
        }

        const parts = diffUIGraphParts(before, after)!;
        expect(parts.graphs?.["bp-1"]?.events?.["ev-1"]).toBeNull();

        const kept = uiGraphPartsBefore(before, parts);
        const applied = clone(before);
        applyUIGraphParts(applied, parts);
        expect(eventGraph(applied)).toBeUndefined();

        applyUIGraphParts(applied, kept);
        expect(applied).toEqual(before);
    });

    it("puts a removed blueprint back with its graphs, not as an empty shell", () => {
        // The interface's removed-component case, one document along and for the same reason: the
        // shell is what travels, and nothing else holds what was inside it.
        const before = document();
        const after = clone(before);
        delete after.blueprintDocument.blueprints["bp-1"];

        const parts = diffUIGraphParts(before, after)!;
        expect(parts.blueprints?.["bp-1"]).toBeNull();
        expect(parts.graphs?.["bp-1"]).toBeUndefined();

        const kept = uiGraphPartsBefore(before, parts);
        // Every graph is in the record kept for the inverse, though the delta never named one.
        expect(Object.keys(kept.graphs?.["bp-1"]?.events ?? {})).toEqual(["ev-1"]);
        expect(Object.keys(kept.graphs?.["bp-1"]?.events?.["ev-1"]?.nodes ?? {}).sort()).toEqual(["n-1", "n-2"]);
        const applied = clone(before);
        applyUIGraphParts(applied, parts);
        expect(applied.blueprintDocument.blueprints["bp-1"]).toBeUndefined();

        applyUIGraphParts(applied, kept);
        expect(applied).toEqual(before);
    });

    it("puts a deleted node back exactly as it was", () => {
        const before = document();
        const after = clone(before);
        delete eventGraph(after).graph!.nodes!["n-2"];
        eventGraph(after).graph!.edges = [];

        const parts = diffUIGraphParts(before, after)!;
        const kept = uiGraphPartsBefore(before, parts);
        const applied = clone(before);
        applyUIGraphParts(applied, parts);
        expect(Object.keys(eventGraph(applied).graph!.nodes!)).toEqual(["n-1"]);

        applyUIGraphParts(applied, kept);
        expect(applied).toEqual(before);
    });

    it("carries the owner records, which is how a widget finds its blueprint again", () => {
        const before = document();
        const after = clone(before);
        after.blueprintDocument.ownerRecords["surfaceMain:s1"] = {
            activeBlueprintId: "bp-2",
            privateBlueprintIds: ["bp-2"],
        };

        const parts = diffUIGraphParts(before, after)!;
        expect(Object.keys(parts.owners ?? {})).toEqual(["surfaceMain:s1"]);

        const applied = clone(before);
        applyUIGraphParts(applied, parts);
        expect(applied).toEqual(after);
    });
});

describe("what a blueprint delta claims and asserts", () => {
    it("names every node it writes, with its blueprint and its graph", () => {
        // ⚠ Both, because node ids are not unique across the document: the seeded entry nodes use
        // fixed ids, and `global.appBoot` is in every project.
        const before = document();
        const after = clone(before);
        eventGraph(after).graph!.nodes!["n-1"].params = { message: "x" };

        const parts = diffUIGraphParts(before, after)!;
        expect(uiGraphPartsNodes(parts)).toEqual([{ blueprintId: "bp-1", graphId: "ev-1", nodeId: "n-1" }]);
    });

    it("tells a blueprint it is changing from one it is creating", () => {
        const before = document();
        const after = clone(before);
        after.blueprintDocument.blueprints["bp-3"] = {
            ...clone(before).blueprintDocument.blueprints["bp-2"],
            id: "bp-3",
        };
        eventGraph(after).graph!.nodes!["n-1"].params = { message: "x" };

        const parts = diffUIGraphParts(before, after)!;
        expect(uiGraphPartsUpdates(before, parts)).toEqual(["bp-1"]);
    });

    it("does not demand a blueprint the inverse is about to take away", () => {
        const before = document();
        const after = clone(before);
        after.blueprintDocument.blueprints["bp-3"] = {
            ...clone(before).blueprintDocument.blueprints["bp-2"],
            id: "bp-3",
            program: {
                kind: "graph",
                graphs: { eventIds: ["e"], events: { e: { id: "e", graph: { nodes: {}, edges: [] } } }, functionIds: [], functions: {} },
            },
        } as never;

        const parts = diffUIGraphParts(before, after)!;
        const kept = uiGraphPartsBefore(before, parts);
        expect(kept.blueprints?.["bp-3"]).toBeNull();
        expect(uiGraphPartsRestored(kept)).toEqual([]);
    });
});

describe("which units a blueprint delta changed, and their fingerprints", () => {
    it("names the blueprint, never the document", () => {
        const before = document();
        const after = clone(before);
        eventGraph(after).graph!.nodes!["n-1"].params = { message: "x" };

        const parts = diffUIGraphParts(before, after)!;
        expect(uiGraphPartsTouched(parts)).toEqual({ blueprints: ["bp-1"], shell: false });
    });

    it("names the shell when the owner records moved", () => {
        const before = document();
        const after = clone(before);
        delete after.blueprintDocument.ownerRecords["widgetMain:s1:btn-1"];

        const parts = diffUIGraphParts(before, after)!;
        expect(uiGraphPartsTouched(parts).shell).toBe(true);
    });

    it("covers one blueprint and nothing beside it", () => {
        const edited = clone(document());
        eventGraph(edited).graph!.nodes!["n-1"].params = { message: "x" };
        expect(uiBlueprintDigest(edited, "bp-1")).not.toBe(uiBlueprintDigest(document(), "bp-1"));
        expect(uiBlueprintDigest(edited, "bp-2")).toBe(uiBlueprintDigest(document(), "bp-2"));
    });

    it("gives an absent blueprint a value rather than no digest", () => {
        const without = clone(document());
        delete without.blueprintDocument.blueprints["bp-2"];
        expect(uiBlueprintDigest(without, "bp-2")).toBe(uiBlueprintDigest(null, "bp-2"));
    });

    it("leaves the document's own timestamps out of the shell", () => {
        // ⚠ `meta.updatedAt` is stamped from the clock of whichever machine wrote the file, so
        // hashing it would eject every guest in the room on every save.
        const stamped = clone(document());
        stamped.meta = { updatedAt: new Date().toISOString() };
        expect(uiGraphShellDigest(stamped)).toBe(uiGraphShellDigest(document()));
    });
});
