import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { registerBuiltInPluginBlueprintNodes } from "@/lib/blueprint-cli/builtinPluginNodes";
import { validateBlueprintDocumentGraphs } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";
import { checkProjectDocument } from "@/lib/blueprint-cli/check";
import { getLintRule } from "@/lib/lint/rules";
import { createTestLintContext } from "@/lib/lint/testContext";
import { resolveLintMessageParams } from "@/lib/lint/types";
import { translate } from "@/lib/i18n";
import { createAssetNameDescriber } from "./assetNameCatalog";
import { findAssetNameGaps } from "./assetNameGaps";
import { describeAssetNameGap, describeReferenceGapSites } from "./assetNameGapText";
import { assetNameGapToIndexGap } from "./referenceModel";

/**
 * One judgement, every surface.
 *
 * The shape is the gallery gesture - a list row's click sets a picture from the row's `image`
 * field - which is what an author builds first and what the build used to refuse only after the
 * five steps of its wizard. Each surface that reports an asset picked by a computed value is asked
 * about it here, from the same document, and each is asked again once the pin names its asset
 * outright: a surface that kept reporting then would be one an author learns to ignore.
 */

const SURFACE = "surface-extra";
const LIST = "list-cg";
const BIG = "image-big";
const BLUEPRINT = "bp-cg-grid";

function registry() {
    registerCoreBlueprintNodes();
    registerBuiltInPluginBlueprintNodes();
    return blueprintNodeRegistry;
}

/** The CG grid's own blueprint: the row click sets the big picture to whatever `source` hands it. */
function gridDocument(source: { id: string; type: string; port: string; params?: Record<string, unknown> }): BlueprintDocument {
    return {
        ownerRecords: { [`widgetMain:${SURFACE}:${LIST}`]: { blueprintId: BLUEPRINT } },
        blueprints: {
            [BLUEPRINT]: {
                id: BLUEPRINT,
                name: "CG grid",
                owner: { kind: "widgetMain", surfaceId: SURFACE, elementId: LIST },
                graphs: {
                    events: {
                        "ev-open": {
                            graph: {
                                nodes: {
                                    click: { id: "click", type: "blueprint.event.head.itemClick", params: {} },
                                    bigRef: {
                                        id: "bigRef",
                                        type: "blueprint.element.ref",
                                        params: { surfaceId: SURFACE, elementId: BIG, elementType: "nl.image" },
                                    },
                                    [source.id]: { id: source.id, type: source.type, params: source.params ?? {} },
                                    showTile: { id: "showTile", type: "blueprint.element.image.setImageAsset", params: {} },
                                },
                                edges: [
                                    { from: { nodeId: "click", port: "then" }, to: { nodeId: "showTile", port: "in" } },
                                    { from: { nodeId: "bigRef", port: "element" }, to: { nodeId: "showTile", port: "element" } },
                                    { from: { nodeId: source.id, port: source.port }, to: { nodeId: "showTile", port: "asset" } },
                                ],
                            },
                        },
                    },
                    functions: {},
                },
            },
        },
    } as unknown as BlueprintDocument;
}

const FROM_ROW = gridDocument({
    id: "tileImage",
    type: "blueprint.list.getItemField",
    port: "value",
    params: { field: "image" },
});

/** The same click, with the picture chosen on the literal it is wired from. */
const FROM_LITERAL = gridDocument({
    id: "picked",
    type: "blueprint.image.assetLiteral",
    port: "value",
    params: { asset: { kind: "imageAsset", assetId: "b1a0c227-b4db-4156-875d-d2809aaa4c48" } },
});

function gapsOf(document: BlueprintDocument) {
    return findAssetNameGaps(document, createAssetNameDescriber(registry()));
}

