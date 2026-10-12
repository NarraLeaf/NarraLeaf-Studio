/**
 * Rendering a binding string for humans, split out from `KeybindingService` so a surface that only
 * *shows* a chord does not have to pull the dispatcher, the focus manager and the UI store in with
 * it. The help browser is such a surface, and it runs in the launcher window, which has none of
 * those.
 *
 * `KeybindingService` re-exports `formatKeybinding`, so every existing import still resolves.
 */

import { getKeyName } from "@/lib/i18n/keyNames";
import { translate } from "@/lib/i18n/store";

const MAC_MODIFIER_SYMBOLS: Record<string, string> = {
    mod: "⌘",
    cmd: "⌘",
    meta: "⌘",
    super: "⌘",
    ctrl: "⌃",
    control: "⌃",
    alt: "⌥",
    option: "⌥",
    shift: "⇧",
};

const MODIFIER_LABELS: Record<string, string> = {
    mod: "Ctrl",
    cmd: "Win",
    meta: "Win",
    super: "Win",
    ctrl: "Ctrl",
    control: "Ctrl",
    alt: "Alt",
    option: "Alt",
    shift: "Shift",
};

/**
 * Key tokens a shortcut draws as a symbol. Every other key is named by `getKeyName`: by its keycap
 * ("Esc", "PageDown", "F5"), or in the author's language where the keycap carries no word (the
 * space bar).
 */
const KEY_GLYPHS: Record<string, string> = {
    arrowup: "↑",
    arrowdown: "↓",
    arrowleft: "←",
    arrowright: "→",
    "=": "+",
};

/**
 * Render a binding for humans: "mod+c" → "⌘C" on macOS, "Ctrl+C" elsewhere.
 *
 * The same string a binding is registered with is the one shown in menus, so a
 * `mod` binding must not be displayed verbatim - and hardcoding "ctrl" in the
 * label is how it silently drifts from what the key actually does on macOS.
 *
 * A translated key name is read in the window's language when this is called, so a caller that
 * keeps the result should re-render on a language change (`useTranslation` does).
 *
 * Exported for tests (the platform flag is injected there).
 */
export function formatKeybinding(binding: string, isMac: boolean): string {
    const parts = binding.toLowerCase().split("+");
    const rendered = parts.map(part => {
        const modifier = isMac ? MAC_MODIFIER_SYMBOLS[part] : MODIFIER_LABELS[part];
        if (modifier) {
            return modifier;
        }
        return KEY_GLYPHS[part] ?? getKeyName(part, translate);
    });
    // macOS convention runs the symbols together (⇧⌘P); elsewhere they are joined.
    return isMac ? rendered.join("") : rendered.join("+");
}
