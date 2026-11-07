import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlueprintGraphIr, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import {
    BLUEPRINT_GRAPH_CLIPBOARD_KIND,
    BLUEPRINT_GRAPH_CLIPBOARD_VERSION,
    clearBlueprintGraphClipboard,
    pasteBlueprintGraphClipboardPayload,
    setBlueprintGraphClipboard,
    type BlueprintGraphClipboardPayload,
} from "./graphClipboard";
import { readBlueprintTextPaste, type BlueprintTextPasteTarget } from "./graphTextPaste";

/**
 * Pasting the blueprint text format onto the canvas: what becomes nodes, what is refused with the
 * author's line number, and that Studio's own clipboard payload still comes first.
 */

const clipboard = vi.hoisted(() => ({ selection: null as string | null, text: null as string | null }));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        clipboard: {
            readEditorSelection: async () => ({ success: true, data: { payload: clipboard.selection } }),
            readPlainText: async () => ({ success: true, data: { text: clipboard.text } }),
        },
    }),
}));

const { describeRefusedGraphTextPaste, isGraphPasteRefusal, resolveGraphPasteSource } = await import("./graphClipboardBridge");

registerCoreBlueprintNodes();

const GLOBAL: BlueprintOwnerRef = { kind: "globalMain" };
const TARGET: BlueprintTextPasteTarget = { owner: GLOBAL, graphKind: "event" };

const BODY = `boot: blueprint.event.head.appBoot
text: blueprint.data.stringLiteral value="hi"
log: blueprint.log
boot -> log
text -> log.value
`;

function existingGraph(): BlueprintGraphIr {
    return {
        nodes: {
            kept: { id: "kept", type: "blueprint.log", params: {}, meta: { editorLayout: { x: 900, y: 900 } } },
        },
        edges: [],
    };
}

function ready(text: string, target: BlueprintTextPasteTarget = TARGET): BlueprintGraphClipboardPayload {
    const outcome = readBlueprintTextPaste(text, target);
    if (outcome.kind !== "ready") {
        throw new Error(`expected ready, got ${JSON.stringify(outcome)}`);
    }
    return outcome.payload;
}

function refused(text: string, target: BlueprintTextPasteTarget = TARGET) {
    const outcome = readBlueprintTextPaste(text, target);
    if (outcome.kind !== "refused") {
        throw new Error(`expected refused, got ${JSON.stringify(outcome)}`);
    }
    return outcome.diagnostics;
}

describe("reading blueprint text for a paste", () => {
    it("turns a bare body into nodes and edges", () => {
        const payload = ready(BODY);
        expect(payload.kind).toBe(BLUEPRINT_GRAPH_CLIPBOARD_KIND);
        expect(payload.nodeIds.sort()).toEqual(["boot", "log", "text"]);
        expect(payload.edges).toEqual([
            { from: { nodeId: "boot", port: "then" }, to: { nodeId: "log", port: "in" } },
            { from: { nodeId: "text", port: "value" }, to: { nodeId: "log", port: "value" } },
        ]);
    });

    it("accepts a whole file, a single layer, and text inside Markdown fences", () => {
        const file = `blueprint Greeter owner=surfaceMain surface=elsewhere\nevent Boot\n${BODY}`;
        const layer = `event Boot\n${BODY}`;
        const fenced = "```bp\n" + BODY + "```\n";
        for (const text of [file, layer, fenced]) {
            expect(ready(text).nodeIds).toHaveLength(3);
        }
    });

    it("leaves text that is not the format to the rest of the paste", () => {
        expect(readBlueprintTextPaste("Just a sentence someone copied.", TARGET)).toEqual({ kind: "none" });
        expect(readBlueprintTextPaste("   \n", TARGET)).toEqual({ kind: "none" });
        expect(readBlueprintTextPaste("https://example.com/docs", TARGET)).toEqual({ kind: "none" });
        expect(readBlueprintTextPaste("Note: check this later", TARGET)).toEqual({ kind: "none" });
    });

    it("refuses a misspelt node type on the author's own line, with the compiler's suggestion", () => {
        const diagnostics = refused(`boot: blueprint.event.head.appBoot\nx: blueprint.data.stringLiterl\n`);
        expect(diagnostics[0]!.code).toBe("compile.unknown_node_type");
        expect(diagnostics[0]!.line).toBe(2);
        expect(diagnostics[0]!.hint).toContain("blueprint.data.stringLiteral");
    });

    it("counts lines from the text the author copied, header or not", () => {
        const layer = refused(`event Boot\nboot: blueprint.event.head.appBoot\nboot -> nowhere\n`);
        expect(layer[0]!.line).toBe(3);
        const file = refused(`blueprint B owner=globalMain\nevent Boot\nboot: blueprint.event.head.appBoot\nboot -> nowhere\n`);
        expect(file[0]!.line).toBe(4);
    });

    it("refuses a pin the node does not have", () => {
        const diagnostics = refused(`boot: blueprint.event.head.appBoot\nlog: blueprint.log\nboot.nope -> log\n`);
        expect(diagnostics[0]!.line).toBe(3);
        expect(diagnostics[0]!.severity).toBe("error");
    });

    it("refuses more than one layer", () => {
        const diagnostics = refused(`event A\nboot: blueprint.event.head.appBoot\nevent B\nlog: blueprint.log\n`);
        expect(diagnostics[0]!.code).toBe("paste.many_layers");
        expect(diagnostics[0]!.line).toBe(3);
    });

    it("resolves a variable the blueprint has by name, and refuses one it does not have", () => {
        const target: BlueprintTextPasteTarget = {
            ...TARGET,
            variables: { "var-1": { id: "var-1", name: "score", valueType: "number" } },
        };
        const payload = ready(`get: blueprint.local.get variableId=score\n`, target);
        expect(payload.nodes.get?.params?.variableId).toBe("var-1");

        const diagnostics = refused(`var missing type=number\nget: blueprint.local.get variableId=missing\n`, target);
        expect(diagnostics[0]!.code).toBe("paste.unknown_variable");
        expect(diagnostics[0]!.line).toBe(1);
    });

    it("pastes through the ordinary paste: fresh ids, the usual offset, the graph otherwise untouched", () => {
        let counter = 0;
        const before = existingGraph();
        const pasted = pasteBlueprintGraphClipboardPayload({
            ir: before,
            payload: ready(BODY),
            generateId: () => `new-${(counter += 1)}`,
        });
        expect(pasted?.newNodeIds).toEqual(["new-1", "new-2", "new-3"]);
        expect(Object.keys(pasted!.ir.nodes ?? {})).toEqual(["kept", "new-1", "new-2", "new-3"]);
        expect(pasted!.ir.edges).toHaveLength(2);
        expect(pasted!.ir.nodes?.["new-1"]?.meta?.editorLayout).toEqual({ x: 48, y: 48 });
        expect(before).toEqual(existingGraph());
    });
});

