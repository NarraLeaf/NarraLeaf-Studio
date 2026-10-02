/**
 * The Gallery's words in the editor's language: the node cards, and the panel and tab around them.
 *
 * Both halves fail the same quiet way. Studio draws a node's title or label in English when no table
 * has it, and the plugin translator hands back the English when the active language lacks a key -
 * nothing throws, the word just stays English. So the tests below ask for every word by name, in
 * every language Studio ships.
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
import { GALLERY_ENTRY_KINDS } from "./catalog";
import { GALLERY_MESSAGES, galleryNodeWord, type GalleryTranslator } from "./messages";
import {
    GALLERY_CATEGORY,
    GALLERY_KIND_LABELS,
    GALLERY_NODE_TRANSLATIONS,
    createGalleryBlueprintNodes,
} from "./nodes";

const defs = createGalleryBlueprintNodes(() => ({}));
for (const def of defs) {
    indexBlueprintNodeTranslations(def.translations);
}

/** Every language Studio ships besides English, the language the declarations are written in. */
const TRANSLATED = ["zh", "ja"] as const;
const ALL = ["en", ...TRANSLATED] as const;

const { en } = GALLERY_MESSAGES.messages;
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

/**
 * The plugin translator as the host builds it: both `.locale` and `.t()` read the editor's live
 * locale, which is also what the node cards read.
 */
function galleryTranslator(): GalleryTranslator {
    return {
        get locale() {
            return i18nStore.getLocale();
        },
        t: (key, params) => {
            const table: Record<string, string> =
                GALLERY_MESSAGES.messages[i18nStore.getLocale() as (typeof ALL)[number]] ?? en;
            return (table[key] ?? en[key]).replace(/\{(\w+)\}/g, (match, name: string) =>
                params && name in params ? String(params[name]) : match,
            );
        },
    };
}

function placeholders(text: string): string[] {
    return [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]!).sort();
}

/** Every string a translated language carries, from the message bundle and the node table alike. */
function translatedStrings(locale: (typeof TRANSLATED)[number]): { key: string; text: string }[] {
    return [
        ...Object.entries(GALLERY_MESSAGES.messages[locale]).map(([key, text]) => ({ key, text })),
        ...Object.entries(GALLERY_NODE_TRANSLATIONS[locale] ?? {}).map(([key, text]) => ({ key, text })),
    ];
}

afterEach(() => {
    i18nStore.setLocale("en");
});

describe("gallery node words", () => {
    it.each(TRANSLATED)("draws every title, category, pin and option in %s", locale => {
        i18nStore.setLocale(locale);
        const t = createTranslator(locale).t;
        const english = nodeWords()
            .filter(word => !SAME_IN_EVERY_LANGUAGE.has(word.text))
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
        const table = GALLERY_NODE_TRANSLATIONS[locale] ?? {};
        const unused = Object.keys(table).filter(text => !used.has(text));
        const shadowed = Object.keys(table).filter(text => translatedByStudio.has(text));
        expect({ unused, shadowed }).toEqual({ unused: [], shadowed: [] });
    });

    it("covers the same words in every language", () => {
        const zhWords = Object.keys(GALLERY_NODE_TRANSLATIONS.zh ?? {}).sort();
        for (const locale of TRANSLATED) {
            expect(Object.keys(GALLERY_NODE_TRANSLATIONS[locale] ?? {}).sort(), locale).toEqual(zhWords);
        }
    });
});

/**
 * The panel and the editor name the nodes, their `Kind` values and their category in their own
 * words, and the author then looks for those words on the canvas. They have to be the card's words
 * exactly, in whatever language the editor is in.
 */
describe("the words the panel and editor share with the node cards", () => {
    const shared: Pick<NodeWord, "text" | "kind">[] = [
        { text: "Get Gallery", kind: "title" },
        { text: "Unlock Gallery", kind: "title" },
        { text: "Kind", kind: "label" },
        ...GALLERY_ENTRY_KINDS.map(kind => ({ text: GALLERY_KIND_LABELS[kind], kind: "label" as const })),
        { text: GALLERY_CATEGORY, kind: "category" },
    ];

    it("names words some node actually uses", () => {
        const words = nodeWords();
        const missing = shared.filter(word => !words.some(used => used.text === word.text && used.kind === word.kind));
        expect(missing).toEqual([]);
    });

    it.each(ALL)("reads each one as the card draws it in %s", locale => {
        i18nStore.setLocale(locale);
        const t = createTranslator(locale).t;
        const tr = galleryTranslator();
        for (const word of shared) {
            expect(galleryNodeWord(tr, word.text), word.text).toBe(resolve(word, t));
        }
    });

    it.each(ALL)("quotes the Unlock Gallery card's title in the CG column's unlock line in %s", locale => {
        i18nStore.setLocale(locale);
        const tr = galleryTranslator();
        const card = resolveBlueprintNodeTitle("Unlock Gallery", createTranslator(locale).t);
        expect(tr.t("unlockCg", { node: galleryNodeWord(tr, "Unlock Gallery") })).toContain(card);
    });

    it.each(ALL)("names Studio's own nodes and pins the way Studio's catalogue does in %s", locale => {
        // The idle inspector's steps point at these on the canvas, so a host rename has to reach here.
        const host = createTranslator(locale).t;
        const table = GALLERY_MESSAGES.messages[locale];
        expect(table.coreSetListContent).toBe(host("blueprint.node.setListContent"));
        expect(table.coreGetListItemProps).toBe(host("blueprint.node.getListItemProps"));
        expect(table.coreGetJsonField).toBe(host("blueprint.node.getJsonField"));
        expect(table.corePinEntries).toBe(host("blueprint.port.entries"));
    });
});

describe("the Gallery message bundle", () => {
    it.each(TRANSLATED)("says everything English says in %s, with the same placeholders", locale => {
        const table: Record<string, string> = GALLERY_MESSAGES.messages[locale];
        expect(Object.keys(table).sort()).toEqual(Object.keys(en).sort());
        const mismatched = Object.entries(en)
            .filter(([key, text]) => placeholders(table[key] ?? "").join() !== placeholders(text).join())
            .map(([key]) => key);
        expect(mismatched).toEqual([]);
    });

    it("leaves no translation empty", () => {
        const empty = [
            ...Object.entries(en).map(([key, text]) => ({ key, text })),
            ...TRANSLATED.flatMap(translatedStrings),
        ].filter(({ text }) => text.trim().length === 0);
        expect(empty).toEqual([]);
    });

    it.each(TRANSLATED)("ends no line with a full stop in %s", locale => {
        const withStop = translatedStrings(locale).filter(({ text }) => /[。.]$/.test(text.trim()));
        expect(withStop).toEqual([]);
    });

    it("uses the interface's words in Chinese: 项目 and 资产, never 工程 or 资源", () => {
        const off = translatedStrings("zh").filter(({ text }) => /工程|资源/.test(text));
        expect(off).toEqual([]);
    });
});
