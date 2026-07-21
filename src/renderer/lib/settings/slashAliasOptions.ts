/**
 * Single source of truth for the "@ opens the action creator" preference (`editor.slashAtAlias`).
 *
 * Shared between the settings registry (`appSettings.ts`), the settings UI's default, and the
 * consumer that applies it (the story scene editor's insert slot) so the key and its locale-aware
 * default never drift.
 */

/** Global-state key the preference is stored under. */
export const SLASH_AT_ALIAS_KEY = "editor.slashAtAlias" as const;

/**
 * Whether this device's language is Simplified Chinese.
 *
 * Reads the ordered browser/OS language list (`navigator.languages`, then `navigator.language` — the
 * same device-locale source the game runtime matches against) and classifies the first Chinese tag
 * it finds: Simplified (`zh`, `zh-CN`, `zh-Hans`, `zh-SG`) counts, Traditional (`zh-Hant`, `zh-TW`,
 * `zh-HK`, `zh-MO`) does not. Non-Chinese and unknown environments (no `navigator`, e.g. tests) are
 * treated as not Simplified Chinese.
 */
export function isSimplifiedChineseDevice(): boolean {
    if (typeof navigator === "undefined") {
        return false;
    }
    const candidates = [...(navigator.languages ?? []), navigator.language];
    for (const raw of candidates) {
        const tag = String(raw ?? "").toLowerCase().replace(/_/g, "-");
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
