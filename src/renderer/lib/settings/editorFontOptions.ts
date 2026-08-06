/**
 * Single source of truth for the Story editor font preference.
 *
 * Shared between the settings registry (`appSettings.ts`), the control that edits it
 * (`SettingFontPicker.tsx`) and the consumer that applies it to the scene editor
 * (`storyEditorTextStyle.tsx`), so a stored value can never mean two different things in two places.
 */

/**
 * The presets — stacks rather than one named typeface, so they answer "which KIND of face" without
 * depending on a file being installed.
 *
 * These four are also the whole history of this setting: they are the literal strings older
 * `global.json` files hold, so they stay as their own stored ids forever. Display labels are
 * localized separately (`settings.items.editorFontFamily.options.*`).
 */
export const EDITOR_FONT_FAMILY_PRESETS = ["Default", "Sans Serif", "Serif", "Monospace"] as const;

export type EditorFontFamilyPreset = typeof EDITOR_FONT_FAMILY_PRESETS[number];

/**
 * What a stored value may be: one of the presets above, or the name of a font family installed on
 * this computer. There is no third form — the picker stores the family name Chromium reports, which
 * is exactly what CSS `font-family` takes.
 */
export type EditorFontFamilyValue = EditorFontFamilyPreset | (string & {});

export const EDITOR_FONT_SIZE_MIN = 8;
export const EDITOR_FONT_SIZE_MAX = 48;
export const EDITOR_FONT_SIZE_DEFAULT = 14;
export const EDITOR_FONT_FAMILY_DEFAULT: EditorFontFamilyPreset = "Default";

/**
 * Preset id -> CSS font-family stack. "Default" inherits the surrounding Studio UI font (the app
 * bundles no dedicated editor typeface, so inheriting is the honest baseline).
 */
export const EDITOR_FONT_PRESET_STACKS: Record<EditorFontFamilyPreset, string> = {
    "Default": "inherit",
    "Sans Serif": "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif",
    "Serif": "ui-serif, Georgia, \"Times New Roman\", serif",
    "Monospace": "ui-monospace, \"SF Mono\", \"Cascadia Code\", \"Fira Code\", Menlo, monospace",
};

/**
 * What a chosen family falls back to for what it cannot draw.
 *
 * A picked face is rarely complete — a Latin display font has no CJK, a CJK face often has no
 * italic — and a family with no tail behind it hands those glyphs to Chromium's standard font,
 * which is not the font the rest of Studio is set in. The UI stack keeps the gaps looking like the
 * app instead. Deliberately not `inherit`: that is only legal as the whole value, not as a tail.
 */
export const EDITOR_FONT_FALLBACK_STACK = EDITOR_FONT_PRESET_STACKS["Sans Serif"];

export function isEditorFontPreset(value: unknown): value is EditorFontFamilyPreset {
    return typeof value === "string" && (EDITOR_FONT_FAMILY_PRESETS as readonly string[]).includes(value);
}

/**
 * A family name reduced to something safe to drop into a CSS `font-family` value.
 *
 * The name reaches us from `queryLocalFonts()` (or from a hand-edited `global.json`) and is quoted
 * into a style string, so the quote characters and the CSS punctuation that could end the
 * declaration are stripped rather than escaped — no real family name contains any of them, and a
 * mangled name simply fails to match a font, which is the same outcome as a typo.
 *
 * Returns "" for anything that is not usable as a name at all.
 */
export function sanitizeFontFamilyName(value: unknown): string {
    if (typeof value !== "string") {
        return "";
    }
    return value
        .replace(/["'\\;{}()<>]/g, " ")
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
}

/**
 * The CSS `font-family` a stored preference resolves to.
 *
 * Anything unrecognised — an absent key on first run, a value from a build that had other presets —
 * lands on the default rather than on nothing, so the editor is never left with an empty family.
 */
export function editorFontCssFamily(value: unknown): string {
    if (isEditorFontPreset(value)) {
        return EDITOR_FONT_PRESET_STACKS[value];
    }
    const family = sanitizeFontFamilyName(value);
    if (family) {
        return `"${family}", ${EDITOR_FONT_FALLBACK_STACK}`;
    }
    return EDITOR_FONT_PRESET_STACKS[EDITOR_FONT_FAMILY_DEFAULT];
}
