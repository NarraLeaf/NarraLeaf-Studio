/**
 * Which writing system a language is written in, and which of a project's languages a font was
 * drawn for.
 *
 * This is the half of the font model that keeps an author out of a matrix. A project's font stack
 * is one ordered list where a rung may be restricted to some languages (see
 * `@shared/types/typography`); this module is what lets Studio fill that restriction in when the
 * font is added, so the author confirms an answer instead of composing one.
 *
 * ## The suggestion is refused far more often than it is made
 *
 * A wrong pre-filled restriction is worse than none: it silently takes a font out of the language
 * it was meant for, and the author has no reason to look at a row they never edited. So the rule is
 * **suggest only when the font itself said so, unambiguously**, and stay quiet otherwise. Three
 * consequences worth knowing before changing anything here:
 *
 * - **Latin is never suggested.** Practically every font declares code page 1252, so a Latin
 *   suggestion would restrict every font ever added to whichever Latin language the project happens
 *   to list - which is the opposite of what an unrestricted rung means.
 * - **Japanese, Simplified and Traditional Chinese are suggested from `OS/2` code pages only.** Han
 *   unification means their `cmap` coverage overlaps almost entirely, and CJK superfamilies ship
 *   kana in their Chinese faces and Chinese-only characters in their Japanese ones. Nothing about
 *   the repertoire separates them; the vendor's declared code page (932 / 936 / 950) does.
 * - **A font naming two of the project's languages is ambiguous, not both.** Pan-CJK faces exist,
 *   and the author is the only one who knows which language they meant it for.
 *
 * The probe code points below are used for the writing systems that *are* disjoint - a font either
 * has hangul or it does not. They are a handful of the most common characters in each script, not a
 * repertoire test: this decides "was this drawn for Thai", and `typography/glyph-coverage` is what
 * decides whether the actual text renders.
 *
 * Comments in English per project convention.
 */

import { coversCodePoint, type FontCoverage } from "./fontCoverage";

export type ScriptProfileId =
    | "latin"
    | "cyrillic"
    | "greek"
    | "japanese"
    | "chinese-simplified"
    | "chinese-traditional"
    | "korean"
    | "thai"
    | "arabic"
    | "hebrew"
    | "vietnamese"
    | "devanagari";

export type ScriptProfile = {
    readonly id: ScriptProfileId;
    /**
     * The `OS/2` code page that names this writing system, when one does.
     *
     * Devanagari has none - it postdates the code page era - which is why the field is optional and
     * why a script without one can only ever be suggested from its repertoire.
     */
    readonly codePage?: number;
    /** A few characters no text in this script gets far without. */
    readonly probes: readonly number[];
    /**
     * Whether a font has to *declare* this script for a suggestion, its repertoire being no evidence.
     *
     * True for the three Han languages and nothing else. See the note above.
     */
    readonly declaredOnly: boolean;
};

const SCRIPT_PROFILES: readonly ScriptProfile[] = [
    // "A", "a", "é" - the last one is what separates a font with real Latin coverage from one
    // carrying only the ASCII range for its own digits and punctuation.
    { id: "latin", codePage: 1252, probes: [0x0041, 0x0061, 0x00e9], declaredOnly: false },
    { id: "cyrillic", codePage: 1251, probes: [0x0410, 0x044f], declaredOnly: false },
    { id: "greek", codePage: 1253, probes: [0x03b1, 0x03a9], declaredOnly: false },
    // Hiragana, katakana, and two kanji. Never enough on their own - see `declaredOnly`.
    { id: "japanese", codePage: 932, probes: [0x3042, 0x30a2, 0x65e5, 0x672c], declaredOnly: true },
    // 简, 这, 国 - all three are simplified forms absent from the JIS repertoire, which is what
    // makes them the right probes even though a suggestion will not be made from them.
    { id: "chinese-simplified", codePage: 936, probes: [0x7b80, 0x8fd9, 0x56fd], declaredOnly: true },
    // 繁, 這, 國 - the traditional forms of the three above.
    { id: "chinese-traditional", codePage: 950, probes: [0x7e41, 0x9019, 0x570b], declaredOnly: true },
    // Hangul syllables, which no Han font carries by accident.
    { id: "korean", codePage: 949, probes: [0xd55c, 0xad6d, 0xae00], declaredOnly: false },
    { id: "thai", codePage: 874, probes: [0x0e01, 0x0e17], declaredOnly: false },
    { id: "arabic", codePage: 1256, probes: [0x0627, 0x0628], declaredOnly: false },
    { id: "hebrew", codePage: 1255, probes: [0x05d0, 0x05e9], declaredOnly: false },
    // Latin with the stacked diacritics only Vietnamese uses; a plain Latin face has neither.
    { id: "vietnamese", codePage: 1258, probes: [0x1ec7, 0x01a1], declaredOnly: false },
    { id: "devanagari", probes: [0x0905, 0x0915], declaredOnly: false },
];

const PROFILE_BY_ID = new Map(SCRIPT_PROFILES.map(profile => [profile.id, profile]));

