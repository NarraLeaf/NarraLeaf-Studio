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
 * name to its letters and digits so cosmetic punctuation differences never
 * break a link.
 *
 * "Letters and digits" is meant in the Unicode sense and that is not a detail.
 * The key used to be `[^a-z0-9]`, which deletes every CJK character - so with
 * the default `{scene}_{index}_{character}` pattern a Japanese project's
 * `序章_001_優希` and `第一章_001_優希` both reduced to `001`, collided, and were
 * dropped as ambiguous. Batch import matched *nothing* on any multi-scene
 * Japanese or Chinese project, which is most voiced projects. Names are also
 * NFKC-normalised, because a booth on macOS hands back decomposed filenames
 * that look identical and would not otherwise match.
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
const NON_ALNUM = /[^\p{L}\p{N}]+/gu;

/** Every pattern token, including the aliases the type's own field names imply. */
export const VOICE_NAME_TOKENS = ["scene", "index", "character", "locale", "unit", "unitId"] as const;

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
    const unit = sanitizeSegment(tokens.unitId);
    const values: Record<string, string> = {
        scene: sanitizeSegment(tokens.scene),
        index: String(Math.max(0, Math.trunc(tokens.index))).padStart(3, "0"),
        character: sanitizeSegment(tokens.character),
        locale: sanitizeSegment(tokens.locale),
        unit,
        // The token's own type field is `unitId`, and the documentation said so, while the formatter
        // only ever understood `{unit}` - so the spelling a reader would copy came out as the literal
        // text "{unitId}" in every filename. Both spell the same thing now.
        unitid: unit,
    };
    const replaced = pattern.replace(/\{(\w+)\}/g, (whole, token: string) => {
        const key = token.toLowerCase();
        return key in values ? values[key] : whole;
    });
    return normalizeRelativePath(replaced) || sanitizeSegment(tokens.unitId);
}

/**
 * The extensions a take can arrive with, lower-case and without the dot: what the voice import's
 * file picker offers, and the other audio formats a booth commonly hands back.
 */
export const VOICE_AUDIO_EXTENSIONS: readonly string[] = [
    "mp3", "wav", "ogg", "oga", "opus", "aac", "m4a", "flac", "weba",
    "webm", "aif", "aiff", "wma", "caf",
];

const AUDIO_EXTENSION = new RegExp(`\\.(?:${VOICE_AUDIO_EXTENSIONS.join("|")})$`, "i");

/** The last path segment, NFKC-normalised, lower-cased, and stripped to Unicode letters and digits. */
function reduceToMatchKey(name: string): string {
    const base = name.replace(/\\+/g, "/").split("/").pop() ?? name;
    return base.normalize("NFKC").toLowerCase().replace(NON_ALNUM, "");
}

/**
 * Reduce a line's expected name - {@link formatVoiceFilename}'s answer, which has no extension -
 * to the key a file is matched against.
 *
 * Nothing is dropped from it: a dot in an expected name is part of a name. A speaker called
 * `Ms. Hara` gives `…_Ms.Hara`, and reading `.Hara` as an extension made the line expect
 * `…_ms` and match no file at all.
 */
export function matchKeyForVoiceName(name: string): string {
    return reduceToMatchKey(name);
}

/**
 * Reduce a file name, or an audio asset's library name, to a stable match key: the basename with a
 * known audio extension dropped ({@link VOICE_AUDIO_EXTENSIONS}), NFKC-normalised, lower-cased, and
 * stripped to Unicode letters and digits, so spaces/underscores/dashes, full-width punctuation,
 * decomposed CJK and folder layout never affect matching. Compared against
 * {@link matchKeyForVoiceName} of the line's expected name.
 *
 * Only an audio extension is dropped. Any other dot is part of the name, which is what lets
 * `…_Ms.Hara.wav` match the line `…_Ms.Hara`.
 */
export function matchKeyForFilename(filename: string): string {
    const base = filename.replace(/\\+/g, "/").split("/").pop() ?? filename;
    return reduceToMatchKey(base.replace(AUDIO_EXTENSION, ""));
}
