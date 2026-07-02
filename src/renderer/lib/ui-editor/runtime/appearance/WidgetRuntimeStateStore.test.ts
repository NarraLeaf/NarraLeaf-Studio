import { describe, expect, it } from "vitest";
import { WidgetRuntimeStateStore } from "./WidgetRuntimeStateStore";

describe("WidgetRuntimeStateStore", () => {
    it("keeps ancestor and descendant widgets hovered at the same time", () => {
        const store = new WidgetRuntimeStateStore();

        store.setHoverTarget("container");
        store.setHoverTarget("image");

        expect(store.getSignalsForElement("container", false).hovered).toBe(true);
        expect(store.getSignalsForElement("image", false).hovered).toBe(true);
        expect([...store.getSnapshot().hoverTargetIds]).toEqual(["container", "image"]);
        expect(store.getSnapshot().hoverTargetId).toBe("image");

        store.clearHoverIf("image");

        expect(store.getSignalsForElement("container", false).hovered).toBe(true);
        expect(store.getSignalsForElement("image", false).hovered).toBe(false);
        expect(store.getSnapshot().hoverTargetId).toBe("container");
    });

    it("notifies dedicated runtime patch subscribers without changing widget interaction state", () => {
        const store = new WidgetRuntimeStateStore();
        let calls = 0;
        const unsubscribe = store.subscribeRuntimePatches(() => {
            calls += 1;
        });

        store.notifyRuntimePatchesChanged();

        expect(calls).toBe(1);
        expect(store.getSnapshot().hoverTargetId).toBeNull();

        unsubscribe();
        store.notifyRuntimePatchesChanged();

        expect(calls).toBe(1);
    });
});
