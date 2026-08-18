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
  referenceGapsAffecting,
  type AssetReference,
  type ReferenceIndexGap
} from "./referenceModel";
import type { StoryAnimationAsset, StoryBlock, StoryDocument } from "@shared/types/story";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { VoiceDocument } from "@shared/types/voice";

/**
 * The two extractors that can report a coverage gap return both halves. These read the reference
 * half, which is what every case below is about; the gap half has cases of its own.
 */
const blueprintReferences = (
  ...args: Parameters<typeof extractBlueprintAssetReferences>
): AssetReference[] => extractBlueprintAssetReferences(...args).references;
const uiReferences = (
  ...args: Parameters<typeof extractUIDocumentAssetReferences>
): AssetReference[] => extractUIDocumentAssetReferences(...args).references;

function actionBlock(id: string, payload: Record<string, unknown>): StoryBlock {
  return { id, kind: "action", parentId: null, childrenIds: [], payload } as unknown as StoryBlock;
}

function storyDoc(
  blocks: Record<string, StoryBlock>,
  defaultBackgroundAssetId?: string
): StoryDocument {
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
        blocks
      }
    }
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
    props
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
      b1: actionBlock("b1", {
        action: "image",
        operation: "create",
        objectName: "cg",
        assetId: "img-1"
      }),
      b2: actionBlock("b2", {
        action: "video",
        operation: "play",
        objectName: "op",
        assetId: "vid-1"
      })
    });

    const fields = extractStoryAssetReferences(document, "Main Story").map(
      (reference) => reference.field
    );
    expect(fields).toContain("image.assetId");
    expect(fields).toContain("video.assetId");
  });

  it("covers every other asset-bearing payload plus the scene default background", () => {
    const document = storyDoc(
      {
        b1: actionBlock("b1", { action: "setBackground", assetId: "bg-1" }),
        b2: actionBlock("b2", { action: "character", operation: "enter", assetId: "char-1" }),
        b3: actionBlock("b3", { action: "audio", operation: "setBgm", assetId: "bgm-1" }),
        b4: actionBlock("b4", {
          action: "displayable",
          operation: "mask",
          target: {},
          maskAssetId: "mask-1"
        }),
        b5: {
          id: "b5",
          kind: "nodeAction",
          parentId: null,
          childrenIds: [],
          payload: { action: "dialogue", text: { value: "hi" }, voiceAssetId: "voice-1" }
        } as unknown as StoryBlock
      },
      "scene-bg"
    );

    const byAsset = buildReferenceIndex(extractStoryAssetReferences(document, "Main Story"));
    expect([...byAsset.keys()].sort()).toEqual(
      ["bg-1", "bgm-1", "char-1", "mask-1", "scene-bg", "voice-1"].sort()
    );
  });

  it("carries a story-block jump target so results are clickable", () => {
    const document = storyDoc({
      b1: actionBlock("b1", { action: "setBackground", assetId: "bg-1" })
    });

    expect(extractStoryAssetReferences(document, "Main Story")[0].target).toEqual({
      kind: "storyBlock",
      storyId: "story-1",
      sceneId: "scene-1",
      blockId: "b1",
      storyName: "Main Story",
      sceneName: "Opening"
    });
  });

  it("points a scene default background at the scene, not a block", () => {
    const document = storyDoc({}, "scene-bg");

    expect(extractStoryAssetReferences(document, "Main Story")[0].target).toMatchObject({
      kind: "storyScene"
    });
  });

  it("counts a scene's own music as a use of that audio asset", () => {
    const document = storyDoc({});
    document.scenes["scene-1"].bgm = { assetId: "scene-theme" };

    // Without this, deleting the track a scene opens with would report it as unused - and the
    // scene would go silent with no warning at all.
    const references = extractStoryAssetReferences(document, "Main Story");
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      assetId: "scene-theme",
      field: "scene.bgm.assetId",
      target: { kind: "storyScene" }
    });
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
      ...overrides
    } as unknown as StoryAnimationAsset;
  }

  it("covers both preview images, which no other extractor walks", () => {
    const references = extractStoryAnimationAssetReferences(
      animation({ previewAssetId: "preview-1", previewBackgroundAssetId: "bg-1" })
    );

    expect(references).toEqual([
      expect.objectContaining({
        assetId: "preview-1",
        field: "animation.previewAssetId",
        label: "Shake"
      }),
      expect.objectContaining({ assetId: "bg-1", field: "animation.previewBackgroundAssetId" })
    ]);
  });

  it("reports nothing for an animation with no preview set", () => {
    expect(extractStoryAnimationAssetReferences(animation({}))).toEqual([]);
  });
});

