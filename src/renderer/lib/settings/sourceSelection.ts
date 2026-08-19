/**
 * Which offered source a stored download address amounts to.
 *
 * Kept apart from the control that renders it because the mapping is the whole of the type's
 * behaviour and it is the part with edge cases: the official entry is stored as an empty string
 * (the "empty means official" convention `resolveDownloadSource` spells out), whitespace is not a
 * typed address, and anything else - including an address that used to be offered before the list
 * changed - has to keep showing what the author stored rather than being quietly rounded to the
 * nearest offered source.
 */

/**
 * The official source, as stored. Empty rather than the official URL written out, so the address
 * stays a single fact in the constants module and a settings file never pins yesterday's one.
 */
export const OFFICIAL_SOURCE_VALUE = "";

/**
 * The offered source a stored address equals, or `null` when the author typed their own.
 *
 * Compares trimmed on both sides for the same reason the readers do - a value with a stray space
 * is the address, not a different one.
 */
export function matchedSourcePreset(stored: string, presets: readonly string[]): string | null {
    const value = stored.trim();
    return presets.find(option => option.trim() === value) ?? null;
}

/**
 * Whether a stored address is one of the offered sources, i.e. whether the typed address is what
 * this setting is currently on.
 */
export function isPresetSource(stored: string, presets: readonly string[]): boolean {
    return matchedSourcePreset(stored, presets) !== null;
}
