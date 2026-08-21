import { describe, expect, it } from "vitest";
import { getVisibleActionMenuItems, isActionMenuSeparator, isRowOnOpenPath } from "./actionMenuModel";
import type { ActionDefinition, ActionMenuItem } from "../../registry/types";
import type { FocusContext } from "@/lib/workspace/services/ui";

function action(id: string, extra: Partial<ActionDefinition> = {}): ActionDefinition {
    return { id, label: id, onClick: () => {}, ...extra };
}

const SEP: ActionMenuItem = { separator: true };

function names(items: ActionMenuItem[]): string[] {
    return items.map(item => (isActionMenuSeparator(item) ? "---" : (item as ActionDefinition).id));
}

describe("which rows the open menus hang from", () => {
    it("counts a row the open path passes through, not only the one it ends on", () => {
        // File ▸ Recent workspaces ▸ …: with `[0, 1]` open, row 0 of the menu is still open. Asking
        // for the end of the path instead unmounted it the moment its own submenu opened, and the
        // submenu went with it - which read as the whole menu disappearing.
        expect(isRowOnOpenPath([0, 1], 0, 0)).toBe(true);
        expect(isRowOnOpenPath([0, 1], 1, 1)).toBe(true);
    });

    it("says no to the rows beside it, and to a level nothing is open at", () => {
        expect(isRowOnOpenPath([0, 1], 0, 2)).toBe(false);
        expect(isRowOnOpenPath([0, 1], 1, 0)).toBe(false);
        expect(isRowOnOpenPath([0], 1, 0)).toBe(false);
        expect(isRowOnOpenPath([], 0, 0)).toBe(false);
    });
});

describe("separators", () => {
    const inAssets = { area: "assets" } as unknown as FocusContext;
    const elsewhere = { area: "story" } as unknown as FocusContext;
    const whenInAssets = (focus: FocusContext) => (focus as unknown as { area: string }).area === "assets";

    it("keeps the ones that divide two rows", () => {
        expect(names(getVisibleActionMenuItems([action("undo"), SEP, action("copy")], inAssets)))
            .toEqual(["undo", "---", "copy"]);
    });

    it("drops the one left at the end when what followed it is not shown", () => {
        // A menu holding a panel's commands while that panel is elsewhere: the line that divided
        // them is a line under nothing.
        expect(names(getVisibleActionMenuItems([action("undo"), SEP, action("copy", { when: whenInAssets })], elsewhere)))
            .toEqual(["undo"]);
    });

    it("drops the one left at the front, and collapses two in a row", () => {
        expect(names(getVisibleActionMenuItems([SEP, action("undo"), SEP, SEP, action("redo")], elsewhere)))
            .toEqual(["undo", "---", "redo"]);
    });
});
