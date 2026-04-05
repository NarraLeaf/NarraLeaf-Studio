import type { BlueprintGraphIr, BlueprintGraphNode } from "@shared/types/blueprint/document";

/**
 * Normalize optional BlueprintGraphIr fields for in-place editing.
 */
export function ensureBlueprintGraphIr(ir: BlueprintGraphIr | undefined): BlueprintGraphIr {
    if (!ir) {
        return { entries: {}, nodes: {}, edges: [] };
    }
    return {
        entries: ir.entries ?? {},
        nodes: ir.nodes ?? {},
        edges: ir.edges ?? [],
        variables: ir.variables,
        meta: ir.meta,
    };
}

export type EditorNodeLayout = { x: number; y: number };

const LAYOUT_KEY = "editorLayout";

export function readNodeEditorLayout(node: BlueprintGraphNode): EditorNodeLayout {
    const raw = node.meta?.[LAYOUT_KEY];
    if (raw && typeof raw === "object" && "x" in raw && "y" in raw) {
        const x = Number((raw as { x: unknown }).x);
        const y = Number((raw as { y: unknown }).y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
            return { x, y };
        }
    }
    return { x: 0, y: 0 };
}

export function writeNodeEditorLayout(node: BlueprintGraphNode, pos: EditorNodeLayout): void {
    node.meta = { ...node.meta, [LAYOUT_KEY]: { x: pos.x, y: pos.y } };
}

/** When a graph has no entry yet, wire `main` to the first placed node (execution starts at this node). */
export function ensureDefaultGraphEntry(ir: BlueprintGraphIr, startNodeId: string): void {
    const entries = ir.entries ?? {};
    if (Object.keys(entries).length > 0) {
        return;
    }
    ir.entries = {
        main: {
            start: { nodeId: startNodeId, port: "in" },
        },
    };
}

export function createGraphNodeForPalette(type: string, id: string): BlueprintGraphNode {
    return {
        id,
        type,
        params: type === "blueprint.state.set" ? { key: "", value: null } : {},
        meta: {
            editorLayout: { x: 140 + Math.random() * 60, y: 100 + Math.random() * 60 },
        },
    };
}
