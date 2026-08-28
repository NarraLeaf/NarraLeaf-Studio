import {
    CharacterGroup,
    isCharacterAppearanceKind,
    StoredCharacter,
} from "@shared/types/character/model";

/**
 * `editor/services/character.json` as a whole - the project's cast, and the only thing in
 * `editor/services/` that is the author's content rather than Studio's own state (see
 * `@shared/vcs/serviceStores`).
 *
 * `characters` is an ARRAY rather than a map keyed by id, and that is load-bearing rather than
 * historical: the array order is the order the cast is listed in, which the author arranges. A map
 * would have to store that order somewhere else or lose it to the canonical encoder's key sort.
 */
export type CharacterStoreDocument = {
    /** Absent only on stores written before the appearance rework, which are no longer read. */
    version?: number;
    characters: StoredCharacter[];
    groups?: Record<string, CharacterGroup>;
};

/**
 * Bumped whenever the persisted character store changes shape. A store with no `version` predates
 * versioning and holds the form/group/variant model, which nothing reads any more.
 *
 * v1 → v2 added the `live2d` and `spine` appearance kinds. There is nothing to migrate *forward*:
 * every v1 store is a valid v2 store, and the bump exists entirely for the other direction. Reading
 * a store from the future is not a no-op here — {@link isCurrentAppearance} treats a kind it does not
 * recognise as the pre-rework model and rewrites it, so a Studio that has never heard of `live2d`
 * would silently replace those characters with empty presets. The version is what lets a reader
 * notice that before touching anything; see `isNewerCharacterStore`.
 */
export const CHARACTER_STORE_VERSION = 2 as const;

/**
 * Whether this store was written by a Studio newer than this one.
 *
 * A reader that answers yes must not migrate and must not write back. The kinds it is about to fail
 * to recognise are the author's data, and the destructive path is the *default* one — so the check
 * has to happen before `migrateCharacterStore`, not instead of trusting it.
 *
 * An absent version is not newer: that is the pre-versioning store, which is exactly what migration
 * is for.
 */
export function isNewerCharacterStore(version: unknown): boolean {
    return typeof version === "number" && Number.isFinite(version) && version > CHARACTER_STORE_VERSION;
}

/**
 * The name of the first character whose appearance this build cannot read, or `null`.
 *
 * A store used to be *migrated* here: the form/group/variant model was flattened into poses, and -
 * as the whole point of that pass - an appearance whose `kind` was not recognised was read as the
 * pre-rework model and replaced with an empty preset. That is destructive by design, and it was the
 * default path, which is why {@link isNewerCharacterStore} had to be consulted first.
 *
 * The migration is gone, and with it the reason to guess. An appearance whose kind this build does
 * not know is now named and the store refused, which is the answer that loses nothing: the two ways
 * one can turn up are a store from a newer Studio (already refused by version) and a file somebody
 * edited by hand, and in both cases the bytes are the author's and belong on disk untouched.
 */
export function findUnreadableCharacterAppearance(characters: readonly unknown[]): string | null {
    for (const entry of characters) {
        const profile = (entry as { profile?: { name?: unknown; appearance?: unknown } } | null)?.profile;
        if (!profile) {
            continue;
        }
        if (isCharacterAppearanceKind((profile.appearance as { kind?: unknown } | null)?.kind)) {
            continue;
        }
        return typeof profile.name === "string" && profile.name.trim() ? profile.name.trim() : "(unnamed)";
    }
    return null;
}
