/**
 * Dictionary registry constants.
 *
 * The registry is a generated `index.json` naming one gzipped word list per language. Studio
 * fetches it read-only; the bytes come from the per-entry `download` URL the index itself carries,
 * never from a renderer-supplied address, and never from Chromium's own dictionary host.
 */

/** Official index. Empty setting = this. */
export const DEFAULT_SPELLCHECK_REGISTRY_URL =
    "https://raw.githubusercontent.com/NarraLeaf/Dictionaries/master/index.json";

/** The only `formatVersion` this client knows how to read; a newer index is refused. */
export const SPELLCHECK_REGISTRY_FORMAT_VERSION = 1;

/** Abort an index / dictionary request that stalls past this. */
export const SPELLCHECK_REGISTRY_FETCH_TIMEOUT_MS = 15_000;

/**
 * Refuse a dictionary larger than this, before writing anything to disk.
 *
 * A gzipped word list of 200k entries is around 700 KB; 16 MB leaves room for a very large
 * agglutinative language and still stops a hostile index handing the cache an arbitrary blob.
 */
export const SPELLCHECK_MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024;

/**
 * Refuse a word list that expands past this, before it is parsed.
 *
 * The compressed cap alone is not enough: gzip of a repeated word compresses at better than
 * 1000:1, so a 16 MB file could otherwise expand to gigabytes in memory.
 */
export const SPELLCHECK_MAX_EXPANDED_BYTES = 128 * 1024 * 1024;

/**
 * A dictionary code as it may appear in a path.
 *
 * The code names a file in the cache directory, so it is validated before it is joined to
 * anything - a code out of the index is remote input, and `../../` is a valid string.
 */
export const SPELLCHECK_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
