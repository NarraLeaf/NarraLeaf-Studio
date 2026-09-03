import { describe, expect, it } from "vitest";
import type { BlueprintGraphIndex } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_COMMENT_DEFAULT_HEIGHT,
    BLUEPRINT_COMMENT_DEFAULT_WIDTH,
} from "@shared/blueprint/blueprintCommentGeometry";
import { buildPreviewModel, resolveFirstBlueprintLayerPreview } from "./blueprintLayerPreviewModel";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";

/** Only `resolveCatalogEntryForNode` is reached, and only for the fields the model reads. */
function catalogOf(entries: Record<string, unknown>): BlueprintNodeCatalogService {
    return {
        resolveCatalogEntryForNode: (type: string) => entries[type],
    } as unknown as BlueprintNodeCatalogService;
}

function layer(id: string, nodeId: string) {
    return {
        id,
        name: `layer ${id}`,
        graph: { nodes: { [nodeId]: { id: nodeId, type: "test.node" } }, edges: [] },
    };
}

function localBpOf(graphs: Partial<BlueprintGraphIndex>): LocalBlueprintService {
    return {
        getBlueprintDocument: () => ({
            blueprints: {
                "bp-1": {
                    id: "bp-1",
                    graphs: { events: {}, functions: {}, ...graphs },
                },
            },
        }),
    } as unknown as LocalBlueprintService;
}

const PLAIN_CATALOG = catalogOf({ "test.node": { role: "normal", pins: [], displayName: "Test" } });

describe("resolveFirstBlueprintLayerPreview", () => {
    it("previews the layer the editor opens, not whichever key comes first", () => {
        const localBp = localBpOf({
            eventIds: ["ev-second"],
            events: { "ev-first": layer("ev-first", "n-1"), "ev-second": layer("ev-second", "n-2") },
        });

        expect(resolveFirstBlueprintLayerPreview(localBp, PLAIN_CATALOG, "bp-1")?.graphName).toBe("layer ev-second");
    });

    it("falls back to key order for a document that predates the order array", () => {
        const localBp = localBpOf({
            events: { "ev-first": layer("ev-first", "n-1"), "ev-second": layer("ev-second", "n-2") },
        });

        expect(resolveFirstBlueprintLayerPreview(localBp, PLAIN_CATALOG, "bp-1")?.graphName).toBe("layer ev-first");
    });

    it("previews the first function graph when there are no event layers", () => {
        const localBp = localBpOf({
            functionIds: ["fn-1"],
            functions: { "fn-1": layer("fn-1", "n-1") },
        });

        const model = resolveFirstBlueprintLayerPreview(localBp, PLAIN_CATALOG, "bp-1");
        expect(model?.graphName).toBe("layer fn-1");
        expect(model?.emptyReason).toBeUndefined();
    });

    it("says there is no layer only when there is genuinely none", () => {
        expect(resolveFirstBlueprintLayerPreview(localBpOf({}), PLAIN_CATALOG, "bp-1")?.emptyReason).toBe("noLayer");
    });
});

describe("buildPreviewModel", () => {
    const catalog = catalogOf({
        "test.comment": { role: "comment", pins: [] },
        "test.node": { role: "normal", pins: [], displayName: "Test" },
    });
    const ir = {
        nodes: {
            "n-card": { id: "n-card", type: "test.node", meta: { editorLayout: { x: 400, y: 200 } } },
            "n-frame": {
                id: "n-frame",
                type: "test.comment",
                params: { frame: true, width: 900, height: 480, color: "violet", text: "Boot" },
                meta: { editorLayout: { x: 360, y: 150 } },
            },
        },
        edges: [],
    };

    it("sizes a group frame from its own params, not from the catalogue", () => {
        const frame = buildPreviewModel(ir, "boot", catalog).nodes.find(node => node.id === "n-frame");
        expect(frame).toMatchObject({ width: 900, height: 480 });
        expect(frame?.data).toMatchObject({ role: "comment", colorKey: "violet", title: "Boot" });
    });

    it("falls back to the default comment size when the params carry none", () => {
        const bare = { nodes: { "n-frame": { id: "n-frame", type: "test.comment" } }, edges: [] };
        expect(buildPreviewModel(bare, "boot", catalog).nodes[0]).toMatchObject({
            width: BLUEPRINT_COMMENT_DEFAULT_WIDTH,
            height: BLUEPRINT_COMMENT_DEFAULT_HEIGHT,
        });
    });

    it("puts frames behind the cards they enclose", () => {
        const model = buildPreviewModel(ir, "boot", catalog);
        expect(model.nodes.map(node => node.id)).toEqual(["n-frame", "n-card"]);
        expect(model.nodes[0]!.zIndex).toBeLessThan(model.nodes[1]!.zIndex!);
    });
});
