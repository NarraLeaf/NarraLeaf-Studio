import { getActiveProjectFonts } from "@shared/typography/projectFonts";
import { coversCodePoint, type FontCoverage } from "@shared/typography/fontCoverage";
import { characterTranslationUnitId } from "@shared/types/localization";
import { resolveProjectFontStackForLocale, type ProjectFontEntry } from "@shared/types/typography";
import type { TranslationKey } from "@shared/i18n/catalog";
import type { SearchJumpTarget } from "../../workspace/services/search/searchIndexModel";
import type { LintContext } from "../context";
import type { LintFinding, LintLocation, LintRule, LintRuleOptions } from "../types";
import { listSurfaceTextSites, surfaceLocation, surfaceTarget } from "./ui";
import { segmentLiteralText } from "./text/displayWidth";
import { listLiveTextSegments, storyBlockTarget, storyLocation } from "./text/textSegments";

/**
 * `typography` - what the project's fonts cannot draw.
 *
 * A font file carries the glyphs its designer drew, and a character no font in the stack has is a
 * box on the player's screen. Nothing in Studio could see that before: the font stack is a list of
 * asset ids and the script is a pile of text, and the two were never held up against each other.
 * It is also the failure that survives every other check - the build succeeds, the preview looks
 * right on a machine that happens to have the typeface installed, and the tofu appears on somebody
 * else's.
 *
 * Two rules, both **warning**, neither stopping a build. That is a ruling rather than a derivation:
 * by the usual criterion (does the artifact depart badly from what the author wrote) a line of boxes
 * is as bad as a missing picture and would be an error. It is a warning here because a coverage
 * answer is a statement about *files*, and the honest confidence in it is lower than the confidence
 * behind "this asset id resolves to nothing".
 *
 * ## What silences these rules, and why each silence is right
 *
 * - **A project that has declared no fonts at all.** Its text is set in whatever the host provides,
 *   and what that covers is not ours to assert. This is also what keeps every project written before
 *   the feature from lighting up.
 * - **A rung whose bytes could not be read.** The character might be in exactly that font. Reported
 *   rather than passed over, because a check that quietly did not run reads on screen as a check
 *   that passed. A **collection** is not this case: it parses, and it is known to render nothing, so
 *   it is reported once and the check goes on without it.
 * - **A language every rung was restricted away from.** Same argument one language down, and
 *   `typography/locale-no-font` is what says it - once, rather than once per character in the
 *   script.
 *
 * ## What does *not* silence them: a built-in system stack
 *
 * A rung may be one of the `builtin:font:*` stacks - `sans-serif`, `system-ui` - which name no file
 * and resolve to whatever the player's machine has. Their coverage is unknowable here, and they are
 * deliberately **not** treated as unknown-and-therefore-skip: a shipped game that needs the player's
 * operating system to own a Japanese font is a game that shows boxes on the machines that do not.
 * So they contribute no coverage and do not silence the rule, and what the finding says is that the
 * project's own fonts cannot draw the character - which is true and is the thing to fix.
 *
 * Comments in English per project convention.
 */

/**
 * Code points nobody expects a project's own typefaces to carry.
 *
 * Three groups, and each is here because reporting it would be noise rather than because it does not
 * matter: control and layout characters draw nothing by definition; private-use area code points
 * mean whatever a font decided and are usually icon-font glyphs; and emoji come from the platform's
 * own colour font on every operating system this ships to, so a text face lacking them is not a
 * defect anybody would act on.
 *
 * Whitespace is folded in here rather than tested separately - `U+3000` is a real character a font
 * can genuinely lack, but a missing ideographic space is invisible on screen and the finding would
 * be one nobody could see the point of.
 */
const IGNORED_RANGES: readonly (readonly [number, number])[] = [
    [0x0000, 0x0020], // C0 controls and the space.
    [0x007f, 0x00a0], // Delete, C1 controls, no-break space.
    [0x00ad, 0x00ad], // Soft hyphen.
    [0x2000, 0x200f], // General-punctuation spaces, zero-width joiners, bidi marks.
    [0x2028, 0x202f], // Line/paragraph separators, bidi embedding, narrow no-break space.
    [0x205f, 0x206f], // Medium mathematical space through the invisible operators.
    [0x2600, 0x27bf], // Miscellaneous symbols and dingbats - where the older emoji live.
    [0x3000, 0x3000], // Ideographic space.
    [0xe000, 0xf8ff], // Private use area.
    [0xfe00, 0xfe0f], // Variation selectors.
    [0xfeff, 0xfeff], // Byte order mark.
    [0x1f000, 0x1faff], // Emoji and their neighbours.
    [0xe0100, 0xe01ef], // Variation selectors, supplement.
    [0xf0000, 0x10fffd], // Private use, supplementary planes.
];

