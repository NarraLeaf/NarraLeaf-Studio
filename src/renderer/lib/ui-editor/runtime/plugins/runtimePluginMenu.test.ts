import { describe, expect, it, vi } from "vitest";
import type { GameMenuSpec } from "@shared/types/gameMenu";
import type { DevModeBundle } from "@shared/types/devMode";
import type { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { RuntimePluginHostController } from "./runtimePluginHostController";

const SPEC: GameMenuSpec = {
    menus: [{
        label: { key: "menu.file", text: "File" },
        items: [{ kind: "action", label: { text: "Quit" }, action: { type: "quitApp" } }],
    }],
};

describe("the plugin menu backend", () => {
    it("is absent on a shell with no menu bar, which is what removes app.game.menu there", () => {
        expect(new RuntimePluginHostController({}).host.menu).toBeUndefined();
        expect(new RuntimePluginHostController({ menuBar: true }).host.menu).toBeDefined();
    });

    it("holds a menu declared before the game app mounts, and hands it over on attach", async () => {
        // The order every launch actually takes: plugins set up during boot, the game app mounts
        // after. A backend that refused here would lose the only declaration the plugin makes.
        const controller = new RuntimePluginHostController({ menuBar: true });
        await controller.host.menu?.set(SPEC);

        const setSpec = vi.fn();
        controller.attachMenuActions({ setSpec });
        expect(setSpec).toHaveBeenCalledWith(SPEC);
    });

    it("passes a later declaration straight through", async () => {
        const controller = new RuntimePluginHostController({ menuBar: true });
        const setSpec = vi.fn();
        controller.attachMenuActions({ setSpec });
        await controller.host.menu?.set(SPEC);
        expect(setSpec).toHaveBeenCalledTimes(1);
        expect(setSpec).toHaveBeenCalledWith(SPEC);
    });

    it("replays the declaration to the next game app, so a relaunch keeps the bar", async () => {
        const controller = new RuntimePluginHostController({ menuBar: true });
        await controller.host.menu?.set(SPEC);
        const first = vi.fn();
        const detach = controller.attachMenuActions({ setSpec: first });
        detach();
        const second = vi.fn();
        controller.attachMenuActions({ setSpec: second });
        expect(second).toHaveBeenCalledWith(SPEC);
    });

    it("stops handing menus to a game app that has gone", async () => {
        const controller = new RuntimePluginHostController({ menuBar: true });
        const setSpec = vi.fn();
        const detach = controller.attachMenuActions({ setSpec });
        detach();
        await controller.host.menu?.set(SPEC);
        expect(setSpec).not.toHaveBeenCalled();
    });
});

describe("the plugin locale backend", () => {
    /** The smallest attachment `locale` reads: a persistence store and the game's own tables. */
    function attach(controller: RuntimePluginHostController, locale: string): void {
        const scope = {
            persistenceGet: (key: string) => (key === "nls.locale" ? locale : undefined),
            subscribePersistence: () => () => undefined,
        } as unknown as ScopeStoreBridge;
        const bundle = {
            localization: {
                sourceLocale: "en",
                locales: [{ code: "en", displayName: "English" }, { code: "ja", displayName: "日本語" }],
                keys: { "menu.file": "File" },
                tables: { ja: { "key:menu.file": "ファイル" } },
            },
        } as unknown as DevModeBundle;
        controller.attachRuntime({ scope, bundle });
    }

    it("reads the project's own wording in the language the game is running in", () => {
        const controller = new RuntimePluginHostController({});
        attach(controller, "ja");
        expect(controller.host.locale?.text("menu.file")).toBe("ファイル");
    });

    it("falls back to the source text, and answers null for a key the project never declared", () => {
        const controller = new RuntimePluginHostController({});
        attach(controller, "en");
        expect(controller.host.locale?.text("menu.file")).toBe("File");
        expect(controller.host.locale?.text("menu.nothing")).toBeNull();
    });

    it("answers null before a game is attached, rather than guessing", () => {
        expect(new RuntimePluginHostController({}).host.locale?.text("menu.file")).toBeNull();
    });
});
