import { describe, expect, it } from "vitest";
import { mergeWidgetRuntimePatch, type WidgetPatchesByScope } from "./widgetRuntimePatches";

describe("mergeWidgetRuntimePatch", () => {
    it("creates scope and element entries when absent", () => {
        const next = mergeWidgetRuntimePatch({}, "scope-1", "el-1", { visible: false });
        expect(next).toEqual({ "scope-1": { "el-1": { visible: false } } });
    });

    it("merges patch fields per element without touching other scopes", () => {
        const current: WidgetPatchesByScope = {
            "scope-1": { "el-1": { visible: true, enabled: true } },
            "scope-2": { "el-9": { visible: false } },
        };
        const next = mergeWidgetRuntimePatch(current, "scope-1", "el-1", { visible: false });
        expect(next["scope-1"]?.["el-1"]).toEqual({ visible: false, enabled: true });
        expect(next["scope-2"]).toBe(current["scope-2"]);
    });

    it("does not mutate the input map", () => {
        const current: WidgetPatchesByScope = { "scope-1": { "el-1": { visible: true } } };
        mergeWidgetRuntimePatch(current, "scope-1", "el-1", { visible: false });
        expect(current["scope-1"]?.["el-1"]).toEqual({ visible: true });
    });
});
