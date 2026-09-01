import { describe, expect, it, vi } from "vitest";
import type { GameMenuModel, GameMenuSpec } from "@shared/types/gameMenu";
import type { BlueprintGamePreferenceKey, BlueprintGamePreferenceValue } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import {
    createGameMenuController,
    resolveGameMenu,
    runGameMenuCommand,
    type GameMenuPort,
    type ResolvedMenuCommand,
} from "./gameMenu";

type PortOverrides = Partial<GameMenuPort> & {
    preferences?: Partial<Record<BlueprintGamePreferenceKey, BlueprintGamePreferenceValue>>;
};

function createPort(overrides: PortOverrides = {}): GameMenuPort & { calls: string[] } {
    const calls: string[] = [];
    const preferences: Record<string, BlueprintGamePreferenceValue> = {
        autoForward: false,
        skipping: false,
        skipReadText: true,
        showDialog: true,
        ...overrides.preferences,
    };
    const port: GameMenuPort & { calls: string[] } = {
        calls,
        isInGame: () => true,
        getPreference: key => preferences[key] ?? false,
        setPreference: async (key, value) => {
            calls.push(`setPreference:${key}=${String(value)}`);
            preferences[key] = value;
        },
        canUndoHistory: () => true,
        canRedoHistory: () => false,
        undoHistory: async () => {
            calls.push("undo");
        },
        redoHistory: async () => {
            calls.push("redo");
        },
        next: async () => {
            calls.push("next");
        },
        toggleDialog: async () => {
            calls.push("toggleDialog");
        },
        openPage: async surfaceId => {
            calls.push(`openPage:${surfaceId}`);
        },
        openLayer: async (surfaceId, options) => {
            calls.push(`openLayer:${surfaceId}:${String(options.modal)}:${String(options.dismissible)}`);
        },
        quitToPage: async surfaceId => {
            calls.push(`quitToPage:${surfaceId}`);
        },
        quitApplication: async () => {
            calls.push("quitApplication");
        },
        getFullscreen: async () => false,
        setFullscreen: async fullscreen => {
            calls.push(`setFullscreen:${String(fullscreen)}`);
        },
        getWindowScale: async () => 1,
        localizedText: (key, locale) => (key === "menu.file" && locale === "ja" ? "ファイル" : null),
        getWindowScaleOptions: async () => [0.5, 0.75, 1],
        setWindowScale: async scale => {
            calls.push(`setWindowScale:${String(scale)}`);
        },
        listTextLanguages: () => [
            { code: "en", displayName: "English" },
            { code: "ja", displayName: "日本語" },
        ],
        getTextLanguage: async () => "ja",
        setTextLanguage: async code => {
            calls.push(`setTextLanguage:${code}`);
        },
        listVoiceLanguages: () => [{ code: "ja", displayName: "日本語" }],
        getVoiceLanguage: async () => "ja",
        setVoiceLanguage: async code => {
            calls.push(`setVoiceLanguage:${code}`);
        },
        callFn: async (fnRef, args) => {
            calls.push(`callFn:${fnRef}:${JSON.stringify(args ?? null)}`);
        },
        ...overrides,
    };
    return port;
}

const SPEC: GameMenuSpec = {
    menus: [
        {
            label: { text: "File" },
            items: [
                { kind: "action", label: { text: "Settings" }, action: { type: "openPage", surfaceId: "settings" } },
                { kind: "action", label: { text: "Title" }, action: { type: "quitToPage", surfaceId: "title" } },
                { kind: "action", label: { text: "Quit" }, action: { type: "quitApp" } },
            ],
        },
        {
            label: { text: "Game" },
            items: [
                { kind: "action", label: { text: "Auto" }, action: { type: "toggleAutoForward" } },
                { kind: "action", label: { text: "Back" }, action: { type: "historyUndo" } },
                { kind: "action", label: { text: "Forward" }, action: { type: "historyRedo" } },
                { kind: "action", label: { text: "Read only" }, action: { type: "setSkipReadText", value: true } },
                { kind: "action", label: { text: "Every line" }, action: { type: "setSkipReadText", value: false } },
            ],
        },
        {
            label: { text: "Language" },
            items: [{ kind: "dynamic", source: "textLanguage" }],
        },
    ],
};

function itemsOf(model: GameMenuModel, menuIndex: number) {
    return model.menus[menuIndex]?.items ?? [];
}

