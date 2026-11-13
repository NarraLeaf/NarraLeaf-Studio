/**
 * The small vocabulary every catalogue page shares: two translators, the words the pages are
 * written in, and the few markdown shapes they use.
 *
 * Every page names a thing in Chinese and English side by side, because a reader asks in one
 * language and the catalogue has to be found in either. Chinese comes first: it is what most
 * authors see in Studio.
 *
 * Comments in English per project convention.
 */

import { createTranslator, type TranslationKey } from "@shared/i18n";
import type { UseTranslation } from "@/lib/i18n";

export type CatalogLocale = "zh" | "en";

export const CATALOG_LOCALES: readonly CatalogLocale[] = ["zh", "en"];

export type CatalogTranslate = UseTranslation["t"];

const translators = {
    zh: createTranslator("zh"),
    en: createTranslator("en"),
};

export function translatorFor(locale: CatalogLocale): CatalogTranslate {
    return translators[locale].t as CatalogTranslate;
}

/** The text of a key, or undefined when no locale has it (the translator would echo the key). */
export function textOf(locale: CatalogLocale, key: string | undefined): string | undefined {
    if (!key || !translators[locale].has(key)) {
        return undefined;
    }
    return translators[locale].t(key as TranslationKey);
}

/** `中文 · English`, or one of them when the other is missing or the same. */
export function bilingual(zh: string | undefined, en: string | undefined): string {
    const a = zh?.trim();
    const b = en?.trim();
    if (a && b && a !== b) {
        return `${a} · ${b}`;
    }
    return a || b || "";
}

/** One line of prose: newlines folded, so a value never breaks the list item it sits in. */
export function oneLine(text: string | undefined): string {
    return (text ?? "").replace(/\s*\n\s*/g, " ").trim();
}

/** The header every generated file starts with. */
export function generatedHeader(title: string, intro: readonly string[]): string[] {
    return [
        `# ${title}`,
        "",
        "> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。",
        "> Generated from the NarraLeaf Studio source. Do not edit by hand.",
        "",
        ...intro,
        "",
    ];
}

/** A file's lines joined, with exactly one trailing newline. */
export function joinLines(lines: readonly string[]): string {
    return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

/** A file-name slug for a category: `Text Input` -> `text-input`. */
export function slugOf(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** A keybinding as the docs write it: `mod+shift+p` -> `Mod+Shift+P`. */
export function formatChord(binding: string): string {
    return binding
        .split(" ")
        .map(chord => chord
            .split("+")
            .map(part => (part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
            .join("+"))
        .join(" ");
}
