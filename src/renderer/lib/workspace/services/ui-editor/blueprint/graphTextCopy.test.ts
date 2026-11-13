import { describe, expect, it } from "vitest";
import type { BlueprintGraphIr, BlueprintOwnerRef, BlueprintVariable } from "@shared/types/blueprint/document";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import { buildBlueprintGraphClipboardPayload } from "./graphClipboard";
import { printBlueprintGraphText } from "./graphTextCopy";
import { readBlueprintTextPaste, type BlueprintTextPasteTarget } from "./graphTextPaste";

/**
 * Copying canvas nodes as blueprint text: what the text says, and that pasting it gives the same
 * nodes and wires back.
 */

registerCoreBlueprintNodes();

const GLOBAL: BlueprintOwnerRef = { kind: "globalMain" };
const VARIABLES: Record<string, BlueprintVariable> = {
    "8f0c-var": { id: "8f0c-var", name: "score", valueType: "number" },
};
const TARGET: BlueprintTextPasteTarget = { owner: GLOBAL, graphKind: "event", variables: VARIABLES };

function graph(): BlueprintGraphIr {
    return {
        nodes: {
            "a1b2-boot": { id: "a1b2-boot", type: "blueprint.event.head.appBoot", params: {}, meta: { editorLayout: { x: 100, y: 40 } } },
            "c3d4-text": { id: "c3d4-text", type: "blueprint.data.stringLiteral", params: { value: "hi there" }, meta: { editorLayout: { x: 100, y: 200 } } },
            "e5f6-log": { id: "e5f6-log", type: "blueprint.log", params: {}, meta: { editorLayout: { x: 400, y: 40 } } },
            "0a0b-log": { id: "0a0b-log", type: "blueprint.log", params: {}, meta: { editorLayout: { x: 700, y: 40 } } },
            "9c9d-get": { id: "9c9d-get", type: "blueprint.local.get", params: { variableId: "8f0c-var" }, meta: { editorLayout: { x: 100, y: 320 } } },
        },
        edges: [
            { from: { nodeId: "a1b2-boot", port: "then" }, to: { nodeId: "e5f6-log", port: "in" } },
            { from: { nodeId: "c3d4-text", port: "value" }, to: { nodeId: "e5f6-log", port: "value" } },
            { from: { nodeId: "e5f6-log", port: "next" }, to: { nodeId: "0a0b-log", port: "in" } },
        ],
    };
}

function copy(ids: string[]): string {
    const payload = buildBlueprintGraphClipboardPayload(graph(), ids);
    const text = payload ? printBlueprintGraphText(payload, VARIABLES) : null;
    if (!text) {
        throw new Error("nothing copied");
    }
    return text;
}

describe("copying nodes as blueprint text", () => {
    it("names nodes after their type and keeps their positions and the wires between them", () => {
        expect(copy(["a1b2-boot", "c3d4-text", "e5f6-log", "0a0b-log"])).toBe(
            [
                "appBoot: blueprint.event.head.appBoot @100,40",
                "stringLiteral: blueprint.data.stringLiteral value=\"hi there\" @100,200",
                "log: blueprint.log @400,40",
                "log2: blueprint.log @700,40",
                "",
                "appBoot.then -> log.in",
                "stringLiteral.value -> log.value",
                "log.next -> log2.in",
                "",
            ].join("\n"),
        );
    });

    it("leaves out wires to nodes that were not copied", () => {
        const text = copy(["e5f6-log", "0a0b-log"]);
        expect(text).toContain("log.next -> log2.in");
        expect(text).not.toContain("appBoot");
        expect(text).not.toContain("stringLiteral");
    });

    it("names a variable rather than giving its id, with a var line for its type", () => {
        const text = copy(["9c9d-get"]);
        expect(text.split("\n")[0]).toBe("var score type=number");
        expect(text).toContain("variableId=score");
        expect(text).not.toContain("8f0c-var");
    });

    it("copies nothing from an empty selection", () => {
        expect(printBlueprintGraphText({ nodeIds: ["gone"], nodes: {}, edges: [] })).toBeNull();
    });

    it("pastes back as the same nodes and wires", () => {
        const ids = Object.keys(graph().nodes ?? {});
        const outcome = readBlueprintTextPaste(copy(ids), TARGET);
        if (outcome.kind !== "ready") {
            throw new Error(`expected ready, got ${JSON.stringify(outcome)}`);
        }
        const original = graph();
        const describe = (ir: Pick<BlueprintGraphIr, "nodes" | "edges">, nodeIds: readonly string[]) => {
            const nodes = nodeIds.map(id => {
                const node = ir.nodes![id]!;
                return { type: node.type, params: node.params ?? {}, at: node.meta?.editorLayout };
            });
            const index = new Map(nodeIds.map((id, i) => [id, i]));
            const edges = (ir.edges ?? []).map(edge => [index.get(edge.from.nodeId), edge.from.port, index.get(edge.to.nodeId), edge.to.port]);
            return { nodes, edges };
        };
        expect(describe(outcome.payload, outcome.payload.nodeIds)).toEqual(describe(original, ids));
        expect(outcome.warnings).toEqual([]);
    });
});
