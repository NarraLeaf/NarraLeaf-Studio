import { describe, expect, it } from "vitest";
import type { LocalizationUnit } from "@shared/types/localization";
import {
    collectClipboardTranslations,
    planCarriedTranslations,
    readCarriedTranslations,
    readProjectTranslations,
} from "./carriedTranslations";

/**
 * Reading translations to carry: from a clipboard another Studio wrote, and from this project's own
 * documents, including languages nobody has opened yet in this session.
 */

function unit(target: string): LocalizationUnit {
    return { target, sourceHash: "fnv1a:0001", status: "translated" };
}

describe("readCarriedTranslations", () => {
    it("keeps language codes and units that hold a translation, and nothing else", () => {
        expect(readCarriedTranslations({
            en: { "ui:a.label": unit("Begin"), "ui:b.label": { target: "" }, "": unit("No id") },
            "not a language": { "ui:a.label": unit("Lost") },
            ja: "not units",
        })).toEqual({ en: { "ui:a.label": unit("Begin") } });
    });

    it("is undefined for anything that carries nothing", () => {
        expect(readCarriedTranslations(undefined)).toBeUndefined();
        expect(readCarriedTranslations([])).toBeUndefined();
        expect(readCarriedTranslations({ en: {} })).toBeUndefined();
    });

    it("retains special unit ids when copying and reading a clipboard", () => {
        const units = Object.fromEntries([["__proto__", unit("First")], ["constructor", unit("Second")]]);
        const copied = collectClipboardTranslations(["__proto__", "constructor"], ["ja"], () => units);
        const read = readCarriedTranslations(copied);
        for (const id of ["__proto__", "constructor"]) {
            expect(Object.hasOwn(copied!.ja, id)).toBe(true);
            expect(Object.hasOwn(read!.ja, id)).toBe(true);
            expect(read!.ja[id]).toEqual(units[id]);
        }
    });

    it("keeps special destination ids when planning a paste", () => {
        const carried = { ja: { a: unit("First"), b: unit("Second") } };
        const plan = planCarriedTranslations(carried, new Map([["a", "__proto__"], ["b", "constructor"]]), new Set(["ja"]));
        expect(plan.carried).toBe(2);
        for (const id of ["__proto__", "constructor"]) {
            expect(Object.hasOwn(plan.writes[0].units, id)).toBe(true);
        }
    });
});

describe("readProjectTranslations", () => {
    function documents(onDisk: Record<string, Record<string, LocalizationUnit>>) {
        const loaded = new Map<string, { units: Record<string, LocalizationUnit> }>();
        const opened: string[] = [];
        return {
            opened,
            getConfiguration: () => ({ sourceLocale: "zh", locales: [{ code: "zh" }, { code: "en" }, { code: "ja" }] }),
            getDocumentIfLoaded: (locale: string) => loaded.get(locale),
            loadDocument: async (locale: string) => {
                opened.push(locale);
                if (!onDisk[locale]) {
                    throw new Error("unreadable");
                }
                loaded.set(locale, { units: onDisk[locale] });
                return loaded.get(locale);
            },
            adoptUnits: () => undefined,
        };
    }

    it("opens each language but the source language, and reads the units asked for", async () => {
        const docs = documents({ en: { "ui:a.label": unit("Begin"), "ui:other.text": unit("Other") }, ja: { "ui:a.label": unit("始める") } });
        expect(await readProjectTranslations(docs, ["ui:a.label"])).toEqual({
            en: { "ui:a.label": unit("Begin") },
            ja: { "ui:a.label": unit("始める") },
        });
        expect(docs.opened).toEqual(["en", "ja"]);
    });

    it("costs an unreadable language that language only, and asks nothing for no units", async () => {
        const docs = documents({ en: { "ui:a.label": unit("Begin") } });
        expect(await readProjectTranslations(docs, ["ui:a.label"])).toEqual({ en: { "ui:a.label": unit("Begin") } });
        expect(await readProjectTranslations(documents({}), [])).toBeUndefined();
    });
});
