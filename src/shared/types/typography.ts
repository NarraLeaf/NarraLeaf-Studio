/**
 * The project's default font stack - what text is set in when nobody said otherwise.
 *
 * An author picks the typeface once here and every text-like widget follows it, the way
 * `@shared/types/brand` lets them pick a colour once. The two features are deliberately not built
 * the same way, and the difference is the point:
 *
 * - a colour is stored as a **link** (`nlbrand:primary`), because a widget has several colours and
 *   each has to say which palette entry it follows;
 * - a font is stored as **nothing at all**. A widget whose `fontAssetId` is null follows the
 *   project, and that is the state every widget already ships in.
 *
 * So this feature has no token to write into documents and no migration behind it: a project that
 * has never opened the Design surface holds an empty stack, an empty stack resolves to no families,
 * and a widget with no families set renders exactly as it did before the feature existed.
 *
 * ## Why it is a list rather than one font
 *
 * A font file carries the glyphs its designer drew. A Latin display face asked to set a Japanese
 * line has nothing to draw with, and the browser goes looking for the next family in the CSS
 * `font-family` list. That list is what this is: the entries in order are the priority, and the
 * first one that has the glyph wins - per character, which is the part that cannot be expressed by
 * choosing a single font.
 *
 * An entry is a font **asset id**, or one of the built-in system stacks (`builtin:font:*`, see the
 * renderer's `ui-editor/fonts/builtinVirtualEditorFonts`). Both are opaque here: turning an id into
 * a CSS family means loading a `FontFace`, and the editor and the shipped runtime load them by
 * different routes and give them different family names. This module never sees a family name.
 *
 * ## Why languages are a property of a rung and not a second axis
 *
 * Two languages want different typefaces far more often than a Western project expects, and the CSS
 * fallback chain cannot express it: Han unification gives Japanese and Simplified Chinese the same
 * code points with different **glyphs**, so both fonts claim every character and whichever the
 * author listed first wins for both languages. One of the two is then set in the wrong glyphs
 * everywhere, and nothing says so.
 *
 * The obvious fix is a table of language against font. It is also the wrong one: adding a language
 * would add a column to fill in, adding a font would add a row to place in every column, and the
 * author would be maintaining a matrix that is almost entirely repetition of one order.
 *
 * So the language lives **on the rung**. There is still one list in one order; a rung may name the
 * languages it is for, and a language's stack is that list with the rungs that are not for it left
 * out. Adding a language costs nothing. Adding a Japanese face is one restriction, stated once. A
 * project with one font for everything holds no restrictions at all and behaves exactly as it did
 * before this existed - which is what makes the migration from the untagged shape a no-op.
 *
 * Comments in English per project convention.
 */

import { isValidLocaleCode, localeMatchesTag, type LocaleCode } from "./localization";

/**
 * One rung of the stack.
 *
 * An object rather than a bare string so a rung can grow the things a rung of a font stack turns out
 * to need (a weight, a range) without every stored document changing shape. The id is the identity;
 * nothing else is stored, because everything else about a font - its name, its file, its format -
 * belongs to the asset library and would be a copy that goes stale.
 */
export type ProjectFontEntry = {
    assetId: string;
    /**
     * The languages this rung is for. Absent or empty means every language, which is what every
     * rung written before this field existed reads as.
     *
     * Language tags rather than script codes, because the distinction that matters here is one
     * scripts cannot draw: `ja` and `zh-Hans` are the same script and want different faces. Matched
     * on subtag boundaries, so a rung marked `zh` serves `zh-Hans-CN` too - an author who wants the
     * narrower answer says the narrower tag.
     */
    locales?: LocaleCode[];
};

/**
 * How many rungs are kept.
 *
 * Not a design limit - a stack for one language is two or three deep, four with a CJK fallback - but
 * a bound on what a hand-edited or merge-mangled document can do. The ceiling counts the whole list
 * across every language rather than per language, which is why it is not three: a four-language
 * project with a face of its own for each and two shared fallbacks is six rungs and entirely
 * reasonable. What is loaded is never the whole list - see `@shared/typography/projectFonts`, which
 * resolves one language's rungs and leaves the rest as bytes nobody fetches.
 */
export const PROJECT_FONT_STACK_MAX = 16;

