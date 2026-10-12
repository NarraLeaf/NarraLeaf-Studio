import type { TranslationKey } from "@shared/i18n";

type TranslateFn = (key: TranslationKey) => string;

/**
 * Keys whose keycap carries no word, named in the author's language. Maps rather than object
 * literals, so a hand-written binding such as "constructor" finds nothing instead of a prototype member.
 */
const WORDLESS_KEYS: ReadonlyMap<string, TranslationKey> = new Map<string, TranslationKey>([
    ["arrowup", "common.keys.arrowUp"],
    ["arrowdown", "common.keys.arrowDown"],
    ["arrowleft", "common.keys.arrowLeft"],
    ["arrowright", "common.keys.arrowRight"],
    [" ", "common.keys.space"],
    ["space", "common.keys.space"],
    ["+", "common.keys.plus"],
]);

/**
 * Keycap names that a capital first letter does not reach: the modifiers by their short names, and
 * the keys whose name is two words run together. Any other key is its own name with a capital.
 */
const KEYCAP_NAMES: ReadonlyMap<string, string> = new Map([
    ["control", "Ctrl"],
    ["alt", "Alt"],
    ["shift", "Shift"],
    ["meta", "Meta"],
    ["escape", "Esc"],
    ["pageup", "PageUp"],
    ["pagedown", "PageDown"],
    ["capslock", "CapsLock"],
    ["numlock", "NumLock"],
    ["scrolllock", "ScrollLock"],
    ["printscreen", "PrintScreen"],
]);

/**
 * What one key is called on screen, in the author's language.
 *
 * A key whose keycap carries no word - the four arrows, the space bar, the plus key - is named in
 * the author's language (`common.keys.*`). Every other key is named by what is printed on it, which
 * is the same word under every language: "Enter", "Esc", "Tab", "PageUp", "F5", "Ctrl". Those are
 * spelled the way the keycap spells them rather than the way `KeyboardEvent.key` arrives lowercased,
 * so "pageup" reads "PageUp" and "f5" reads "F5".
 *
 * Takes a key as the blueprint key parser spells it (`normalizeBlueprintKeyboardEventKeyName`): a
 * lowercased `KeyboardEvent.key`, with "space" for the space bar and "+" for the plus key. Display
 * only - a stored binding keeps its own spelling (`formatBlueprintKeyboardBinding`), so nothing read
 * from here is ever written into a project.
 *
 * Takes its translator as an argument: components pass the `t` they hold, imperative callers pass
 * `translate`.
 */
export function getKeyName(key: string, t: TranslateFn): string {
    const translated = WORDLESS_KEYS.get(key);
    if (translated) {
        return t(translated);
    }
    const keycap = KEYCAP_NAMES.get(key);
    if (keycap) {
        return keycap;
    }
    return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
}
