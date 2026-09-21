import { describe, expect, it } from "vitest";
import type { Blueprint, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { validateBlueprintDocumentGraphs } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";
import { checkProjectDocument } from "@/lib/blueprint-cli/check";
import { getLintRule } from "@/lib/lint/rules";
import { createTestLintContext } from "@/lib/lint/testContext";
import { resolveLintMessageParams } from "@/lib/lint/types";
import { translate } from "@/lib/i18n";
import { createAssetNameDescriber } from "./assetNameCatalog";
import { findAssetNameGaps, listAssetNameSinks, type AssetNameProject } from "./assetNameGaps";
import { describeAssetNameGap, describeReferenceGapSites } from "./assetNameGapText";
import { assetNameGapToIndexGap } from "./referenceModel";
import { blueprint, document, element, graph, shippingRegistry, type EdgeSpec, type NodeSpec } from "./assetNameTestKit";

/**
 * One judgement, every surface.
 *
 * Two shapes, taken from the two projects this rule was worked out on. The gallery gesture - a list
 * row's click sets a picture from the row's `image` field - names a picture the Gallery catalogue
 * holds, which ships with the game; nothing may refuse it. A picture bound to a Concat of two halves
 * of an id names one nothing in the project writes down; everything must. Each surface that reports
 * the rule is asked about both, from the same documents.
 */

const SURFACE = "surface-extra";
const ROOT = "root";
const LIST = "list-cg";
const ROW_ART = "row-art";
const BIG = "image-big";
const PROBE = "image-probe";
const WASHROOM = "b1a0c227-b4db-4156-875d-d2809aaa4c48";

const registry = shippingRegistry;

/**
 * The EXTRA page: a CG grid whose rows draw their `image` field, a big picture, and a probe image
 * bound to a value blueprint.
 */
function interfaceDocument(overrides: { list?: Partial<UIElement>; probe?: Partial<UIElement> } = {}): UIDocument {
    const elements = [
        element(ROOT, "nl.container", null, { childrenIds: [LIST, BIG, PROBE] }),
        element(LIST, "nl.list", ROOT, { childrenIds: [ROW_ART], ...overrides.list }),
        element(ROW_ART, "nl.image", LIST, {
            valueBindings: { "imageFill.assetId": { kind: "listItemField", fieldId: "image" } },
        }),
        element(BIG, "nl.image", ROOT),
        element(PROBE, "nl.image", ROOT, overrides.probe ?? {}),
    ];
    return {
        surfaces: [{ id: SURFACE, name: "Extra", rootElementId: ROOT }],
        elements: Object.fromEntries(elements.map(entry => [entry.id, entry])),
    } as unknown as UIDocument;
}

const GRID_OWNER: BlueprintOwnerRef = { kind: "widgetMain", surfaceId: SURFACE, elementId: LIST };
const listRef = (id = "listRef") => ({
    id,
    type: "blueprint.element.ref",
    params: { surfaceId: SURFACE, elementId: LIST, elementType: "nl.list" },
});
const bigRef = { id: "bigRef", type: "blueprint.element.ref", params: { surfaceId: SURFACE, elementId: BIG, elementType: "nl.image" } };

/** The grid's own graphs: fill the rows on Init, and show a row's picture when it is clicked. */
function gridBlueprint(rows: { nodes: NodeSpec[]; edges?: EdgeSpec[]; port: [string, string] }): Blueprint {
    return blueprint("bp-grid", "CG grid", GRID_OWNER, {
        fill: graph(
            [{ id: "init", type: "blueprint.event.head.init" }, listRef(), { id: "fill", type: "blueprint.element.list.setItems" }, ...rows.nodes],
            [
                ["init", "then", "fill", "in"],
                ["listRef", "element", "fill", "list"],
                [rows.port[0], rows.port[1], "fill", "items"],
                ...(rows.edges ?? []),
            ],
        ),
        open: graph(
            [
                { id: "click", type: "blueprint.event.head.itemClick" },
                bigRef,
                { id: "tileImage", type: "blueprint.list.getItemField", params: { field: "image" } },
                { id: "showTile", type: "blueprint.element.image.setImageAsset" },
            ],
            [
                ["click", "then", "showTile", "in"],
                ["bigRef", "element", "showTile", "element"],
                ["tileImage", "value", "showTile", "asset"],
            ],
        ),
    });
}

const GALLERY_ROWS = { nodes: [{ id: "entries", type: "narraleaf.gallery.getEntries", params: { galleryKind: "cg" } }], port: ["entries", "entries"] as [string, string] };
const CONCAT_ROWS = {
    nodes: [
        { id: "name", type: "blueprint.string.concat", params: { a: "b1a0c227-b4db-4156-", b: "875d-d2809aaa4c48" } },
        { id: "row", type: "blueprint.data.jsonMakeObject", params: { __jsonObjectInputPins: ["field_1_name", "field_1_value"], field_1_name: "image" } },
        { id: "rows", type: "blueprint.data.jsonMakeArray", params: { __jsonArrayInputPins: ["item_1"] } },
    ],
    edges: [["name", "result", "row", "field_1_value"], ["row", "result", "rows", "item_1"]] as EdgeSpec[],
    port: ["rows", "result"] as [string, string],
};

/** The probe's value blueprint: whatever `source` hands its Return Value. */
function probeBlueprint(source: NodeSpec, port: string): Blueprint {
    return blueprint("bp-probe", "Probe value", { kind: "widgetValue", surfaceId: SURFACE, elementId: PROBE, propPath: "imageFill.assetId" }, {
        init: graph(
            [{ id: "init", type: "blueprint.event.head.init" }, source, { id: "ret", type: "blueprint.data.returnValue" }],
            [["init", "then", "ret", "in"], [source.id, port, "ret", "value"]],
        ),
    });
}

const PROBE_BOUND = { probe: { valueBindings: { "imageFill.assetId": { kind: "blueprintValue", blueprintId: "bp-probe", valueType: "string" } } } } as const;
const CONCAT = { id: "halves", type: "blueprint.string.concat", params: { a: "b1a0c227-b4db-4156-", b: "875d-d2809aaa4c48" } };
const LITERAL = { id: "picked", type: "blueprint.image.assetLiteral", params: { asset: { kind: "imageAsset", assetId: WASHROOM } } };

/** The gallery gesture, as `D:\tmp\assetpin-fx` has it. */
const ROW_PICK: AssetNameProject = {
    blueprintDocument: document(gridBlueprint(GALLERY_ROWS)),
    uiDocument: interfaceDocument(),
};

/** The Concat binding, as `D:\tmp\assetpin-bind-fx` has it. */
const CONCAT_BINDING: AssetNameProject = {
    blueprintDocument: document(gridBlueprint(GALLERY_ROWS), probeBlueprint(CONCAT, "result")),
    uiDocument: interfaceDocument(PROBE_BOUND as never),
};

/** The same binding, reading a picture chosen in the picker. */
const LITERAL_BINDING: AssetNameProject = {
    blueprintDocument: document(gridBlueprint(GALLERY_ROWS), probeBlueprint(LITERAL, "value")),
    uiDocument: interfaceDocument(PROBE_BOUND as never),
};

function gapsOf(project: AssetNameProject) {
    return findAssetNameGaps(project, createAssetNameDescriber(registry()));
}

describe("the rule: a package carries every asset named in the project", () => {
    it("lets a picture read off a Gallery row through, and has looked at every place it is used", () => {
        expect(gapsOf(ROW_PICK)).toEqual([]);
        // Not "nothing was followed": the pin, and the row picture bound to the same field.
        const sinks = listAssetNameSinks(ROW_PICK, createAssetNameDescriber(registry()));
        expect(sinks.map(entry => entry.sink.kind).sort()).toEqual(["binding", "pin"]);
    });

    it("refuses a picture bound to a name put together from two halves, naming the Concat", () => {
        expect(gapsOf(CONCAT_BINDING)).toEqual([
            expect.objectContaining({
                assetKind: "image",
                sink: expect.objectContaining({ kind: "binding", elementId: PROBE, propPath: "imageFill.assetId", surfaceName: "Extra" }),
                origin: expect.objectContaining({ kind: "node", nodeId: "halves", nodeTitle: "Concat" }),
            }),
        ]);
        expect(gapsOf(LITERAL_BINDING)).toEqual([]);
    });

    it("refuses rows put together in the graph, where a row picture is bound to them", () => {
        const project: AssetNameProject = {
            blueprintDocument: document(gridBlueprint(CONCAT_ROWS)),
            uiDocument: interfaceDocument(),
        };
        const gaps = gapsOf(project);
        // The click's Set Image and the row's bound picture both read those rows.
        expect(gaps.map(gap => gap.sink.kind).sort()).toEqual(["binding", "pin"]);
        expect(gaps.every(gap => gap.origin.kind === "node" && gap.origin.nodeId === "name")).toBe(true);
    });
});

describe("every surface, on the two shapes", () => {
    it("is an index gap scoped to pictures, jumping to the value blueprint's Concat", () => {
        const [gap] = gapsOf(CONCAT_BINDING).map(assetNameGapToIndexGap);
        expect(gap).toMatchObject({
            reason: "computedAssetPin",
            slice: "ui",
            affects: ["image"],
            target: { kind: "blueprint", blueprintId: "bp-probe", focusNodeId: "halves", focusEventId: "init" },
        });
    });

    it("is an error on the canvas of the graph that puts the name together, at that node", () => {
        registry();
        const onCanvas = (project: AssetNameProject, blueprintId: string) => validateBlueprintDocumentGraphs(
            project.blueprintDocument!,
            blueprintId,
            { assetNameGaps: gapsOf(project) },
        ).filter(diagnostic => diagnostic.code === "node.asset_name_assembled");

        expect(onCanvas(CONCAT_BINDING, "bp-probe")).toEqual([
            expect.objectContaining({
                severity: "error",
                target: { kind: "node", graphKind: "event", graphId: "init", nodeId: "halves" },
                message: describeAssetNameGap(gapsOf(CONCAT_BINDING)[0], translate),
            }),
        ]);
        expect(onCanvas(LITERAL_BINDING, "bp-probe")).toEqual([]);
        expect(onCanvas(ROW_PICK, "bp-grid")).toEqual([]);
    });

    it("is an error from `blueprint check` given the project, and nothing on the gallery gesture", () => {
        registry();
        const errors = (project: AssetNameProject) => checkProjectDocument(project.blueprintDocument!, {
            assetNameContext: { uiDocument: project.uiDocument },
        }).filter(diagnostic => diagnostic.code === "node.asset_name_assembled");

        expect(errors(CONCAT_BINDING)).toEqual([expect.objectContaining({ severity: "error" })]);
        expect(errors(LITERAL_BINDING)).toEqual([]);
        expect(errors(ROW_PICK)).toEqual([]);
    });

    it("is an error from the project check, located at the widget, in the canvas's own words", async () => {
        registry();
        const rule = getLintRule("blueprint/assembled-asset-name")!;
        expect(rule.defaultSeverity).toBe("error");
        const run = (project: AssetNameProject) => rule.run(createTestLintContext({
            blueprintDocument: project.blueprintDocument!,
            uiDocument: project.uiDocument!,
        }), {});

        const findings = await run(CONCAT_BINDING);
        expect(findings).toEqual([
            expect.objectContaining({
                ruleId: "blueprint/assembled-asset-name",
                location: { kind: "surface", surfaceId: SURFACE, surfaceName: "Extra", elementId: PROBE, elementName: PROBE },
            }),
        ]);
        const [finding] = findings;
        expect(translate(finding.messageKey, resolveLintMessageParams(finding, translate)))
            .toBe(describeAssetNameGap(gapsOf(CONCAT_BINDING)[0], translate));

        expect(await run(LITERAL_BINDING)).toEqual([]);
        expect(await run(ROW_PICK)).toEqual([]);
    });

    it("names the node, the pin and the property in the reader's language", () => {
        const keys = (project: AssetNameProject) => {
            const seen: string[] = [];
            describeAssetNameGap(gapsOf(project)[0], key => {
                seen.push(key);
                return key;
            });
            return seen;
        };
        expect(keys(CONCAT_BINDING)).toEqual(expect.arrayContaining([
            "lint.rule.blueprintAssembledAssetName.messageBinding",
            "widgets.rectangleInspector.imageFill",
            "blueprint.node.concat",
        ]));
        const pinProject: AssetNameProject = {
            blueprintDocument: document(gridBlueprint(CONCAT_ROWS)),
            uiDocument: interfaceDocument(),
        };
        expect(keys(pinProject)).toEqual(expect.arrayContaining([
            "lint.rule.blueprintAssembledAssetName.message",
            "blueprint.node.setImageAsset",
            "blueprint.port.asset",
        ]));
    });

    it("is listed by where it is in the delete dialog", () => {
        const text = describeReferenceGapSites(gapsOf(CONCAT_BINDING).map(assetNameGapToIndexGap), translate, 5);
        expect(text).toContain(translate("assets.delete.unverifiedComputed"));
        expect(text).toContain(`Extra › ${PROBE} › ${translate("widgets.rectangleInspector.imageFill")}`);
    });
});
