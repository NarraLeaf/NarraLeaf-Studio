import { describe, expect, it, vi } from "vitest";
import {
    LayerStackController,
    mountSurfaceLayer,
    unmountSurfaceLayer,
} from "./LayerStackController";

describe("LayerStackController", () => {
    it("mounts in order and mints a fresh key each time", () => {
        const controller = new LayerStackController();
        const first = mountSurfaceLayer(controller, { surfaceId: "confirm" });
        const second = mountSurfaceLayer(controller, { surfaceId: "confirm" });
        expect(first).not.toBe(second);
        expect(controller.getState().map(layer => layer.key)).toEqual([first, second]);
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
            presentation: "appPage",
        });
    });

    it("a modal layer draws a scrim unless it is turned off", () => {
        const controller = new LayerStackController();
        mountSurfaceLayer(controller, { surfaceId: "confirm", modal: true });
        mountSurfaceLayer(controller, { surfaceId: "confirm", modal: true, scrim: false });
        expect(controller.getState().map(layer => layer.scrim)).toEqual([true, false]);
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