function isIgnored(codePoint: number): boolean {
    return IGNORED_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/**
 * One piece of text a player will read, and where it came from.
 *
 * Keyed by translation unit so the same site can be asked about in any language: a target locale
 * reads the translation where there is one and the source text where there is not, which is exactly
 * what the game does at run time. Without that fallback a half-translated project would be checked
 * against the handful of lines that happen to be translated and pass.
 */
type TextSite = {
    unitId: string;
    /** The source-language text, which is also what an untranslated unit renders as. */
    source: string;
    location: LintLocation;
    target?: SearchJumpTarget;
    /**
     * The font this site chose for itself, when it is a widget that has one.
     *
     * Story text has none - it is set in the project's stack, and a character's colour is the only
     * thing a speaker overrides. A widget with its own face still falls through to the project's
     * stack for what that face lacks, which is what {@link stackFor} composes.
     */
    fontAssetId?: string;
};

/** Everything a player reads, in the language the author wrote it in. */
function collectTextSites(ctx: LintContext): TextSite[] {
    const sites: TextSite[] = [];

    for (const ref of listLiveTextSegments(ctx)) {
        const source = segmentLiteralText(ref.segment);
        if (source.trim()) {
            sites.push({
                unitId: ref.textId,
                source,
                location: storyLocation(ref),
                target: storyBlockTarget(ref),
            });
        }
    }

    for (const character of ctx.characters) {
        if (character.name.trim()) {
            sites.push({
                unitId: characterTranslationUnitId(character.id),
                source: character.name,
                location: {
                    kind: "character",
                    characterId: character.id,
                    characterName: character.name,
                },
            });
        }
    }

    if (ctx.uiDocument) {
        for (const site of listSurfaceTextSites(ctx.uiDocument)) {
            sites.push({
                unitId: site.unitId,
                source: site.text,
                location: surfaceLocation(site.surface, site.element),
                target: surfaceTarget(site.surface),
                ...(site.fontAssetId ? { fontAssetId: site.fontAssetId } : {}),
            });
        }
    }

    return sites;
}

/**
 * The languages to ask about, or a single unnamed one.
 *
 * `null` for a project that never configured localization: it has exactly one language and no name
 * for it, and the findings say so by using the message variants that name no language. Everything
 * below treats that as the empty locale, which is also what filters no rung out of the stack.
 */
function languagesOf(ctx: LintContext): readonly (string | null)[] {
    const localization = ctx.localization;
    if (!localization) {
        return [null];
    }
    const codes = new Set<string>([localization.sourceLocale, ...localization.targetLocales]);
    return [...codes].filter(Boolean);
}

/** The rungs that serve a language, with a widget's own choice in front of them. */
function stackFor(
    entries: readonly ProjectFontEntry[],
    locale: string | null,
    fontAssetId: string | undefined,
): string[] {
    const stack = resolveProjectFontStackForLocale(entries, locale).map(entry => entry.assetId);
    const chosen = fontAssetId?.trim();
    // Never filtered by language: the author named that face on that widget, and a restriction on
    // the project's list says which language a *default* is for, not which widgets may use a font.
    return chosen ? [chosen, ...stack.filter(id => id !== chosen)] : stack;
}

/** What a language's text renders as, unit by unit. */
function textForLocale(ctx: LintContext, site: TextSite, locale: string | null): string {
    if (!locale || !ctx.localization || locale === ctx.localization.sourceLocale) {
        return site.source;
    }
    const target = ctx.localization.documents.get(locale)?.units[site.unitId]?.target;
    return target && target.trim() ? target : site.source;
}

/**
 * How a message names a language.
 *
 * The code, not the autonym. `LintLocalizationContext` carries codes and documents and no display
 * names, and the code is what the Localization panel keys its rows on - so an author reading
 * "zh-Hans" in the report finds "zh-Hans" in the panel they are being sent to. Resolving an autonym
 * here would hand them a second spelling of the same language to reconcile.
 */
function languageName(locale: string): string {
    return locale;
}

// ---------------------------------------------------------------------------
// typography/locale-no-font
// ---------------------------------------------------------------------------

/**
 * A language the project's stack leaves with nothing.
 *
 * Only reachable through a restriction: an unrestricted rung serves every language, so this fires
 * exactly when every rung the project has was pinned to some other language. That is a real state
 * and an easy one to reach - restrict two fonts to `ja` and `zh-Hans`, add English, and English is
 * suddenly set in the host's own typeface while every other language is set in the author's.
 */
export function findLanguagesWithoutFonts(
    ctx: LintContext,
    entries: readonly ProjectFontEntry[],
): string[] {
    if (entries.length === 0 || !ctx.localization) {
        return [];
    }
    return languagesOf(ctx)
        .filter((locale): locale is string => Boolean(locale))
        .filter(locale => resolveProjectFontStackForLocale(entries, locale).length === 0);
}

function runLocaleNoFont(ctx: LintContext, entries: readonly ProjectFontEntry[]): LintFinding[] {
    return findLanguagesWithoutFonts(ctx, entries).map(locale => ({
        ruleId: "typography/locale-no-font" as const,
        messageKey: "lint.rule.typographyLocaleNoFont.message" as TranslationKey,
        messageParams: { language: languageName(locale) },
        location: { kind: "project" as const },
    }));
}

// ---------------------------------------------------------------------------
// typography/glyph-coverage
// ---------------------------------------------------------------------------

/** A character no font could draw, with the first place it was found and how often it appears. */
type MissingCharacter = {
    character: string;
    codePoint: number;
    count: number;
    location: LintLocation;
    target?: SearchJumpTarget;
};

/**
 * Coverage for every rung a language's sites can reach, and the two ways a rung can fail to have any.
 *
 * One probe per asset per sweep, not per site: a scene has a thousand lines and they are all set in
 * the same two fonts.
 *
 * The two failures are kept apart because they point opposite ways:
 *
 * - **`unreadable`** - the bytes would not parse. The character might be in exactly that font, so
 *   nothing computed without it can be trusted and the sweep stops.
 * - **`unloadable`** - a font collection, which parses fine and which `FontFace` will not take. Here
 *   "draws nothing" is not an unknown, it is the answer; the rest of the check is *more* accurate
 *   without it, so it contributes no coverage and the sweep goes on.
 */
async function readStacks(
    ctx: LintContext,
    ids: Iterable<string>,
): Promise<{ coverage: Map<string, FontCoverage>; unreadable: string[]; unloadable: string[] }> {
    const coverage = new Map<string, FontCoverage>();
    const unreadable: string[] = [];
    const unloadable: string[] = [];
    for (const id of ids) {
        const result = await ctx.io.probeFontCoverage(id);
        if (result.ok) {
            coverage.set(id, result.coverage);
        } else if (result.reason === "unloadable-container") {
            unloadable.push(id);
        } else if (result.reason !== "not-a-font") {
            // `not-a-font` is what a built-in system stack and a deleted asset both answer, and
            // neither is a font that failed to be read - see the note at the top of this file.
            unreadable.push(id);
        }
    }
    return { coverage, unreadable, unloadable };
}

/**
 * Every character of `sites`, in `locale`, that no font in that site's stack can draw.
 *
 * Distinct characters rather than occurrences: a Latin face asked to set a Japanese script is
 * missing the same two thousand characters on every line, and one finding per line would be a report
 * nobody reads. The count travels with the character instead, and the location is the first place it
 * turned up - which is where an author would go to see the problem.
 */
export function findMissingCharacters(input: {
    sites: readonly TextSite[];
    entries: readonly ProjectFontEntry[];
    locale: string | null;
    coverage: ReadonlyMap<string, FontCoverage>;
    textFor: (site: TextSite) => string;
}): MissingCharacter[] {
    const found = new Map<number, MissingCharacter>();
    // Keyed on the stack rather than on the site: every line of a scene resolves the same one.
    const drawable = new Map<string, (codePoint: number) => boolean>();

    for (const site of input.sites) {
        const ids = stackFor(input.entries, input.locale, site.fontAssetId);
        if (ids.length === 0) {
            // Nothing is declared for this text in this language, so what draws it is the host's own
            // typeface and its coverage is not ours to assert - the same silence a project with no
            // fonts at all gets, applied one site at a time. When it is a whole language that has
            // been left with nothing, `typography/locale-no-font` says so once instead of this
            // saying it about every character in the script.
            continue;
        }
        const key = ids.join("|");
        let covers = drawable.get(key);
        if (!covers) {
            const coverages = ids
                .map(id => input.coverage.get(id))
                .filter((entry): entry is FontCoverage => Boolean(entry));
            covers = codePoint => coverages.some(entry => coversCodePoint(entry, codePoint));
            drawable.set(key, covers);
        }

        for (const character of input.textFor(site)) {
            const codePoint = character.codePointAt(0)!;
            const already = found.get(codePoint);
            if (already) {
                already.count += 1;
                continue;
            }
            if (isIgnored(codePoint) || covers(codePoint)) {
                continue;
            }
            found.set(codePoint, {
                character,
                codePoint,
                count: 1,
                location: site.location,
                ...(site.target ? { target: site.target } : {}),
            });
        }
    }

    // Sorted by code point so two runs of the same sweep report in the same order, and so the
    // reported sample of a capped run is a stable set rather than whichever came first this time.
    return [...found.values()].sort((a, b) => a.codePoint - b.codePoint);
}

/**
 * What to call a font in a message.
 *
 * The library's name, never the asset id. Both of these findings are filed under the project, so the
 * locator column beside them prints nothing and this string is the only thing that says *which* font
 * - and a uuid says nothing an author can act on. Falls back to the id only for a rung whose asset
 * has left the library, which `assets/missing` is already reporting by name.
 */
function fontName(ctx: LintContext, assetId: string): string {
    return ctx.assets.find(asset => asset.id === assetId)?.name ?? assetId;
}

async function runGlyphCoverage(
    ctx: LintContext,
    entries: readonly ProjectFontEntry[],
    options: LintRuleOptions,
): Promise<LintFinding[]> {
    if (entries.length === 0) {
        // Nothing declared: the text is set in the host's own typeface and its coverage is not ours
        // to assert. See the note at the top of this file.
        return [];
    }
    const sites = collectTextSites(ctx);
    if (sites.length === 0) {
        return [];
    }

    const referenced = new Set<string>();
    for (const entry of entries) {
        referenced.add(entry.assetId);
    }
    for (const site of sites) {
        if (site.fontAssetId) {
            referenced.add(site.fontAssetId);
        }
    }
    const { coverage, unreadable, unloadable } = await readStacks(ctx, referenced);

    const maxCharacters = Math.max(1, Number(options.maxCharacters) || 20);
    const findings: LintFinding[] = [];
    const named = Boolean(ctx.localization);

    // A font that renders nothing at all, said once. Not folded into the per-character findings
    // below, which it would otherwise turn into every character of the script: the single useful
    // sentence about a collection is that the file cannot be used, not that it is missing an "a".
    for (const assetId of unloadable) {
        findings.push({
            ruleId: "typography/glyph-coverage" as const,
            messageKey: "lint.rule.typographyGlyphCoverage.messageUnloadable" as TranslationKey,
            messageParams: { font: fontName(ctx, assetId) },
            location: { kind: "project" as const },
        });
    }

    if (unreadable.length > 0) {
        // Said out loud rather than passed over: a font whose bytes would not parse might be exactly
        // the one carrying the character, so nothing below can be trusted while one is on the stack,
        // and a check that silently did not run reads on screen as a check that passed.
        for (const assetId of unreadable) {
            findings.push({
                ruleId: "typography/glyph-coverage" as const,
                messageKey: "lint.rule.typographyGlyphCoverage.messageUnreadable" as TranslationKey,
                messageParams: { font: fontName(ctx, assetId) },
                location: { kind: "project" as const },
            });
        }
        return findings;
    }

    for (const locale of languagesOf(ctx)) {
        const missing = findMissingCharacters({
            sites,
            entries,
            locale,
            coverage,
            textFor: site => textForLocale(ctx, site, locale),
        });
        const language = locale ? languageName(locale) : "";

        for (const entry of missing.slice(0, maxCharacters)) {
            findings.push({
                ruleId: "typography/glyph-coverage" as const,
                messageKey: (named
                    ? "lint.rule.typographyGlyphCoverage.messageInLanguage"
                    : "lint.rule.typographyGlyphCoverage.message") as TranslationKey,
                messageParams: {
                    character: entry.character,
                    count: entry.count,
                    ...(named ? { language } : {}),
                },
                location: entry.location,
                ...(entry.target ? { target: entry.target } : {}),
            });
        }

        // The cap is stated, never silent: a project set entirely in the wrong script is missing
        // thousands of characters, and a report that showed twenty of them and said nothing else
        // would read as "twenty problems" rather than "this font is not for this language".
        if (missing.length > maxCharacters) {
            findings.push({
                ruleId: "typography/glyph-coverage" as const,
                messageKey: (named
                    ? "lint.rule.typographyGlyphCoverage.messageMoreInLanguage"
                    : "lint.rule.typographyGlyphCoverage.messageMore") as TranslationKey,
                messageParams: {
                    count: missing.length - maxCharacters,
                    ...(named ? { language } : {}),
                },
                location: { kind: "project" as const },
            });
        }
    }

    return findings;
}

export const TYPOGRAPHY_LINT_RULES: readonly LintRule[] = [
    {
        id: "typography/glyph-coverage",
        category: "typography",
        // Warning by ruling; see the file header for why this one is not an error.
        defaultSeverity: "warning",
        slug: "typographyGlyphCoverage",
        options: {
            /**
             * How many distinct characters one language reports before the rest are summarised.
             *
             * Twenty is enough to recognise a script and far short of what a wrong font produces, so
             * the default separates "a few characters are missing" from "this font is not for this
             * language" without either one filling the report.
             */
            maxCharacters: { kind: "number", default: 20, min: 1, max: 200 },
        },
        run: (ctx, options) => runGlyphCoverage(ctx, getActiveProjectFonts(), options),
    },
    {
        id: "typography/locale-no-font",
        category: "typography",
        defaultSeverity: "warning",
        slug: "typographyLocaleNoFont",
        run: ctx => runLocaleNoFont(ctx, getActiveProjectFonts()),
    },
];