/**
 * The stack as the rest of Studio may assume it: no blanks, no duplicates, in the author's order,
 * with every language restriction a language tag Studio would accept elsewhere.
 *
 * A duplicate is dropped rather than kept because a CSS family list repeating a family is the same
 * list, and the second row is one the author can only delete - it does nothing and cannot be told
 * from the first on screen. **The first spelling wins, restrictions and all**; the two are not
 * merged, because merging would silently widen a restriction the author put there.
 */
export function normalizeProjectFontStack(raw: unknown): ProjectFontEntry[] {
    const source = Array.isArray(raw) ? raw : [];
    const seen = new Set<string>();
    const entries: ProjectFontEntry[] = [];

    for (const item of source) {
        if (entries.length >= PROJECT_FONT_STACK_MAX) {
            break;
        }
        const assetId = readAssetId(item);
        if (!assetId || seen.has(assetId)) {
            continue;
        }
        seen.add(assetId);
        const locales = readLocales(item);
        entries.push(locales.length > 0 ? { assetId, locales } : { assetId });
    }

    return entries;
}

/**
 * Whether two stacks say the same thing.
 *
 * Order is part of the answer - a stack is a priority list, so swapping two rungs is a different
 * stack. So is a restriction: the same fonts in the same order restricted to different languages
 * resolve differently for every language in the project. Used to keep a publish that changed nothing
 * from bumping a revision and repainting every surface (see `@shared/typography/projectFonts`).
 */
export function sameProjectFontStack(
    a: readonly ProjectFontEntry[],
    b: readonly ProjectFontEntry[],
): boolean {
    if (a.length !== b.length) {
        return false;
    }
    return a.every((entry, index) => {
        const other = b[index]!;
        if (entry.assetId !== other.assetId) {
            return false;
        }
        const mine = entry.locales ?? [];
        const theirs = other.locales ?? [];
        return mine.length === theirs.length && mine.every((locale, at) => locale === theirs[at]);
    });
}

/**
 * The rungs that serve a language, in the author's order.
 *
 * **An empty or absent `locale` filters nothing.** Three callers reach here without one - a project
 * that has never configured localization, a host that has not published its language yet, and the
 * asset audit, which has to name every rung the build ships whatever language it is for. Answering
 * the whole list is right for all three: it is what the stack meant before restrictions existed,
 * and it can never make a font disappear from a surface that had it.
 */
export function resolveProjectFontStackForLocale(
    entries: readonly ProjectFontEntry[],
    locale: string | null | undefined,
): ProjectFontEntry[] {
    const code = typeof locale === "string" ? locale.trim() : "";
    if (!code) {
        return [...entries];
    }
    return entries.filter(entry => entryServesLocale(entry, code));
}

/** Whether a rung participates in a language's stack. Unrestricted rungs serve every language. */
export function entryServesLocale(entry: ProjectFontEntry, locale: string): boolean {
    const locales = entry.locales ?? [];
    if (locales.length === 0) {
        return true;
    }
    return locales.some(tag => localeMatchesTag(locale, tag));
}

/** The ids alone, in order. What every resolver actually wants. */
export function projectFontStackIds(entries: readonly ProjectFontEntry[]): string[] {
    return entries.map(entry => entry.assetId);
}

/**
 * A rung's id, accepting the bare string spelling as well as the object one.
 *
 * A hand-written `"fonts": ["<id>"]` is unambiguous and reads the way somebody editing the file by
 * hand would expect it to, so it is honoured rather than dropped - the alternative is a document
 * that looks right and silently sets no font.
 */
function readAssetId(raw: unknown): string {
    if (typeof raw === "string") {
        return raw.trim();
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return "";
    }
    const value = (raw as Record<string, unknown>).assetId;
    return typeof value === "string" ? value.trim() : "";
}

/**
 * A rung's language restriction, kept only where every tag is one Studio would accept.
 *
 * A malformed tag is dropped rather than kept as written, and a restriction that loses every tag
 * that way becomes no restriction. That direction is deliberate: a rung nobody can spell a language
 * for should go on serving every language, where it is visible and one edit from correct, rather
 * than vanish from every stack in the project with nothing on screen to say why.
 */
function readLocales(raw: unknown): LocaleCode[] {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return [];
    }
    const value = (raw as Record<string, unknown>).locales;
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set<string>();
    const locales: LocaleCode[] = [];
    for (const item of value) {
        const code = typeof item === "string" ? item.trim() : "";
        if (!isValidLocaleCode(code) || seen.has(code)) {
            continue;
        }
        seen.add(code);
        locales.push(code);
    }
    return locales;
}
