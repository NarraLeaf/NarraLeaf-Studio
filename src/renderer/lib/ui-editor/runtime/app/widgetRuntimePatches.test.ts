import { describe, expect, it, vi } from "vitest";
import { applyWidgetRuntimePatch, mergeWidgetRuntimePatch, type WidgetPatchesByScope } from "./widgetRuntimePatches";

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

    it("hands back the same table when the write changes nothing", () => {
        const current: WidgetPatchesByScope = {
            "scope-1": { "el-1": { visible: false, props: { text: "Skip", appearance: { variants: ["a"] } } } },
        };
        expect(mergeWidgetRuntimePatch(current, "scope-1", "el-1", { visible: false })).toBe(current);
        expect(mergeWidgetRuntimePatch(current, "scope-1", "el-1", { props: { appearance: { variants: ["a"] } } })).toBe(current);
        expect(mergeWidgetRuntimePatch(current, "scope-1", "el-1", { props: { text: "Auto" } })).not.toBe(current);
    });
});

describe("applyWidgetRuntimePatch", () => {
    it("does not set state for a write that changes nothing", () => {
        const ref = { current: { "scope-1": { "el-1": { visible: false } } } as WidgetPatchesByScope };
        const setWidgetPatchesByScope = vi.fn();
        const write = (visible: boolean) => applyWidgetRuntimePatch({
            setWidgetPatchesByScope,
            widgetPatchesByScopeRef: ref,
            runtimeScopeId: "scope-1",
            elementId: "el-1",
            patch: { visible },
        });

        const before = ref.current;
        write(false);
        expect(ref.current).toBe(before);
        expect(setWidgetPatchesByScope).not.toHaveBeenCalled();

        write(true);
        expect(ref.current["scope-1"]?.["el-1"]).toEqual({ visible: true });
        expect(setWidgetPatchesByScope).toHaveBeenCalledWith(ref.current);
    });
});
