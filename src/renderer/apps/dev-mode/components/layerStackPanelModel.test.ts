import { describe, expect, it } from "vitest";
import type {
  GameAppCompositeLayer,
  GameAppCompositeView
} from "@/lib/ui-editor/runtime/app/GameAppHost";
import { buildCompositeStackView, type CompositeStackLayerRow } from "./layerStackPanelModel";

function layer(overrides: Partial<GameAppCompositeLayer> = {}): GameAppCompositeLayer {
  return {
    key: "layer:confirm:1",
    surfaceId: "confirm",
    surfaceName: "Quit Confirm",
    interactive: true,
    keyboardOwner: false,
    modal: false,
    dismissible: true,
    group: null,
    ownerScopeId: "menu:1",
    onScreen: true,
    ...overrides
  };
}

function composite(overrides: Partial<GameAppCompositeView> = {}): GameAppCompositeView {
  return {
    page: {
      key: "menu:1",
      surfaceId: "menu",
      surfaceName: "Main Menu",
      interactive: true,
      keyboardOwner: true
    },
    layers: [],
    queued: [],
    exitPending: false,
    ...overrides
  };
}

describe("buildCompositeStackView", () => {
  it("reads bottom to top, page lane first", () => {
    const view = buildCompositeStackView(
      composite({
        layers: [
          layer({ key: "layer:confirm:1" }),
          layer({ key: "layer:confirm:2", modal: true, keyboardOwner: true })
        ]
      })
    );
    expect(view.rows.map((row) => [row.kind, row.key])).toEqual([
      ["page", "menu:1"],
      ["layer", "layer:confirm:1"],
      ["layer", "layer:confirm:2"]
    ]);
  });

  it("keeps only the tail of a key, which is what tells two mounts apart", () => {
    const view = buildCompositeStackView(
      composite({
        layers: [layer({ key: "layer:confirm:7" })]
      })
    );
    expect(view.rows.map((row) => row.keyTail)).toEqual(["1", "7"]);
  });

  it("names a layer by its surface, and by its id when the project has no such surface", () => {
    const view = buildCompositeStackView(
      composite({
        layers: [layer({ key: "layer:deleted:3", surfaceId: "deleted", surfaceName: null })]
      })
    );
    expect(view.rows[1]).toMatchObject({ label: "deleted", surfaceMissing: true });
    expect(view.rows[0]).toMatchObject({ label: "Main Menu", surfaceMissing: false });
  });

  it("counts what the stack holds against what the screen has", () => {
    const view = buildCompositeStackView(
      composite({
        layers: [
          layer({ key: "layer:confirm:1" }),
          layer({ key: "layer:deleted:2", surfaceName: null, onScreen: false })
        ]
      })
    );
    expect(view.layerCount).toBe(2);
    expect(view.onScreenCount).toBe(1);
    expect((view.rows[2] as CompositeStackLayerRow).onScreen).toBe(false);
  });

  it("names an owner by its own row, and leaves an unknown scope as it is", () => {
    const view = buildCompositeStackView(
      composite({
        layers: [
          layer({ key: "layer:confirm:1", ownerScopeId: "menu:1" }),
          layer({ key: "layer:confirm:2", ownerScopeId: "layer:confirm:1" }),
          layer({ key: "layer:confirm:3", ownerScopeId: "frame:9" }),
          layer({ key: "layer:confirm:4", ownerScopeId: "" })
        ]
      })
    );
    expect(view.rows.slice(1).map((row) => (row as CompositeStackLayerRow).owner)).toEqual([
      "Main Menu",
      "Quit Confirm",
      "frame:9",
      null
    ]);
  });

  it("carries the queue and the pending exit through", () => {
    const view = buildCompositeStackView(
      composite({
        layers: [layer({ key: "layer:confirm:1", group: "confirm" })],
        queued: [
          {
            key: "layer:confirm:2",
            surfaceId: "confirm",
            surfaceName: "Quit Confirm",
            modal: true,
            group: "confirm",
            ownerScopeId: "menu:1"
          }
        ],
        exitPending: true
      })
    );
    expect(view.queued).toEqual([
      {
        kind: "queued",
        key: "layer:confirm:2",
        keyTail: "2",
        label: "Quit Confirm",
        surfaceMissing: false,
        modal: true,
        group: "confirm",
        owner: "Main Menu"
      }
    ]);
    expect(view.exitPending).toBe(true);
  });

  it("reports an empty composite as no rows at all", () => {
    const view = buildCompositeStackView(composite({ page: null }));
    expect(view.rows).toEqual([]);
    expect(view.layerCount).toBe(0);
  });
});
