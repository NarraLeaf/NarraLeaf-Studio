import { describe, expect, it, vi } from "vitest";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { freezeContextMenuRows, isDeferredWriteAllowed, makeFreezeGuard } from "./freezeGuard";

/**
 * The frozen editors' read-only affordance, asserted on the decision rather than on rendered React.
 *
 * There is no component-test precedent under `apps/workspace/**` (no testing-library, no jsdom
 * harness), and the thing worth pinning is not the markup: it is that a blocked control keeps
 * rendering with a reason, that an already-disabled one does not start blaming the freeze, and that a
 * gesture comes back as `undefined` rather than as a handler that does nothing. The last is the one
 * that would go wrong quietly - a drag that starts and refuses to drop reads as a broken editor.
 */

const REASON = "Not available while the project is frozen — unfreeze it to use this again.";

describe("isDeferredWriteAllowed", () => {
    it("lets an unprompted bake run on a writable workspace", () => {
        expect(isDeferredWriteAllowed(false)).toBe(true);
    });

    it("defers it while frozen, so opening a panel writes nothing", () => {
        expect(isDeferredWriteAllowed(true)).toBe(false);
    });
});

describe("makeFreezeGuard - writes()", () => {
    it("leaves a control alone while the workspace is writable", () => {
        expect(makeFreezeGuard(false, REASON).writes()).toEqual({ disabled: false, title: undefined });
    });

    it("disables and explains while frozen", () => {
        expect(makeFreezeGuard(true, REASON).writes()).toEqual({ disabled: true, title: REASON });
    });

    it("keeps the caller's own title when the workspace is writable", () => {
        expect(makeFreezeGuard(false, REASON).writes(false, "Add row")).toEqual({
            disabled: false,
            title: "Add row",
        });
    });

    it("replaces the caller's title while frozen, so a greyed button is never unexplained", () => {
        expect(makeFreezeGuard(true, REASON).writes(false, "Add row")).toEqual({
            disabled: true,
            title: REASON,
        });
    });

    it("does not blame the freeze for a control that was already disabled", () => {
        // The lie this prevents outlives the thaw: the author unfreezes, the button is still off, and
        // the last thing it told them was that freezing was why.
        expect(makeFreezeGuard(true, REASON).writes(true, "Select a scene first")).toEqual({
            disabled: true,
            title: "Select a scene first",
        });
        expect(makeFreezeGuard(false, REASON).writes(true, "Select a scene first")).toEqual({
            disabled: true,
            title: "Select a scene first",
        });
    });
});

describe("makeFreezeGuard - menuRow()", () => {
    it("puts the reason on the row, now that `ContextMenuItemDef` has somewhere to put one", () => {
        expect(makeFreezeGuard(true, REASON).menuRow()).toEqual({ disabled: true, tooltip: REASON });
        expect(makeFreezeGuard(false, REASON).menuRow()).toEqual({ disabled: false, tooltip: undefined });
    });

    it("keeps a row that was already disabled disabled, and does not blame the freeze for it", () => {
        expect(makeFreezeGuard(false, REASON).menuRow(true)).toEqual({ disabled: true, tooltip: undefined });
        expect(makeFreezeGuard(true, REASON).menuRow(true)).toEqual({ disabled: true, tooltip: undefined });
    });
});

describe("makeFreezeGuard - gesture()", () => {
    it("passes the handler through untouched while writable, by identity", () => {
        const handler = () => {};
        expect(makeFreezeGuard(false, REASON).gesture(handler)).toBe(handler);
    });

    it("withholds the handler entirely while frozen", () => {
        // `undefined`, not a no-op: `draggable`, `onDragOver` and React Flow's `nodesDraggable` key
        // off whether a handler is present, and half a gesture looks like a defect.
        expect(makeFreezeGuard(true, REASON).gesture(() => {})).toBeUndefined();
    });
});

