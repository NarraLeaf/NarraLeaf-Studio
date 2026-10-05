/**
 * A menu the author wrote, from the panel's document to the words the bar draws, in two languages:
 * the runtime entry publishes the spec, the host names each label's own words as the plugin's unit,
 * and the game resolves them against the project's tables as it draws - the same tables the
 * translation table writes, through the same unit id the studio entry offers them under.
 */

import { describe, expect, it } from "vitest";
import { pluginWordsUnitId, resolveLocalizedUnitText, type GameLocalizationBundle } from "@shared/types/localization";
import { qualifyGameMenuWords, type GameMenuSpec } from "@shared/types/gameMenu";
import { resolveGameMenu, type GameMenuPort } from "@/lib/ui-editor/runtime/app/gameMenu";
import { menuBarWords, type MenuBarDocument } from "./document";
import menuBarRuntime from "./runtime";

const PLUGIN_ID = "narraleaf.menu-bar";

const DOCUMENT: MenuBarDocument = {
    version: 1,
    enabled: true,
    menus: [{
        id: "menu-game",
        label: { key: null, text: "游戏" },
        items: [
            { id: "item-next", kind: "action", label: { key: null, text: "推进" }, action: { type: "next" } },
            { id: "item-auto", kind: "action", label: { key: "menu.auto", text: "自动" }, action: { type: "toggleAutoForward" } },
        ],
    }],
};

const BUNDLE: GameLocalizationBundle = {
    sourceLocale: "zh",
    locales: [{ code: "zh", displayName: "中文" }, { code: "en", displayName: "English" }],
    tables: {
        en: {
            [pluginWordsUnitId(PLUGIN_ID, "menu-game.label")]: "Game",
            [pluginWordsUnitId(PLUGIN_ID, "item-next.label")]: "Next",
            "key:menu.auto": "Auto",
        },
    },
    keys: { "menu.auto": "自动" },
};

/** The port a game builds, cut down to what drawing labels reads (`GameApp`'s, over the bundle). */
function port(locale: string): GameMenuPort {
    return {
        isInGame: () => true,
        getPreference: () => false,
        setPreference: async () => undefined,
        canUndoHistory: () => false,
        canRedoHistory: () => false,
        undoHistory: async () => undefined,
        redoHistory: async () => undefined,
        next: async () => undefined,
        toggleDialog: async () => undefined,
        openPage: async () => undefined,
        openLayer: async () => undefined,
        quitToPage: async () => undefined,
        quitApplication: async () => undefined,
        localizedText: (key, language) => {
            const translated = resolveLocalizedUnitText(BUNDLE, language, `key:${key}`);
            return translated ?? BUNDLE.keys?.[key] ?? null;
        },
        localizedUnitText: (unitId, language) => resolveLocalizedUnitText(BUNDLE, language, unitId),
        listTextLanguages: () => BUNDLE.locales,
        getTextLanguage: async () => locale,
        setTextLanguage: async () => undefined,
        listVoiceLanguages: () => [],
        getVoiceLanguage: async () => "",
        setVoiceLanguage: async () => undefined,
        callFn: async () => undefined,
    };
}

async function publishedSpec(): Promise<GameMenuSpec> {
    let published: GameMenuSpec | null = null;
    const app = {
        plugin: { id: PLUGIN_ID },
        game: {
            // What the loader hands a plugin granted `menu`: the host qualifies its words.
            menu: { set: async (spec: GameMenuSpec) => { published = qualifyGameMenuWords(spec, PLUGIN_ID); } },
            data: { readJson: () => DOCUMENT },
            log: () => undefined,
        },
    };
    await (menuBarRuntime as unknown as { setup(app: unknown): unknown }).setup(app);
    await Promise.resolve();
    return published!;
}

describe("the Menu Bar's words, written to drawn", () => {
    it("offers each directly written label under the unit the game reads it back from", () => {
        expect(menuBarWords(DOCUMENT).map(entry => pluginWordsUnitId(PLUGIN_ID, entry.id))).toEqual(
            Object.keys(BUNDLE.tables.en).filter(unitId => unitId.startsWith("plugin:")),
        );
    });

    it("draws the bar in the player's language, and in the project's own words in the source language", async () => {
        const spec = await publishedSpec();
        const en = (await resolveGameMenu(spec, port("en"))).model;
        expect(en.menus[0]?.label).toBe("Game");
        expect(en.menus[0]?.items.map(item => ("label" in item ? item.label : null))).toEqual(["Next", "Auto"]);
        const zh = (await resolveGameMenu(spec, port("zh"))).model;
        expect(zh.menus[0]?.label).toBe("游戏");
        expect(zh.menus[0]?.items.map(item => ("label" in item ? item.label : null))).toEqual(["推进", "自动"]);
    });
});
