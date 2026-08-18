import { describe, expect, it, vi } from "vitest";
import {
  LayerStackController,
  mountSurfaceLayer,
  unmountSurfaceLayer
} from "./LayerStackController";

describe("LayerStackController", () => {
  it("mounts in order and mints a fresh key each time", () => {
    const controller = new LayerStackController();
    const first = mountSurfaceLayer(controller, { surfaceId: "confirm" });
    const second = mountSurfaceLayer(controller, { surfaceId: "confirm" });
    expect(first).not.toBe(second);
    expect(controller.getState().map((layer) => layer.key)).toEqual([first, second]);
  });

  it("keys cannot collide with a page entry's key", () => {
    const controller = new LayerStackController();
    // Page entries are `${surfaceId}:${seq}`; a layer key has to be distinguishable because both
    // index the same prepaint set and the same blueprint scope table.
    expect(mountSurfaceLayer(controller, { surfaceId: "menu" })).toBe("layer:menu:1");
  });

  it("defaults: not modal, no scrim, dismissible, ungrouped", () => {
    const controller = new LayerStackController();
    mountSurfaceLayer(controller, { surfaceId: "hud" });
    expect(controller.getState()[0]).toMatchObject({
      modal: false,
      scrim: false,
      dismissible: true,
      group: null,
      ownerScopeId: "",
      presentation: "appPage"
    });
  });

  it("a modal layer draws a scrim unless it is turned off", () => {
    const controller = new LayerStackController();
    mountSurfaceLayer(controller, { surfaceId: "confirm", modal: true });
    mountSurfaceLayer(controller, { surfaceId: "confirm", modal: true, scrim: false });
    expect(controller.getState().map((layer) => layer.scrim)).toEqual([true, false]);
  });

  it("props are copied, not held by reference", () => {
    const controller = new LayerStackController();
    const props = { title: "Quit?" };
    mountSurfaceLayer(controller, { surfaceId: "confirm", props });
    props.title = "changed";
    expect(controller.getState()[0]!.props).toEqual({ title: "Quit?" });
  });

  it("hide removes one layer and reports whether there was one", () => {
    const controller = new LayerStackController();
    const key = mountSurfaceLayer(controller, { surfaceId: "confirm" });
    expect(unmountSurfaceLayer(controller, key)).toBe(true);
    expect(controller.getState()).toEqual([]);
    expect(unmountSurfaceLayer(controller, key)).toBe(false);
  });

  it("dismissTop closes the top layer only when it allows it", () => {
    const controller = new LayerStackController();
    mountSurfaceLayer(controller, { surfaceId: "a" });
    mountSurfaceLayer(controller, { surfaceId: "b", dismissible: false });
    expect(controller.dismissTop()).toBe(false);
    expect(controller.getState()).toHaveLength(2);
    unmountSurfaceLayer(controller, controller.getState()[1]!.key);
    expect(controller.dismissTop()).toBe(true);
    expect(controller.getState()).toEqual([]);
  });

  it("dismissTop on an empty stack reports false and changes nothing", () => {
    const controller = new LayerStackController();
    const listener = vi.fn();
    controller.subscribe(listener);
    expect(controller.dismissTop()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("clear empties the stack, and is silent when it is already empty", () => {
    const controller = new LayerStackController();
    mountSurfaceLayer(controller, { surfaceId: "a" });
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.clear();
    expect(controller.getState()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
    controller.clear();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("a second layer of the same group queues instead of stacking", () => {
    const controller = new LayerStackController();
    const first = mountSurfaceLayer(controller, { surfaceId: "confirm", group: "confirm" });
    const second = mountSurfaceLayer(controller, { surfaceId: "confirm", group: "confirm" });
    expect(controller.getState().map((layer) => layer.key)).toEqual([first]);
    // A queued layer already has its handle, and counts as live: it has not closed, it has not
    // started, and a `Wait For Layer` on it must not resolve early.
    expect(controller.isPresent(second)).toBe(true);
  });

  it("a queued layer waits for the exit animation, not for the removal", () => {
    const controller = new LayerStackController();
    const first = mountSurfaceLayer(controller, { surfaceId: "confirm", group: "confirm" });
    const second = mountSurfaceLayer(controller, { surfaceId: "confirm", group: "confirm" });
    unmountSurfaceLayer(controller, first);
    // Removed, but still animating out: letting the next one in here is what puts two layers of
    // one group on screen at once.
    expect(controller.getState()).toEqual([]);
    controller.notifyExitComplete();
    expect(controller.getState().map((layer) => layer.key)).toEqual([second]);
  });

  it("only one of a queue enters per exit", () => {
    const controller = new LayerStackController();
    const first = mountSurfaceLayer(controller, { surfaceId: "confirm", group: "confirm" });
    mountSurfaceLayer(controller, { surfaceId: "confirm", group: "confirm" });
    const third = mountSurfaceLayer(controller, { surfaceId: "confirm", group: "confirm" });
    unmountSurfaceLayer(controller, first);
    controller.notifyExitComplete();
    expect(controller.getState()).toHaveLength(1);
    expect(controller.isPresent(third)).toBe(true);
  });

  it("an ungrouped layer never queues", () => {
    const controller = new LayerStackController();
    mountSurfaceLayer(controller, { surfaceId: "a" });
    mountSurfaceLayer(controller, { surfaceId: "b" });
    expect(controller.getState()).toHaveLength(2);
  });

  it("hideGroup takes the group off screen and empties its queue", () => {
    const controller = new LayerStackController();
    mountSurfaceLayer(controller, { surfaceId: "confirm", group: "confirm" });
    const queued = mountSurfaceLayer(controller, { surfaceId: "confirm", group: "confirm" });
    const other = mountSurfaceLayer(controller, { surfaceId: "hud", group: "hud" });
    expect(controller.hideGroup("confirm")).toBe(true);
    controller.notifyExitComplete();
    expect(controller.getState().map((layer) => layer.key)).toEqual([other]);
    expect(controller.isPresent(queued)).toBe(false);
  });

  it("closing a scope closes every layer that scope showed", () => {
    const controller = new LayerStackController();
    const owned = mountSurfaceLayer(controller, { surfaceId: "confirm", ownerScopeId: "page:1" });
    const alsoOwned = mountSurfaceLayer(controller, { surfaceId: "hud", ownerScopeId: "page:1" });
    const other = mountSurfaceLayer(controller, { surfaceId: "hud", ownerScopeId: "page:2" });
    expect(controller.hideOwnedBy("page:1")).toBe(true);
    expect(controller.getState().map((layer) => layer.key)).toEqual([other]);
    expect(controller.isPresent(owned)).toBe(false);
    expect(controller.isPresent(alsoOwned)).toBe(false);
  });

  it("a scope that showed nothing takes nothing with it", () => {
    const controller = new LayerStackController();
    mountSurfaceLayer(controller, { surfaceId: "confirm", ownerScopeId: "page:1" });
    expect(controller.hideOwnedBy("page:2")).toBe(false);
    // Nor does an unowned layer answer to the empty scope id every host without one reports.
    expect(controller.hideOwnedBy("")).toBe(false);
    expect(controller.getState()).toHaveLength(1);
  });

  it("a queued layer of a closing scope never gets its turn", () => {
    const controller = new LayerStackController();
    const first = mountSurfaceLayer(controller, {
      surfaceId: "confirm",
      group: "confirm",
      ownerScopeId: "page:1"
    });
    const queued = mountSurfaceLayer(controller, {
      surfaceId: "confirm",
      group: "confirm",
      ownerScopeId: "page:1"
    });
    controller.hideOwnedBy("page:1");
    controller.notifyExitComplete();
    expect(controller.getState()).toEqual([]);
    expect(controller.isPresent(first)).toBe(false);
    expect(controller.isPresent(queued)).toBe(false);
  });

  it("a close resolves whoever is waiting, with the value it closed with", async () => {
    const controller = new LayerStackController();
    const key = mountSurfaceLayer(controller, { surfaceId: "confirm" });
    const waiting = controller.waitForClose(key);
    expect(controller.closeWithResult(key, 1)).toBe(true);
    await expect(waiting).resolves.toBe(1);
  });

  it("waiting resolves the caller before the exit animation finishes", async () => {
    // The two halves of a close are deliberately on different clocks: the graph that opened a
    // confirm runs on the answer, while the next layer of that group still waits for the screen.
    const controller = new LayerStackController();
    const key = mountSurfaceLayer(controller, { surfaceId: "confirm", group: "confirm" });
    const waiting = controller.waitForClose(key);
    controller.closeWithResult(key, "yes");
    await expect(waiting).resolves.toBe("yes");
  });

  it("a layer closed any other way answers null", async () => {
    const controller = new LayerStackController();
    const key = mountSurfaceLayer(controller, { surfaceId: "confirm" });
    const waiting = controller.waitForClose(key);
    controller.dismissTop();
    await expect(waiting).resolves.toBeNull();
  });

  it("waiting on a handle that names nothing answers null rather than hanging", async () => {
    const controller = new LayerStackController();
    await expect(controller.waitForClose("layer:gone:9")).resolves.toBeNull();
  });

  it("a load settles every waiter and every pending exit", async () => {
    const controller = new LayerStackController();
    const shown = mountSurfaceLayer(controller, { surfaceId: "confirm", group: "confirm" });
    const queued = mountSurfaceLayer(controller, { surfaceId: "confirm", group: "confirm" });
    const waiters = Promise.all([controller.waitForClose(shown), controller.waitForClose(queued)]);
    const hiding = controller.hideAndWaitForExit(shown);
    controller.clear();
    await expect(waiters).resolves.toEqual([null, null]);
    // The stack is empty, so nothing is left to animate out: a graph stopped inside Hide Layer
    // would otherwise wait for a frame that is never coming.
    await expect(hiding).resolves.toBe(true);
    expect(controller.getState()).toEqual([]);
  });

  it("hiding settles once the exit animation reports in", async () => {
    const controller = new LayerStackController();
    const key = mountSurfaceLayer(controller, { surfaceId: "confirm" });
    let settled = false;
    const hiding = controller.hideAndWaitForExit(key).then((removed) => {
      settled = true;
      return removed;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    controller.notifyExitComplete();
    await expect(hiding).resolves.toBe(true);
  });

  it("hiding a layer that never got on screen does not wait for an exit", async () => {
    const controller = new LayerStackController();
    mountSurfaceLayer(controller, { surfaceId: "confirm", group: "confirm" });
    const queued = mountSurfaceLayer(controller, { surfaceId: "confirm", group: "confirm" });
    await expect(controller.hideAndWaitForExit(queued)).resolves.toBe(true);
  });

  it("hiding a layer the host never put on screen does not wait for an exit", async () => {
    const controller = new LayerStackController();
    const key = mountSurfaceLayer(controller, { surfaceId: "deleted" });
    // What the host reports when the running bundle has no surface with that id: the stack holds
    // the layer and the screen never had it, so no exit animation is ever going to be reported.
    controller.setUnrenderedLayers([key]);
    await expect(controller.hideAndWaitForExit(key)).resolves.toBe(true);
  });

  it("a group held by a layer that was never on screen is given back", () => {
    const controller = new LayerStackController();
    const held = mountSurfaceLayer(controller, { surfaceId: "deleted", group: "confirm" });
    const queued = mountSurfaceLayer(controller, { surfaceId: "confirm", group: "confirm" });
    controller.setUnrenderedLayers([held]);
    unmountSurfaceLayer(controller, held);
    // No exit to wait for, so the queue moves on the removal itself. Waiting for one would hold
    // the group forever behind something nobody could see.
    expect(controller.getState().map((layer) => layer.key)).toEqual([queued]);
  });

  it("a removal with nothing to animate leaves an exit already running alone", async () => {
    const controller = new LayerStackController();
    const onScreen = mountSurfaceLayer(controller, { surfaceId: "confirm" });
    const neverRendered = mountSurfaceLayer(controller, { surfaceId: "deleted" });
    controller.setUnrenderedLayers([neverRendered]);
    let settled = false;
    unmountSurfaceLayer(controller, onScreen);
    const waiting = controller.waitForExitComplete().then(() => {
      settled = true;
    });
    unmountSurfaceLayer(controller, neverRendered);
    await Promise.resolve();
    expect(settled).toBe(false);
    controller.notifyExitComplete();
    await waiting;
    expect(settled).toBe(true);
  });

  it("the snapshot reports the queue and the pending exit, not only the screen", () => {
    const controller = new LayerStackController();
    const shown = mountSurfaceLayer(controller, { surfaceId: "confirm", group: "confirm" });
    const before = controller.getSnapshot();
    const queued = mountSurfaceLayer(controller, { surfaceId: "confirm", group: "confirm" });
    const afterQueue = controller.getSnapshot();
    // Queueing changes nothing on screen, and a reader of the stack still has to see it.
    expect(afterQueue).not.toBe(before);
    expect(afterQueue.layers).toBe(before.layers);
    expect(afterQueue.queued.map((layer) => layer.key)).toEqual([queued]);
    expect(afterQueue.exitPending).toBe(false);
    unmountSurfaceLayer(controller, shown);
    expect(controller.getSnapshot().exitPending).toBe(true);
    controller.notifyExitComplete();
    expect(controller.getSnapshot().exitPending).toBe(false);
  });

  it("the snapshot identity only changes when the stack does", () => {
    // useSyncExternalStore re-renders on every changed snapshot identity and loops on an unstable
    // one, so this is load-bearing rather than tidiness.
    const controller = new LayerStackController();
    const before = controller.getState();
    expect(controller.getState()).toBe(before);
    mountSurfaceLayer(controller, { surfaceId: "a" });
    expect(controller.getState()).not.toBe(before);
  });
});
