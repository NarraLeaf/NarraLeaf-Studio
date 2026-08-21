import {
    EDITOR_FONT_PRESET_STACKS,
    sanitizeFontFamilyName,
} from "@/lib/settings/editorFontOptions";

/**
 * Single source of truth for the Studio *interface* font preference.
 *
 * The story editor's own font (`editorFontOptions.ts`) is the same idea one level down: that one
 * sets the words an author writes, this one sets the chrome around them. They are deliberately two
 * settings — a face that is pleasant to read a scene in is not always the face you want a menu bar
 * in, and an author who only wants to change one should not have to change both.
 *
 * Shared between the settings registry (`appSettings.ts`), the control that edits it
 * (`SettingFontPicker.tsx`) and the bootstrap that applies it (`lib/appearance`), so a stored value
 * can never mean two different things in two places.
 */

/** Global-state key. Applied by `lib/appearance`, which is the only consumer. */
export const UI_FONT_FAMILY_KEY = "ui.fontFamily";

/**
 * The custom property the interface is set from (`html.nl-studio` in styles.css), and the one
 * holding the stack the product ships with. Both are declared in `:root` there; the bootstrap only
 * ever overrides the first.
 */
export const UI_FONT_VAR = "--nl-ui-font";
export const UI_FONT_BASE_VAR = "--nl-ui-font-base";

/**
 * The presets — stacks rather than one named typeface, so they answer "which KIND of face" without
 * depending on a file being installed.
 *
 * The same four ids as the story editor's setting, and the same strings: an author who has decided
 * what "Serif" means to them should find it meaning that in both places, and one shared set of ids
 * also means one shared set of localized labels.
 */
export const UI_FONT_FAMILY_PRESETS = ["Default", "Sans Serif", "Serif", "Monospace"] as const;

export type UIFontFamilyPreset = typeof UI_FONT_FAMILY_PRESETS[number];

/**
 * What a stored value may be: one of the presets above, or the name of a font family installed on
 * this computer. There is no third form — the picker stores the family name Chromium reports, which
 * is exactly what CSS `font-family` takes.
 */
export type UIFontFamilyValue = UIFontFamilyPreset | (string & {});

export const UI_FONT_FAMILY_DEFAULT: UIFontFamilyPreset = "Default";

/**
 * Preset id -> CSS font-family stack.
 *
 * "Default" resolves to the base variable rather than to `inherit`: the value is written onto the
 * root element, which has nothing above it to inherit from, and the picker previews this string
 * too — where `inherit` would show the row in whatever face is currently chosen and so make every
 * preview of "Default" a preview of something else.
 *
 * The other three are the story editor's stacks verbatim, imported rather than copied so "Serif"
 * cannot come to mean two different piles of fonts in two settings rows.
 */
export const UI_FONT_PRESET_STACKS: Record<UIFontFamilyPreset, string> = {
    "Default": `var(${UI_FONT_BASE_VAR})`,
    "Sans Serif": EDITOR_FONT_PRESET_STACKS["Sans Serif"],
    "Serif": EDITOR_FONT_PRESET_STACKS["Serif"],
    "Monospace": EDITOR_FONT_PRESET_STACKS["Monospace"],
};

/**
 * What a chosen family falls back to for what it cannot draw.
 *
 * A picked face is rarely complete — a Latin display font has no CJK, a CJK face often has no
 * italic — and a family with no tail behind it hands those glyphs to Chromium's standard font,
 * which is not the font the rest of the product is set in. Falling back to the base stack keeps the
 * gaps looking like Studio's own face rather than like a third one.
 */
export const UI_FONT_FALLBACK_STACK = `var(${UI_FONT_BASE_VAR})`;

export function isUIFontPreset(value: unknown): value is UIFontFamilyPreset {
    return typeof value === "string" && (UI_FONT_FAMILY_PRESETS as readonly string[]).includes(value);
}

/**
 * The CSS `font-family` a stored preference resolves to.
 *
 * Anything unrecognised — an absent key on first run, a value from a build that had other presets —
 * lands on the default rather than on nothing, so no window is ever left with an empty family.
 */
export function uiFontCssFamily(value: unknown): string {
    if (isUIFontPreset(value)) {
        return UI_FONT_PRESET_STACKS[value];
    }
    const family = sanitizeFontFamilyName(value);
    if (family) {
        return `"${family}", ${UI_FONT_FALLBACK_STACK}`;
    }
    return UI_FONT_PRESET_STACKS[UI_FONT_FAMILY_DEFAULT];
}
