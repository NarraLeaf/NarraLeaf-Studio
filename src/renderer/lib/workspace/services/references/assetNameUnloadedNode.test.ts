/**
 * An asset name coming out of a node type nothing here can load.
 *
 * The judgement has to refuse it - a node nobody can describe could name anything, and a package
 * built on it would be missing whatever it named - but the reason is not the one the sentence used
 * to give. A project whose screens are built on a plugin's nodes, opened where that plugin is not
 * installed or is switched off, reported every picture and clip on those screens as "an asset name
 * assembled at run time", named the author's own widgets, and told them to pick the asset in the
 * picker - on a node drawn as a stub, where there is nothing to pick. The shipped skeleton is such a
 * project: its EXTRA screen is built on the Gallery plugin, and with Gallery off the build refused
 * with six of those sentences and no mention of a plugin anywhere.
 *
 * So the gap now carries which of the two it is, and the two halves are asserted together: the
 * unloaded type gets the sentence that names it and says what to install, and a name the project
 * really does assemble keeps the old one. An exemption is not what is being added - both still
 * refuse - so the third claim here is that the count of refusals did not move.
 *
 * Comments in English per project convention.
 */

import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import type { BlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/blueprint-nodes/types";
import { createAssetNameDescriber, type BlueprintNodeCatalogLike } from "./assetNameCatalog";
import { assetNameGapMessage } from "./assetNameGapText";
import { extractStoryVariableWrites, findAssetNameGaps, type AssetNameProject } from "./assetNameGaps";
import { blueprint, document, gapsOf, graph, shippingRegistry } from "./assetNameTestKit";

const GALLERY_PREFIX = "narraleaf.gallery.";

/**
 * The catalogue a Studio has when a plugin is not loaded: its node types are simply not there, and
 * asking about one gets the stub the registry hands back for a type it has never registered.
 *
 * Modelled rather than achieved by unregistering, because the registry is one module-level object
 * and the tests here need both answers about the same node types in one run.
 */
function catalogueWithout(prefix: string): BlueprintNodeCatalogLike {
    const live = shippingRegistry();
    const stub = (type: string): BlueprintNodeEditorCatalogEntry => ({
        type,
        category: "Other",
        displayName: type,
        isPure: false,
        unknown: true,
        graphKinds: ["event", "function", "macro"],
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
    } as unknown as BlueprintNodeEditorCatalogEntry);
    return {
        get: type => (type.startsWith(prefix) ? undefined : live.get(type)),
        resolveCatalogEntry: type => (type.startsWith(prefix) ? stub(type) : live.resolveCatalogEntry(type)),
        resolveCatalogEntryForNode: (type, params) => (type.startsWith(prefix)
            ? stub(type)
            : live.resolveCatalogEntryForNode(type, params)),
    };
}

/** One graph: a source node's `value` wired into `Set Image Asset`'s picture. */
function picksFrom(nodeType: string, port: string) {
    return document(blueprint(
        "bp-1",
        "Viewer",
        { kind: "globalMain" },
        {
            main: graph(
                [
                    { id: "head", type: "blueprint.event.head.init" },
                    { id: "source", type: nodeType },
                    { id: "set", type: "blueprint.element.image.setImageAsset" },
                ],
                [
                    ["head", "then", "set", "in"],
                    ["source", port, "set", "asset"],
                ],
            ),
        },
    ));
}

describe("a picture named by a node type this Studio has not loaded", () => {
    it("is refused, and says which type to install rather than blaming the graph", () => {
        const project: AssetNameProject = { blueprintDocument: picksFrom("acme.gallery.rows", "value") };

        const gaps = findAssetNameGaps(project, createAssetNameDescriber(shippingRegistry()));

        expect(gaps).toHaveLength(1);
        expect(gaps[0].origin).toMatchObject({ kind: "node", nodeId: "source", unknownType: true });
        const message = assetNameGapMessage(gaps[0]);
        expect(message.key).toBe("lint.rule.blueprintAssembledAssetName.messageUnloadedNode");
        // The type, not a card title: it is what names the plugin, and it is not a catalogue key to
        // be rendered in the reader's language.
        expect(message.params.origin).toBe("acme.gallery.rows");
        expect(message.paramKeys.origin).toBeUndefined();
    });

    it("keeps the old sentence for a name the project really does assemble", () => {
        // `Concat` is in the catalogue and declares that it puts strings together: the author wrote
        // this, and the remedy is theirs.
        const gaps = gapsOf({ blueprintDocument: picksFrom("blueprint.string.concat", "result") });

        expect(gaps).toHaveLength(1);
        expect(gaps[0].origin).toMatchObject({ kind: "node", nodeId: "source" });
        expect((gaps[0].origin as { unknownType?: true }).unknownType).toBeUndefined();
        expect(assetNameGapMessage(gaps[0]).key).toBe("lint.rule.blueprintAssembledAssetName.message");
    });

    it("says the same about a widget property bound to one", () => {
        const project: AssetNameProject = {
            blueprintDocument: document(blueprint(
                "bp-value",
                "Art source",
                { kind: "widgetValue", surfaceId: "surface-1", elementId: "art", propPath: "imageFill.assetId" },
                {
                    main: graph(
                        [
                            { id: "source", type: "acme.gallery.rows" },
                            { id: "ret", type: "blueprint.data.returnValue" },
                        ],
                        [["source", "value", "ret", "value"]],
                    ),
                },
            )),
            uiDocument: {
                surfaces: [{ id: "surface-1", name: "Extra", rootElementId: "root" }],
                elements: {
                    root: { id: "root", type: "nl.container", parentId: null, childrenIds: ["art"], props: {} },
                    art: {
                        id: "art",
                        type: "nl.image",
                        name: "Art",
                        parentId: "root",
                        childrenIds: [],
                        props: {},
                        valueBindings: { "imageFill.assetId": { kind: "blueprintValue", blueprintId: "bp-value" } },
                    },
                },
            } as unknown as AssetNameProject["uiDocument"],
        };

        const gaps = findAssetNameGaps(project, createAssetNameDescriber(shippingRegistry()));

        expect(gaps).toHaveLength(1);
        expect(assetNameGapMessage(gaps[0]).key)
            .toBe("lint.rule.blueprintAssembledAssetName.messageUnloadedNodeBinding");
    });
});

describe("the shipped starter template, read where the Gallery plugin is not loaded", () => {
    /**
     * The reproduction, off the files an author actually receives. With the plugin registered the
     * template has no gaps at all (`referenceCatalogPins.test.ts` holds that); without it, the same
     * six places are refused - and every one of them has to say a node type is not loaded, because
     * not one of them is something the author wrote wrong.
     */
    function starter(): AssetNameProject {
        const content = path.join(process.cwd(), "resources/templates/skeleton/content/editor");
        const read = (relative: string) => JSON.parse(fs.readFileSync(path.join(content, relative), "utf-8"));
        const index = read("story/index.json") as { stories: Array<{ id: string; name: string }> };
        return {
            blueprintDocument: read("ui/uigraphs.json").blueprintDocument,
            uiDocument: read("ui/uidoc.json"),
            storyWrites: index.stories.flatMap(story => extractStoryVariableWrites(
                read(`story/stories/${story.id}/storydoc.json`),
                story.name,
            )),
        };
    }

    it("refuses every place the plugin's rows reach, naming the node type each time", () => {
        const gaps = findAssetNameGaps(starter(), createAssetNameDescriber(catalogueWithout(GALLERY_PREFIX)));

        // The six a release build printed, spelled out: four clips and pictures wired into a node,
        // and the two grid tiles that bind one. Named rather than counted, so a change that moves
        // the refusal somewhere else cannot pass by keeping the total.
        expect(gaps.map(gap => (gap.sink.kind === "pin"
            ? `${gap.sink.blueprintName} › ${gap.sink.nodeTitle} › ${gap.sink.pinLabel}`
            : `${gap.sink.surfaceName} › ${gap.sink.elementName} › ${gap.sink.propPath}`))).toEqual([
            "CG grid › Set Image Asset › Asset",
            "Music rows › Play Sound › Asset Id",
            "Voice rows › Play Sound › Asset Id",
            "Viewer › Set Image Asset › Asset",
            "Extra › Art › imageFill.assetId",
            "Extra › Art › imageFill.assetId",
        ]);
        expect(gaps.every(gap => gap.origin.kind === "node" && gap.origin.unknownType === true)).toBe(true);
        expect([...new Set(gaps.map(gap => assetNameGapMessage(gap).key))].sort()).toEqual([
            "lint.rule.blueprintAssembledAssetName.messageUnloadedNode",
            "lint.rule.blueprintAssembledAssetName.messageUnloadedNodeBinding",
        ]);
        expect([...new Set(gaps.map(gap => assetNameGapMessage(gap).params.origin))].every(
            origin => origin.startsWith(GALLERY_PREFIX),
        )).toBe(true);
    });

    it("has nothing to refuse once the plugin is loaded", () => {
        expect(findAssetNameGaps(starter(), createAssetNameDescriber(shippingRegistry()))).toEqual([]);
    });
});
