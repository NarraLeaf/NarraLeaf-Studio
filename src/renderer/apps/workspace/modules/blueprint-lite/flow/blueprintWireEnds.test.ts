import { describe, expect, it } from "vitest";
import { createTranslator } from "@shared/i18n";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import { resolveBlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import {
    blueprintWireEnds,
    describeBlueprintWireEnd,
    formatBlueprintWireEnd,
    listBlueprintPinConnections,
    numberRepeatedNames,
    pickFarBlueprintWireEnd,
} from "./blueprintWireEnds";

const zh = createTranslator("zh").t;
const en = createTranslator("en").t;

function soundCard() {
    registerCoreBlueprintNodes();
    return { catalog: resolveBlueprintNodeEditorCatalogEntry("blueprint.sound.play") };
}

describe("blueprintWireEnds", () => {
    it("names the output as the source and the input as the target", () => {
        expect(blueprintWireEnds({ source: "a", sourceHandle: "next", target: "b", targetHandle: "in" })).toEqual({
            source: { nodeId: "a", pinId: "next", side: "output" },
            target: { nodeId: "b", pinId: "in", side: "input" },
        });
    });
});

describe("pickFarBlueprintWireEnd", () => {
    const source = { x: 0, y: 0 };
    const target = { x: 1000, y: 0 };

    it("names the input when the pointer is near the output, and the other way round", () => {
        expect(pickFarBlueprintWireEnd({ x: 50, y: 10 }, source, target)).toBe("target");
        expect(pickFarBlueprintWireEnd({ x: 950, y: -10 }, source, target)).toBe("source");
    });

    it("names the input from exactly halfway", () => {
        expect(pickFarBlueprintWireEnd({ x: 500, y: 0 }, source, target)).toBe("target");
    });
});

describe("listBlueprintPinConnections", () => {
    const ir = {
        nodes: {},
        edges: [
            { from: { nodeId: "a", port: "value" }, to: { nodeId: "b", port: "x" } },
            { from: { nodeId: "a", port: "value" }, to: { nodeId: "c", port: "y" } },
            { from: { nodeId: "a", port: "next" }, to: { nodeId: "d", port: "in" } },
            { from: { nodeId: "e", port: "out" }, to: { nodeId: "b", port: "y" } },
        ],
    } as unknown as BlueprintGraphIr;

    it("lists every input an output feeds", () => {
        expect(listBlueprintPinConnections(ir, { nodeId: "a", pinId: "value", side: "output" })).toEqual([
            { nodeId: "b", pinId: "x", side: "input" },
            { nodeId: "c", pinId: "y", side: "input" },
        ]);
    });

    it("lists the output feeding an input", () => {
        expect(listBlueprintPinConnections(ir, { nodeId: "b", pinId: "y", side: "input" })).toEqual([
            { nodeId: "e", pinId: "out", side: "output" },
        ]);
    });

    it("does not mistake an input for an output of the same name", () => {
        expect(listBlueprintPinConnections(ir, { nodeId: "b", pinId: "x", side: "output" })).toEqual([]);
    });
});

describe("numberRepeatedNames", () => {
    it("numbers only the names that repeat, in list order", () => {
        expect(numberRepeatedNames(["Log · Value", "Branch · In", "Log · Value", "Log · Value"])).toEqual([1, null, 2, 3]);
        expect(numberRepeatedNames(["A", "B"])).toEqual([null, null]);
    });
});

describe("describeBlueprintWireEnd", () => {
    it("uses the card's title and the pin's label in the interface language", () => {
        const name = describeBlueprintWireEnd(soundCard(), { nodeId: "s", pinId: "volume", side: "input" }, zh);
        expect(name.node).toBe(describeBlueprintWireEnd(soundCard(), { nodeId: "s", pinId: "in", side: "input" }, zh).node);
        expect(name.node).not.toMatch(/blueprint\./);
        expect(name.pin).toBeTruthy();
        expect(formatBlueprintWireEnd(name, zh)).toBe(`${name.node} · ${name.pin}`);
    });

    it("tells an input from an output with the same id", () => {
        const output = describeBlueprintWireEnd(soundCard(), { nodeId: "s", pinId: "volume", side: "output" }, en);
        expect(output.pin).toBeUndefined();
    });

    it("adds the element an element card is bound to", () => {
        const card = {
            catalog: { displayName: "Element", role: "elementLiteral", pins: [{ id: "element", kind: "output", label: "Element" }] },
            elementPreview: { name: "Start button" },
        };
        const name = describeBlueprintWireEnd(card, { nodeId: "e", pinId: "element", side: "output" }, en);
        expect(name.detail).toBe("Start button");
        expect(formatBlueprintWireEnd(name, zh)).toBe(`${name.node}（Start button） · ${name.pin}`);
    });

    it("tells two cards with one title apart by the value in their first field", () => {
        const card = (action: string) => ({
            catalog: {
                displayName: "On Input Action",
                pins: [{ id: "then", kind: "output", label: "Then" }],
                inspectorParams: [{ key: "action", kind: "select", dynamicOptionsSource: "inputActions" }],
            },
            params: { action },
            dynamicSelectOptions: { inputActions: [{ value: "a1", label: "Advance" }, { value: "a2", label: "Dismiss" }] },
        });
        const end = { nodeId: "n", pinId: "then", side: "output" as const };
        expect(formatBlueprintWireEnd(describeBlueprintWireEnd(card("a1"), end, en), en)).toBe("On Input Action (Advance) · Then");
        expect(formatBlueprintWireEnd(describeBlueprintWireEnd(card("a2"), end, en), en)).toBe("On Input Action (Dismiss) · Then");
        // An option that is gone has no name to show, and the id it held is not one.
        expect(describeBlueprintWireEnd(card("a9"), end, en).detail).toBeUndefined();
    });

    it("shows a short line of text from the first field, and never an id", () => {
        const card = (name: string) => ({
            catalog: { displayName: "Fn", pins: [], inspectorParams: [{ key: "name", kind: "string" }] },
            params: { name },
        });
        const end = { nodeId: "n", pinId: "then", side: "output" as const };
        expect(describeBlueprintWireEnd(card("Confirm cue"), end, en).detail).toBe("Confirm cue");
        expect(describeBlueprintWireEnd(card("5143dcd8-1d6c-420b-a3b4-7839eb6938e9"), end, en).detail).toBeUndefined();
        expect(describeBlueprintWireEnd(card("x".repeat(40)), end, en).detail).toHaveLength(24);
    });

    it("never prints an id: an unknown node is called unknown, a pin without a label is left out", () => {
        const unknown = {
            catalog: { displayName: "plugin.gone.node", unknown: true, pins: [] },
        };
        expect(describeBlueprintWireEnd(unknown, { nodeId: "5143dcd8-0000-4000-8000-000000000001", pinId: "in", side: "input" }, en)).toEqual({
            node: en("blueprint.canvas.unknownNode"),
        });
        expect(describeBlueprintWireEnd(undefined, { nodeId: "missing", pinId: "in", side: "input" }, en)).toEqual({
            node: en("blueprint.canvas.unknownNode"),
        });
        const unlabelled = { catalog: { displayName: "Branch", pins: [{ id: "p-7f3a", kind: "input" }] } };
        const name = describeBlueprintWireEnd(unlabelled, { nodeId: "n", pinId: "p-7f3a", side: "input" }, en);
        expect(name.pin).toBeUndefined();
        expect(formatBlueprintWireEnd(name, en)).not.toContain("p-7f3a");
    });
});