describe("resolveGameMenu", () => {
    it("greys out what a playthrough is needed for while the title screen is up", async () => {
        const { model } = await resolveGameMenu(SPEC, createPort({ isInGame: () => false }));
        const file = itemsOf(model, 0);
        expect(file.map(item => ("enabled" in item ? item.enabled : null))).toEqual([true, false, true]);
        const game = itemsOf(model, 1);
        // Auto, back and forward all need a run; the skip-scope pair is a setting and does not.
        expect(game.map(item => ("enabled" in item ? item.enabled : null)))
            .toEqual([false, false, false, true, true]);
    });

    it("ticks what the preference store says, and greys redo when there is nothing to redo", async () => {
        const { model } = await resolveGameMenu(SPEC, createPort({ preferences: { autoForward: true } }));
        const game = itemsOf(model, 1);
        expect(game[0]).toMatchObject({ kind: "checkbox", checked: true, enabled: true });
        expect(game[1]).toMatchObject({ enabled: true });
        expect(game[2]).toMatchObject({ enabled: false });
        expect(game[3]).toMatchObject({ kind: "radio", checked: true });
        expect(game[4]).toMatchObject({ kind: "radio", checked: false });
    });

    it("expands a language list into one ticked row per language the build ships", async () => {
        const { model } = await resolveGameMenu(SPEC, createPort());
        expect(itemsOf(model, 2)).toEqual([
            { kind: "radio", id: "2.0.0", label: "English", enabled: true, checked: false },
            { kind: "radio", id: "2.0.1", label: "日本語", enabled: true, checked: true },
        ]);
    });

    it("resolves a label through the project's tables, in the language the game is being read in", async () => {
        const spec: GameMenuSpec = {
            menus: [{
                label: { key: "menu.file", text: "File" },
                items: [
                    { kind: "action", label: { key: "menu.missing", text: "Settings" }, action: { type: "quitApp" } },
                ],
            }],
        };
        const { model } = await resolveGameMenu(spec, createPort());
        // The key the build carries answers in Japanese; the one it does not falls back to the
        // author's own wording rather than leaving a blank row.
        expect(model.menus[0]?.label).toBe("ファイル");
        expect(itemsOf(model, 0)[0]).toMatchObject({ label: "Settings" });
    });

    it("marks the game's own Quit for the shell, so macOS can drop the duplicate", async () => {
        const { model } = await resolveGameMenu(SPEC, createPort());
        expect(itemsOf(model, 0)[2]).toMatchObject({ kind: "command", role: "quit" });
    });

    it("shows window sizes as percentages and ticks none of them while full screen", async () => {
        const spec: GameMenuSpec = { menus: [{ label: { text: "View" }, items: [{ kind: "dynamic", source: "windowScale" }] }] };
        const windowed = await resolveGameMenu(spec, createPort());
        expect(itemsOf(windowed.model, 0).map(item => ("label" in item ? item.label : null)))
            .toEqual(["50%", "75%", "100%"]);
        expect(itemsOf(windowed.model, 0).map(item => ("checked" in item ? item.checked : null)))
            .toEqual([false, false, true]);

        const full = await resolveGameMenu(spec, createPort({ getFullscreen: async () => true }));
        expect(itemsOf(full.model, 0).every(item => "checked" in item && item.checked === false)).toBe(true);
    });

    it("drops the full-screen row on a shell that has no full screen to offer", async () => {
        const spec: GameMenuSpec = {
            menus: [{
                label: { text: "View" },
                items: [
                    { kind: "action", label: { text: "Full screen" }, action: { type: "toggleFullscreen" } },
                    { kind: "action", label: { text: "Settings" }, action: { type: "openPage", surfaceId: "settings" } },
                ],
            }],
        };
        const { model } = await resolveGameMenu(spec, createPort({
            getFullscreen: undefined,
            setFullscreen: undefined,
        }));
        expect(itemsOf(model, 0).map(item => ("label" in item ? item.label : item.kind))).toEqual(["Settings"]);
    });

    it("gives the same row the same id every time, so a click during a rebuild still lands", async () => {
        const first = await resolveGameMenu(SPEC, createPort());
        const second = await resolveGameMenu(SPEC, createPort({ preferences: { autoForward: true } }));
        expect([...first.commands.keys()]).toEqual([...second.commands.keys()]);
    });

    it("survives a shell whose window answers with a failure", async () => {
        const { model } = await resolveGameMenu(SPEC, createPort({
            getFullscreen: () => Promise.reject(new Error("no window here")),
            getWindowScale: () => Promise.reject(new Error("no window here")),
        }));
        expect(model.menus).toHaveLength(3);
    });
});

