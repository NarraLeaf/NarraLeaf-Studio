/**
 * What language this machine says it is in, and which of Studio's languages that points at.
 *
 * The *effective default* for `app.language`, which is why that key deliberately has no entry in
 * `GLOBAL_STATE_DEFAULTS` - the same arrangement `editor.slashAtAlias` uses, and for the same
 * reason: the right answer depends on the device, which a static default cannot know. A stored
 * value always wins; this is only consulted when there is none.
 *
 * The main process answers the same question from `app.getPreferredSystemLanguages()` (see
 * `main/app/application/i18n.ts`). Both route through `resolvePreferredLocale`, so the native menu
 * and the windows cannot end up in different languages.
 */

import { resolvePreferredLocale, type LocaleCode } from "@shared/i18n";

/**
 * The device's preferred languages, most-preferred first, normalized to lower-case hyphen form.
 *
 * `navigator.languages` is the ordered list; `navigator.language` is appended because some
 * environments leave the list empty and answer only the singular. Underscores fold to hyphens
 * because both spellings turn up in the wild ("zh_CN" from some Linux locale setups).
 *
 * Empty where there is no `navigator` at all, which is what tests and anything outside a renderer
 * get.
 */
export function deviceLanguageTags(): string[] {
    if (typeof navigator === "undefined") {
        return [];
    }
    return [...(navigator.languages ?? []), navigator.language]
        .map(raw => String(raw ?? "").toLowerCase().replace(/_/g, "-"))
        .filter(tag => tag.length > 0);
}

/** The language to use, and to preselect in first-run setup, when none has ever been chosen. */
export function deviceDefaultLocale(): LocaleCode {
    return resolvePreferredLocale(deviceLanguageTags());
}
