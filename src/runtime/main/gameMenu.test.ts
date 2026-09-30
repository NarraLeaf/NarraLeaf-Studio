import { describe, expect, it, vi } from "vitest";
import type { GameMenuModel } from "@shared/types/gameMenu";
import { buildGameMenuTemplate, type GameMenuTemplateItem } from "./gameMenu";

const MODEL: GameMenuModel = {
    menus: [
        {
            label: "File",
            items: [
                { kind: "command", id: "0.0", label: "Settings", enabled: true },
                { kind: "separator" },
                { kind: "command", id: "0.2", label: "Quit", enabled: true, role: "quit" },
            ],
        },
        {
            label: "Game",
            items: [
                { kind: "checkbox", id: "1.0", label: "Auto", enabled: false, checked: true },
                {
                    kind: "submenu",
                    label: "Skip",
                    items: [
                        { kind: "radio", id: "1.1.0", label: "Every line", enabled: true, checked: false },
                        { kind: "radio", id: "1.1.1", label: "Read lines", enabled: true, checked: true },
                    ],
                },
            ],
        },
    ],
};

function flatten(items: GameMenuTemplateItem[]): GameMenuTemplateItem[] {
    return items.flatMap(item => [item, ...flatten(item.submenu ?? [])]);
}

function labelsOf(items: GameMenuTemplateItem[]): (string | undefined)[] {
    return items.map(item => item.label ?? item.role);
}

describe("buildGameMenuTemplate", () => {
    it("lays the authored menus out as they were sent, on Windows", () => {
        const template = buildGameMenuTemplate(MODEL, "win32", () => undefined);
        expect(labelsOf(template)).toEqual(["File", "Game"]);
        expect(labelsOf(template[0]?.submenu ?? [])).toEqual(["Settings", undefined, "Quit"]);
        expect(template[0]?.submenu?.[1]?.type).toBe("separator");
    });

    it("carries the state each row was resolved with", () => {
        const template = buildGameMenuTemplate(MODEL, "win32", () => undefined);
        const auto = template[1]?.submenu?.[0];
        expect(auto).toMatchObject({ type: "checkbox", checked: true, enabled: false });
        const skip = template[1]?.submenu?.[1]?.submenu ?? [];
        expect(skip.map(item => item.type)).toEqual(["radio", "radio"]);
        expect(skip.map(item => item.checked)).toEqual([false, true]);
    });

    it("reports a click as the id the row was drawn with, and nothing else", () => {
        const dispatch = vi.fn();
        const template = buildGameMenuTemplate(MODEL, "win32", dispatch);
        flatten(template).find(item => item.label === "Read lines")?.click?.();
        expect(dispatch).toHaveBeenCalledWith("1.1.1");
        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it("keeps the OS menus on macOS and drops the game's own Quit", () => {
        const template = buildGameMenuTemplate(MODEL, "darwin", () => undefined);
        expect(template.map(item => item.role ?? item.label))
            .toEqual(["appMenu", "File", "Game", "editMenu", "windowMenu"]);
        // The row went, and so did the separator that would have been left hanging under Settings.
        expect(labelsOf(template[1]?.submenu ?? [])).toEqual(["Settings"]);
    });

    it("answers macOS with the OS menus alone when the game has no bar", () => {
        expect(buildGameMenuTemplate({ menus: [] }, "darwin", () => undefined).map(item => item.role))
            .toEqual(["appMenu", "editMenu", "windowMenu"]);
    });

    it("answers every other platform with nothing at all when the game has no bar", () => {
        expect(buildGameMenuTemplate({ menus: [] }, "win32", () => undefined)).toEqual([]);
        expect(buildGameMenuTemplate({ menus: [] }, "linux", () => undefined)).toEqual([]);
    });

    it("drops a menu whose every row was filtered out rather than drawing an empty word", () => {
        const quitOnly: GameMenuModel = {
            menus: [{
                label: "File",
                items: [{ kind: "command", id: "0.0", label: "Quit", enabled: true, role: "quit" }],
            }],
        };
        expect(buildGameMenuTemplate(quitOnly, "darwin", () => undefined).map(item => item.role ?? item.label))
            .toEqual(["appMenu", "editMenu", "windowMenu"]);
        expect(buildGameMenuTemplate(quitOnly, "win32", () => undefined).map(item => item.label))
            .toEqual(["File"]);
    });

    it("never gives an item an accelerator", () => {
        // A menu accelerator is consumed by the main process before the page sees the key, so one
        // here would take a key away from the author's own input intents. Nothing may add one.
        const template = flatten(buildGameMenuTemplate(MODEL, "win32", () => undefined));
        for (const item of template) {
            expect(item).not.toHaveProperty("accelerator");
        }
    });
});
