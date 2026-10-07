import { describe, expect, it } from "vitest";
import type { Blueprint, BlueprintDocument, BlueprintGraphNode } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL, BLUEPRINT_NODE_TYPE_FN_CALL } from "@shared/types/blueprint/graph";
import {
    catalogStoryBlueprintNodeReader,
    storyBlueprintName,
    summarizeStoryBlueprint,
    type StoryBlueprintNodeCatalog,
    type StoryBlueprintNodeReader,
} from "./storyBlueprintSummary";

const SOUND = "test.playSound";
const NOTE = "test.comment";

/** Titles a fake catalogue knows, with the exec pins every node here runs through. */
const read: StoryBlueprintNodeReader = node => {
    if (node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL) {
        return { title: "On Call", execOutputs: ["then"], passive: false, head: true };
    }
    if (node.type === NOTE) {
        return { title: "Note", execOutputs: [], passive: true, head: false };
    }
    if (node.type === SOUND) {
        return { title: "Play Sound", execOutputs: ["next"], passive: false, head: false };
    }
    if (node.type === BLUEPRINT_NODE_TYPE_FN_CALL) {
        return { title: String(node.params?.label ?? "Call Fn"), execOutputs: ["next"], passive: false, head: false };
    }
    return null;
};

function storyBlueprint(
    nodes: BlueprintGraphNode[],
    wires: [string, string, string][],
    extra: { name?: string; mode?: "action" | "value" | "condition" } = {},
): Blueprint {
    return {
        id: "bp-1",
        name: extra.name ?? "Story Action",
        owner: { kind: "storyAction", blueprintId: "bp-1", ...(extra.mode ? { mode: extra.mode } : {}) },
        graphs: {
            events: {
                onCall: {
                    id: "onCall",
                    name: "On Call",
                    graph: {
                        nodes: Object.fromEntries(nodes.map(node => [node.id, node])),
                        edges: wires.map(([from, port, to]) => ({ from: { nodeId: from, port }, to: { nodeId: to, port: "in" } })),
                    },
                },
            },
            functions: {},
        },
    } as unknown as Blueprint;
}

const head: BlueprintGraphNode = { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL, params: {} };

describe("what a story blueprint does", () => {
    it("is the first thing its run does, with the rest counted", () => {
        const blueprint = storyBlueprint(
            [head, { id: "call", type: BLUEPRINT_NODE_TYPE_FN_CALL, params: { label: "Open the gallery" } }, { id: "sound", type: SOUND, params: {} }],
            [["head", "then", "call"], ["call", "next", "sound"]],
        );
        expect(summarizeStoryBlueprint(blueprint, read)).toBe("Open the gallery +1");
    });

    it("tells two blueprints that call different functions apart", () => {
        const call = (label: string) => storyBlueprint(
            [head, { id: "call", type: BLUEPRINT_NODE_TYPE_FN_CALL, params: { label } }],
            [["head", "then", "call"]],
        );
        expect(summarizeStoryBlueprint(call("Confirm sound"), read)).toBe("Confirm sound");
        expect(summarizeStoryBlueprint(call("Back sound"), read)).toBe("Back sound");
    });

    it("skips a comment, and counts nothing the run does not reach", () => {
        const blueprint = storyBlueprint(
            [head, { id: "note", type: NOTE, params: {} }, { id: "sound", type: SOUND, params: {} }, { id: "loose", type: SOUND, params: {} }],
            [["head", "then", "note"], ["head", "then", "sound"]],
        );
        expect(summarizeStoryBlueprint(blueprint, read)).toBe("Play Sound");
    });

    it("says nothing for a graph that does nothing yet, or whose first node has no name", () => {
        expect(summarizeStoryBlueprint(storyBlueprint([head], []), read)).toBeNull();
        const unknown = storyBlueprint([head, { id: "x", type: "plugin.gone", params: {} }], [["head", "then", "x"]]);
        expect(summarizeStoryBlueprint(unknown, read)).toBeNull();
    });

    it("says nothing for a value or a condition blueprint, whose first node is what it returns", () => {
        const blueprint = storyBlueprint([head, { id: "sound", type: SOUND, params: {} }], [["head", "then", "sound"]], { mode: "condition" });
        expect(summarizeStoryBlueprint(blueprint, read)).toBeNull();
    });
});

describe("the name a story blueprint goes by", () => {
    function documentWith(blueprint: Blueprint): BlueprintDocument {
        return { schemaVersion: 1, blueprints: { [blueprint.id]: blueprint }, ownerRecords: {} } as unknown as BlueprintDocument;
    }

    it("is the name its author gave it, over what it does", () => {
        const blueprint = storyBlueprint([head, { id: "sound", type: SOUND, params: {} }], [["head", "then", "sound"]], { name: "Door chime" });
        expect(storyBlueprintName(documentWith(blueprint), "bp-1", read)).toBe("Door chime");
    });

    it("is what it does while it keeps the name it was created with", () => {
        const blueprint = storyBlueprint([head, { id: "sound", type: SOUND, params: {} }], [["head", "then", "sound"]]);
        expect(storyBlueprintName(documentWith(blueprint), "bp-1", read)).toBe("Play Sound");
    });

    it("is nothing for an id the document does not hold", () => {
        expect(storyBlueprintName(documentWith(storyBlueprint([head], [])), "bp-gone", read)).toBeNull();
    });
});

describe("naming nodes from the catalogue", () => {
    it("names a Call Fn by the function it calls, never by an id", () => {
        const catalog: StoryBlueprintNodeCatalog = {
            resolveCatalogEntryForNode: type => ({
                type,
                category: "Function",
                displayName: type === BLUEPRINT_NODE_TYPE_FN_CALL ? "Call Fn" : type,
                isPure: false,
                graphKinds: ["event"],
                pins: [{ id: "next", kind: "output", semantic: "exec" }],
                ...(type === "plugin.gone" ? { unknown: true } : {}),
            }),
        };
        const document = { schemaVersion: 1, blueprints: {}, ownerRecords: {} } as unknown as BlueprintDocument;
        const reader = catalogStoryBlueprintNodeReader(catalog, document, key => key);
        const fromSnapshot = reader({ id: "c", type: BLUEPRINT_NODE_TYPE_FN_CALL, params: { fnRef: "fn:gone:head", __fnSignatureSnapshot: { name: "Confirm sound" } } }, {} as Blueprint);
        expect(fromSnapshot?.title).toBe("Confirm sound");
        const unset = reader({ id: "c", type: BLUEPRINT_NODE_TYPE_FN_CALL, params: {} }, {} as Blueprint);
        expect(unset?.title).not.toMatch(/fn:/);
        expect(reader({ id: "p", type: "plugin.gone", params: {} }, {} as Blueprint)?.title).toBeNull();
    });
});
