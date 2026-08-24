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
