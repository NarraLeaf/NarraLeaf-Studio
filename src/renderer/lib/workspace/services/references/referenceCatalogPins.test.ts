import { describe, expect, it } from "vitest";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import {
  BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_FONT,
  BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL,
  BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET
} from "@shared/types/blueprint/graph";
import { extractBlueprintAssetReferences, type BlueprintAssetPin } from "./referenceModel";
import {
  BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PREVIEW,
  BLUEPRINT_NODE_TYPE_SAVED_GET
} from "@shared/types/blueprint/graph";
import fs from "fs";
import path from "path";

/**
 * The declared asset pins, read off the **real** node catalogue rather than a stand-in.
 *
 * Without this the whole declaration mechanism is untestable in the way that matters: every shipping
 * `assetRef` happens to sit on a pin id the model also hard-codes as a fallback, so dropping
 * `assetRef` in `effectivePins.ts`, or mistyping `pin.kind`, changes no reference the other tests
 * look at. A mechanism whose zero output is indistinguishable from correctness is exactly the shape
 * that has shipped a rule which could never fire.
 */

/** The same projection `ReferenceService` makes; kept here so the assertion drives the real path. */
function assetPinsFromCatalogue(nodeType: string): readonly BlueprintAssetPin[] | null {
  registerCoreBlueprintNodes();
  if (!blueprintNodeRegistry.get(nodeType)) {
    return null;
  }
  return blueprintNodeRegistry.resolveCatalogEntry(nodeType).pins.flatMap((pin) =>
    pin.assetRef
      ? [
          {
            pinId: pin.id,
            kind: pin.assetRef.kind,
            paramKey: pin.assetRef.paramKey ?? pin.id,
            input: pin.kind === "input",
            origin: pin.assetRef.origin
          }
        ]
      : []
  );
}

describe("asset pins declared by the shipping node catalogue", () => {
  it("carries the image declaration from the definition through to the catalogue entry", () => {
    expect(assetPinsFromCatalogue(BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET)).toEqual([
      { pinId: "asset", kind: "image", paramKey: "asset", input: true }
    ]);
  });

  it("carries the font declaration, whose pin stays a plain string on the wire", () => {
    expect(assetPinsFromCatalogue(BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_FONT)).toEqual([
      { pinId: "fontAssetId", kind: "font", paramKey: "fontAssetId", input: true }
    ]);
  });

  it("carries the literal's param key, which is not its pin id", () => {
    expect(assetPinsFromCatalogue(BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL)).toEqual([
      { pinId: "value", kind: "image", paramKey: "asset", input: false }
    ]);
  });

  it("answers null for a type the catalogue has never registered", () => {
    // The distinction the whole unknown-node gap rests on.
    expect(assetPinsFromCatalogue("acme.uninstalled")).toBeNull();
  });

  it("finds a reference through the catalogue's declarations end to end", () => {
    const document = {
      ownerRecords: { globalMain: { activeBlueprintId: "bp-1", privateBlueprintIds: [] } },
      blueprints: {
        "bp-1": {
          id: "bp-1",
          name: "Main",
          program: {
            kind: "graph",
            graphs: {
              events: {
                "g-1": {
                  graph: {
                    nodes: {
                      set: { id: "set", type: BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET, params: {} },
                      lit: {
                        id: "lit",
                        type: "blueprint.data.jsonLiteral",
                        params: { value: { kind: "imageAsset", assetId: "img-1" } }
                      }
                    },
                    edges: [
                      {
                        from: { nodeId: "lit", port: "value" },
                        to: { nodeId: "set", port: "asset" }
                      }
                    ]
                  }
                }
              },
              functions: {}
            }
          }
        }
      },
      persistentVariables: {}
    };

    const extraction = extractBlueprintAssetReferences(document as never, {
      resolveAssetPins: assetPinsFromCatalogue
    });

    expect(extraction.gaps).toEqual([]);
    expect(extraction.references.map((reference) => reference.assetId)).toEqual(["img-1"]);
  });
});

describe("the blueprints the shipped starter template creates", () => {
  /**
   * Every project made from the starter template runs through this walk on its first open, so a
   * gap the template itself produces is a gap every project has - and a delete confirmation every
   * author sees on every delete, forever. A prompt that fires unconditionally is one people learn
   * to click through, which costs the mechanism exactly when it matters.
   *
   * Read from the shipped file rather than a fixture: the point is what authors actually get.
   */
  it("produce no coverage gaps at all", () => {
    const templatePath = path.join(
      process.cwd(),
      "resources/templates/skeleton/content/editor/ui/uigraphs.json"
    );
    const document = JSON.parse(fs.readFileSync(templatePath, "utf-8")).blueprintDocument;

    const extraction = extractBlueprintAssetReferences(document, {
      resolveAssetPins: assetPinsFromCatalogue
    });

    expect(extraction.gaps).toEqual([]);
  });
});

describe("a pin that publishes rather than stores", () => {
  function hitAreaDoc(sourceType: string, sourcePort: string) {
    return {
      ownerRecords: { globalMain: { activeBlueprintId: "bp-1", privateBlueprintIds: [] } },
      blueprints: {
        "bp-1": {
          id: "bp-1",
          name: "Hit area",
          program: {
            kind: "graph",
            graphs: {
              events: {
                "g-1": {
                  graph: {
                    nodes: {
                      get: { id: "get", type: sourceType, params: {} },
                      set: { id: "set", type: "blueprint.element.image.setImageAsset", params: {} }
                    },
                    edges: [
                      {
                        from: { nodeId: "get", port: sourcePort },
                        to: { nodeId: "set", port: "asset" }
                      }
                    ]
                  }
                }
              },
              functions: {}
            }
          }
        }
      },
      persistentVariables: {}
    };
  }

  it("declares the save preview as published, because no library row answers to it", () => {
    // `dev-mode-save-preview:{saveId}` is rejected by `isLibraryAssetId`, so this pin provably
    // cannot carry a library asset. Twelve of the starter template's widgets wire it into an
    // image pin, and reading that as "an asset I could not identify" left every one of those
    // projects permanently unable to say whether an image was in use.
    expect(assetPinsFromCatalogue(BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PREVIEW)).toEqual([
      { pinId: "preview", kind: "image", paramKey: "preview", input: false, origin: "published" }
    ]);
  });

  it("reads no reference and reports no gap for an edge out of one", () => {
    const extraction = extractBlueprintAssetReferences(
      hitAreaDoc(BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PREVIEW, "preview") as never,
      { resolveAssetPins: assetPinsFromCatalogue }
    );

    expect(extraction.references).toEqual([]);
    expect(extraction.gaps).toEqual([]);
  });

  it("still reports a source that declares nothing about what it carries", () => {
    // The bar is not lowered: only a pin that has made the claim is exempt from the gap.
    const extraction = extractBlueprintAssetReferences(
      hitAreaDoc(BLUEPRINT_NODE_TYPE_SAVED_GET, "value") as never,
      { resolveAssetPins: assetPinsFromCatalogue }
    );

    expect(extraction.gaps).toEqual([
      expect.objectContaining({ reason: "computedAssetPin", affects: ["image"] })
    ]);
  });
});