describe("where a paste comes from", () => {
    const environment = {
        projectPath: "/projects/here",
        projectName: "Here",
        projectIdentifier: "here",
        assetsService: null,
        fileSystemService: null,
        uiService: null,
        localBlueprintService: null,
        uiDocumentService: null,
        isFrozen: () => false,
        resolveAssetPins: () => [],
    };
    const readText = (text: string) => readBlueprintTextPaste(text, TARGET);

    function privatePayload(copyId: string): BlueprintGraphClipboardPayload {
        return {
            v: BLUEPRINT_GRAPH_CLIPBOARD_VERSION,
            kind: BLUEPRINT_GRAPH_CLIPBOARD_KIND,
            copyId,
            source: { path: "/projects/here", identifier: "here", name: "Here" },
            nodeIds: ["only"],
            nodes: { only: { id: "only", type: "blueprint.log", params: {} } },
            edges: [],
        };
    }

    beforeEach(() => {
        clipboard.selection = null;
        clipboard.text = null;
        clearBlueprintGraphClipboard();
    });

    it("keeps Studio's own payload ahead of any text", async () => {
        clipboard.selection = JSON.stringify(privatePayload("copy-a"));
        clipboard.text = BODY;
        const read = vi.fn(readText);
        const resolved = await resolveGraphPasteSource(environment, read);
        expect(resolved && !isGraphPasteRefusal(resolved) ? resolved.payload.nodeIds : null).toEqual(["only"]);
        expect(read).not.toHaveBeenCalled();
    });

    it("takes blueprint text ahead of this window's earlier copy", async () => {
        setBlueprintGraphClipboard(privatePayload("copy-b"));
        clipboard.text = BODY;
        const resolved = await resolveGraphPasteSource(environment, readText);
        expect(resolved && !isGraphPasteRefusal(resolved) ? resolved.text : null).toEqual({ warnings: [] });
    });

    it("falls back to this window's copy when the text is not the format", async () => {
        setBlueprintGraphClipboard(privatePayload("copy-c"));
        clipboard.text = "https://example.com";
        const resolved = await resolveGraphPasteSource(environment, readText);
        expect(resolved && !isGraphPasteRefusal(resolved) ? resolved.payload.copyId : null).toBe("copy-c");
    });

    it("refuses broken text outright, naming the line", async () => {
        setBlueprintGraphClipboard(privatePayload("copy-d"));
        clipboard.text = `boot: blueprint.event.head.appBoot\nx: blueprint.data.stringLiterl\n`;
        const resolved = await resolveGraphPasteSource(environment, readText);
        expect(resolved && isGraphPasteRefusal(resolved)).toBe(true);
        if (resolved && isGraphPasteRefusal(resolved)) {
            const message = describeRefusedGraphTextPaste(resolved.refused);
            expect(message).toContain("2");
            expect(message).toContain("blueprint.data.stringLiterl");
        }
    });
});