describe("extractBlueprintAssetReferences", () => {
  function blueprintDoc(
    nodes: Record<string, unknown>,
    slot: "events" | "functions" | "macros" = "events"
  ): BlueprintDocument {
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
              ...{ [slot]: { "g-1": { graph: { nodes } } } }
            }
          }
        }
      },
      persistentVariables: {}
    } as unknown as BlueprintDocument;
  }

  it("reads the tagged image-asset param", () => {
    const references = blueprintReferences(
      blueprintDoc({
        n1: {
          id: "n1",
          type: "blueprint.image.assetLiteral",
          params: { asset: { kind: "imageAsset", assetId: "img-1" } }
        }
      })
    );

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ assetId: "img-1", field: "asset" });
    expect(references[0].target).toMatchObject({
      kind: "blueprint",
      focusNodeId: "n1",
      focusEventId: "g-1"
    });
  });

  it("reads the legacy bare-string form of the same param", () => {
    const references = blueprintReferences(
      blueprintDoc({ n1: { id: "n1", type: "x", params: { asset: "img-legacy" } } })
    );

    expect(references[0]?.assetId).toBe("img-legacy");
  });

  it("scans macro graphs, which the search index omits", () => {
    const references = blueprintReferences(
      blueprintDoc({ n1: { id: "n1", type: "x", params: { asset: "img-in-macro" } } }, "macros")
    );

    expect(references[0]?.assetId).toBe("img-in-macro");
  });

  it("reads the pre-rename `assetId` pin, which Set Image Asset still falls back to", () => {
    const references = blueprintReferences(
      blueprintDoc({
        n1: { id: "n1", type: "x", params: { assetId: { kind: "imageAsset", assetId: "img-old" } } }
      })
    );

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ assetId: "img-old", field: "assetId" });
  });

  it("takes only `asset` when a migrated node still carries the old pin", () => {
    // The node executes `asset`, so the stale `assetId` is not a second live reference.
    const references = blueprintReferences(
      blueprintDoc({
        n1: { id: "n1", type: "x", params: { asset: "img-new", assetId: "img-old" } }
      })
    );

    expect(references.map((reference) => reference.assetId)).toEqual(["img-new"]);
  });

  it("reads bare font ids and skips builtin font stacks", () => {
    const references = blueprintReferences(
      blueprintDoc({
        n1: { id: "n1", type: "x", params: { fontAssetId: "font-1" } },
        n2: { id: "n2", type: "x", params: { fontAssetId: "builtin:font:sans" } }
      })
    );

    expect(references.map((reference) => reference.assetId)).toEqual(["font-1"]);
  });
});

