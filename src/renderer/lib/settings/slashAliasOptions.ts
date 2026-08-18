/**
 * Single source of truth for the "@ opens the action creator" preference (`editor.slashAtAlias`).
 *
 * Shared between the settings registry (`appSettings.ts`), the settings UI's default, and the
 * consumer that applies it (the story scene editor's insert slot) so the key and its locale-aware
 * default never drift.
 */

import { deviceLanguageTags } from "@/lib/i18n/deviceLocale";

/** Global-state key the preference is stored under. */
export const SLASH_AT_ALIAS_KEY = "editor.slashAtAlias" as const;

/**
 * Whether this device's language is Simplified Chinese.
 *
 * Reads the same ordered device language list first-run setup preselects a language from
 * ({@link deviceLanguageTags}) and classifies the first Chinese tag it finds: Simplified (`zh`,
 * `zh-CN`, `zh-Hans`, `zh-SG`) counts, Traditional (`zh-Hant`, `zh-TW`, `zh-HK`, `zh-MO`) does
 * not. Non-Chinese and unknown environments (no `navigator`, e.g. tests) are treated as not
 * Simplified Chinese.
 *
 * A different question from "which language is the interface in", which is why it stays its own
 * function: an author can read a Chinese interface on a device set to English, and it is the
 * device - where the IME lives - that decides whether the "/" key types "、".
 */
export function isSimplifiedChineseDevice(): boolean {
  for (const tag of deviceLanguageTags()) {
    if (!tag.startsWith("zh")) {
      continue;
    }
    // Decide on the most-preferred Chinese tag: an explicit Traditional marker opts out, and
    // everything else (bare `zh`, `zh-cn`, `zh-hans`, `zh-sg`) is Simplified.
    return !/(^|-)(hant|tw|hk|mo)(-|$)/.test(tag);
  }
  return false;
}

/**
 * The effective value of `editor.slashAtAlias` when the user has never set it: on for a
 * Simplified-Chinese device (where the "/" key types "、"), off everywhere else.
 */
export function slashAtAliasDefault(): boolean {
  return isSimplifiedChineseDevice();
}
