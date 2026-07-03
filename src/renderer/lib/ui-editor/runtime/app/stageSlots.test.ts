import { describe, expect, it, vi } from "vitest";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { dialogSlotRuntimeScopeId, findStageSurfaceForSlot } from "./stageSlots";

function docWith(surfaces: unknown[]): UIDocument {
    return { surfaces } as unknown as UIDocument;
}

describe("findStageSurfaceForSlot", () => {
    it("returns the stage surface mounted on the slot", () => {
        const dialog = { id: "s-dialog", kind: "stageSurface", mount: { slotId: "dialog" } };
        const doc = docWith([
            { id: "s-app", kind: "appSurface" },
            dialog,
        ]);
        expect(findStageSurfaceForSlot(doc, "dialog" as never, "Runtime")).toBe(dialog);
    });

    it("returns null when no stage surface matches", () => {
        const doc = docWith([{ id: "s-app", kind: "appSurface" }]);
        expect(findStageSurfaceForSlot(doc, "dialog" as never, "Runtime")).toBeNull();
    });

    it("warns with the provided log label and picks the first match on conflicts", () => {
        const first = { id: "s-1", kind: "stageSurface", mount: { slotId: "dialog" } };
        const second = { id: "s-2", kind: "stageSurface", mount: { slotId: "dialog" } };
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const doc = docWith([first, second]);
            expect(findStageSurfaceForSlot(doc, "dialog" as never, "DevMode")).toBe(first);
            expect(warn).toHaveBeenCalledWith(expect.stringContaining("[DevMode]"));
        } finally {
            warn.mockRestore();
        }
    });
});

describe("dialogSlotRuntimeScopeId", () => {
    it("builds the stable per-session scope id", () => {
        expect(dialogSlotRuntimeScopeId("sess-1", "surf-9")).toBe("nlr:sess-1:slot:dialog:surf-9");
    });
});
