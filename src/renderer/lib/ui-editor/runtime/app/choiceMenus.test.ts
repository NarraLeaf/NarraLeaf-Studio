import { describe, expect, it, vi } from "vitest";
import { createChoiceMenus, type ChoiceSlotRuntime } from "./choiceMenus";

function makeRuntime(count: number): ChoiceSlotRuntime {
    return { count, items: [], choose: () => undefined };
}

describe("choice menus", () => {
    it("gives the first menu slot zero, which is the scope every game already had", () => {
        const menus = createChoiceMenus();
        expect(menus.claimSlot("a")).toBe(0);
    });

    it("answers the same slot however many times one drawing asks", () => {
        const menus = createChoiceMenus();
        expect(menus.claimSlot("a")).toBe(0);
        expect(menus.claimSlot("a")).toBe(0);
    });

    it("gives a menu standing beside another one a slot of its own", () => {
        const menus = createChoiceMenus();
        menus.claimSlot("a");
        expect(menus.claimSlot("b")).toBe(1);
        expect(menus.claimSlot("c")).toBe(2);
    });

    it("hands a released slot to the next menu rather than counting upwards forever", () => {
        // Menus come and go for the whole length of a playthrough. A fresh number per menu would
        // leave a blueprint scope and a surface store behind for every one of them.
        const menus = createChoiceMenus();
        menus.claimSlot("a");
        menus.claimSlot("b");
        menus.release("a");
        expect(menus.claimSlot("c")).toBe(0);
        expect(menus.claimSlot("d")).toBe(2);
    });

    it("has no menu before one registers, and none after the last leaves", () => {
        const menus = createChoiceMenus();
        expect(menus.current()).toBeNull();
        menus.claimSlot("a");
        expect(menus.current()).toBeNull();
        menus.setRuntime("a", makeRuntime(3));
        expect(menus.current()?.count).toBe(3);
        menus.setRuntime("a", null);
        expect(menus.current()).toBeNull();
    });

    it("answers with the newest menu", () => {
        const menus = createChoiceMenus();
        menus.setRuntime("a", makeRuntime(2));
        menus.setRuntime("b", makeRuntime(5));
        expect(menus.current()?.count).toBe(5);
    });

    it("keeps the menu that is live when the one beside it leaves", () => {
        // The defect this registry replaces: one slot, written on mount and cleared on unmount, so
        // the menu that left took the survivor's runtime with it and `Select Choice` threw.
        const menus = createChoiceMenus();
        menus.setRuntime("a", makeRuntime(2));
        menus.setRuntime("b", makeRuntime(5));
        menus.release("b");
        expect(menus.current()?.count).toBe(2);
    });

    it("re-registering a menu makes it the newest rather than a duplicate", () => {
        const menus = createChoiceMenus();
        menus.setRuntime("a", makeRuntime(2));
        menus.setRuntime("b", makeRuntime(5));
        menus.setRuntime("a", makeRuntime(9));
        expect(menus.current()?.count).toBe(9);
        menus.release("a");
        expect(menus.current()?.count).toBe(5);
    });

    it("tells listeners about every menu that registers, including a second one", () => {
        const menus = createChoiceMenus();
        const shown = vi.fn();
        menus.onShown(shown);
        menus.setRuntime("a", makeRuntime(2));
        menus.setRuntime("b", makeRuntime(5));
        expect(shown).toHaveBeenCalledTimes(2);
        expect(shown.mock.calls[1][0].count).toBe(5);
    });

    it("says nothing when a menu clears itself", () => {
        const menus = createChoiceMenus();
        const shown = vi.fn();
        menus.onShown(shown);
        menus.setRuntime("a", makeRuntime(2));
        menus.setRuntime("a", null);
        expect(shown).toHaveBeenCalledTimes(1);
    });

    it("stops telling a listener that unsubscribed", () => {
        const menus = createChoiceMenus();
        const shown = vi.fn();
        menus.onShown(shown)();
        menus.setRuntime("a", makeRuntime(2));
        expect(shown).not.toHaveBeenCalled();
    });

    it("forgets every menu and every slot when the session ends", () => {
        const menus = createChoiceMenus();
        menus.claimSlot("a");
        menus.claimSlot("b");
        menus.setRuntime("a", makeRuntime(2));
        menus.clear();
        expect(menus.current()).toBeNull();
        expect(menus.claimSlot("c")).toBe(0);
    });
});
