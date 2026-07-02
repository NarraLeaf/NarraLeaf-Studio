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
});
