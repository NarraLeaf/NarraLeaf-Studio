/**
 * Recording-script filename convention for voice-over. The pattern is a plain
 * string with `{token}` placeholders, resolved per line into a filesystem-safe
 * relative path (folder separators in the pattern are preserved; separators
 * inside a token value are neutralised). It drives both the exported recording
 * script's `filename` column and the reverse match when audio is batch-imported.
 *
 * Filenames are for humans in the booth - they can drift when scenes are
 * renamed or lines reordered, and a booth may swap spaces for underscores. The
 * recording script always carries the line's authoritative unit id alongside,
 * and audio matching goes through {@link matchKeyForFilename}, which reduces a
 * name to alphanumerics so cosmetic punctuation differences never break a link.
 * Comments in English per project convention.
 */

export type VoiceNameTokens = {
    /** Scene display name. */
    scene: string;
    /** 1-based position among the voiceable lines of its scene. */
    index: number;
    /** Speaker display name (or the narration label). */
    character: string;
    /** Voice language code. */
    locale: string;
    /** Stable translation-unit id (story textId). */
    unitId: string;
};

const RESERVED_CHARS = /["|<>:?*]/g;
const SEPARATORS = /[\\/]+/g;
const WHITESPACE = /\s+/g;
const NON_ALNUM = /[^a-z0-9]+/g;

/** Reduce one token value to a safe, space-free path segment (no separators/reserved chars). */
function sanitizeSegment(value: string): string {
    const cleaned = value
        .replace(SEPARATORS, "")
        .replace(WHITESPACE, "")
        .replace(RESERVED_CHARS, "")
        .trim();
    return cleaned || "_";
}

/** Collapse and trim path separators produced by empty pattern segments. */
function normalizeRelativePath(path: string): string {
    return path
        .replace(/\\+/g, "/")
        .split("/")
        .map(segment => segment.trim())
        .filter(segment => segment.length > 0)
        .join("/");
}

/**
 * Resolve a naming pattern into a relative filename base (no extension). `{index}`
 * is zero-padded to three digits so lexical and numeric order agree. Unknown
 * tokens are left as literal text.
 */
export function formatVoiceFilename(pattern: string, tokens: VoiceNameTokens): string {
    const values: Record<string, string> = {
        scene: sanitizeSegment(tokens.scene),
        index: String(Math.max(0, Math.trunc(tokens.index))).padStart(3, "0"),
        character: sanitizeSegment(tokens.character),
        locale: sanitizeSegment(tokens.locale),
        unit: sanitizeSegment(tokens.unitId),
    };
    const replaced = pattern.replace(/\{(\w+)\}/g, (whole, token: string) => {
        const key = token.toLowerCase();
        return key in values ? values[key] : whole;
    });
    return normalizeRelativePath(replaced) || sanitizeSegment(tokens.unitId);
}

/**
 * Reduce a filename to a stable match key: the basename, extension dropped,
 * lower-cased, and stripped to alphanumerics. Applied to both a line's expected
 * filename and an imported audio file's name so spaces/underscores/dashes and
 * folder layout never affect matching.
 */
export function matchKeyForFilename(filename: string): string {
    const base = filename.replace(/\\+/g, "/").split("/").pop() ?? filename;
    const withoutExt = base.replace(/\.[^.]+$/, "");
    return withoutExt.toLowerCase().replace(NON_ALNUM, "");
}
