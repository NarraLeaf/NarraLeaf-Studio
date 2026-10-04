import { describe, expect, it } from "vitest";
import type { LocalizationUnit } from "@shared/types/localization";
import { removeLocalizationKeyKeepingWords } from "./localizationKeyRemoval";

/**
 * Removing a key leaves nothing naming it: the widgets that read it hold its words and its
 * translations, and every language shows what it showed.
 */

const unit = (target: string): LocalizationUnit => ({ target, sourceHash: "fnv1a:1", status: "translated" });

function ports() {
    const calls: string[] = [];
    const documents: Record<string, Record<string, LocalizationUnit>> = {
        "zh-CN": { "key:menu.start": unit("开始") },
        ja: { "ui:title.text": unit("古い訳") },
    };
    return {
        calls,
        documents,
        ports: {
            localization: {
                getKeysIfLoaded: () => ({ keys: { "menu.start": { sourceText: "Start" } } }),
                getConfiguration: () => ({
                    sourceLocale: "en",
                    locales: [{ code: "en" }, { code: "zh-CN" }, { code: "ja" }],
                }),
                loadDocument: async (locale: string) => ({ units: documents[locale] ?? {} }),
                applyUnitEdits: (locale: string, edit: { set: Readonly<Record<string, LocalizationUnit>>; remove: readonly string[] }) => {
                    calls.push(`edit ${locale}`);
                    const units = { ...documents[locale] };
                    for (const unitId of edit.remove) {
                        delete units[unitId];
                    }
                    documents[locale] = { ...units, ...edit.set };
                },
                removeKey: (name: string) => {
                    calls.push(`remove ${name}`);
                },
            },
            interfaceDocument: {
                giveKeyedWidgetsTheirWords: (keyName: string, words: string) => {
                    calls.push(`words ${keyName}=${words}`);
                    return [{ elementId: "start", prop: "label" }, { elementId: "title", prop: "text" }];
                },
            },
        },
    };
}

describe("removeLocalizationKeyKeepingWords", () => {
    it("gives the key's words and translations to the widgets that used it, then removes the key", async () => {
        const { ports: given, calls, documents } = ports();
        expect(await removeLocalizationKeyKeepingWords(given, "menu.start")).toBe(2);
        expect(calls).toEqual(["words menu.start=Start", "edit zh-CN", "edit ja", "remove menu.start"]);
        expect(documents["zh-CN"]["ui:start.label"]).toEqual(unit("开始"));
        expect(documents["zh-CN"]["ui:title.text"]).toEqual(unit("开始"));
        // Japanese had no translation of the key, so the widget showed the key's words there; a
        // translation its own unit happened to hold would be read in their place, and goes.
        expect(documents.ja["ui:title.text"]).toBeUndefined();
    });

    it("files the key's translations under a placement's own unit when a text parameter read it", async () => {
        const { ports: given, documents } = ports();
        given.interfaceDocument.giveKeyedWidgetsTheirWords = () => [{ elementId: "item", prop: "param.label" }];
        await removeLocalizationKeyKeepingWords(given, "menu.start");
        expect(documents["zh-CN"]["ui:item.param.label"]).toEqual(unit("开始"));
    });

    it("removes a key nothing uses without touching any language", async () => {
        const { ports: given, calls } = ports();
        given.interfaceDocument.giveKeyedWidgetsTheirWords = () => [];
        await removeLocalizationKeyKeepingWords(given, "menu.start");
        expect(calls).toEqual(["remove menu.start"]);
    });
});
