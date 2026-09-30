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
        // Escaped, which is how the encoder has always written a prop path and now writes every
        // part. This case previously used the raw spelling - a key nothing could produce - and
        // accepting it is the tolerance that let three decoders each read one key differently.
        expect(parseBlueprintOwnerKey("widgetValue:surf:el:props%3Atext")).toEqual({
            ownerKind: "widgetValue",
            surfaceId: "surf",
            elementId: "el",
            propPath: "props:text",
        });
    });

    it("reads a widget on the built-in surface, whose id contains the separator", () => {
        // The case this file used to get wrong: it split on every separator, took `narraleaf-studio`
        // for the surface and `main-surface` for the element, and dropped the element id the author
        // was searching for.
        expect(parseBlueprintOwnerKey("widgetMain:narraleaf-studio%3Amain-surface:el-2")).toEqual({
            ownerKind: "widgetMain",
            surfaceId: "narraleaf-studio:main-surface",
            elementId: "el-2",
        });
    });

    it("returns null for malformed or unknown keys", () => {
        expect(parseBlueprintOwnerKey("surfaceMain")).toBeNull();
        expect(parseBlueprintOwnerKey("widgetMain:only-surface")).toBeNull();
        expect(parseBlueprintOwnerKey("mystery:abc")).toBeNull();
    });
});