describe("extractUIDocumentAssetReferences", () => {
  function doc(elements: UIElement[], components?: UIDocument["components"]): UIDocument {
    return {
      elements: Object.fromEntries(elements.map((element) => [element.id, element])),
      components
    } as unknown as UIDocument;
  }

  it("finds an image fill nested under scrollbar chrome", () => {
    const references = uiReferences(
      doc([
        uiElement("e1", "nl.container", {
          scrollbar: {
            trackStyle: { fillType: "image", imageFill: { mode: "cover", assetId: "track-1" } }
          }
        })
      ])
    );

    expect(references[0]).toMatchObject({
      assetId: "track-1",
      field: "scrollbar.trackStyle.imageFill"
    });
    expect(references[0].dormant).toBeUndefined();
  });

  it("marks a fill dormant when its sibling fillType is not image", () => {
    const references = uiReferences(
      doc([
        uiElement("e1", "nl.container", {
          fillType: "color",
          imageFill: { mode: "cover", assetId: "img-1" }
        })
      ])
    );

    expect(references[0]).toMatchObject({ assetId: "img-1", dormant: true });
  });

  it("judges dormancy per nesting level, not from the element root", () => {
    const references = uiReferences(
      doc([
        uiElement("e1", "nl.container", {
          fillType: "color",
          scrollbar: {
            trackStyle: { fillType: "image", imageFill: { mode: "cover", assetId: "track-1" } }
          }
        })
      ])
    );

    expect(references[0].dormant).toBeUndefined();
  });

  it("reads the legacy bare assetId on nl.image", () => {
    const references = uiReferences(doc([uiElement("e1", "nl.image", { assetId: "legacy-1" })]));

    expect(references[0]).toMatchObject({ assetId: "legacy-1", field: "assetId" });
  });

  it("keeps the legacy prop as a dormant reference when an imageFill supplies the picture", () => {
    // `getImageWidgetRectangleProps` renders img-1, so legacy-1 draws nothing today - but
    // clearing the fill brings it back, which is the whole point of reporting dormant sites.
    const references = uiReferences(
      doc([
        uiElement("e1", "nl.image", {
          assetId: "legacy-1",
          fillType: "image",
          imageFill: { mode: "cover", assetId: "img-1" }
        })
      ])
    );

    const byAsset = Object.fromEntries(
      references.map((reference) => [reference.assetId, reference])
    );
    expect(Object.keys(byAsset).sort()).toEqual(["img-1", "legacy-1"]);
    expect(byAsset["img-1"].dormant).toBeUndefined();
    expect(byAsset["legacy-1"].dormant).toBe(true);
  });

  it("still reads the legacy prop when imageFill exists but holds no asset", () => {
    // The runtime gates on `!hasAssetInFill`, not on the presence of the object. Testing for the
    // object dropped this reference and the widget rendered an asset nothing claimed to use.
    const references = uiReferences(
      doc([
        uiElement("e1", "nl.image", {
          assetId: "legacy-1",
          imageFill: { mode: "cover", assetId: null }
        })
      ])
    );

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ assetId: "legacy-1", field: "assetId" });
    expect(references[0].dormant).toBeUndefined();
  });

  it("treats the legacy prop as live even when fillType says colour", () => {
    // The legacy upgrade forces `fillType: "image"`, so reading the stored fillType inverted the
    // flag and showed a live reference as "inactive" in the delete dialog.
    const references = uiReferences(
      doc([uiElement("e1", "nl.image", { assetId: "legacy-1", fillType: "color" })])
    );

    expect(references).toHaveLength(1);
    expect(references[0].dormant).toBeUndefined();
  });

  it("marks the legacy prop dormant when a backgroundImage wins instead", () => {
    const references = uiReferences(
      doc([uiElement("e1", "nl.image", { assetId: "legacy-1", backgroundImage: "app://fs/abc" })])
    );

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ assetId: "legacy-1", dormant: true });
  });

  it("finds a Surface's background image, which no element holds", () => {
    const document = {
      ...doc([]),
      surfaces: [
        {
          id: "s1",
          name: "Main Menu",
          settings: { backgroundImage: { assetId: "bg-1", fillMode: "cover" } }
        },
        { id: "s2", name: "Config", settings: { backgroundColor: "#000000" } }
      ]
    } as unknown as UIDocument;

    const references = uiReferences(document);

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      assetId: "bg-1",
      label: "Main Menu",
      field: "backgroundImage",
      target: { kind: "uiSurface", surfaceId: "s1" }
    });
  });

  it("reads a widget's bare assetId and posterAssetId", () => {
    // Before `nl.video` this walk knew `imageFill`, `fontAssetId`, and `nl.image`'s legacy bare
    // id - nothing else. A widget naming its prop `assetId` was preloaded by the shipped game
    // (`surfaceResourcePreload.ts` matches that literal name) and simultaneously absent from
    // "what uses this asset", which is the one place an author looks before deleting it.
    const references = uiReferences(
      doc([uiElement("e1", "nl.video", { assetId: "clip-1", posterAssetId: "poster-1" })])
    );

    expect(references.map((reference) => reference.field).sort()).toEqual([
      "assetId",
      "posterAssetId"
    ]);
    expect(references.map((reference) => reference.assetId).sort()).toEqual(["clip-1", "poster-1"]);
    expect(references.every((reference) => reference.dormant === undefined)).toBe(true);
  });

  it("reports the nl.image legacy assetId exactly once", () => {
    // The generic `assetId` arm and the nl.image legacy branch push the same reference id; if
    // both fired, the delete dialog would list the same site twice under one key.
    const references = uiReferences(doc([uiElement("e1", "nl.image", { assetId: "legacy-1" })]));

    expect(references).toHaveLength(1);
    expect(references[0].id).toBe("ui:e1:assetId");
  });

  it("descends into arrays so a fill in a list prop is still found", () => {
    const references = uiReferences(
      doc([
        uiElement("e1", "nl.list", {
          slides: [
            { fillType: "image", imageFill: { mode: "cover", assetId: "slide-1" } },
            { fillType: "color", imageFill: { mode: "cover", assetId: "slide-2" } }
          ]
        })
      ])
    );

    expect(references.map((reference) => reference.field)).toEqual([
      "slides[0].imageFill",
      "slides[1].imageFill"
    ]);
    expect(references[0]).toMatchObject({ assetId: "slide-1" });
    expect(references[0].dormant).toBeUndefined();
    expect(references[1]).toMatchObject({ assetId: "slide-2", dormant: true });
  });

  it("reads assets out of appearance variant rows and labels them by variant", () => {
    const references = uiReferences(
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
                  { key: "fontAssetId", rows: [{ value: "font-1" }] }
                ]
              }
            ]
          }
        })
      ])
    );

    expect(references.map((reference) => reference.assetId).sort()).toEqual(["font-1", "hover-1"]);
    const hoverFill = references.find((reference) => reference.assetId === "hover-1");
    expect(hoverFill).toMatchObject({ detail: "Hover" });
    expect(hoverFill?.dormant).toBeUndefined();
  });

  it("marks appearance fills dormant when the variant pins fillType away from image", () => {
    const references = uiReferences(
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
                  { key: "imageFill", rows: [{ value: { mode: "cover", assetId: "img-1" } }] }
                ]
              }
            ]
          }
        })
      ])
    );

    expect(references[0].dormant).toBe(true);
  });

  it("scans the component element pool, which is disjoint from the stage pool", () => {
    const references = uiReferences(
      doc([], [
        {
          id: "c1",
          name: "Card",
          rootElementId: "e9",
          elements: {
            e9: uiElement("e9", "nl.image", {
              fillType: "image",
              imageFill: { mode: "cover", assetId: "in-component" }
            })
          }
        }
      ] as unknown as UIDocument["components"])
    );

    expect(references[0]).toMatchObject({ assetId: "in-component", detail: "Card" });
  });
});

