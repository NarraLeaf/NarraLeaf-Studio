import { describe, expect, it } from "vitest";
import { blueprintDisplayName, factoryLayerNameKey, isFactoryStoryBlueprintName } from "./ownerLabels";

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

describe("blueprintDisplayName", () => {
    const echo = (key: string) => `<${key}>`;

    it("names an unnamed story blueprint as its tab from the story is named, by how the row uses it", () => {
        expect(blueprintDisplayName({ name: "Story Condition", owner: { kind: "storyAction", blueprintId: "b", mode: "condition" } }, echo))
            .toBe("<story.condition.title>");
        expect(blueprintDisplayName({ name: "Story Action", owner: { kind: "storyAction", blueprintId: "b" } }, echo))
            .toBe("<storyInspector.blueprint.storyActionTitle>");
        expect(blueprintDisplayName({ name: "Story Value", owner: { kind: "storyAction", blueprintId: "b", mode: "value" } }, echo))
            .toBe("<story.interpolation.storyValueTitle>");
    });

    it("keeps a name an author gave, and any blueprint that is not a story's", () => {
        expect(blueprintDisplayName({ name: "Ending check", owner: { kind: "storyAction", blueprintId: "b", mode: "condition" } }, echo))
            .toBe("Ending check");
        expect(blueprintDisplayName({ name: "Story Action", owner: { kind: "globalMain" } }, echo)).toBe("Story Action");
    });
});
