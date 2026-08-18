import { describe, expect, it } from "vitest";
import { LayerStackController } from "./LayerStackController";
import { resolveCompositeInput } from "./compositeInput";
import { buildCompositeView } from "./compositeView";

const SURFACE_NAMES: Record<string, string> = {
  menu: "Main Menu",
  confirm: "Quit Confirm"
};

function describeStack(input: {
  controller: LayerStackController;
  activePageEntry?: { key: string; surfaceId: string } | null;
  renderedLayerKeys?: readonly string[];
}) {
  const snapshot = input.controller.getSnapshot();
  const activePageEntry =
    input.activePageEntry === undefined
      ? { key: "menu:1", surfaceId: "menu" }
      : input.activePageEntry;
  // Everything the host can render unless the caller says otherwise.
  const rendered = new Set(input.renderedLayerKeys ?? snapshot.layers.map((layer) => layer.key));
  const onScreenLayers = snapshot.layers.filter((layer) => rendered.has(layer.key));
  return buildCompositeView({
    activePageEntry,
    layers: snapshot.layers,
    queued: snapshot.queued,
    renderedLayerKeys: rendered,
    resolution: resolveCompositeInput({
      pageEntries: activePageEntry ? [{ key: activePageEntry.key }] : [],
      activePageKey: activePageEntry?.key ?? null,
      layers: onScreenLayers
    }),
    exitPending: snapshot.exitPending,
    surfaceName: (surfaceId) => SURFACE_NAMES[surfaceId] ?? null
  });
}

describe("buildCompositeView", () => {
  it("reports the page lane alone when nothing is stacked on it", () => {
    const view = describeStack({ controller: new LayerStackController() });
    expect(view.page).toEqual({
      key: "menu:1",
      surfaceId: "menu",
      surfaceName: "Main Menu",
      interactive: true,
      keyboardOwner: true
    });
    expect(view.layers).toEqual([]);
    expect(view.queued).toEqual([]);
    expect(view.exitPending).toBe(false);
  });

  it("passes the input arbitration through rather than deciding again", () => {
    const controller = new LayerStackController();
    controller.show({ surfaceId: "confirm", modal: true });
    const view = describeStack({ controller });
    expect(view.page?.interactive).toBe(false);
    expect(view.page?.keyboardOwner).toBe(false);
    expect(view.layers[0]).toMatchObject({ interactive: true, keyboardOwner: true, modal: true });
  });

  it("marks a layer the host could not put on screen", () => {
    const controller = new LayerStackController();
    const shown = controller.show({ surfaceId: "confirm" });
    const missing = controller.show({ surfaceId: "deleted" });
    const view = describeStack({ controller, renderedLayerKeys: [shown] });
    expect(view.layers.map((layer) => [layer.key, layer.onScreen])).toEqual([
      [shown, true],
      [missing, false]
    ]);
    // The surface is gone from the project, so there is no name to show for it.
    expect(view.layers[1]!.surfaceName).toBeNull();
  });

  it("carries a queued layer and the owner that showed it", () => {
    const controller = new LayerStackController();
    controller.show({ surfaceId: "confirm", group: "confirm", ownerScopeId: "menu:1" });
    const queued = controller.show({
      surfaceId: "confirm",
      group: "confirm",
      ownerScopeId: "menu:1"
    });
    const view = describeStack({ controller });
    expect(view.layers[0]!.ownerScopeId).toBe("menu:1");
    expect(view.queued).toEqual([
      {
        key: queued,
        surfaceId: "confirm",
        surfaceName: "Quit Confirm",
        modal: false,
        group: "confirm",
        ownerScopeId: "menu:1"
      }
    ]);
  });
});