describe("an asset pin fed by a list row's field", () => {
    it("is one gap, at the Set Image Asset, made by the Get Item Field", () => {
        expect(gapsOf(FROM_ROW)).toEqual([
            expect.objectContaining({
                assetKind: "image",
                sink: expect.objectContaining({
                    kind: "pin",
                    blueprintName: "CG grid",
                    nodeId: "showTile",
                    pinId: "asset",
                    nodeTitle: "Set Image Asset",
                    pinLabel: "Asset",
                }),
                origin: expect.objectContaining({ kind: "node", nodeId: "tileImage", nodeTitle: "Get Item Field" }),
            }),
        ]);
        expect(gapsOf(FROM_LITERAL)).toEqual([]);
    });

    it("is an index gap scoped to pictures, jumping to the node", () => {
        const [gap] = gapsOf(FROM_ROW).map(assetNameGapToIndexGap);
        expect(gap).toMatchObject({
            reason: "computedAssetPin",
            affects: ["image"],
            target: { kind: "blueprint", blueprintId: BLUEPRINT, focusNodeId: "showTile", focusEventId: "ev-open" },
        });
    });

    it("is an error on the canvas, at the node, when the index hands it over", () => {
        registry();
        const onCanvas = (document: BlueprintDocument) => validateBlueprintDocumentGraphs(document, BLUEPRINT, {
            assetNameGaps: gapsOf(document),
        }).filter(diagnostic => diagnostic.code === "node.asset_name_computed");

        expect(onCanvas(FROM_ROW)).toEqual([
            expect.objectContaining({
                severity: "error",
                target: { kind: "node", graphKind: "event", graphId: "ev-open", nodeId: "showTile" },
                message: describeAssetNameGap(gapsOf(FROM_ROW)[0], translate),
            }),
        ]);
        expect(onCanvas(FROM_LITERAL)).toEqual([]);
    });

    it("is an error from `blueprint check` over the whole project", () => {
        registry();
        const errors = (document: BlueprintDocument) => checkProjectDocument(document)
            .filter(diagnostic => diagnostic.code === "node.asset_name_computed");

        expect(errors(FROM_ROW)).toEqual([expect.objectContaining({ severity: "error" })]);
        expect(errors(FROM_LITERAL)).toEqual([]);
    });

    it("is an error from the project check, located at the node", async () => {
        registry();
        const rule = getLintRule("blueprint/computed-asset-name")!;
        expect(rule.defaultSeverity).toBe("error");

        const findings = await rule.run(createTestLintContext({ blueprintDocument: FROM_ROW }), {});
        expect(findings).toEqual([
            expect.objectContaining({
                ruleId: "blueprint/computed-asset-name",
                location: expect.objectContaining({ kind: "blueprint", blueprintName: "CG grid", nodeId: "showTile" }),
            }),
        ]);
        // Rendered the way every surface renders a finding, it is the canvas's sentence word for word.
        const [finding] = findings;
        expect(translate(finding.messageKey, resolveLintMessageParams(finding, translate)))
            .toBe(describeAssetNameGap(gapsOf(FROM_ROW)[0], translate));

        expect(await rule.run(createTestLintContext({ blueprintDocument: FROM_LITERAL }), {})).toEqual([]);
    });

    it("names the node and the pin in the reader's language, not by the catalogue's English", () => {
        const [gap] = gapsOf(FROM_ROW);
        const keys: string[] = [];
        describeAssetNameGap(gap, key => {
            keys.push(key);
            return key;
        });
        expect(keys).toEqual(expect.arrayContaining([
            "blueprint.node.setImageAsset",
            "blueprint.port.asset",
            "blueprint.node.getItemField",
        ]));
    });

    it("is listed by where it is in the delete dialog, rather than as a bare 'cannot check'", () => {
        const text = describeReferenceGapSites(gapsOf(FROM_ROW).map(assetNameGapToIndexGap), translate, 5);
        expect(text).toContain(translate("assets.delete.unverifiedComputed"));
        expect(text).toContain("CG grid › Set Image Asset › Asset");
    });
});