describe("extractVoiceAssetReferences", () => {
  it("indexes one reference per voiced unit, tagged with its locale", () => {
    const document = {
      schemaVersion: 1,
      locale: "ja",
      units: { "text-1": { assetId: "take-1", sourceHash: "h", status: "linked" } }
    } as unknown as VoiceDocument;

    expect(extractVoiceAssetReferences(document)[0]).toMatchObject({
      assetId: "take-1",
      kind: "voice",
      label: "text-1",
      detail: "ja"
    });
  });
});

describe("extractCharacterAssetReferences", () => {
  it("covers the profile thumbnail and every appearance image", () => {
    const references = extractCharacterAssetReferences([
      {
        id: "c1",
        name: "Inko",
        thumbnailAssetId: "thumb-1",
        appearanceAssets: [
          { slot: "pose:p1", detail: "Happy", assetId: "happy-1" },
          { slot: "pose:p2", detail: "Sad", assetId: null }
        ]
      }
    ]);

    expect(references.map((reference) => reference.assetId).sort()).toEqual(["happy-1", "thumb-1"]);
    expect(references.find((reference) => reference.assetId === "happy-1")?.detail).toBe("Happy");
  });

  it("keeps a layered character's per-tag images apart", () => {
    const references = extractCharacterAssetReferences([
      {
        id: "c1",
        name: "Inko",
        appearanceAssets: [
          { slot: "layer:l1:t1", detail: "Mouth › Happy", assetId: "mouth-happy" },
          { slot: "layer:l1:t2", detail: "Mouth › Angry", assetId: "mouth-angry" }
        ]
      }
    ]);

    // One layer, two tags, two references — a slot key naming only the layer would collapse them.
    expect(references.map((reference) => reference.id)).toEqual([
      "char:c1:layer:l1:t1",
      "char:c1:layer:l1:t2"
    ]);
  });
});

