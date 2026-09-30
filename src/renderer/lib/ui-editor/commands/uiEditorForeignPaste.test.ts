import { describe, expect, it, vi } from "vitest";
import type { Blueprint } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_LITERAL_JSON } from "@shared/types/blueprint/graph";
import type { UIElement } from "@shared/types/ui-editor/document";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import { importTransferredAssets, type TransferredAssetPort } from "@/lib/workspace/services/assets/assetTransferImport";
import type { UIEditorClipboardPayload } from "./uiEditorClipboard";
import {
    collectUiClipboardAssetIds,
    collectUiClipboardComponentIds,
    countUnresolvedUiAssetSites,
    countUnresolvedUiComponentInstances,
    countUnresolvedUiFrameTargets,
    isUiPasteFromAnotherProject,
} from "./uiEditorForeignPaste";

/**
 * What a foreign paste is allowed to conclude, tested as the pure functions it is made of.
 *
 * Each one is exercised from both ends: the case it has to act on, and the case it has to leave
 * alone. The quiet half is what earns its keep here - a version of `isUiPasteFromAnotherProject`
 * that answered "foreign" for two spellings of one directory would look identical in a test that
 * only fed it two different projects, and would put every same-project paste through the import
 * path.
 */

function element(input: Partial<UIElement> & { id: string; type: string }): UIElement {
    return { parentId: null, childrenIds: [], layout: { x: 0, y: 0, width: 10, height: 10 }, ...input };
}

function payload(input: Partial<UIEditorClipboardPayload> & { elements: Record<string, UIElement> }): UIEditorClipboardPayload {
    return {
        v: 1,
        kind: "narraleaf.ui.elements",
        sourceSurfaceId: "surface",
        topLevelElementIds: Object.keys(input.elements),
        widgetMainBlueprints: {},
        widgetValueBlueprints: {},
        ...input,
    };
}

function sourced(path: string, elements: Record<string, UIElement>): UIEditorClipboardPayload {
    return payload({ elements, source: { path, identifier: "com.example.game", name: "Game" } });
}

describe("telling a foreign payload from one of this project's own", () => {
    it("reads two spellings of one directory as the same project", () => {
        const copied = sourced("D:/games/one", { a: element({ id: "a", type: "nl.text" }) });

        // A trailing separator, because it is the spelling every host folds. Which further
        // spellings fold - slash direction and case, on Windows - is the identity key's own rule
        // and is settled in recentProject's tests, where the platform can be named; asked through
        // this function it would only ever measure the host the suite is running on.
        expect(isUiPasteFromAnotherProject(copied, "D:/games/one/")).toBe(false);
    });

    it("reads a different directory as another project", () => {
        const copied = sourced("D:/games/one", { a: element({ id: "a", type: "nl.text" }) });

        expect(isUiPasteFromAnotherProject(copied, "D:/games/two")).toBe(true);
    });

    it("reads a payload with no source as this project's own", () => {
        // Nothing writes a payload without the stamp, and only the system clipboard can bring one
        // in from elsewhere - so an unstamped payload never left this window.
        const copied = payload({ elements: { a: element({ id: "a", type: "nl.text" }) } });

        expect(isUiPasteFromAnotherProject(copied, "D:/games/two")).toBe(false);
    });

    it("cannot decide without a project of its own to compare against", () => {
        const copied = sourced("D:/games/one", { a: element({ id: "a", type: "nl.text" }) });

        expect(isUiPasteFromAnotherProject(copied, "")).toBe(false);
    });
});

describe("the asset ids a copied selection carries", () => {
    it("takes them from the props the reference index reads, dormant ones included", () => {
        const copied = payload({
            elements: {
                // `fillType: "color"` leaves the picture in place for when the author flips back, so
                // the id is still a use of that file and still has to travel.
                card: element({
                    id: "card",
                    type: "nl.container",
                    props: { fillType: "color", imageFill: { assetId: "asset-dormant" } },
                }),
                label: element({ id: "label", type: "nl.text", props: { fontAssetId: "asset-font" } }),
                clip: element({ id: "clip", type: "nl.video", props: { assetId: "asset-video", posterAssetId: "asset-poster" } }),
            },
        });

        expect(collectUiClipboardAssetIds(copied)).toEqual([
            "asset-dormant",
            "asset-font",
            "asset-video",
            "asset-poster",
        ]);
    });

    it("takes them from the widget blueprints that travel beside the elements", () => {
        const copied = payload({
            elements: { button: element({ id: "button", type: "nl.button" }) },
            widgetMainBlueprints: { "bp-1": literalAssetBlueprint("bp-1", "asset-from-graph") },
        });

        expect(collectUiClipboardAssetIds(copied)).toContain("asset-from-graph");
    });

    it("names each id once however many widgets use it", () => {
        const copied = payload({
            elements: {
                one: element({ id: "one", type: "nl.image", props: { imageFill: { assetId: "asset-shared" } } }),
                two: element({ id: "two", type: "nl.image", props: { imageFill: { assetId: "asset-shared" } } }),
            },
        });

        expect(collectUiClipboardAssetIds(copied)).toEqual(["asset-shared"]);
    });
});

