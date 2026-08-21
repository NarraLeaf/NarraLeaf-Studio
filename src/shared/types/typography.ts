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
 * Comments in English per project convention.
 */

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
};

/**
 * How many rungs are kept.
 *
 * Not a design limit - a real stack is two or three deep, four with a CJK fallback - but a bound on
 * what a hand-edited or merge-mangled document can do. Every rung is a font file the editor loads
 * into `document.fonts` and the shipped game preloads before its first surface, so a file listing
 * two hundred of them is a startup this refuses to have.
 */
export const PROJECT_FONT_STACK_MAX = 8;

/**
 * The stack as the rest of Studio may assume it: no blanks, no duplicates, in the author's order.
 *
 * A duplicate is dropped rather than kept because a CSS family list repeating a family is the same
 * list, and the second row is one the author can only delete - it does nothing and cannot be told
 * from the first on screen.
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
        entries.push({assetId});
    }

    return entries;
}

/**
 * Whether two stacks say the same thing.
 *
 * Order is part of the answer - a stack is a priority list, so swapping two rungs is a different
 * stack. Used to keep a publish that changed nothing from bumping a revision and repainting every
 * surface (see `@shared/typography/projectFonts`).
 */
export function sameProjectFontStack(
    a: readonly ProjectFontEntry[],
    b: readonly ProjectFontEntry[],
): boolean {
    if (a.length !== b.length) {
        return false;
    }
    return a.every((entry, index) => entry.assetId === b[index]!.assetId);
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