describe("buildReferenceIndex", () => {
  it("groups every site that shares an asset id", () => {
    const index = buildReferenceIndex([
      { id: "a", assetId: "img-1", kind: "story", label: "S", field: "f" },
      { id: "b", assetId: "img-1", kind: "uiElement", label: "W", field: "g" },
      { id: "c", assetId: "img-2", kind: "story", label: "S", field: "f" }
    ]);

    expect(index.get("img-1")).toHaveLength(2);
    expect(index.get("img-2")).toHaveLength(1);
    expect(index.has("img-3")).toBe(false);
  });
});

describe("coverage of an asset reachable only through a hash URL", () => {
  function urlDoc(props: Record<string, unknown>): UIDocument {
    return { elements: { e1: uiElement("e1", "nl.container", props) } } as unknown as UIDocument;
  }

  it("finds the asset behind a token this session minted", () => {
    // The widget's only asset-shaped prop is the URL: no imageFill, no assetId. Without the
    // reverse table this asset has nothing pointing at it and reads as deletable.
    const extraction = extractUIDocumentAssetReferences(
      urlDoc({ backgroundImage: "app://fs/token-1" }),
      {
        resolveAssetToken: (token) => (token === "token-1" ? "img-1" : null)
      }
    );

    expect(extraction.gaps).toEqual([]);
    expect(extraction.references).toHaveLength(1);
    expect(extraction.references[0]).toMatchObject({ assetId: "img-1", field: "backgroundImage" });
  });

  it("reads the token out of a bundle URL, whose remainder is a path inside the grant", () => {
    const extraction = extractUIDocumentAssetReferences(
      urlDoc({ backgroundImage: "app://fs/token-1/Hiyori.2048/texture_00.png" }),
      { resolveAssetToken: (token) => (token === "token-1" ? "model-1" : null) }
    );

    expect(extraction.references[0]?.assetId).toBe("model-1");
  });

  it("reports an unknown token as a gap naming the widget and field", () => {
    const extraction = extractUIDocumentAssetReferences(
      urlDoc({ backgroundImage: "app://fs/stale" }),
      {
        resolveAssetToken: () => null
      }
    );

    expect(extraction.references).toEqual([]);
    expect(extraction.gaps).toEqual([
      {
        reason: "hashUrlUnresolved",
        slice: "ui",
        location: "Widget.backgroundImage",
        affects: ["image"]
      }
    ]);
  });

  it("finds a token inside an appearance variant row", () => {
    const extraction = extractUIDocumentAssetReferences(
      {
        elements: {
          e1: uiElement("e1", "nl.button", {
            appearance: {
              defaultVariantId: "v1",
              variants: [
                {
                  id: "v1",
                  name: "Hover",
                  propertyGroups: [
                    { key: "backgroundImage", rows: [{ value: "app://fs/token-2" }] }
                  ]
                }
              ]
            }
          })
        }
      } as unknown as UIDocument,
      { resolveAssetToken: (token) => (token === "token-2" ? "hover-1" : null) }
    );

    expect(extraction.references[0]).toMatchObject({ assetId: "hover-1", detail: "Hover" });
  });

  it("treats an ordinary web address as neither a reference nor a gap", () => {
    // It names no library asset at all, so there is nothing missing and nothing to warn about.
    const extraction = extractUIDocumentAssetReferences(
      urlDoc({ backgroundImage: "https://example.com/a.png" })
    );

    expect(extraction.references).toEqual([]);
    expect(extraction.gaps).toEqual([]);
  });
});

