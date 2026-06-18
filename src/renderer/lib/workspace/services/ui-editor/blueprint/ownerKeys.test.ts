import { describe, expect, it } from "vitest";
import { decodeWidgetValueOwnerKey, ownerRefToIndexKey, widgetValueOwnerKey } from "./ownerKeys";
import { parsePrivateOwnerKeyToRef } from "./ownerRecords";

describe("blueprint owner keys", () => {
    it("encodes and decodes widgetValue prop paths", () => {
        const key = widgetValueOwnerKey("surface-a", "element-a", "props.text/value");

        expect(key).toBe("widgetValue:surface-a:element-a:props.text%2Fvalue");
        expect(decodeWidgetValueOwnerKey(key)).toEqual({
            surfaceId: "surface-a",
            elementId: "element-a",
            propPath: "props.text/value",
        });
        expect(parsePrivateOwnerKeyToRef(key)).toEqual({
            kind: "widgetValue",
            surfaceId: "surface-a",
            elementId: "element-a",
            propPath: "props.text/value",
        });
    });

    it("maps widgetValue owner refs to stable keys", () => {
        expect(
            ownerRefToIndexKey({
                kind: "widgetValue",
                surfaceId: "surface-a",
                elementId: "element-a",
                propPath: "text",
            }),
        ).toBe("widgetValue:surface-a:element-a:text");
    });
});