describe("freezeContextMenuRows", () => {
    /** The shape the UI editor's canvas menu comes back in: read-only rows, writes, and a submenu. */
    function canvasMenu(): ContextMenuDef {
        return [
            { id: "paste", label: "Paste", onClick: () => {} },
            { id: "insert", label: "Insert", submenu: [{ id: "insert:nl.text", label: "Text", onClick: () => {} }] },
            { id: "select-all", label: "Select All", onClick: () => {} },
            { separator: true, id: "sep-edit" },
            { id: "copy", label: "Copy", onClick: () => {} },
            { id: "delete", label: "Delete", onClick: () => {} },
        ];
    }

    const READ_ONLY = new Set(["copy", "select-all"]);

    it("returns the menu untouched while writable, by identity", () => {
        const items = canvasMenu();
        expect(freezeContextMenuRows(items, false, READ_ONLY)).toBe(items);
    });

    it("disables every row that is not named read-only", () => {
        const frozen = freezeContextMenuRows(canvasMenu(), true, READ_ONLY);
        const disabledById = new Map(
            frozen.filter(item => !("separator" in item && item.separator)).map(item => [item.id, (item as { disabled?: boolean }).disabled]),
        );
        expect(disabledById.get("paste")).toBe(true);
        expect(disabledById.get("delete")).toBe(true);
        expect(disabledById.get("copy")).toBeUndefined();
        expect(disabledById.get("select-all")).toBeUndefined();
    });

    it("keeps a submenu openable and disables what is inside it", () => {
        // A group that could not be opened would hide what the freeze is doing, and the author is here
        // to look at the project - so the parent stays live and the leaves go inert.
        const frozen = freezeContextMenuRows(canvasMenu(), true, READ_ONLY);
        const insert = frozen.find(item => item.id === "insert") as { disabled?: boolean; submenu: ContextMenuDef };
        expect(insert.disabled).toBeUndefined();
        expect((insert.submenu[0] as { disabled?: boolean }).disabled).toBe(true);
    });

    it("leaves separators alone", () => {
        const frozen = freezeContextMenuRows(canvasMenu(), true, READ_ONLY);
        expect(frozen.find(item => item.id === "sep-edit")).toEqual({ separator: true, id: "sep-edit" });
    });

    it("does not mutate the menu it was given - the caller rebuilds it after the thaw", () => {
        const items = canvasMenu();
        freezeContextMenuRows(items, true, READ_ONLY);
        expect((items[0] as { disabled?: boolean }).disabled).toBeUndefined();
    });

    it("puts the reason on the rows it switches off, and only on those", () => {
        const frozen = freezeContextMenuRows(canvasMenu(), true, READ_ONLY, REASON);
        const tooltipById = new Map(
            frozen
                .filter(item => !("separator" in item && item.separator))
                .map(item => [item.id, (item as { tooltip?: string }).tooltip]),
        );
        expect(tooltipById.get("paste")).toBe(REASON);
        expect(tooltipById.get("delete")).toBe(REASON);
        expect(tooltipById.get("copy")).toBeUndefined();
        // A submenu parent stays live, so it gets no reason - its leaves do.
        expect(tooltipById.get("insert")).toBeUndefined();
        const insert = frozen.find(item => item.id === "insert") as { submenu: ContextMenuDef };
        expect((insert.submenu[0] as { tooltip?: string }).tooltip).toBe(REASON);
    });

    it("keeps a row's own tooltip, which describes the action the author is looking at", () => {
        const items: ContextMenuDef = [{ id: "delete", label: "Delete", tooltip: "Removes the element", onClick: () => {} }];
        const frozen = freezeContextMenuRows(items, true, READ_ONLY, REASON);
        expect((frozen[0] as { tooltip?: string }).tooltip).toBe("Removes the element");
    });
});

describe("makeFreezeGuard - run()", () => {
    it("calls through and returns the result while writable", () => {
        const handler = vi.fn((n: number) => n + 1);
        expect(makeFreezeGuard(false, REASON).run(handler)(1)).toBe(2);
        expect(handler).toHaveBeenCalledWith(1);
    });

    it("never calls the handler while frozen", () => {
        const handler = vi.fn(() => "written");
        expect(makeFreezeGuard(true, REASON).run(handler)()).toBeUndefined();
        expect(handler).not.toHaveBeenCalled();
    });
});