describe("coverage of an asset reachable only through a legacy literal node", () => {
  function wiredDoc(nodes: Record<string, unknown>, edges: unknown[]): BlueprintDocument {
    return {
      ownerRecords: { globalMain: { activeBlueprintId: "bp-1", privateBlueprintIds: [] } },
      blueprints: {
        "bp-1": {
          id: "bp-1",
          name: "Main",
          program: {
            kind: "graph",
            graphs: { events: { "g-1": { graph: { nodes, edges } } }, functions: {} }
          }
        }
      },
      persistentVariables: {}
    } as unknown as BlueprintDocument;
  }

  it("reads a JSON literal wired into an image asset pin", () => {
    // The consuming node stores nothing: its pin is fed by the edge, and the id lives in the
    // literal's free-form JSON. This is the shape the index used to be blind to.
    const extraction = extractBlueprintAssetReferences(
      wiredDoc(
        {
          lit: {
            id: "lit",
            type: "blueprint.data.jsonLiteral",
            params: { value: { kind: "imageAsset", assetId: "img-json" } }
          },
          set: { id: "set", type: "widget.image.setAsset", params: {} }
        },
        [{ from: { nodeId: "lit", port: "value" }, to: { nodeId: "set", port: "asset" } }]
      )
    );

    expect(extraction.gaps).toEqual([]);
    expect(extraction.references).toHaveLength(1);
    expect(extraction.references[0]).toMatchObject({ assetId: "img-json", field: "asset" });
  });

  it("reads a String literal wired into a font pin", () => {
    const extraction = extractBlueprintAssetReferences(
      wiredDoc(
        {
          lit: { id: "lit", type: "blueprint.data.stringLiteral", params: { value: "font-wired" } },
          set: { id: "set", type: "text.setFont", params: {} }
        },
        [{ from: { nodeId: "lit", port: "value" }, to: { nodeId: "set", port: "fontAssetId" } }]
      )
    );

    expect(extraction.references.map((reference) => reference.assetId)).toEqual(["font-wired"]);
  });

  it("does not read a literal wired into a pin that carries no asset", () => {
    // The guard against the heuristic this replaces: an id-shaped string is an asset reference
    // because of the pin it feeds, never because of how it looks.
    const extraction = extractBlueprintAssetReferences(
      wiredDoc(
        {
          lit: {
            id: "lit",
            type: "blueprint.data.stringLiteral",
            params: { value: "looks-like-an-id" }
          },
          set: { id: "set", type: "text.setText", params: {} }
        },
        [{ from: { nodeId: "lit", port: "value" }, to: { nodeId: "set", port: "text" } }]
      )
    );

    expect(extraction.references).toEqual([]);
    expect(extraction.gaps).toEqual([]);
  });

  it("reports an asset pin fed by a computing node as a gap naming the node", () => {
    const extraction = extractBlueprintAssetReferences(
      wiredDoc(
        {
          pick: { id: "pick", type: "blueprint.saved.get.value", params: {} },
          set: { id: "set", type: "widget.image.setAsset", params: {} }
        },
        [{ from: { nodeId: "pick", port: "value" }, to: { nodeId: "set", port: "asset" } }]
      ),
      {
        resolveNodeLabel: (type) =>
          type === "widget.image.setAsset" ? "Set Image Asset" : undefined
      }
    );

    expect(extraction.references).toEqual([]);
    expect(extraction.gaps).toEqual([
      expect.objectContaining({
        reason: "computedAssetPin",
        slice: "blueprint",
        location: "Main › Set Image Asset.asset"
      })
    ]);
  });

  it("counts an Image Asset literal once, from the node that stores it", () => {
    // Its own `asset` param is the reference; following the edge as well would list the same
    // pick twice under one asset.
    const extraction = extractBlueprintAssetReferences(
      wiredDoc(
        {
          lit: {
            id: "lit",
            type: "blueprint.image.assetLiteral",
            params: { asset: { kind: "imageAsset", assetId: "img-1" } }
          },
          set: { id: "set", type: "widget.image.setAsset", params: {} }
        },
        [{ from: { nodeId: "lit", port: "value" }, to: { nodeId: "set", port: "asset" } }]
      )
    );

    expect(extraction.gaps).toEqual([]);
    expect(extraction.references).toHaveLength(1);
    expect(extraction.references[0]).toMatchObject({ assetId: "img-1", field: "asset" });
  });

  it("does not report a gap when the source pin carries the same kind of asset", () => {
    // Get Font into Set Font moves a font the element already stores, and that element is
    // indexed. Calling this a gap would make the index incomplete over a graph that hides
    // nothing, and cost the author their unused-asset report for it.
    const extraction = extractBlueprintAssetReferences(
      wiredDoc(
        {
          get: { id: "get", type: "text.getFont", params: {} },
          set: { id: "set", type: "text.setFont", params: {} }
        },
        [
          {
            from: { nodeId: "get", port: "fontAssetId" },
            to: { nodeId: "set", port: "fontAssetId" }
          }
        ]
      ),
      {
        resolveAssetPins: () => [
          { pinId: "fontAssetId", kind: "font", paramKey: "fontAssetId", input: true }
        ]
      }
    );

    expect(extraction.gaps).toEqual([]);
    expect(extraction.references).toEqual([]);
  });

  it("covers a node whose asset param the catalogue alone knows about", () => {
    // A plugin node storing its pick under a name this file has never heard of. Declaring the
    // pin is the whole registration; nothing here lists it.
    const extraction = extractBlueprintAssetReferences(
      wiredDoc(
        {
          n1: {
            id: "n1",
            type: "acme.showBanner",
            params: { banner: { kind: "imageAsset", assetId: "img-plugin" } }
          }
        },
        []
      ),
      {
        resolveAssetPins: (type) =>
          type === "acme.showBanner"
            ? [{ pinId: "banner", kind: "image", paramKey: "banner", input: true }]
            : []
      }
    );

    expect(extraction.references[0]).toMatchObject({ assetId: "img-plugin", field: "banner" });
  });
});

