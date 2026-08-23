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

import { deviceLanguageTags, resolvePreferredLocale, type LocaleCode } from "@shared/i18n";

/**
 * The device's preferred languages, most-preferred first, normalized to lower-case hyphen form.
 *
 * Re-exported rather than implemented here: a shipped game reads the same list to pick the
 * language of its crash screen, and it cannot reach Studio renderer modules.
 */
export { deviceLanguageTags };

/** The language to use, and to preselect in first-run setup, when none has ever been chosen. */
export function deviceDefaultLocale(): LocaleCode {
    return resolvePreferredLocale(deviceLanguageTags());
}