describe("runGameMenuCommand", () => {
    it("routes every action to the game's own path", async () => {
        const port = createPort({ preferences: { autoForward: true, skipping: false } });
        const commands: ResolvedMenuCommand[] = [
            { type: "openPage", surfaceId: "settings" },
            { type: "openLayer", surfaceId: "confirm", modal: true, dismissible: false },
            { type: "quitToPage", surfaceId: "title" },
            { type: "quitApp" },
            { type: "next" },
            { type: "toggleAutoForward" },
            { type: "toggleSkipping" },
            { type: "toggleDialog" },
            { type: "setSkipReadText", value: false },
            { type: "historyUndo" },
            { type: "historyRedo" },
            { type: "toggleFullscreen" },
            { type: "fn", fnRef: "fn:abc", args: { param_1_value: 3 } },
            { type: "pickTextLanguage", code: "en" },
            { type: "pickVoiceLanguage", code: "ja" },
            { type: "pickWindowScale", scale: 0.75 },
        ];
        for (const command of commands) {
            await runGameMenuCommand(command, port);
        }
        expect(port.calls).toEqual([
            "openPage:settings",
            "openLayer:confirm:true:false",
            "quitToPage:title",
            "quitApplication",
            "next",
            // Toggles read the store and write the opposite, so the menu never has to hold state.
            "setPreference:autoForward=false",
            "setPreference:skipping=true",
            "toggleDialog",
            "setPreference:skipReadText=false",
            "undo",
            "redo",
            "setFullscreen:true",
            'callFn:fn:abc:{"param_1_value":3}',
            "setTextLanguage:en",
            "setVoiceLanguage:ja",
            "setWindowScale:0.75",
        ]);
    });
});

describe("createGameMenuController", () => {
    it("takes the bar away when there is no game to resolve it against", async () => {
        const setMenu = vi.fn(async (_model: GameMenuModel) => undefined);
        const controller = createGameMenuController({ getPort: () => null, setMenu, log: () => undefined });
        controller.setSpec(SPEC);
        await vi.waitFor(() => expect(setMenu).toHaveBeenCalled());
        expect(setMenu.mock.calls[0]?.[0]).toEqual({ menus: [] });
        controller.dispose();
    });

    it("draws the menu the spec asks for", async () => {
        const port = createPort();
        const setMenu = vi.fn(async (_model: GameMenuModel) => undefined);
        const controller = createGameMenuController({ getPort: () => port, setMenu, log: () => undefined });
        controller.setSpec(SPEC);
        await vi.waitFor(() => expect(setMenu).toHaveBeenCalled());
        const model = setMenu.mock.calls[0]?.[0];
        expect(model).toBeDefined();
        expect(model?.menus.map(menu => menu.label)).toEqual(["File", "Game", "Language"]);
        controller.dispose();
    });

    it("runs the row the shell named, and ignores an id it no longer knows", async () => {
        const port = createPort();
        const setMenu = vi.fn(async (_model: GameMenuModel) => undefined);
        const controller = createGameMenuController({ getPort: () => port, setMenu, log: () => undefined });
        controller.setSpec(SPEC);
        await vi.waitFor(() => expect(setMenu).toHaveBeenCalled());
        controller.handleCommand("0.0");
        await vi.waitFor(() => expect(port.calls).toContain("openPage:settings"));
        controller.handleCommand("nothing.like.this");
        expect(port.calls).toEqual(["openPage:settings"]);
        controller.dispose();
    });

    it("coalesces a burst of refreshes into far fewer redraws", async () => {
        const port = createPort();
        const setMenu = vi.fn(async (_model: GameMenuModel) => undefined);
        const controller = createGameMenuController({ getPort: () => port, setMenu, log: () => undefined });
        controller.setSpec(SPEC);
        for (let index = 0; index < 50; index += 1) {
            controller.refresh();
        }
        await vi.waitFor(() => expect(setMenu).toHaveBeenCalled());
        // One leading redraw for the burst; the trailing one is on a timer this test does not wait
        // for. What matters is that fifty signals are not fifty menus.
        expect(setMenu.mock.calls.length).toBeLessThan(3);
        controller.dispose();
    });

    it("reports a failing redraw and keeps going", async () => {
        const log = vi.fn();
        const setMenu = vi.fn(async (_model: GameMenuModel) => {
            throw new Error("the window went away");
        });
        const controller = createGameMenuController({ getPort: () => createPort(), setMenu, log });
        controller.setSpec(SPEC);
        await vi.waitFor(() => expect(log).toHaveBeenCalled());
        expect(log.mock.calls[0]?.[0]).toBe("warning");
        expect(String(log.mock.calls[0]?.[1])).toContain("the window went away");
        controller.dispose();
    });
});
