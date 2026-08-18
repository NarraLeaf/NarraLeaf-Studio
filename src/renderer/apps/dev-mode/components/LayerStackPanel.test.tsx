// @vitest-environment jsdom
/**
 * What the Layers panel puts on screen, for the two facts that have no other witness: the one slot
 * that owns the keyboard, and a layer the stack holds while the screen does not.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GameAppCompositeView } from "@/lib/ui-editor/runtime/app/GameAppHost";
import { LayerStackPanel } from "./LayerStackPanel";

afterEach(cleanup);

const PAGE = {
  key: "menu:1",
  surfaceId: "menu",
  surfaceName: "Main Menu",
  interactive: false,
  keyboardOwner: false
};

function composite(overrides: Partial<GameAppCompositeView> = {}): GameAppCompositeView {
  return { page: PAGE, layers: [], queued: [], exitPending: false, ...overrides };
}

describe("LayerStackPanel", () => {
  it("marks the one slot that owns the keyboard, and says who takes clicks", () => {
    render(
      <LayerStackPanel
        composite={composite({
          layers: [
            {
              key: "layer:confirm:1",
              surfaceId: "confirm",
              surfaceName: "Quit Confirm",
              interactive: true,
              keyboardOwner: true,
              modal: true,
              dismissible: true,
              group: null,
              ownerScopeId: "menu:1",
              onScreen: true
            }
          ]
        })}
      />
    );
    expect(screen.getAllByText("Keyboard")).toHaveLength(1);
    expect(screen.getByText("Takes no clicks")).toBeTruthy();
    expect(screen.getByText("Takes clicks")).toBeTruthy();
    expect(screen.getByText("Shown by Main Menu")).toBeTruthy();
  });

  it("shows the difference between what the stack holds and what the screen has", () => {
    render(
      <LayerStackPanel
        composite={composite({
          layers: [
            {
              key: "layer:deleted:2",
              surfaceId: "deleted",
              surfaceName: null,
              interactive: true,
              keyboardOwner: false,
              modal: false,
              dismissible: true,
              group: "confirm",
              ownerScopeId: "menu:1",
              onScreen: false
            }
          ]
        })}
      />
    );
    expect(screen.getByText("0 of 1 on screen")).toBeTruthy();
    expect(screen.getByText("Not on screen")).toBeTruthy();
    // Named by its id, because the project has no surface to name it after.
    expect(screen.getByText("deleted")).toBeTruthy();
  });

  it("lists what is waiting for a group, and an exit that has not finished", () => {
    render(
      <LayerStackPanel
        composite={composite({
          queued: [
            {
              key: "layer:confirm:3",
              surfaceId: "confirm",
              surfaceName: "Quit Confirm",
              modal: true,
              group: "confirm",
              ownerScopeId: "menu:1"
            }
          ],
          exitPending: true
        })}
      />
    );
    expect(screen.getByText("Waiting for a group")).toBeTruthy();
    expect(screen.getByText("Group: confirm")).toBeTruthy();
    expect(screen.getByText("A layer is still leaving the screen")).toBeTruthy();
  });
});
