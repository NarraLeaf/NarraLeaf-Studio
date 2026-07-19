import { describe, expect, it } from "vitest";
import {
    buildReferenceIndex,
    extractBlueprintAssetReferences,
    extractCharacterAssetReferences,
    extractStoryAnimationAssetReferences,
    extractStoryAssetReferences,
    extractUIDocumentAssetReferences,
    extractVoiceAssetReferences,
    isLibraryAssetId,
} from "./referenceModel";
import type { StoryAnimationAsset, StoryBlock, StoryDocument } from "@shared/types/story";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { VoiceDocument } from "@shared/types/voice";

function actionBlock(id: string, payload: Record<string, unknown>): StoryBlock {
    return { id, kind: "action", parentId: null, childrenIds: [], payload } as unknown as StoryBlock;
}

function storyDoc(blocks: Record<string, StoryBlock>, defaultBackgroundAssetId?: string): StoryDocument {
    return {
        schemaVersion: 4,
        id: "story-1",
        name: "Main Story",
        entrySceneId: "scene-1",
        chapters: [],
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "Opening",
                runtimeName: "opening",
                defaultBackgroundAssetId,
                rootBlockIds: Object.keys(blocks),
                blocks,
            },
        },
    } as unknown as StoryDocument;
}

function uiElement(id: string, type: string, props: Record<string, unknown>): UIElement {
    return {
        id,
        type,
        name: "Widget",
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10, opacity: 1, visible: true },
        props,
    } as unknown as UIElement;
}

describe("isLibraryAssetId", () => {
    it("rejects id-shaped values that have no library row behind them", () => {
        expect(isLibraryAssetId("real-asset")).toBe(true);
        expect(isLibraryAssetId("builtin:font:sans")).toBe(false);
        expect(isLibraryAssetId("dev-mode-save-preview:abc")).toBe(false);
        expect(isLibraryAssetId("   ")).toBe(false);
        expect(isLibraryAssetId(undefined)).toBe(false);
        expect(isLibraryAssetId(null)).toBe(false);
    });
});

describe("extractStoryAssetReferences", () => {
    it("covers image and video blocks, which the asset-lock walker misses", () => {
        const document = storyDoc({
            b1: actionBlock("b1", { action: "image", operation: "create", objectName: "cg", assetId: "img-1" }),
            b2: actionBlock("b2", { action: "video", operation: "play", objectName: "op", assetId: "vid-1" }),
        });

        const fields = extractStoryAssetReferences(document, "Main Story").map(reference => reference.field);
        expect(fields).toContain("image.assetId");
        expect(fields).toContain("video.assetId");
    });

    it("covers every other asset-bearing payload plus the scene default background", () => {
        const document = storyDoc(
            {
                b1: actionBlock("b1", { action: "setBackground", assetId: "bg-1" }),
                b2: actionBlock("b2", { action: "character", operation: "enter", assetId: "char-1" }),
                b3: actionBlock("b3", { action: "audio", operation: "setBgm", assetId: "bgm-1" }),
                b4: actionBlock("b4", { action: "displayable", operation: "mask", target: {}, maskAssetId: "mask-1" }),
                b5: {
                    id: "b5",
                    kind: "nodeAction",
                    parentId: null,
                    childrenIds: [],
                    payload: { action: "dialogue", text: { value: "hi" }, voiceAssetId: "voice-1" },
                } as unknown as StoryBlock,
            },
            "scene-bg",
        );

        const byAsset = buildReferenceIndex(extractStoryAssetReferences(document, "Main Story"));
        expect([...byAsset.keys()].sort()).toEqual(
            ["bg-1", "bgm-1", "char-1", "mask-1", "scene-bg", "voice-1"].sort(),
        );
    });

    it("carries a story-block jump target so results are clickable", () => {
        const document = storyDoc({ b1: actionBlock("b1", { action: "setBackground", assetId: "bg-1" }) });

        expect(extractStoryAssetReferences(document, "Main Story")[0].target).toEqual({
            kind: "storyBlock",
            storyId: "story-1",
            sceneId: "scene-1",
            blockId: "b1",
            storyName: "Main Story",
            sceneName: "Opening",
        });
    });

    it("points a scene default background at the scene, not a block", () => {
        const document = storyDoc({}, "scene-bg");

        expect(extractStoryAssetReferences(document, "Main Story")[0].target).toMatchObject({ kind: "storyScene" });
    });
});

