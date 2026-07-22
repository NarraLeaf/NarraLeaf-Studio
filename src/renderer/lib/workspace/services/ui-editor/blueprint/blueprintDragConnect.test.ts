import { beforeAll, describe, expect, it } from "vitest";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { resolveBlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import type { BlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/blueprint-nodes/types";
import {
    isBlueprintDragConnectCompatible,
    pickBlueprintDragConnectTargetPin,
    resolveBlueprintDragConnectSource,
} from "./blueprintDragConnect";

function findPin(
    entry: BlueprintNodeEditorCatalogEntry,
    kind: "input" | "output",
    semantic: "exec" | "data",
): string {
    const pin = entry.pins.find(p => p.kind === kind && p.semantic === semantic);
    if (!pin) {
        throw new Error(`missing ${semantic} ${kind} pin on ${entry.type}`);
    }
    return pin.id;
}

describe("blueprint drag-to-connect", () => {
    beforeAll(() => {
        registerCoreBlueprintNodes();
    });

    const setEntry = () => resolveBlueprintNodeEditorCatalogEntry(BLUEPRINT_NODE_TYPE_LOCAL_SET);
    const getEntry = () => resolveBlueprintNodeEditorCatalogEntry(BLUEPRINT_NODE_TYPE_LOCAL_GET);

    const irWith = (type: string): BlueprintGraphIr => ({
        nodes: { src: { id: "src", type } },
        edges: [],
    });

    it("classifies an exec output pin as execOutput and finds a compatible exec input", () => {
        const execOut = findPin(setEntry(), "output", "exec");
        const source = resolveBlueprintDragConnectSource(
            irWith(BLUEPRINT_NODE_TYPE_LOCAL_SET),
            "src",
            execOut,
            "source",
        );
        expect(source).not.toBeNull();
        expect(source!.kind).toBe("execOutput");
        expect(source!.isExec).toBe(true);

        // A node with an exec input (Set var) is compatible; the wired pin is that exec input.
        const target = pickBlueprintDragConnectTargetPin(source!, setEntry());
        expect(target).toBe(findPin(setEntry(), "input", "exec"));

        // A pure data node (Get var) has no exec input → incompatible.
        expect(isBlueprintDragConnectCompatible(source!, getEntry())).toBe(false);
    });

    it("classifies a data output pin as dataOutput", () => {
        const dataOut = findPin(getEntry(), "output", "data");
        const source = resolveBlueprintDragConnectSource(
            irWith(BLUEPRINT_NODE_TYPE_LOCAL_GET),
            "src",
            dataOut,
            "source",
        );
        expect(source).not.toBeNull();
        expect(source!.kind).toBe("dataOutput");
        expect(source!.isExec).toBe(false);
    });

    it("classifies any input pin as input and wires from the new node's output", () => {
        const execIn = findPin(setEntry(), "input", "exec");
        const source = resolveBlueprintDragConnectSource(
            irWith(BLUEPRINT_NODE_TYPE_LOCAL_SET),
            "src",
            execIn,
            "target",
        );
        expect(source).not.toBeNull();
        expect(source!.kind).toBe("input");

        // Dragging off an exec input must match a candidate's exec OUTPUT (opposite direction).
        const target = pickBlueprintDragConnectTargetPin(source!, setEntry());
        expect(target).toBe(findPin(setEntry(), "output", "exec"));
    });

    it("returns null for an unknown node or a pin that does not exist / wrong direction", () => {
        const ir = irWith(BLUEPRINT_NODE_TYPE_LOCAL_SET);
        const execOut = findPin(setEntry(), "output", "exec");
        expect(resolveBlueprintDragConnectSource(ir, "missing", execOut, "source")).toBeNull();
        expect(resolveBlueprintDragConnectSource(ir, "src", "__no_such_pin__", "source")).toBeNull();
        // The exec output pin does not exist as an input, so resolving it as a "target" fails.
        expect(resolveBlueprintDragConnectSource(ir, "src", execOut, "target")).toBeNull();
    });
});
