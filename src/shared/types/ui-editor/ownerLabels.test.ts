import { describe, expect, it } from "vitest";
import { factoryLayerNameKey, isFactoryStoryBlueprintName } from "./ownerLabels";

describe("factoryLayerNameKey", () => {
    it("shows the layers Studio seeds by the title of the event that starts them", () => {
        expect(factoryLayerNameKey("init", "Init")).toBe("blueprint.node.init");
        expect(factoryLayerNameKey("onCall", "On Call")).toBe("blueprint.node.onCall");
    });

    it("leaves a renamed layer, another layer's name and an inherited key alone", () => {
        expect(factoryLayerNameKey("onCall", "Check the route")).toBeUndefined();
        expect(factoryLayerNameKey("init", "On Call")).toBeUndefined();
        expect(factoryLayerNameKey("toString", "Init")).toBeUndefined();
        expect(factoryLayerNameKey("onCall", undefined)).toBeUndefined();
    });
});

describe("isFactoryStoryBlueprintName", () => {
    it("knows the three names a story blueprint is created with", () => {
        expect(isFactoryStoryBlueprintName("Story Condition")).toBe(true);
        expect(isFactoryStoryBlueprintName("Ending check")).toBe(false);
    });
});
