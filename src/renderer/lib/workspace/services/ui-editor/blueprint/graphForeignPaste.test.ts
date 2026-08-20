import { describe, expect, it } from "vitest";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
} from "@shared/types/blueprint/graph";
import {
    ELEMENT_REF_PARAM_ELEMENT_ID,
    ELEMENT_REF_PARAM_ELEMENT_TYPE,
    ELEMENT_REF_PARAM_SURFACE_ID,
} from "@/lib/ui-editor/blueprint-nodes/built-in/elementRefUtils";
import { createBlueprintFnRef } from "./fnCatalog";
import {
    buildBlueprintGraphClipboardPayload,
    type BlueprintGraphClipboardPayload,
} from "./graphClipboard";
import {
    collectGraphClipboardAssetIds,
    countUnresolvedGraphAssetSites,
    countUnresolvedGraphElementRefs,
    countUnresolvedGraphFnCalls,
    isBlueprintGraphPasteFromAnotherProject,
} from "./graphForeignPaste";

/**
 * What a fragment from another project costs, before any of it is written.
 *
 * These are the rules the paste routes on, kept pure so they can be exercised without a project
 * behind them: whether a payload is foreign at all, and how much of what it names this project
 * cannot answer for.
 */

const HERE = "D:/Projects/Here";

function payloadFrom(ir: BlueprintGraphIr, nodeIds: string[], sourcePath?: string): BlueprintGraphClipboardPayload {
    const payload = buildBlueprintGraphClipboardPayload(ir, nodeIds, {
        copyId: "copy-1",
        ...(sourcePath ? { source: { path: sourcePath, identifier: "com.example", name: "Elsewhere" } } : {}),
    });
    if (!payload) {
        throw new Error("the fixture selected no nodes");
    }
    return payload;
}

function elementRefGraph(refs: Array<Partial<Record<string, string>>>): BlueprintGraphIr {
    const nodes = Object.fromEntries(
        refs.map((params, index) => [
            `n${index}`,
            {
                id: `n${index}`,
                type: index % 2 === 0 ? BLUEPRINT_NODE_TYPE_ELEMENT_REF : BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
                params,
            },
        ]),
    );
    return { nodes, edges: [] };
}

describe("blueprint graph paste routing", () => {
    it("reads a payload with no source stamp as this window's own", () => {
        const payload = payloadFrom({ nodes: { a: { id: "a", type: "x" } }, edges: [] }, ["a"]);

        expect(isBlueprintGraphPasteFromAnotherProject(payload, HERE)).toBe(false);
    });

    it("reads a copy made in this project as unchanged, whatever the path is spelled like", () => {
        const payload = payloadFrom(
            { nodes: { a: { id: "a", type: "x" } }, edges: [] },
            ["a"],
            "D:\\Projects\\Here\\",
        );

        expect(isBlueprintGraphPasteFromAnotherProject(payload, HERE)).toBe(false);
    });

    it("recognises a copy made in another project", () => {
        const payload = payloadFrom(
            { nodes: { a: { id: "a", type: "x" } }, edges: [] },
            ["a"],
            "D:/Projects/Elsewhere",
        );

        expect(isBlueprintGraphPasteFromAnotherProject(payload, HERE)).toBe(true);
    });

    it("cannot judge a paste into a window with no project path", () => {
        const payload = payloadFrom(
            { nodes: { a: { id: "a", type: "x" } }, edges: [] },
            ["a"],
            "D:/Projects/Elsewhere",
        );

        expect(isBlueprintGraphPasteFromAnotherProject(payload, "")).toBe(false);
    });
});

describe("blueprint graph paste, what it cannot resolve", () => {
    it("counts a node bound to a widget this project does not have", () => {
        const payload = payloadFrom(
            elementRefGraph([
                {
                    [ELEMENT_REF_PARAM_SURFACE_ID]: "surface-elsewhere",
                    [ELEMENT_REF_PARAM_ELEMENT_ID]: "element-elsewhere",
                    [ELEMENT_REF_PARAM_ELEMENT_TYPE]: "nl.button",
                },
                {
                    [ELEMENT_REF_PARAM_SURFACE_ID]: "surface-elsewhere",
                    [ELEMENT_REF_PARAM_ELEMENT_ID]: "element-here",
                    [ELEMENT_REF_PARAM_ELEMENT_TYPE]: "nl.button",
                },
            ]),
            ["n0", "n1"],
            "D:/Projects/Elsewhere",
        );

        expect(countUnresolvedGraphElementRefs(payload, id => id === "element-here")).toBe(1);
    });

    it("leaves a half-filled binding alone - that is an unfinished node, not a broken one", () => {
        const payload = payloadFrom(
            elementRefGraph([{ [ELEMENT_REF_PARAM_SURFACE_ID]: "surface-elsewhere" }]),
            ["n0"],
            "D:/Projects/Elsewhere",
        );

        expect(countUnresolvedGraphElementRefs(payload, () => false)).toBe(0);
    });

    it("counts a Call Fn whose blueprint is not here, but not one pasted with its own head", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_FN_HEAD },
                callHome: {
                    id: "callHome",
                    type: BLUEPRINT_NODE_TYPE_FN_CALL,
                    params: { [BLUEPRINT_NODE_PARAM_FN_REF]: createBlueprintFnRef("bp-elsewhere", "head") },
                },
                callAway: {
                    id: "callAway",
                    type: BLUEPRINT_NODE_TYPE_FN_CALL,
                    params: { [BLUEPRINT_NODE_PARAM_FN_REF]: createBlueprintFnRef("bp-elsewhere", "other-head") },
                },
            },
            edges: [],
        };
        const payload = payloadFrom(ir, ["head", "callHome", "callAway"], "D:/Projects/Elsewhere");

        expect(countUnresolvedGraphFnCalls(payload, id => id === "bp-here")).toBe(1);
    });

    it("counts no Call Fn when the blueprint it names is one this project has", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                call: {
                    id: "call",
                    type: BLUEPRINT_NODE_TYPE_FN_CALL,
                    params: { [BLUEPRINT_NODE_PARAM_FN_REF]: createBlueprintFnRef("bp-shared", "head") },
                },
            },
            edges: [],
        };
        const payload = payloadFrom(ir, ["call"], "D:/Projects/Elsewhere");

        expect(countUnresolvedGraphFnCalls(payload, id => id === "bp-shared")).toBe(0);
    });

    it("collects the files a fragment names and counts the ones that did not come across", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                a: { id: "a", type: "plugin.image", params: { asset: "asset-imported" } },
                b: { id: "b", type: "plugin.image", params: { asset: "asset-missing" } },
                c: { id: "c", type: "plugin.image", params: { asset: "asset-missing" } },
            },
            edges: [],
        };
        const payload = payloadFrom(ir, ["a", "b", "c"], "D:/Projects/Elsewhere");

        expect(collectGraphClipboardAssetIds(payload)).toEqual(["asset-imported", "asset-missing"]);
        // Per site, not per id: two nodes naming one absent file are two things to look at.
        expect(countUnresolvedGraphAssetSites(payload, id => id === "asset-imported")).toBe(2);
    });
});