describe("what a foreign paste still has to report", () => {
    it("counts an unresolved asset per field rather than per file", () => {
        const copied = payload({
            elements: {
                one: element({ id: "one", type: "nl.image", props: { imageFill: { assetId: "asset-shared" } } }),
                two: element({ id: "two", type: "nl.image", props: { imageFill: { assetId: "asset-shared" } } }),
            },
        });

        expect(countUnresolvedUiAssetSites(copied, () => false)).toBe(2);
        expect(countUnresolvedUiAssetSites(copied, () => true)).toBe(0);
    });

    it("counts an instance of a component this project does not have", () => {
        const copied = payload({
            elements: {
                slot: linkedInstance("slot", "component-a"),
                badge: linkedInstance("badge", "component-b"),
            },
        });

        expect(collectUiClipboardComponentIds(copied)).toEqual(["component-a", "component-b"]);
        expect(countUnresolvedUiComponentInstances(copied, id => id === "component-a")).toBe(1);
        expect(countUnresolvedUiComponentInstances(copied, () => true)).toBe(0);
    });

    it("counts a Page widget embedding a page this project does not have", () => {
        const copied = payload({
            elements: {
                embed: element({ id: "embed", type: UI_FRAME_ELEMENT_TYPE, props: { targetSurfaceId: "page-a" } }),
                // A frame the author never finished placing is not a broken reference.
                blank: element({ id: "blank", type: UI_FRAME_ELEMENT_TYPE }),
            },
        });

        expect(countUnresolvedUiFrameTargets(copied, () => false)).toBe(1);
        expect(countUnresolvedUiFrameTargets(copied, id => id === "page-a")).toBe(0);
    });

    it("says nothing about an element that is not a linked instance", () => {
        const copied = payload({
            elements: {
                detached: element({
                    id: "detached",
                    type: "nl.container",
                    extra: { componentLink: { componentId: "component-a", linked: false } },
                }),
            },
        });

        expect(countUnresolvedUiComponentInstances(copied, () => false)).toBe(0);
    });
});

describe("a payload whose files cannot be fetched", () => {
    it("keeps its asset ids and imports nothing", async () => {
        // The window that made the copy has closed, or the copy came from another Studio process
        // whose grants this one cannot see. That is an ordinary outcome: the elements still paste,
        // their references stay foreign, and `assets/missing` reports each one.
        const copied = payload({
            elements: { art: element({ id: "art", type: "nl.image", props: { imageFill: { assetId: "asset-a" } } }) },
        });
        const port = failingPort();

        const outcome = await importTransferredAssets(port, undefined, collectUiClipboardAssetIds(copied));

        expect(outcome).toEqual({ imported: 0, failed: 0, frozen: false });
        expect(port.redeem).not.toHaveBeenCalled();
        expect(collectUiClipboardAssetIds(copied)).toEqual(["asset-a"]);
    });

    it("does not spend a token on files the copied elements do not name", async () => {
        const copied = payload({
            elements: { art: element({ id: "art", type: "nl.image", props: { imageFill: { assetId: "asset-a" } } }) },
        });
        const port = failingPort();

        const outcome = await importTransferredAssets(
            port,
            { token: "token", declaredAssetIds: ["asset-elsewhere"] },
            collectUiClipboardAssetIds(copied),
        );

        expect(outcome.imported).toBe(0);
        expect(port.redeem).not.toHaveBeenCalled();
    });
});

/** An instance of `componentId`, in the shape `getUIComponentLink` accepts. */
function linkedInstance(id: string, componentId: string): UIElement {
    return element({ id, type: "nl.container", extra: { componentLink: { componentId, linked: true } } });
}

/**
 * A graph feeding a JSON literal into an `asset` pin - the shape the reference walk follows with no
 * catalogue behind it, and the one a widget's own blueprint takes when its picture is wired rather
 * than picked.
 */
function literalAssetBlueprint(id: string, assetId: string): Blueprint {
    return {
        id,
        name: "Widget",
        owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
        graphs: {
            events: {
                click: {
                    graph: {
                        nodes: {
                            literal: {
                                id: "literal",
                                type: BLUEPRINT_NODE_TYPE_LITERAL_JSON,
                                params: { value: { kind: "imageAsset", assetId } },
                            },
                            sink: { id: "sink", type: "widget.image.setAsset", params: {} },
                        },
                        edges: [
                            { from: { nodeId: "literal", port: "value" }, to: { nodeId: "sink", port: "asset" } },
                        ],
                    },
                },
            },
            functions: {},
        },
    } as unknown as Blueprint;
}

function failingPort(): TransferredAssetPort & { redeem: ReturnType<typeof vi.fn> } {
    const redeem = vi.fn(async () => null);
    return {
        redeem,
        has: () => false,
        read: async () => null,
        create: async () => "failed" as const,
        createFromDirectory: async () => "failed" as const,
        isFrozen: () => false,
    };
}
