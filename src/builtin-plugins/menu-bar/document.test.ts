import { describe, expect, it } from "vitest";
import {
    EMPTY_MENU_BAR_DOCUMENT,
    createMenuBarLabel,
    isMenuBarItemComplete,
    normalizeMenuBarDocument,
    toGameMenuSpec,
    type MenuBarDocument,
} from "./document";

const AUTHORED: MenuBarDocument = {
    version: 1,
    enabled: true,
    menus: [{
        id: "menu-file",
        label: { key: "menu.file", text: "File" },
        items: [
            {
                id: "item-settings",
                kind: "action",
                label: { key: "menu.settings", text: "Settings" },
                action: { type: "openPage", surfaceId: "settings" },
            },
            { id: "item-sep", kind: "separator" },
            {
                id: "item-unfinished",
                kind: "action",
                label: createMenuBarLabel("Somewhere"),
                action: { type: "openPage", surfaceId: "" },
            },
        ],
    }],
};

describe("normalizeMenuBarDocument", () => {
    it("keeps a half-finished row, because that is what a menu looks like while it is being built", () => {
        const document = normalizeMenuBarDocument(AUTHORED);
        expect(document.menus[0]?.items).toHaveLength(3);
        expect(isMenuBarItemComplete(document.menus[0]!.items[2]!)).toBe(false);
    });

    it("gives an id to a row that arrives without one", () => {
        const document = normalizeMenuBarDocument({
            menus: [{ label: { text: "File" }, items: [{ kind: "separator" }] }],
        });
        expect(document.menus[0]?.id).toBeTruthy();
        expect(document.menus[0]?.items[0]?.id).toBeTruthy();
    });

    it("reads anything unreadable as an empty menu rather than throwing", () => {
        expect(normalizeMenuBarDocument(null)).toEqual(EMPTY_MENU_BAR_DOCUMENT);
        expect(normalizeMenuBarDocument({ menus: 7 }).menus).toEqual([]);
    });

    it("keeps the bar switched off when the author switched it off", () => {
        expect(normalizeMenuBarDocument({ ...AUTHORED, enabled: false }).enabled).toBe(false);
    });
});

describe("toGameMenuSpec", () => {
    it("hands the labels over with their keys, for the game to resolve as it draws", () => {
        // Not resolved here on purpose: this runs during boot, before the project's tables can be
        // read, and a word frozen then would stay in the launch language for the whole session.
        const spec = toGameMenuSpec(AUTHORED);
        expect(spec.menus[0]?.label).toEqual({ key: "menu.file", text: "File" });
        const item = spec.menus[0]?.items[0];
        expect(item?.kind === "action" && item.label).toEqual({ key: "menu.settings", text: "Settings" });
    });

    it("carries the typed text as the fallback when the row has no key", () => {
        const document: MenuBarDocument = {
            version: 1,
            enabled: true,
            menus: [{
                id: "m",
                label: createMenuBarLabel("Help"),
                items: [{ id: "i", kind: "action", label: createMenuBarLabel("Site"), action: { type: "quitApp" } }],
            }],
        };
        const spec = toGameMenuSpec(document);
        expect(spec.menus[0]?.label).toEqual({ key: null, text: "Help" });
    });

    it("drops the rows the player would not be able to use", () => {
        const spec = toGameMenuSpec(AUTHORED);
        // The unfinished row went; the separator that would have trailed it goes with it downstream.
        expect(spec.menus[0]?.items.map(item => item.kind)).toEqual(["action", "separator"]);
    });

    it("drops a submenu whose rows were all unfinished", () => {
        const document: MenuBarDocument = {
            version: 1,
            enabled: true,
            menus: [{
                id: "m",
                label: createMenuBarLabel("File"),
                items: [{
                    id: "sub",
                    kind: "submenu",
                    label: createMenuBarLabel("More"),
                    items: [{
                        id: "child",
                        kind: "action",
                        label: createMenuBarLabel("Nowhere"),
                        action: { type: "openPage", surfaceId: "" },
                    }],
                }],
            }],
        };
        expect(toGameMenuSpec(document).menus).toEqual([]);
    });

    it("publishes nothing at all while the bar is switched off", () => {
        expect(toGameMenuSpec({ ...AUTHORED, enabled: false }).menus).toEqual([]);
    });

    it("keeps a dynamic list, which is complete the moment it is added", () => {
        const document: MenuBarDocument = {
            version: 1,
            enabled: true,
            menus: [{
                id: "m",
                label: createMenuBarLabel("Language"),
                items: [{ id: "d", kind: "dynamic", source: "textLanguage" }],
            }],
        };
        expect(toGameMenuSpec(document).menus[0]?.items)
            .toEqual([{ kind: "dynamic", source: "textLanguage" }]);
    });
});
