import { describe, expect, it } from "vitest";
import {
    GAME_MENU_MAX_LABEL_LENGTH,
    isGameMenuModelEmpty,
    normalizeGameMenuModel,
    normalizeGameMenuSpec,
} from "./gameMenu";

describe("normalizeGameMenuSpec", () => {
    it("keeps a menu the author finished and drops the rows it cannot read", () => {
        const spec = normalizeGameMenuSpec({
            menus: [{
                label: "File",
                items: [
                    { kind: "action", label: "Settings", action: { type: "openPage", surfaceId: "s1" } },
                    // No surface: the action names nowhere to go.
                    { kind: "action", label: "Broken", action: { type: "openPage", surfaceId: "" } },
                    { kind: "action", label: "No action", action: { type: "somethingElse" } },
                    { kind: "action", label: "", action: { type: "quitApp" } },
                    { kind: "action", label: "Quit", action: { type: "quitApp" } },
                ],
            }],
        });
        expect(spec.menus).toHaveLength(1);
        expect(spec.menus[0]?.items.map(item => (item.kind === "action" ? item.label.text : item.kind)))
            .toEqual(["Settings", "Quit"]);
    });

    it("reads a label as a key with a fallback, and a bare string as a fallback alone", () => {
        const spec = normalizeGameMenuSpec({
            menus: [{
                label: { key: "menu.file", text: "File" },
                items: [
                    { kind: "action", label: "Quit", action: { type: "quitApp" } },
                    { kind: "action", label: { key: "menu.settings" }, action: { type: "quitApp" } },
                    { kind: "action", label: { key: "", text: "" }, action: { type: "quitApp" } },
                ],
            }],
        });
        expect(spec.menus[0]?.label).toEqual({ key: "menu.file", text: "File" });
        expect(spec.menus[0]?.items.map(item => (item.kind === "action" ? item.label : null))).toEqual([
            { key: null, text: "Quit" },
            // A key with no fallback still names a row; the build is expected to carry the key.
            { key: "menu.settings", text: "" },
        ]);
    });

    it("drops a top-level menu with nothing left under it", () => {
        const spec = normalizeGameMenuSpec({
            menus: [
                { label: "Empty", items: [] },
                { label: "", items: [{ kind: "separator" }] },
                { label: "Only separators", items: [{ kind: "separator" }, { kind: "separator" }] },
            ],
        });
        expect(spec.menus).toEqual([]);
    });

    it("trims leading, trailing and doubled separators", () => {
        const spec = normalizeGameMenuSpec({
            menus: [{
                label: "Game",
                items: [
                    { kind: "separator" },
                    { kind: "action", label: "Auto", action: { type: "toggleAutoForward" } },
                    { kind: "separator" },
                    { kind: "separator" },
                    { kind: "action", label: "Skip", action: { type: "toggleSkipping" } },
                    { kind: "separator" },
                ],
            }],
        });
        expect(spec.menus[0]?.items.map(item => item.kind)).toEqual(["action", "separator", "action"]);
    });

    it("keeps nesting up to the cap and drops a branch that goes past it", () => {
        const deep = (depth: number): unknown => (depth === 0
            ? { kind: "action", label: "Leaf", action: { type: "quitApp" } }
            : { kind: "submenu", label: `Level ${depth}`, items: [deep(depth - 1)] });
        const measure = (value: unknown): number => {
            const spec = normalizeGameMenuSpec({ menus: [{ label: "Deep", items: [value] }] });
            let level = spec.menus[0]?.items[0];
            let depth = 0;
            while (level && level.kind === "submenu") {
                depth += 1;
                level = level.items[0];
            }
            return spec.menus.length === 0 ? -1 : depth;
        };
        // Two levels of submenu with a row under them is inside the cap and survives whole.
        expect(measure(deep(2))).toBe(2);
        // Past it, the leaf is dropped - and a submenu with nothing left under it is a word the
        // player could click and watch do nothing, so the branch goes with it, all the way up.
        expect(measure(deep(5))).toBe(-1);
    });

    it("flattens a label onto one line and caps its length", () => {
        const long = "x".repeat(GAME_MENU_MAX_LABEL_LENGTH + 40);
        const spec = normalizeGameMenuSpec({
            menus: [{
                label: " Help\nand\tmore ",
                items: [{ kind: "action", label: long, action: { type: "quitApp" } }],
            }],
        });
        expect(spec.menus[0]?.label).toEqual({ key: null, text: "Help and more" });
        const item = spec.menus[0]?.items[0];
        expect(item?.kind === "action" && item.label.text.length).toBe(GAME_MENU_MAX_LABEL_LENGTH);
    });

    it("reads a dynamic list only when the source is one the game knows", () => {
        const spec = normalizeGameMenuSpec({
            menus: [{
                label: "Language",
                items: [
                    { kind: "dynamic", source: "textLanguage" },
                    { kind: "dynamic", source: "invented" },
                ],
            }],
        });
        expect(spec.menus[0]?.items).toEqual([{ kind: "dynamic", source: "textLanguage" }]);
    });

    it("answers an empty menu for anything that is not a menu at all", () => {
        expect(normalizeGameMenuSpec(null).menus).toEqual([]);
        expect(normalizeGameMenuSpec("File").menus).toEqual([]);
        expect(normalizeGameMenuSpec({ menus: "File" }).menus).toEqual([]);
    });
});

describe("normalizeGameMenuModel", () => {
    it("keeps the state a resolved model carries", () => {
        const model = normalizeGameMenuModel({
            menus: [{
                label: "View",
                items: [
                    { kind: "checkbox", id: "0.0", label: "Full screen", enabled: true, checked: true },
                    { kind: "radio", id: "0.1", label: "100%", enabled: true, checked: false },
                    { kind: "command", id: "0.2", label: "Quit", enabled: false, role: "quit" },
                ],
            }],
        });
        expect(model.menus[0]?.items).toEqual([
            { kind: "checkbox", id: "0.0", label: "Full screen", enabled: true, checked: true },
            { kind: "radio", id: "0.1", label: "100%", enabled: true, checked: false },
            { kind: "command", id: "0.2", label: "Quit", enabled: false, role: "quit" },
        ]);
    });

    it("drops a row with no id, because a click on it could name nothing", () => {
        const model = normalizeGameMenuModel({
            menus: [{
                label: "File",
                items: [
                    { kind: "command", label: "Nameless", enabled: true },
                    { kind: "command", id: "0.1", label: "Fine", enabled: true },
                ],
            }],
        });
        expect(model.menus[0]?.items).toEqual([{ kind: "command", id: "0.1", label: "Fine", enabled: true }]);
    });

    it("keeps separators exactly as sent, because the platform filter still has to run", () => {
        const model = normalizeGameMenuModel({
            menus: [{
                label: "File",
                items: [
                    { kind: "command", id: "0.0", label: "Settings", enabled: true },
                    { kind: "separator" },
                    { kind: "command", id: "0.2", label: "Quit", enabled: true, role: "quit" },
                ],
            }],
        });
        expect(model.menus[0]?.items.map(item => item.kind)).toEqual(["command", "separator", "command"]);
    });
});

describe("isGameMenuModelEmpty", () => {
    it("reads an absent or empty model as no bar at all", () => {
        expect(isGameMenuModelEmpty(null)).toBe(true);
        expect(isGameMenuModelEmpty({ menus: [] })).toBe(true);
        expect(isGameMenuModelEmpty({ menus: [{ label: "File", items: [] }] })).toBe(false);
    });
});
