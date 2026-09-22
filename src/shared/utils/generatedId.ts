/**
 * Ids Studio mints - UUIDs, and the 64-character content digests legacy assets are addressed by - as
 * opposed to anything an author typed.
 *
 * The interface never shows one (they name nothing an author can find), so a sentence built from
 * whatever a document stored has to check a value before quoting it: a stage key falls back to a
 * character id, a sound handle to an asset id, a surface to its own id. This is that check, and the
 * one the guard tests over author-facing messages run.
 */

const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** A UUID with its hyphens dropped is 32 hex characters, a content digest 64; either is a run of 32+. */
const HEX_RUN_ANYWHERE = /(?:^|[^0-9a-z])[0-9a-f]{32,}(?:$|[^0-9a-z])/i;

/** Whether `text` contains a generated id anywhere in it. */
export function containsGeneratedId(text: string): boolean {
    return UUID_ANYWHERE.test(text) || HEX_RUN_ANYWHERE.test(text);
}

/**
 * `value` when it is something an author could have written, otherwise null: empty, blank, or
 * carrying a generated id. The caller supplies the wording for "unnamed".
 */
export function authoredNameOrNull(value: string | null | undefined): string | null {
    const trimmed = value?.trim() ?? "";
    if (!trimmed || containsGeneratedId(trimmed)) {
        return null;
    }
    return trimmed;
}
