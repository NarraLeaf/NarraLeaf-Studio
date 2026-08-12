import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContextMenuDef, ContextMenuItemDef } from "@/lib/components/elements/ContextMenu";
import {
    appendDeveloperIdSection,
    DEVELOPER_MENU_ROW_IDS,
    DEVELOPER_MENU_SEPARATOR_ID,
    developerCopyIdRowId,
} from "./developerMenuSection";
import { setDeveloperModeForTesting } from "./developerMode";

const copied: string[] = [];
vi.mock("@shared/utils/copyText", () => ({
    copyTextToClipboard: (text: string) => {
        copied.push(text);
        return Promise.resolve();
    },
}));

// The labels are catalog lookups; what matters here is which rows appear and what they carry.
vi.mock("@/lib/i18n", () => ({
    translate: (key: string, params?: Record<string, unknown>) =>
        params ? `${key}:${JSON.stringify(params)}` : key,
}));

function menu(): ContextMenuDef {
    return [
        { id: "open", label: "Open" },
        { id: "delete", label: "Delete" },
    ];
}

function rowIds(items: ContextMenuDef): string[] {
    return items.map(item => item.id);
}

function findRow(items: ContextMenuDef, id: string): ContextMenuItemDef {
    const found = items.find(item => !("separator" in item) && item.id === id);
    if (!found || "separator" in found) {
        throw new Error(`Row not found: ${id}`);
    }
    return found;
}

afterEach(() => {
    setDeveloperModeForTesting(false);
    copied.length = 0;
});

describe("developer id section", () => {
    it("adds nothing while developer options are off", () => {
        const items = appendDeveloperIdSection(menu(), [{ kind: "scene", value: "scene-1" }]);
        expect(rowIds(items)).toEqual(["open", "delete"]);
    });

    it("appends one divided section at the end when on", () => {
        setDeveloperModeForTesting(true);
        const items = appendDeveloperIdSection(menu(), [
            { kind: "element", value: "el-1" },
            { kind: "surface", value: "surface-1", label: "Page" },
        ]);

        expect(rowIds(items)).toEqual([
            "open",
            "delete",
            DEVELOPER_MENU_SEPARATOR_ID,
            developerCopyIdRowId("element"),
            developerCopyIdRowId("surface"),
        ]);
        // Every row it can produce is named in the set the read-only walkers exempt.
        for (const id of rowIds(items).slice(3)) {
            expect(DEVELOPER_MENU_ROW_IDS.has(id)).toBe(true);
        }
    });

    it("carries the identifier as the row's hover text and puts it on the clipboard", async () => {
        setDeveloperModeForTesting(true);
        const hideMenu = vi.fn();
        const notify = vi.fn();
        const items = appendDeveloperIdSection(
            menu(),
            [{ kind: "asset", value: "asset-7" }],
            { hideMenu, notify },
        );

        const row = findRow(items, developerCopyIdRowId("asset"));
        expect(row.tooltip).toBe("asset-7");
        row.onClick?.();
        await Promise.resolve();

        expect(hideMenu).toHaveBeenCalledOnce();
        expect(copied).toEqual(["asset-7"]);
        expect(notify).toHaveBeenCalledWith("developer.copied", "success");
    });

    it("takes the surface's own noun rather than defaulting to one of the two kinds", () => {
        setDeveloperModeForTesting(true);
        const items = appendDeveloperIdSection(menu(), [
            { kind: "surface", value: "surface-1", label: "Game UI" },
        ]);

        expect(findRow(items, developerCopyIdRowId("surface")).label).toContain("Game UI");
    });

    /**
     * A blank-area right-click has nothing to name. The separator must not survive on its own, or the
     * menu ends in a divider with nothing under it.
     */
    it("drops entries with no identifier, and the divider with them", () => {
        setDeveloperModeForTesting(true);
        const items = appendDeveloperIdSection(menu(), [
            { kind: "element", value: null },
            { kind: "asset", value: "" },
        ]);

        expect(rowIds(items)).toEqual(["open", "delete"]);
    });

    it("does not double the divider on a menu that already ends in one", () => {
        setDeveloperModeForTesting(true);
        const items = appendDeveloperIdSection(
            [{ id: "open", label: "Open" }, { separator: true, id: "sep" }],
            [{ kind: "scene", value: "scene-1" }],
        );

        expect(rowIds(items)).toEqual(["open", "sep", developerCopyIdRowId("scene")]);
    });

    it("keeps the first entry when a kind is offered twice", () => {
        setDeveloperModeForTesting(true);
        const items = appendDeveloperIdSection(menu(), [
            { kind: "scene", value: "scene-1" },
            { kind: "scene", value: "scene-2" },
        ]);

        expect(findRow(items, developerCopyIdRowId("scene")).tooltip).toBe("scene-1");
    });
});