describe("extractStoryAnimationAssetReferences", () => {
    function animation(overrides: Record<string, unknown>): StoryAnimationAsset {
        return {
            schemaVersion: 1,
            id: "anim-1",
            name: "Shake",
            targetKind: "character",
            sequences: [],
            ...overrides,
        } as unknown as StoryAnimationAsset;
    }

    it("covers both preview images, which no other extractor walks", () => {
        const references = extractStoryAnimationAssetReferences(
            animation({ previewAssetId: "preview-1", previewBackgroundAssetId: "bg-1" }),
        );

        expect(references).toEqual([
            expect.objectContaining({ assetId: "preview-1", field: "animation.previewAssetId", label: "Shake" }),
            expect.objectContaining({ assetId: "bg-1", field: "animation.previewBackgroundAssetId" }),
        ]);
    });

    it("reports nothing for an animation with no preview set", () => {
        expect(extractStoryAnimationAssetReferences(animation({}))).toEqual([]);
    });
});

describe("extractBlueprintAssetReferences", () => {
    function blueprintDoc(nodes: Record<string, unknown>, slot: "events" | "functions" | "macros" = "events"): BlueprintDocument {
        return {
            ownerRecords: { globalMain: { activeBlueprintId: "bp-1", privateBlueprintIds: [] } },
            blueprints: {
                "bp-1": {
                    id: "bp-1",
                    name: "Main",
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {},
                            functions: {},
                            ...{ [slot]: { "g-1": { graph: { nodes } } } },
                        },
                    },
                },
            },
            persistentVariables: {},
        } as unknown as BlueprintDocument;
    }

    it("reads the tagged image-asset param", () => {
        const references = extractBlueprintAssetReferences(
            blueprintDoc({ n1: { id: "n1", type: "blueprint.image.assetLiteral", params: { asset: { kind: "imageAsset", assetId: "img-1" } } } }),
        );

        expect(references).toHaveLength(1);
        expect(references[0]).toMatchObject({ assetId: "img-1", field: "asset" });
        expect(references[0].target).toMatchObject({ kind: "blueprint", focusNodeId: "n1", focusEventId: "g-1" });
    });

    it("reads the legacy bare-string form of the same param", () => {
        const references = extractBlueprintAssetReferences(
            blueprintDoc({ n1: { id: "n1", type: "x", params: { asset: "img-legacy" } } }),
        );

        expect(references[0]?.assetId).toBe("img-legacy");
    });

    it("scans macro graphs, which the search index omits", () => {
        const references = extractBlueprintAssetReferences(
            blueprintDoc({ n1: { id: "n1", type: "x", params: { asset: "img-in-macro" } } }, "macros"),
        );

        expect(references[0]?.assetId).toBe("img-in-macro");
    });

    it("reads the pre-rename `assetId` pin, which Set Image Asset still falls back to", () => {
        const references = extractBlueprintAssetReferences(
            blueprintDoc({ n1: { id: "n1", type: "x", params: { assetId: { kind: "imageAsset", assetId: "img-old" } } } }),
        );

        expect(references).toHaveLength(1);
        expect(references[0]).toMatchObject({ assetId: "img-old", field: "assetId" });
    });

    it("takes only `asset` when a migrated node still carries the old pin", () => {
        // The node executes `asset`, so the stale `assetId` is not a second live reference.
        const references = extractBlueprintAssetReferences(
            blueprintDoc({ n1: { id: "n1", type: "x", params: { asset: "img-new", assetId: "img-old" } } }),
        );

        expect(references.map(reference => reference.assetId)).toEqual(["img-new"]);
    });

    it("reads bare font ids and skips builtin font stacks", () => {
        const references = extractBlueprintAssetReferences(
            blueprintDoc({
                n1: { id: "n1", type: "x", params: { fontAssetId: "font-1" } },
                n2: { id: "n2", type: "x", params: { fontAssetId: "builtin:font:sans" } },
            }),
        );

        expect(references.map(reference => reference.assetId)).toEqual(["font-1"]);
    });
});

