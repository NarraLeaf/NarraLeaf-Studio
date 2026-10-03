/**
 * Which language to show someone who has never chosen one, decided from an ordered list of
 * language tags.
 *
 * Dependency-free, and that is the point of the file existing at all. {@link resolvePreferredLocale}
 * in `locales.ts` answers the same question for anything that already carries the catalog; the
 * shipped game's main process cannot import it, because reaching `locales.ts` reaches the locale
 * registry and through it every Studio string in every language - all of it in the main bundle of
 * every game, to say six sentences.
 */

import { chineseScriptOf, localeTagParts } from "./chineseScript";

/** Lower-cased, hyphen-form language tags, with empty entries dropped. */
export function normalizeLanguageTags(tags: readonly unknown[]): string[] {
    return tags
        .map(raw => String(raw ?? "").toLowerCase().replace(/_/g, "-"))
        .filter(tag => tag.length > 0);
}

/**
 * The device's preferred languages, most-preferred first.
 *
 * `navigator.languages` is the ordered list; `navigator.language` is appended because some
 * environments leave the list empty and answer only the singular. Underscores fold to hyphens
 * because both spellings turn up in the wild ("zh_CN" from some Linux locale setups).
 *
 * Empty where there is no `navigator` at all, which is what the main process and anything outside
 * a document get.
 */
export function deviceLanguageTags(): string[] {
    if (typeof navigator === "undefined") {
        return [];
    }
    return normalizeLanguageTags([...(navigator.languages ?? []), navigator.language]);
}

/**
 * The first entry of `tags` that `available` can satisfy, or `fallback` when none can.
 *
 * The list is walked rather than read from the head, because a list of languages is a preference
 * order: a machine that asks for French and then Japanese has said something about Japanese, and
 * answering `fallback` throws away the half of it that could have been honoured. A tag matches
 * whole first ("zh-hant", where that is on offer) and then on its primary subtag ("zh-cn" -> "zh").
 */
export function pickPreferredLocale<T extends string>(
    tags: readonly string[],
    available: readonly T[],
    fallback: T,
): T {
    for (const tag of normalizeLanguageTags(tags)) {
        const whole = available.find(code => code === tag);
        if (whole !== undefined) {
            return whole;
        }
        const primary = tag.split("-")[0];
        const partial = available.find(code => code === primary);
        if (partial !== undefined) {
            return partial;
        }
    }
    return fallback;
}

/** A language on offer, with every tag it answers to: its own code, and the tag `Intl` is given for it. */
export type OfferedLocale<T extends string> = {
    code: T;
    tags: readonly string[];
};

/** The script a tag is written in: named outright, or - for Chinese - implied by the region. */
function scriptOfTag(tag: string): string | null {
    return chineseScriptOf(tag) ?? localeTagParts(tag)?.script ?? null;
}

/** The script a whole offer is written in, read from whichever of its tags says. */
function scriptOfOffer(offer: OfferedLocale<string>): string | null {
    for (const tag of offer.tags) {
        const script = scriptOfTag(tag);
        if (script !== null) {
            return script;
        }
    }
    return null;
}

/**
 * How closely `candidate` names `offer`, or `null` when it does not name it at all.
 *
 *  - `0` - the same tag, letter for letter once case is folded.
 *  - `1` - one is the other with subtags added (`zh-hant-tw` and `zh-Hant`, `pt` and `pt-BR`), in a
 *    script the two do not disagree about.
 *  - `2` - the same language in the same script, spelled one way by script and the other by region
 *    (`zh-TW` and `zh-Hant`, `zh-HK` and `zh-TW`) - see `chineseScriptOf`.
 *
 * Scripts that disagree are not a match at this strength whatever the subtags say: `zh-TW` is not
 * read as the `zh` a catalog in Simplified characters answers to, because to a reader Simplified and
 * Traditional are two languages.
 */
function strictRank(candidate: string, offer: OfferedLocale<string>): number | null {
    const candidateScript = scriptOfTag(candidate);
    const offerScript = scriptOfOffer(offer);
    const scriptsAgree = candidateScript === null || offerScript === null || candidateScript === offerScript;
    let best: number | null = null;
    for (const raw of offer.tags) {
        const tag = normalizeLanguageTags([raw])[0];
        if (!tag) {
            continue;
        }
        if (tag === candidate) {
            return 0;
        }
        if (scriptsAgree && (candidate.startsWith(`${tag}-`) || tag.startsWith(`${candidate}-`))) {
            best = 1;
        }
    }
    if (best !== null) {
        return best;
    }
    const candidateLanguage = localeTagParts(candidate)?.language;
    const sameLanguage = offer.tags.some(tag => localeTagParts(tag)?.language === candidateLanguage);
    return sameLanguage && candidateScript !== null && candidateScript === offerScript ? 2 : null;
}

/** Whether `offer` is in the language `candidate` names, whatever the script or region. */
function sameLanguage(candidate: string, offer: OfferedLocale<string>): boolean {
    const language = localeTagParts(candidate)?.language;
    return language !== undefined && offer.tags.some(tag => localeTagParts(tag)?.language === language);
}

/** The closest offer in one group for one candidate, the earlier one on a tie. */
function closestInGroup<T extends string>(candidate: string, group: readonly OfferedLocale<T>[]): T | null {
    let best: { code: T; rank: number } | null = null;
    for (const offer of group) {
        const rank = strictRank(candidate, offer);
        if (rank !== null && (best === null || rank < best.rank)) {
            best = { code: offer.code, rank };
        }
    }
    return best?.code ?? null;
}

/**
 * The language to show for an ordered list of language tags, matched by BCP-47 fallback against
 * groups of offers - and the first group wins whenever it can answer.
 *
 * {@link pickPreferredLocale} compares codes as text, which is right for a fixed table of bare codes
 * and wrong for a language somebody else named: a pack registered as `zh-Hant` is never picked for a
 * machine that says `zh-TW`, and a `zh-TW` pack never for one that says `zh-Hant`. This matches a
 * tag to an offer by the subtags they share and by the script they are written in (`strictRank`),
 * and only when no offer in any group is in the reader's script does it settle for the language
 * alone - the same answer {@link pickPreferredLocale} gives, so a `zh-TW` machine with no Traditional
 * pack on offer still reads Chinese.
 *
 * Groups are tried in order at each strength, and an offer from an earlier group beats a closer one
 * from a later group: Studio passes its own complete catalogs first and the plugins' packs second, so
 * a pack never takes a reader its built-in language already serves. The tag list is walked in order
 * as {@link pickPreferredLocale} walks it - every strength is tried for one tag before the next.
 */
export function matchPreferredLocale<T extends string>(
    tags: readonly string[],
    groups: readonly (readonly OfferedLocale<T>[])[],
    fallback: T,
): T {
    for (const candidate of normalizeLanguageTags(tags)) {
        for (const group of groups) {
            const closest = closestInGroup(candidate, group);
            if (closest !== null) {
                return closest;
            }
        }
        for (const group of groups) {
            const sameLanguageOffer = group.find(offer => sameLanguage(candidate, offer));
            if (sameLanguageOffer) {
                return sameLanguageOffer.code;
            }
        }
    }
    return fallback;
}
