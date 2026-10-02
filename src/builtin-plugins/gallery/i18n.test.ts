/**
 * The Gallery's words in the editor's language: the node cards, and the panel and tab around them.
 *
 * Both halves fail the same quiet way. Studio draws a node's title or label in English when no table
 * has it, and the plugin translator hands back the English when the active language lacks a key -
 * nothing throws, the word just stays English. So the tests below ask for every word by name.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTranslator } from "@shared/i18n";
import { i18nStore } from "@/lib/i18n/store";
import { indexBlueprintNodeTranslations } from "@/lib/ui-editor/blueprint-nodes/nodeTranslations";
import {
    resolveBlueprintCategoryLabel,
    resolveBlueprintLabel,
    resolveBlueprintNodeTitle,
} from "@/apps/workspace/modules/blueprint-lite/blueprintNodeI18n";
import { GALLERY_MESSAGES } from "./messages";
import { GALLERY_NODE_TRANSLATIONS, createGalleryBlueprintNodes } from "./nodes";

const defs = createGalleryBlueprintNodes(() => ({}));
for (const def of defs) {
    indexBlueprintNodeTranslations(def.translations);
}

const zhNodeTable = GALLERY_NODE_TRANSLATIONS.zh!;
const en = GALLERY_MESSAGES.messages.en!;
const zh = GALLERY_MESSAGES.messages.zh!;
const echoKey = ((key: string) => key) as never;

/** A word that reads the same in every language. */
const SAME_IN_EVERY_LANGUAGE = new Set(["CG"]);

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
            if (param.emptyOptionLabel) {
                out.push({ text: param.emptyOptionLabel, where: `${def.type}!${param.key}`, kind: "label" });
            }
            for (const option of param.options ?? []) {
                out.push({ text: option.label, where: `${def.type}!${param.key}=${option.value}`, kind: "label" });
            }
        }
    }
    return out;
}

function resolve(word: NodeWord, t: Parameters<typeof resolveBlueprintLabel>[1]): string {
    switch (word.kind) {
        case "title":
            return resolveBlueprintNodeTitle(word.text, t);
        case "category":
            return resolveBlueprintCategoryLabel(word.text, t);
        default:
            return resolveBlueprintLabel(word.text, t);
    }
}

function placeholders(text: string): string[] {
    return [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]!).sort();
}

afterEach(() => {
    i18nStore.setLocale("en");
});

describe("gallery node words", () => {
    it("draws every title, category, pin and option in Chinese", () => {
        i18nStore.setLocale("zh");
        const zhT = createTranslator("zh").t;
        const english = nodeWords()
            .filter(word => !SAME_IN_EVERY_LANGUAGE.has(word.text))
            .filter(word => resolve(word, zhT) === word.text)
            .map(word => `${word.text} (${word.where})`);
        expect(english).toEqual([]);
    });

    it("lists only words the nodes use and Studio does not already translate", () => {
        // In English, with a translator that echoes keys, a word comes back changed exactly when
        // Studio's own table has it - and then the plugin's entry is never read.
        const words = nodeWords();
        const used = new Set(words.map(word => word.text));
        const translatedByStudio = new Set(
            words.filter(word => resolve(word, echoKey) !== word.text).map(word => word.text),
        );
        const unused = Object.keys(zhNodeTable).filter(text => !used.has(text));
        const shadowed = Object.keys(zhNodeTable).filter(text => translatedByStudio.has(text));
        expect({ unused, shadowed }).toEqual({ unused: [], shadowed: [] });
    });
});

describe("gallery messages", () => {
    it("has a Chinese wording for every key, with the same placeholders", () => {
        const mismatched = Object.keys(en).filter(
            key => zh[key] === undefined || placeholders(zh[key]!).join() !== placeholders(en[key]!).join(),
        );
        expect(mismatched).toEqual([]);
    });

    it("ends no Chinese sentence with a full stop", () => {
        const withStop = [
            ...Object.entries(zh).map(([key, text]) => ({ key, text })),
            ...Object.entries(zhNodeTable).map(([key, text]) => ({ key, text })),
        ].filter(({ text }) => /[。.]$/.test(text.trim()));
        expect(withStop).toEqual([]);
    });

    it("names Studio's own nodes and pins the way Studio's catalogue does", () => {
        const pairs = [
            ["coreSetListContent", "blueprint.node.setListContent"],
            ["coreGetListItemProps", "blueprint.node.getListItemProps"],
            ["coreGetJsonField", "blueprint.node.getJsonField"],
            ["corePinEntries", "blueprint.port.entries"],
        ] as const;
        for (const locale of ["en", "zh"] as const) {
            const t = createTranslator(locale).t;
            const messages = GALLERY_MESSAGES.messages[locale]!;
            for (const [messageKey, catalogKey] of pairs) {
                expect(messages[messageKey], `${locale}.${messageKey}`).toBe(t(catalogKey));
            }
        }
    });

    it("names the unlock node by the title its card shows", () => {
        expect(zh.unlockCg).toContain(`「${zhNodeTable["Unlock Gallery"]}」`);
        expect(en.unlockCg).toContain("Unlock Gallery");
    });
});
