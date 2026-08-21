import { describe, expect, it } from "vitest";
import { foldActionGroupsByMenuSlot } from "./actionMenuFold";
import { getActionGroupItems, getVisibleActionMenuItems, isActionMenuSeparator } from "./actionMenuModel";
import type { ActionDefinition, ActionGroup, ActionMenuItem } from "../../registry/types";
import type { FocusContext } from "@/lib/workspace/services/ui";

/**
 * One Edit menu, not two.
 *
 * The assets panel registers its Copy/Cut/Paste into the `edit` slot, which the macOS menu bar has
 * always merged into the standard Edit menu; off macOS the same registration used to be drawn as a
 * second dropdown reading the same word. What is easy to get wrong here is not the merge but what
 * comes with it: the two contributions interleaving by the orders they each numbered from zero, and
 * the separator between them being left drawn under nothing when the panel is not in front.
 */
function action(id: string, extra: Partial<ActionDefinition> = {}): ActionDefinition {
    return { id, label: id, onClick: () => {}, ...extra };
}

function group(id: string, items: ActionMenuItem[], extra: Partial<ActionGroup> = {}): ActionGroup {
    return { id, label: id, items, ...extra };
}

/** What the menu actually draws: folded, then filtered and sorted the way a dropdown does it. */
function rows(folded: ActionGroup, focus: FocusContext | null = null): string[] {
    return getVisibleActionMenuItems(getActionGroupItems(folded), focus)
        .map(item => (isActionMenuSeparator(item) ? "---" : (item as ActionDefinition).id));
}

describe("foldActionGroupsByMenuSlot", () => {
    it("draws one menu for the groups that name the same standard menu", () => {
        const folded = foldActionGroupsByMenuSlot([
            group("narraleaf-studio:workspace-history", [action("undo"), action("redo")], {
                menuSlot: "edit", order: 20, mnemonic: "E",
            }),
            group("narraleaf-studio:assets-edit", [action("copy"), action("cut")], {
                menuSlot: "edit", order: 21,
            }),
        ]);

        expect(folded).toHaveLength(1);
        // The first contributor IS the menu: its id is what the freeze policy and the bar's own
        // member registration answer for, and its letter is what Alt reaches.
        expect(folded[0].id).toBe("narraleaf-studio:workspace-history");
        expect(folded[0].mnemonic).toBe("E");
        expect(rows(folded[0])).toEqual(["undo", "redo", "---", "copy", "cut"]);
    });

    it("keeps each contribution together when both numbered their rows from zero", () => {
        // The case that would interleave: every group orders its own rows from 0, so without
        // renumbering the menu's sort reads copy(0) as belonging beside undo(0).
        const folded = foldActionGroupsByMenuSlot([
            group("a", [action("undo", { order: 0 }), action("redo", { order: 1 })], { menuSlot: "edit" }),
            group("b", [action("copy", { order: 0 }), action("cut", { order: 1 })], { menuSlot: "edit" }),
        ]);

        expect(rows(folded[0])).toEqual(["undo", "redo", "---", "copy", "cut"]);
    });

    it("leaves the registered groups alone", () => {
        // Registry state outlives the render; a group re-registered on every undo would otherwise
        // come back carrying the numbers the last fold gave it.
        const history = group("a", [action("undo", { order: 0 })], { menuSlot: "edit" });
        const assets = group("b", [action("copy", { order: 0 })], { menuSlot: "edit" });

        foldActionGroupsByMenuSlot([history, assets]);

        expect((history.items![0] as ActionDefinition).order).toBe(0);
        expect((assets.items![0] as ActionDefinition).order).toBe(0);
    });

    it("drops the separator when the contribution behind it has nothing to show", () => {
        // The assets rows are `when`-gated on their panel being focused. With the panel elsewhere,
        // the menu is Undo/Redo - and the line that divided them from the panel's commands is a
        // line under nothing.
        const focusedElsewhere = { area: "story" } as unknown as FocusContext;
        const folded = foldActionGroupsByMenuSlot([
            group("a", [action("undo")], { menuSlot: "edit" }),
            group("b", [action("copy", { when: focus => (focus as { area: string }).area === "assets" })], {
                menuSlot: "edit",
            }),
        ]);

        expect(rows(folded[0], focusedElsewhere)).toEqual(["undo"]);
    });

    it("gives a group its own menu when nothing else names its slot", () => {
        const plugin = group("plugin:thing", [action("run")]);
        const folded = foldActionGroupsByMenuSlot([
            group("narraleaf-studio:file", [action("new")], { menuSlot: "none" }),
            group("narraleaf-studio:help", [action("docs")], { menuSlot: "none" }),
            plugin,
        ]);

        // `none` is "the main process draws this itself", not a menu several groups share: folding
        // by it would put File and Help in one menu off macOS, where both come from here.
        expect(folded.map(entry => entry.id)).toEqual([
            "narraleaf-studio:file",
            "narraleaf-studio:help",
            "plugin:thing",
        ]);
        // Handed straight back, identity and all: a menu nobody joins is not worth a copy, and the
        // memos downstream are keyed on these objects.
        expect(folded[2]).toBe(plugin);
    });

    it("will not fold a group the freeze treats differently from the menu it would join", () => {
        // A folded menu has one id and `freezeActionPolicy` answers for that id. Folding File into
        // a frozen-out menu would switch off the exemption that keeps a frozen window escapable.
        const folded = foldActionGroupsByMenuSlot([
            group("plugin-ish:writes", [action("write")], { menuSlot: "edit" }),
            group("narraleaf-studio:file", [action("backToLauncher")], { menuSlot: "edit" }),
        ]);

        expect(folded.map(entry => entry.id)).toEqual(["plugin-ish:writes", "narraleaf-studio:file"]);
    });
});