/**
 * Locale prefix -> writing system, longest prefix first.
 *
 * Matched on BCP-47 subtag boundaries, so `zh-Hant-HK` finds `zh-hant` and `pt-BR` falls through to
 * the Latin default. Only languages whose script is *not* Latin need an entry; everything absent is
 * Latin, which is the right answer for the long tail of European languages and the wrong answer for
 * nothing this list forgets to name loudly.
 */
const LOCALE_SCRIPTS: readonly (readonly [prefix: string, id: ScriptProfileId])[] = [
    ["zh-hant", "chinese-traditional"],
    ["zh-tw", "chinese-traditional"],
    ["zh-hk", "chinese-traditional"],
    ["zh-mo", "chinese-traditional"],
    ["zh-hans", "chinese-simplified"],
    // Bare `zh` reads as Simplified: it is what the code is conventionally used for, and a project
    // writing Traditional has a reason to say so.
    ["zh", "chinese-simplified"],
    ["ja", "japanese"],
    ["ko", "korean"],
    ["th", "thai"],
    ["ar", "arabic"],
    ["fa", "arabic"],
    ["ur", "arabic"],
    ["he", "hebrew"],
    ["iw", "hebrew"],
    ["ru", "cyrillic"],
    ["uk", "cyrillic"],
    ["be", "cyrillic"],
    ["bg", "cyrillic"],
    ["mk", "cyrillic"],
    ["sr", "cyrillic"],
    ["kk", "cyrillic"],
    ["mn", "cyrillic"],
    ["el", "greek"],
    ["vi", "vietnamese"],
    ["hi", "devanagari"],
    ["mr", "devanagari"],
    ["ne", "devanagari"],
];

/** The writing system a language is set in. Latin when nothing else claims it. */
export function scriptProfileForLocale(locale: string): ScriptProfile {
    const code = locale.trim().toLowerCase();
    let best: { prefix: string; id: ScriptProfileId } | null = null;
    for (const [prefix, id] of LOCALE_SCRIPTS) {
        if (!matchesSubtagPrefix(code, prefix)) {
            continue;
        }
        if (!best || prefix.length > best.prefix.length) {
            best = { prefix, id };
        }
    }
    return PROFILE_BY_ID.get(best?.id ?? "latin") ?? PROFILE_BY_ID.get("latin")!;
}

/**
 * Which of the project's languages this font should be restricted to, or nothing.
 *
 * Nothing is by far the common answer, and it is the answer that means "all languages" - the state
 * every rung is added in today. A non-empty result is only produced when the font names exactly one
 * of the project's writing systems and no other, for the reasons set out at the top of this file.
 *
 * When several of the project's languages share the named writing system - a project listing both
 * `zh-Hans` and `zh-SG`, say - all of them come back, because restricting the font to one of two
 * languages it is equally right for would be a guess.
 */
export function suggestLocalesForCoverage(
    coverage: FontCoverage,
    projectLocales: readonly string[],
): string[] {
    const byProfile = new Map<ScriptProfileId, string[]>();
    for (const locale of projectLocales) {
        const profile = scriptProfileForLocale(locale);
        // Latin is every project's fallthrough and never a restriction worth suggesting.
        if (profile.id === "latin") {
            continue;
        }
        const bucket = byProfile.get(profile.id);
        if (bucket) {
            bucket.push(locale);
        } else {
            byProfile.set(profile.id, [locale]);
        }
    }
    if (byProfile.size < 2) {
        // One writing system besides Latin - or none - means there is nothing to choose between, and
        // an unrestricted rung already serves it. Saying so would add a restriction that changes
        // nothing today and quietly excludes whatever language is added tomorrow.
        return [];
    }

    const named: ScriptProfileId[] = [];
    for (const id of byProfile.keys()) {
        const profile = PROFILE_BY_ID.get(id)!;
        if (fontNamesProfile(coverage, profile)) {
            named.push(id);
        }
    }
    return named.length === 1 ? [...byProfile.get(named[0]!)!] : [];
}

/**
 * Whether the font says it was drawn for this writing system.
 *
 * A declared code page is the whole answer where there is one to declare. Repertoire is consulted
 * only for the scripts that cannot be confused with each other, and only when the font declared no
 * code pages at all - a font that declared some and left this one out has said no, and reading its
 * `cmap` past that would overturn the vendor's own statement.
 */
function fontNamesProfile(coverage: FontCoverage, profile: ScriptProfile): boolean {
    if (profile.codePage !== undefined && coverage.codePages.includes(profile.codePage)) {
        return true;
    }
    if (profile.declaredOnly || coverage.codePages.length > 0) {
        return false;
    }
    return profile.probes.every(codePoint => coversCodePoint(coverage, codePoint));
}

/** `zh-hant` matches `zh-hant-hk` but not `zh-hantx`; `zh` matches both and not `zho`. */
function matchesSubtagPrefix(locale: string, prefix: string): boolean {
    if (!locale.startsWith(prefix)) {
        return false;
    }
    return locale.length === prefix.length || locale[prefix.length] === "-";
}