describe("blueprints this walk cannot read", () => {
  function docWith(
    blueprint: Record<string, unknown>,
    ownerRecords?: Record<string, unknown>
  ): BlueprintDocument {
    return {
      ownerRecords: ownerRecords ?? {
        globalMain: { activeBlueprintId: "bp-1", privateBlueprintIds: [] }
      },
      blueprints: { "bp-1": blueprint },
      persistentVariables: {}
    } as unknown as BlueprintDocument;
  }

  it("reports a script-module blueprint as a gap instead of skipping it", () => {
    // TypeScript blueprints are creatable, and an asset id in that source is a plain string this
    // file has no business parsing. Skipping in silence reported full coverage over it.
    const extraction = extractBlueprintAssetReferences(
      docWith({
        id: "bp-1",
        name: "Title Logic",
        program: { kind: "scriptModule", source: { language: "typescript", code: "" } }
      })
    );

    expect(extraction.references).toEqual([]);
    expect(extraction.gaps).toEqual([
      { reason: "blueprintProgramNotWalked", slice: "blueprint", location: "Title Logic" }
    ]);
  });

  it("reports a blueprint no owner record claims", () => {
    const extraction = extractBlueprintAssetReferences(
      docWith(
        {
          id: "bp-1",
          name: "Orphaned",
          program: { kind: "graph", graphs: { events: {}, functions: {} } }
        },
        {}
      )
    );

    expect(extraction.gaps).toEqual([
      { reason: "blueprintProgramNotWalked", slice: "blueprint", location: "Orphaned" }
    ]);
  });
});

