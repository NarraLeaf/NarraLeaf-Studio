import { assetStorageIdFromContentPath } from "@shared/utils/assetStorageId";

/**
 * Keeping the identifiers Studio generates off the version-control surfaces.
 *
 * Nearly everything an author makes is stored under an id nobody chose: a story's folder is its
 * uuid, an asset's bytes sit under a shard of its id, a scene, a block, an element and a blueprint
 * are map keys that are uuids. Version control works from those addresses, and every place it used
 * to print one - a row's tooltip, the line above a detail, the path inside a document a change sits
 * at - put a uuid in front of an author who has no way to read it and nothing to do with it.
 *
 * The interface never shows one. The names that replace them are `documentName.ts`'s business;
 * this is the rule for the few places that print an ADDRESS rather than a name, and it has two
 * shapes because the two kinds of address fail differently:
 *
 *  - **A file's path is drawn only when nothing in it is generated.** `editor/variables.json` or an
 *    author's own `scripts/tools/build.js` is a location somebody can find. A path with an id in it
 *    is not one with part of it hidden - `editor/story/stories/…/storydoc.json` locates nothing an
 *    author can navigate to - so it is left out rather than drawn half-readable.
 *  - **A path inside a document keeps its shape and loses its ids.** `scenes / … / blocks / … /
 *    payload` still says the change is in a block of a scene, which is what that line is for; the
 *    ids in it said which ones, and the row it belongs to already says that by name.
 *
 * Detection is by shape, never by a list of fields: a uuid in either spelling, and a run of 32 or
 * more hex digits - which is a uuid with its hyphens dropped, a shard of one, or a content digest.
 * Short random ids (`p1oh`) and readable ones (`narraleaf-studio:main-surface`) are left alone; the
 * first says nothing but claims nothing either, and the second is a word.
 */

/** A uuid, hyphenated or not, or any run of 32+ hex digits. */
const IDENTIFIER_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32,}";
const ANY_IDENTIFIER = new RegExp(IDENTIFIER_SOURCE, "i");
const EVERY_IDENTIFIER = new RegExp(IDENTIFIER_SOURCE, "gi");

/** What an identifier is drawn as, where the shape around it is still worth drawing. */
export const ELIDED_IDENTIFIER = "…";

/** Whether a generated identifier appears anywhere in this text. */
export function containsGeneratedIdentifier(text: string): boolean {
    return ANY_IDENTIFIER.test(text);
}

/**
 * Text with every generated identifier in it drawn as {@link ELIDED_IDENTIFIER}.
 *
 * For values printed verbatim - a field of a record in a merge, the two sides of a changed value -
 * where the value itself is the author's and only the ids inside it are Studio's.
 */
export function elideGeneratedIdentifiers(text: string): string {
    return text.replace(EVERY_IDENTIFIER, ELIDED_IDENTIFIER);
}

/**
 * Where inside a document a change sits, as the line a tooltip draws, or undefined at the root.
 *
 * Every segment is drawn, and a segment that is an id is drawn as {@link ELIDED_IDENTIFIER}: the
 * structure is the useful half, and the ids were only ever a second, unreadable copy of what the
 * row names.
 */
export function readableChangePath(path: readonly (string | number)[]): string | undefined {
    if (path.length === 0) {
        return undefined;
    }
    return path.map(segment => elideGeneratedIdentifiers(String(segment))).join(" / ");
}

/**
 * A repository-relative path, when it is one an author could look for; otherwise null.
 *
 * Null for any path with a generated identifier in it, and for an asset's content file, whose two
 * directories are the first four digits of its id - a shard is a fragment of the id, and drawing a
 * fragment is drawing the id. Separators are normalised to `/` for the reason the naming layer does.
 */
export function readableStoragePath(path: string): string | null {
    const normalized = path.replace(/\\/g, "/");
    if (normalized.startsWith("assets/content/") || assetStorageIdFromContentPath(normalized) !== null) {
        return null;
    }
    return containsGeneratedIdentifier(normalized) ? null : normalized;
}
