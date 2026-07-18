import { describe, expect, it } from "vitest";
import { parseBlueprintOwnerKey } from "./blueprintOwnerKey";

describe("parseBlueprintOwnerKey", () => {
    it("parses each owner kind", () => {
        expect(parseBlueprintOwnerKey("globalMain")).toEqual({ ownerKind: "globalMain" });
        expect(parseBlueprintOwnerKey("surfaceMain:surf-1")).toEqual({ ownerKind: "surfaceMain", surfaceId: "surf-1" });
        expect(parseBlueprintOwnerKey("widgetMain:surf-1:el-2")).toEqual({
            ownerKind: "widgetMain",
            surfaceId: "surf-1",
            elementId: "el-2",
        });
        expect(parseBlueprintOwnerKey("componentWidgetMain:comp-1:el-2")).toEqual({
            ownerKind: "componentWidgetMain",
            componentId: "comp-1",
            elementId: "el-2",
        });
        expect(parseBlueprintOwnerKey("storyAction:whatever")).toEqual({ ownerKind: "storyAction" });
    });

    it("keeps separators inside a widgetValue prop path", () => {
        expect(parseBlueprintOwnerKey("widgetValue:surf:el:props:text")).toEqual({
            ownerKind: "widgetValue",
            surfaceId: "surf",
            elementId: "el",
            propPath: "props:text",
        });
    });

    it("returns null for malformed or unknown keys", () => {
        expect(parseBlueprintOwnerKey("surfaceMain")).toBeNull();
        expect(parseBlueprintOwnerKey("widgetMain:only-surface")).toBeNull();
        expect(parseBlueprintOwnerKey("mystery:abc")).toBeNull();
    });
});
