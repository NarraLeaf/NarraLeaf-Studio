// @vitest-environment jsdom
/**
 * Exit-completion contract for a surface layer: once the layer is removed, its presence group
 * settles - the node leaves the DOM and the group reports the exit as done.
 *
 * That report is the layer stack's only dequeue signal, so a layer that never finishes leaving
 * strands `Hide Layer` forever and holds a mutual-exclusion group shut. The cases below are the
 * shapes that used to strand it: an animated element that is hidden while the layer leaves, and one
 * that goes away mid-exit because whatever was driving it stopped.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { AnimatePresence } from "motion/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { normalizeUIPageAnimationSettings } from "@shared/types/ui-editor/pageAnimation";
import { LayerStackController } from "@/lib/ui-editor/runtime/app/layers/LayerStackController";
import { resolvePageAnimationMotion } from "@/lib/ui-editor/runtime/pageAnimation";
import type { ElementAnimationTiming } from "@/lib/ui-editor/runtime/surfaceAnimationPlan";
import { ensureAnimationFramePolyfill } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { ElementAnimationLayer, ElementAnimationPresence } from "./ElementAnimationLayer";
import { SurfaceAnimationLayer } from "./SurfaceAnimationLayer";

beforeAll(() => {
  ensureAnimationFramePolyfill();
});

afterEach(cleanup);

/** What a Surface with no page animation of its own resolves to: hold the pose, take no time. */
const noPageAnimation = resolvePageAnimationMotion({});

/** An element that does animate, which is what puts a presence wrapper around it. */
const animatedTiming: ElementAnimationTiming = {
  settings: normalizeUIPageAnimationSettings({
    enter: "fade",
    exit: "fade",
    enterDurationSeconds: 0.02,
    exitDurationSeconds: 0.02
  }),
  enterOriginMs: 0,
  enterStartMs: 0,
  enterDurationMs: 20,
  exitOriginMs: 0,
  exitStartMs: 0,
  exitDurationMs: 20,
  selfAnimated: true,
  subtreeAnimated: true
};

/**
 * What an element on the layer is doing: on screen, hidden, or no longer part of the tree at all -
 * a blueprint hiding a container, a list row that went away, a switch on another branch.
 *
 * Read through an external store because an exiting layer renders the children it was removed with:
 * only something the content subscribes to itself can still change it, which is exactly how the
 * runtime's own content changes under a layer that is on its way out.
 */
function createContentStore(initial: "shown" | "hidden" | "gone") {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    set(next: "shown" | "hidden" | "gone") {
      state = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => state
  };
}

type ContentStore = ReturnType<typeof createContentStore>;

function LayerContent(props: { store: ContentStore }) {
  const state = useSyncExternalStore(props.store.subscribe, props.store.get, props.store.get);
  if (state === "gone") {
    return null;
  }
  return (
    <ElementAnimationPresence timing={animatedTiming} visible={state === "shown"}>
      <ElementAnimationLayer timing={animatedTiming} reducedMotion={false}>
        <span data-ui-element-id="button">Go back</span>
      </ElementAnimationLayer>
    </ElementAnimationPresence>
  );
}

function view(input: { mounted: boolean; store: ContentStore; onExitComplete: () => void }) {
  return (
    <AnimatePresence
      custom="forward"
      initial={false}
      mode="sync"
      onExitComplete={input.onExitComplete}
    >
      {input.mounted ? (
        <SurfaceAnimationLayer
          key="layer:modal:1"
          prepaintKey="layer:modal:1"
          direction="forward"
          pageMotion={noPageAnimation}
          surfaceId="modal"
          presentZIndex={42}
          exitZIndex={62}
          contentClassName="layer-content"
        >
          <LayerContent store={input.store} />
        </SurfaceAnimationLayer>
      ) : null}
    </AnimatePresence>
  );
}

function layerNode(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>("[data-ui-surface-id='modal']");
}

/** A promise plus the answer to "has it settled yet", which is the thing under test. */
function track(promise: Promise<unknown>): { settled: boolean } {
  const state = { settled: false };
  void promise.then(() => {
    state.settled = true;
  });
  return state;
}

async function renderShownLayer(input: { content: "shown" | "hidden" }) {
  const store = createContentStore(input.content);
  const stack = new LayerStackController();
  const key = stack.show({ surfaceId: "modal" });
  const onExitComplete = vi.fn(() => stack.notifyExitComplete());
  const { container, rerender } = render(view({ mounted: true, store, onExitComplete }));
  // Let the hidden prepaint pass finish, so the layer is on screen exactly as it is when a player
  // clicks something on it.
  await waitFor(() => {
    expect(layerNode(container)?.dataset.uiSurfacePrepaint).toBe("ready");
  });
  const hide = async () => {
    stack.hide(key);
    const exit = track(stack.waitForExitComplete());
    await act(async () => {
      rerender(view({ mounted: false, store, onExitComplete }));
    });
    return exit;
  };
  return { container, hide, onExitComplete, store };
}

async function expectExitSettled(input: {
  container: HTMLElement;
  exit: { settled: boolean };
  onExitComplete: ReturnType<typeof vi.fn>;
}) {
  await waitFor(() => {
    expect(input.onExitComplete).toHaveBeenCalled();
  });
  expect(input.exit.settled).toBe(true);
  expect(layerNode(input.container)).toBeNull();
}

describe("surface layer exit completion", () => {
  it("settles the exit when an animated element on the layer is hidden", async () => {
    const { container, hide, onExitComplete } = await renderShownLayer({ content: "hidden" });
    const exit = await hide();
    await expectExitSettled({ container, exit, onExitComplete });
  });

  it("settles the exit when an animated element left the layer while it was up", async () => {
    const { container, hide, onExitComplete, store } = await renderShownLayer({ content: "shown" });
    await act(async () => {
      store.set("gone");
    });
    const exit = await hide();
    await expectExitSettled({ container, exit, onExitComplete });
  });

  it("settles the exit of a layer whose content animates out normally", async () => {
    const { container, hide, onExitComplete } = await renderShownLayer({ content: "shown" });
    const exit = await hide();
    await expectExitSettled({ container, exit, onExitComplete });
  });
});
