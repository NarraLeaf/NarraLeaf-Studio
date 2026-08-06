import { SOURCE_LOCALE, type LocaleCode } from "@shared/i18n";

/**
 * Single source of truth for whether the story command vocabulary is translated
 * (`editor.localizedCommands`).
 *
 * Shared between the settings registry (`appSettings.ts`) and the consumer that applies it
 * (`lib/i18n/commandLocale`), so the key and its default never drift apart.
 *
 * A switch rather than a language picker, because there are only ever two useful answers. The
 * interface language and the *grammar* language are different questions — an author reading Chinese
 * menus may still want `/show at= t= d=` in English, because that is the spelling every tutorial and
 * every shared script uses — but nobody wants a THIRD language for their command line. So: follow the
 * interface, or stay in the one language the grammar is actually written in. See the note on the key
 * itself in `globalState.ts`.
 */

/** Global-state key the preference is stored under. */
export const LOCALIZED_COMMANDS_KEY = "editor.localizedCommands" as const;

/** On unless explicitly switched off, so an author who never opens the setting reads their own language. */
export const LOCALIZED_COMMANDS_DEFAULT = true;

/**
 * The locale the command vocabulary renders in: the interface language, or the source locale when
 * translation is off.
 *
 * Only an explicit `false` turns it off. An unset key (nobody has toggled it) and a garbage value both
 * mean the default — losing a preference should land an author on their own language, which is also
 * where they were before this setting existed.
 */
export function resolveCommandLocale(localized: unknown, uiLocale: LocaleCode): LocaleCode {
    return localized === false ? SOURCE_LOCALE : uiLocale;
}
