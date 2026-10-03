/**
 * Quick Save's node cards in the editor's language.
 *
 * A missing word fails quietly: Studio draws a node's title or label in English when no table has
 * it, so the card just stays English in a Chinese or Japanese editor. The tests below ask for every
 * word the nodes use, in every language Studio ships.
 */
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createTranslator } from "@shared/i18n";
import { i18nStore } from "@/lib/i18n/store";
import { indexBlueprintNodeTranslations } from "@/lib/ui-editor/blueprint-nodes/nodeTranslations";
import {
    resolveBlueprintCategoryLabel,
    resolveBlueprintLabel,
    resolveBlueprintNodeTitle,
} from "@/apps/workspace/modules/blueprint-lite/blueprintNodeI18n";
import { QUICK_SAVE_NODE_TRANSLATIONS, createQuickSaveBlueprintNodes } from "./nodes";

const defs = createQuickSaveBlueprintNodes();
for (const def of defs) {
    indexBlueprintNodeTranslations(def.translations);
}

/** Every language Studio ships besides English, the language the declarations are written in. */
const TRANSLATED = ["zh", "ja"] as const;

const echoKey = ((key: string) => key) as never;

type NodeWord = { text: string; where: string; kind: "title" | "category" | "label" };

function nodeWords(): NodeWord[] {
    const out: NodeWord[] = [];
    for (const def of defs) {
        out.push({ text: def.displayName, where: def.type, kind: "title" });
        out.push({ text: def.category, where: def.type, kind: "category" });
        for (const pin of def.pins) {
            if (pin.label) {
                out.push({ text: pin.label, where: `${def.type}#${pin.id}`, kind: "label" });
            }
        }
        for (const param of def.inspectorParams ?? []) {
            out.push({ text: param.label, where: `${def.type}!${param.key}`, kind: "label" });
        }
    }
    return out;
}

function resolve(word: Pick<NodeWord, "text" | "kind">, t: Parameters<typeof resolveBlueprintLabel>[1]): string {
    switch (word.kind) {
        case "title":
            return resolveBlueprintNodeTitle(word.text, t);
        case "category":
            return resolveBlueprintCategoryLabel(word.text, t);
        default:
            return resolveBlueprintLabel(word.text, t);
    }
}

afterEach(() => {
    i18nStore.setLocale("en");
});

describe("quick save node words", () => {
    it("declares the table on every node", () => {
        expect(defs.map(def => def.translations)).toEqual(defs.map(() => QUICK_SAVE_NODE_TRANSLATIONS));
    });

    it.each(TRANSLATED)("draws every title, category and pin in %s", locale => {
        i18nStore.setLocale(locale);
        const t = createTranslator(locale).t;
        const english = nodeWords()
            .filter(word => resolve(word, t) === word.text)
            .map(word => `${word.text} (${word.where})`);
        expect(english).toEqual([]);
    });

    it.each(TRANSLATED)("lists only words the nodes use and Studio does not already translate, in %s", locale => {
        // In English, with a translator that echoes keys, a word comes back changed exactly when
        // Studio's own table has it - and then the plugin's entry is never read.
        const words = nodeWords();
        const used = new Set(words.map(word => word.text));
        const translatedByStudio = new Set(
            words.filter(word => resolve(word, echoKey) !== word.text).map(word => word.text),
        );
        const table = QUICK_SAVE_NODE_TRANSLATIONS[locale] ?? {};
        const unused = Object.keys(table).filter(text => !used.has(text));
        const shadowed = Object.keys(table).filter(text => translatedByStudio.has(text));
        expect({ unused, shadowed }).toEqual({ unused: [], shadowed: [] });
    });

    it("covers the same words in every language", () => {
        const zhWords = Object.keys(QUICK_SAVE_NODE_TRANSLATIONS.zh ?? {}).sort();
        for (const locale of TRANSLATED) {
            expect(Object.keys(QUICK_SAVE_NODE_TRANSLATIONS[locale] ?? {}).sort(), locale).toEqual(zhWords);
        }
    });

    it.each(TRANSLATED)("names the Quick Save node as the plugin is named in %s", locale => {
        // The plugin list and the node palette sit side by side: the plugin called 快速存档 has a
        // node called 快速存档, not one called Quick Save.
        const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf-8")) as {
            name: string;
            localized: Record<string, { name?: string }>;
        };
        expect(manifest.name).toBe("Quick Save");
        expect(QUICK_SAVE_NODE_TRANSLATIONS[locale]?.["Quick Save"]).toBe(manifest.localized[locale]?.name);
    });
});
