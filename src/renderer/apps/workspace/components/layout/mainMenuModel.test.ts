import { describe, expect, it } from "vitest";
import { buildMainMenuSubmenus } from "./mainMenuModel";
import { getVisibleActionMenuItems } from "../ui/actionMenuModel";
import type { ActionDefinition, ActionGroup, ActionMenuItem } from "../../registry/types";

const FROZEN_REASON = "Unavailable while the project is frozen";

function action(id: string, extra: Partial<ActionDefinition> = {}): ActionDefinition {
    return { id, label: id, onClick: () => {}, ...extra };
}

function group(id: string, items: ActionMenuItem[], extra: Partial<ActionGroup> = {}): ActionGroup {
    return { id, label: id, items, ...extra };
}

function rowIds(items: ActionMenuItem[]): string[] {
    return items.map(item => (item as ActionDefinition).id);
}

function disabledFlags(items: ActionMenuItem[]): boolean[] {
    return items.map(item => (item as ActionDefinition).disabled === true);
}

describe("buildMainMenuSubmenus", () => {
    it("turns each group into a submenu of its visible rows", () => {
        const submenus = buildMainMenuSubmenus(
            [group("narraleaf-studio:file", [action("new"), action("open")])],
            null,
            false,
            FROZEN_REASON,
        );

        expect(submenus).toHaveLength(1);
        expect(submenus[0].id).toBe("narraleaf-studio:file");
        expect(rowIds(submenus[0].items)).toEqual(["new", "open"]);
    });

    it("carries each group's accelerator onto its row", () => {
        // Collapsing the bar takes away the button Alt+F pressed, not the letter: the row carries it
        // so `ActionDropdown` can claim it from the bar and open on that row.
        const submenus = buildMainMenuSubmenus(
            [
                group("narraleaf-studio:file", [action("new")], { mnemonic: "F" }),
                group("plugin:no-letter", [action("run")]),
            ],
            null,
            false,
            FROZEN_REASON,
        );

        expect(submenus[0].mnemonic).toBe("F");
        // A plugin gets no accelerator on the bar, and must not be given one by the hamburger.
        expect(submenus[1].mnemonic).toBeUndefined();
    });

    it("drops a group with nothing visible rather than offering an empty submenu", () => {
        const submenus = buildMainMenuSubmenus(
            [group("plugin:empty", [action("hidden", { visible: false })])],
            null,
            false,
            FROZEN_REASON,
        );

        expect(submenus).toEqual([]);
    });

    it("keeps the registry's order once the menu re-sorts the rows", () => {
        // The registry hands over ordered groups first and order-less ones last; a menu sorts an
        // order-less row FIRST, so the ranks assigned here are what stops the bar's order from
        // being inverted inside the hamburger.
        const submenus = buildMainMenuSubmenus(
            [
                group("ordered", [action("a")], { order: 10 }),
                group("unordered", [action("b")]),
            ],
            null,
            false,
            FROZEN_REASON,
        );

        expect(rowIds(getVisibleActionMenuItems(submenus))).toEqual(["ordered", "unordered"]);
    });

    it("disables the rows of a frozen group and says why", () => {
        const submenus = buildMainMenuSubmenus(
            [group("plugin:writes", [action("write")])],
            null,
            true,
            FROZEN_REASON,
        );

        expect(disabledFlags(submenus[0].items)).toEqual([true]);
        expect(submenus[0].disabledReason).toBe(FROZEN_REASON);
    });

    it("leaves the freeze-exempt groups working, so a frozen window stays escapable", () => {
        const submenus = buildMainMenuSubmenus(
            [
                group("narraleaf-studio:file", [action("backToLauncher")]),
                group("narraleaf-studio:help", [action("docs")]),
                group("plugin:writes", [action("write")]),
            ],
            null,
            true,
            FROZEN_REASON,
        );

        expect(disabledFlags(submenus[0].items)).toEqual([false]);
        expect(disabledFlags(submenus[1].items)).toEqual([false]);
        expect(disabledFlags(submenus[2].items)).toEqual([true]);
        // No reason on the exempt groups: their rows are not off, and a row of theirs that is off
        // for its own sake must not be told it is the freeze.
        expect(submenus[0].disabledReason).toBeUndefined();
        expect(submenus[1].disabledReason).toBeUndefined();
    });

    it("never writes the freeze back into the registered group", () => {
        const registered = group("plugin:writes", [action("write")]);

        buildMainMenuSubmenus([registered], null, true, FROZEN_REASON);

        expect(disabledFlags(registered.items!)).toEqual([false]);
    });
});