describe("node types the catalogue does not know", () => {
  function nodeDoc(nodes: Record<string, unknown>): BlueprintDocument {
    return {
      ownerRecords: { globalMain: { activeBlueprintId: "bp-1", privateBlueprintIds: [] } },
      blueprints: {
        "bp-1": {
          id: "bp-1",
          name: "Main",
          program: {
            kind: "graph",
            graphs: { events: { "g-1": { graph: { nodes } } }, functions: {} }
          }
        }
      },
      persistentVariables: {}
    } as unknown as BlueprintDocument;
  }

  it("reports a gap when the resolver says the type is unknown", () => {
    // A node left behind by an uninstalled plugin. Its params may hold an asset under a name
    // nothing here can guess, and reading "no declared pins" as "holds nothing" hid it.
    const extraction = extractBlueprintAssetReferences(
      nodeDoc({
        n1: { id: "n1", type: "acme.gone", params: { banner: "img-1" } }
      }),
      { resolveAssetPins: () => null }
    );

    expect(extraction.references).toEqual([]);
    expect(extraction.gaps).toEqual([
      expect.objectContaining({ reason: "unknownNodeType", location: "Main › acme.gone" })
    ]);
  });

  it("reports one gap per blueprint however many of the nodes there are", () => {
    const extraction = extractBlueprintAssetReferences(
      nodeDoc({
        n1: { id: "n1", type: "acme.gone", params: {} },
        n2: { id: "n2", type: "acme.gone", params: {} },
        n3: { id: "n3", type: "acme.gone", params: {} }
      }),
      { resolveAssetPins: () => null }
    );

    expect(extraction.gaps).toHaveLength(1);
  });

  it("says nothing about a known type that simply declares no asset pins", () => {
    // "Known and holds none" is an answer; "unknown" is the absence of one. An empty array and
    // null used to be the same value here, which is what made the omission silent.
    const extraction = extractBlueprintAssetReferences(
      nodeDoc({
        n1: { id: "n1", type: "blueprint.flow.branch", params: {} }
      }),
      { resolveAssetPins: () => [] }
    );

    expect(extraction.gaps).toEqual([]);
  });
});

describe("referenceGapsAffecting", () => {
  const imageGap: ReferenceIndexGap = {
    reason: "hashUrlUnresolved",
    slice: "ui",
    location: "Title Screen.backgroundImage",
    affects: ["image"]
  };
  const wholeIndexGap: ReferenceIndexGap = {
    reason: "documentUnreadable",
    slice: "story",
    location: "Main Story"
  };

  it("holds a picture-shaped gap against pictures only", () => {
    // The half that keeps one pasted URL from putting the whole library beyond deleting.
    expect(referenceGapsAffecting([imageGap], ["image"])).toEqual([imageGap]);
    expect(referenceGapsAffecting([imageGap], ["font"])).toEqual([]);
  });

  it("holds a gap that names no kinds against every question", () => {
    // An unread story can hold a use of anything, so it must not be narrowed by asset kind.
    expect(referenceGapsAffecting([wholeIndexGap], ["font"])).toEqual([wholeIndexGap]);
    expect(referenceGapsAffecting([wholeIndexGap], [])).toEqual([wholeIndexGap]);
  });

  it("returns every gap for the project-wide question", () => {
    expect(referenceGapsAffecting([imageGap, wholeIndexGap])).toHaveLength(2);
  });

  it("scopes an unresolved URL to pictures at the point it is produced", () => {
    const extraction = extractUIDocumentAssetReferences({
      elements: { e1: uiElement("e1", "nl.container", { backgroundImage: "app://fs/stale" }) }
    } as unknown as UIDocument);

    expect(extraction.gaps[0].affects).toEqual(["image"]);
  });
});