describe("extractUIDocumentAssetReferences", () => {
    function doc(elements: UIElement[], components?: UIDocument["components"]): UIDocument {
        return {
            elements: Object.fromEntries(elements.map(element => [element.id, element])),
            components,
        } as unknown as UIDocument;
    }

    it("finds an image fill nested under scrollbar chrome", () => {
        const references = extractUIDocumentAssetReferences(
            doc([uiElement("e1", "nl.container", { scrollbar: { trackStyle: { fillType: "image", imageFill: { mode: "cover", assetId: "track-1" } } } })]),
        );

        expect(references[0]).toMatchObject({ assetId: "track-1", field: "scrollbar.trackStyle.imageFill" });
        expect(references[0].dormant).toBeUndefined();
    });

    it("marks a fill dormant when its sibling fillType is not image", () => {
        const references = extractUIDocumentAssetReferences(
            doc([uiElement("e1", "nl.container", { fillType: "color", imageFill: { mode: "cover", assetId: "img-1" } })]),
        );

        expect(references[0]).toMatchObject({ assetId: "img-1", dormant: true });
    });

    it("judges dormancy per nesting level, not from the element root", () => {
        const references = extractUIDocumentAssetReferences(
            doc([
                uiElement("e1", "nl.container", {
                    fillType: "color",
                    scrollbar: { trackStyle: { fillType: "image", imageFill: { mode: "cover", assetId: "track-1" } } },
                }),
            ]),
        );

        expect(references[0].dormant).toBeUndefined();
    });

    it("reads the legacy bare assetId on nl.image", () => {
        const references = extractUIDocumentAssetReferences(doc([uiElement("e1", "nl.image", { assetId: "legacy-1" })]));

        expect(references[0]).toMatchObject({ assetId: "legacy-1", field: "assetId" });
    });

    it("keeps the legacy prop as a dormant reference when an imageFill supplies the picture", () => {
        // `getImageWidgetRectangleProps` renders img-1, so legacy-1 draws nothing today - but
        // clearing the fill brings it back, which is the whole point of reporting dormant sites.
        const references = extractUIDocumentAssetReferences(
            doc([uiElement("e1", "nl.image", { assetId: "legacy-1", fillType: "image", imageFill: { mode: "cover", assetId: "img-1" } })]),
        );

        const byAsset = Object.fromEntries(references.map(reference => [reference.assetId, reference]));
        expect(Object.keys(byAsset).sort()).toEqual(["img-1", "legacy-1"]);
        expect(byAsset["img-1"].dormant).toBeUndefined();
        expect(byAsset["legacy-1"].dormant).toBe(true);
    });

    it("still reads the legacy prop when imageFill exists but holds no asset", () => {
        // The runtime gates on `!hasAssetInFill`, not on the presence of the object. Testing for the
        // object dropped this reference and the widget rendered an asset nothing claimed to use.
        const references = extractUIDocumentAssetReferences(
            doc([uiElement("e1", "nl.image", { assetId: "legacy-1", imageFill: { mode: "cover", assetId: null } })]),
        );

        expect(references).toHaveLength(1);
        expect(references[0]).toMatchObject({ assetId: "legacy-1", field: "assetId" });
        expect(references[0].dormant).toBeUndefined();
    });

    it("treats the legacy prop as live even when fillType says colour", () => {
        // The legacy upgrade forces `fillType: "image"`, so reading the stored fillType inverted the
        // flag and showed a live reference as "inactive" in the delete dialog.
        const references = extractUIDocumentAssetReferences(
            doc([uiElement("e1", "nl.image", { assetId: "legacy-1", fillType: "color" })]),
        );

        expect(references).toHaveLength(1);
        expect(references[0].dormant).toBeUndefined();
    });

    it("marks the legacy prop dormant when a backgroundImage wins instead", () => {
        const references = extractUIDocumentAssetReferences(
            doc([uiElement("e1", "nl.image", { assetId: "legacy-1", backgroundImage: "app://fs/abc" })]),
        );

        expect(references).toHaveLength(1);
        expect(references[0]).toMatchObject({ assetId: "legacy-1", dormant: true });
    });

    it("descends into arrays so a fill in a list prop is still found", () => {
        const references = extractUIDocumentAssetReferences(
            doc([uiElement("e1", "nl.list", {
                slides: [
                    { fillType: "image", imageFill: { mode: "cover", assetId: "slide-1" } },
                    { fillType: "color", imageFill: { mode: "cover", assetId: "slide-2" } },
                ],
            })]),
        );

        expect(references.map(reference => reference.field)).toEqual([
            "slides[0].imageFill",
            "slides[1].imageFill",
        ]);
        expect(references[0]).toMatchObject({ assetId: "slide-1" });
        expect(references[0].dormant).toBeUndefined();
        expect(references[1]).toMatchObject({ assetId: "slide-2", dormant: true });
    });

    it("reads assets out of appearance variant rows and labels them by variant", () => {
        const references = extractUIDocumentAssetReferences(
            doc([
                uiElement("e1", "nl.button", {
                    appearance: {
                        defaultVariantId: "v1",
                        variants: [
                            {
                                id: "v1",
                                name: "Hover",
                                propertyGroups: [
                                    { key: "fillType", rows: [{ value: "image" }] },
                                    { key: "imageFill", rows: [{ value: { mode: "cover", assetId: "hover-1" } }] },
                                    { key: "fontAssetId", rows: [{ value: "font-1" }] },
                                ],
                            },
                        ],
                    },
                }),
            ]),
        );

        expect(references.map(reference => reference.assetId).sort()).toEqual(["font-1", "hover-1"]);
        const hoverFill = references.find(reference => reference.assetId === "hover-1");
        expect(hoverFill).toMatchObject({ detail: "Hover" });
        expect(hoverFill?.dormant).toBeUndefined();
    });

    it("marks appearance fills dormant when the variant pins fillType away from image", () => {
        const references = extractUIDocumentAssetReferences(
            doc([
                uiElement("e1", "nl.button", {
                    appearance: {
                        defaultVariantId: "v1",
                        variants: [
                            {
                                id: "v1",
                                name: "Disabled",
                                propertyGroups: [
                                    { key: "fillType", rows: [{ value: "color" }] },
                                    { key: "imageFill", rows: [{ value: { mode: "cover", assetId: "img-1" } }] },
                                ],
                            },
                        ],
                    },
                }),
            ]),
        );

        expect(references[0].dormant).toBe(true);
    });

    it("scans the component element pool, which is disjoint from the stage pool", () => {
        const references = extractUIDocumentAssetReferences(
            doc([], [
                {
                    id: "c1",
                    name: "Card",
                    rootElementId: "e9",
                    elements: { e9: uiElement("e9", "nl.image", { fillType: "image", imageFill: { mode: "cover", assetId: "in-component" } }) },
                },
            ] as unknown as UIDocument["components"]),
        );

        expect(references[0]).toMatchObject({ assetId: "in-component", detail: "Card" });
    });
});

