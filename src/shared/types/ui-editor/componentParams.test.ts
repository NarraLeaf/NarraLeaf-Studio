import { describe, expect, it } from "vitest";
import {
    buildUIComponentInstanceKey,
    readUIComponentInstanceElementId,
} from "./componentInstanceKey";
import {
    getUIComponentLink,
    getUIComponentParams,
    resolveUIComponentParams,
    type UIComponentDefinition,
} from "./document";

const component = {
    params: [
        { id: "saveId", name: "Save id", type: "string", defaultValue: "1" },
        { id: "label", name: "Label", type: "string", defaultValue: "" },
    ],
} as unknown as UIComponentDefinition;

describe("component instance keys", () => {
    it("round-trips the instance element id", () => {
        const key = buildUIComponentInstanceKey(undefined, "el-1");
        expect(readUIComponentInstanceElementId(key)).toBe("el-1");
    });

    // A component can contain a component; an inner element reads the instance it is actually in.
    it("returns the innermost instance when nested", () => {
        const outer = buildUIComponentInstanceKey(undefined, "outer");
        const inner = buildUIComponentInstanceKey(outer, "inner");
        expect(readUIComponentInstanceElementId(inner)).toBe("inner");
    });

    it("has no instance for a key that names none", () => {
        expect(readUIComponentInstanceElementId("row:3")).toBeNull();
        expect(readUIComponentInstanceElementId(undefined)).toBeNull();
    });
});

describe("component params", () => {
    // The link reader rebuilds its result, so params had to be copied across explicitly; dropping
    // them would silently unset every instance value on the next read.
    it("keeps instance values when reading a link", () => {
        const link = getUIComponentLink({
            extra: { componentLink: { componentId: "c1", linked: true, params: { saveId: "4" } } },
        });
        expect(link?.params).toEqual({ saveId: "4" });
    });

    it("ignores non-string values and malformed links", () => {
        const link = getUIComponentLink({
            extra: { componentLink: { componentId: "c1", linked: true, params: { a: 3, b: "ok" } } },
        });
        expect(link?.params).toEqual({ b: "ok" });
        expect(getUIComponentLink({ extra: { componentLink: { componentId: "c1" } } })).toBeNull();
    });

    it("falls back to the declared default, per param", () => {
        const link = getUIComponentLink({
            extra: { componentLink: { componentId: "c1", linked: true, params: { saveId: "6" } } },
        });
        expect(resolveUIComponentParams(component, link)).toEqual({ saveId: "6", label: "" });
    });

    // An empty string is a value an author can mean, so it must not fall back to the default.
    it("treats an empty instance value as a value", () => {
        const link = getUIComponentLink({
            extra: { componentLink: { componentId: "c1", linked: true, params: { saveId: "" } } },
        });
        expect(resolveUIComponentParams(component, link).saveId).toBe("");
    });

    it("drops params that are not declared", () => {
        expect(getUIComponentParams({ params: [{ id: "", name: "x", type: "string", defaultValue: "" }] })).toEqual([]);
        expect(getUIComponentParams(undefined)).toEqual([]);
    });
});
