import { describe, expect, it, vi } from "vitest";
import { BREAKPOINT_MENU_ROW_IDS, buildBreakpointContextMenu } from "./breakpointContextMenu";

const labels = {
    add: "Add breakpoint",
    remove: "Remove breakpoint",
    enable: "Enable breakpoint",
    disable: "Disable breakpoint",
    edit: "Edit breakpoint…",
};

function build(existing: { enabled: boolean } | undefined) {
    return buildBreakpointContextMenu({
        existing,
        onToggle: vi.fn(),
        onSetEnabled: vi.fn(),
        onEdit: vi.fn(),
        labels,
    });
}

describe("breakpoint context menu", () => {
    it("offers adding one when the node has none", () => {
        expect(build(undefined).map(item => item.label)).toEqual([labels.add]);
    });

    it("names the state the row would move the breakpoint to", () => {
        expect(build({ enabled: true }).map(item => item.label)).toEqual([
            labels.remove,
            labels.disable,
            labels.edit,
        ]);
        expect(build({ enabled: false }).map(item => item.label)).toEqual([
            labels.remove,
            labels.enable,
            labels.edit,
        ]);
    });

    /**
     * A breakpoint is debugger state, so these rows stay live on a frozen project - but only for as
     * long as the exemption set names every one of them. A row added here and not added there would
     * be greyed out beside the document actions it shares a menu with, which is not a failure
     * anything else would catch.
     */
    it("names every row it can emit in the freeze exemption set", () => {
        const emitted = [...build(undefined), ...build({ enabled: true }), ...build({ enabled: false })];
        for (const item of emitted) {
            expect(BREAKPOINT_MENU_ROW_IDS.has(item.id)).toBe(true);
        }
        expect(new Set(emitted.map(item => item.id)).size).toBe(BREAKPOINT_MENU_ROW_IDS.size);
    });
});