describe("extractVoiceAssetReferences", () => {
    it("indexes one reference per voiced unit, tagged with its locale", () => {
        const document = {
            schemaVersion: 1,
            locale: "ja",
            units: { "text-1": { assetId: "take-1", sourceHash: "h", status: "linked" } },
        } as unknown as VoiceDocument;

        expect(extractVoiceAssetReferences(document)[0]).toMatchObject({
            assetId: "take-1",
            kind: "voice",
            label: "text-1",
            detail: "ja",
        });
    });
});

describe("extractCharacterAssetReferences", () => {
    it("covers the profile thumbnail and every form variant", () => {
        const references = extractCharacterAssetReferences([
            {
                id: "c1",
                name: "Inko",
                thumbnailAssetId: "thumb-1",
                forms: [{ name: "School", variantAssetIds: { happy: "happy-1", sad: null } }],
            },
        ]);

        expect(references.map(reference => reference.assetId).sort()).toEqual(["happy-1", "thumb-1"]);
        expect(references.find(reference => reference.assetId === "happy-1")?.detail).toBe("School › happy");
    });
});

describe("buildReferenceIndex", () => {
    it("groups every site that shares an asset id", () => {
        const index = buildReferenceIndex([
            { id: "a", assetId: "img-1", kind: "story", label: "S", field: "f" },
            { id: "b", assetId: "img-1", kind: "uiElement", label: "W", field: "g" },
            { id: "c", assetId: "img-2", kind: "story", label: "S", field: "f" },
        ]);

        expect(index.get("img-1")).toHaveLength(2);
        expect(index.get("img-2")).toHaveLength(1);
        expect(index.has("img-3")).toBe(false);
    });
});
