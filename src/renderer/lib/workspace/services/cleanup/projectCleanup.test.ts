/**
 * Project clean-up: which blueprint nodes count as debris, that formatting settles, and which
 * comments and translations count as orphaned.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import type { Blueprint, BlueprintGraphIr } from "@shared/types/blueprint/document";
import type { StoryCommentThread } from "@shared/types/storyComments";
import {
    danglingBlueprintNodeIds,
    missingLineTranslationUnitIds,
    orphanCommentThreadIds,
    withFormattedLayout,
    withoutDanglingNodes,
} from "./projectCleanup";

registerCoreBlueprintNodes();

const at = (x: number, y: number) => ({ editorLayout: { x, y } });

/** An app-boot head wired to a Print, plus whatever `extra` adds unwired. */
function graph(extra: BlueprintGraphIr["nodes"] = {}): BlueprintGraphIr {
    return {
        nodes: {
            head: { id: "head", type: "blueprint.event.head.appBoot", meta: at(0, 0) },
            print: { id: "print", type: "blueprint.log", meta: at(0, 0) },
            ...extra,
        },
        edges: [{ from: { nodeId: "head", port: "out" }, to: { nodeId: "print", port: "in" } }],
    };
}

function blueprint(ir: BlueprintGraphIr): Blueprint {
    return {
        id: "bp",
        name: "Main",
        owner: { kind: "globalMain" } as Blueprint["owner"],
        graphs: { eventIds: ["layer"], events: { layer: { id: "layer", graph: ir } }, functions: {} },
    };
}

describe("dangling blueprint nodes", () => {
    it("counts unwired literals and actions", () => {
        const ir = graph({
            literal: { id: "literal", type: "blueprint.data.stringLiteral" },
            orphan: { id: "orphan", type: "blueprint.log" },
        });
        expect(danglingBlueprintNodeIds(ir).sort()).toEqual(["literal", "orphan"]);
    });

    it("keeps heads, comments and declared locals even with no wire", () => {
        const ir = graph({
            secondHead: { id: "secondHead", type: "blueprint.event.head.gameReady" },
            note: { id: "note", type: "blueprint.flow.comment" },
            local: { id: "local", type: "blueprint.local.declareVar" },
        });
        expect(danglingBlueprintNodeIds(ir)).toEqual([]);
    });

    it("keeps a node whose type is not registered", () => {
        expect(danglingBlueprintNodeIds(graph({ plugin: { id: "plugin", type: "someplugin.missing" } }))).toEqual([]);
    });

    it("removes them on a copy and leaves the original alone", () => {
        const original = blueprint(graph({ orphan: { id: "orphan", type: "blueprint.log" } }));
        const result = withoutDanglingNodes(original);
        expect(result?.removed).toBe(1);
        expect(Object.keys(result!.blueprint.graphs.events.layer.graph!.nodes!)).toEqual(["head", "print"]);
        expect(original.graphs.events.layer.graph!.nodes!.orphan).toBeDefined();
        expect(withoutDanglingNodes(blueprint(graph()))).toBeNull();
    });
});

describe("formatting every blueprint", () => {
    it("moves stacked cards apart, and is settled after one pass", () => {
        const formatted = withFormattedLayout(blueprint(graph()));
        expect(formatted).not.toBeNull();
        const nodes = formatted!.graphs.events.layer.graph!.nodes!;
        expect(nodes.print.meta?.editorLayout).not.toEqual(nodes.head.meta?.editorLayout);
        expect(withFormattedLayout(formatted!)).toBeNull();
    });

    it("leaves a blueprint with only comments untouched", () => {
        const ir: BlueprintGraphIr = { nodes: { note: { id: "note", type: "blueprint.flow.comment", meta: at(5, 5) } }, edges: [] };
        expect(withFormattedLayout(blueprint(ir))).toBeNull();
    });
});

describe("orphaned comments and translations", () => {
    it("finds threads whose row is gone", () => {
        const thread = (id: string, blockId: string) => ({ id, blockId }) as StoryCommentThread;
        expect(orphanCommentThreadIds([thread("a", "row-1"), thread("b", "row-9")], new Set(["row-1"]))).toEqual(["b"]);
    });

    it("finds story-line units whose line is gone, and never a namespaced unit", () => {
        const units = { "line-1": {}, "line-2": {}, "key:save": {}, "char:narra": {} };
        expect(missingLineTranslationUnitIds(units, new Set(["line-1"]))).toEqual(["line-2"]);
    });
});
