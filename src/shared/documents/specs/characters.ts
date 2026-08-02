import {
    CHARACTER_STORE_VERSION,
    CharacterStoreDocument,
    isNewerCharacterStore,
    migrateCharacterStore,
} from "@shared/characters/characterStoreModel";
import type {CharacterGroup, StoredCharacter} from "@shared/types/character/model";
import {defineDocumentSpec} from "../registry";
import {diffCharacterStore} from "./charactersDiff";
import {isJsonObject, requireDocumentObject, requireOptionalMap} from "./parseHelpers";

/**
 * `editor/services/character.json` - the project's cast.
 *
 * Owned by the renderer's `CharacterService`, which reads and writes it through `loadDocument` /
 * `saveDocument` like the wave-1 services. It is the one file in `editor/services/` that is the
 * author's content rather than Studio's own state, which is what `@shared/vcs/serviceStores` decides
 * and why it stays in the versioned tree.
 *
 * **It did not move house to become a document.** The path is unchanged, the JSON is the same JSON,
 * and the only thing that changed on disk is the byte layout: `ServiceAssetsService.writeStore` used
 * `JSON.stringify` with no indent and no trailing newline, and this writes canonical JSON - sorted
 * keys, two-space indent, trailing newline. That is a one-time whole-file rewrite on the first save
 * after this build, and it is the point rather than a cost: unsorted keys mean a one-word edit lands
 * as a whole-file diff, which is exactly what a semantic diff of the cast cannot be built on top of.
 *
 * The store's version field is spelled `version`, not `schemaVersion`, so the shared
 * `rejectNewerSchema` does not apply and {@link isNewerCharacterStore} - the same predicate
 * `CharacterService` has always used - is what refuses a store from the future.
 */
export const CHARACTER_STORE_DOCUMENT_PATH = "editor/services/character.json";

export const charactersSpec = defineDocumentSpec<CharacterStoreDocument>({
    kind: "characters",
    version: CHARACTER_STORE_VERSION,
    paths: [CHARACTER_STORE_DOCUMENT_PATH],
    parse: (raw, context) => {
        const record = requireDocumentObject(raw, context, "a character store");

        // Before anything is read, let alone migrated. Migration is destructive by design for a kind
        // it does not recognise - `isCurrentAppearance` reads an unknown kind as the pre-rework model
        // and replaces the character with an empty preset - so on a store that may hold kinds from a
        // newer Studio the only safe move is to touch nothing. `CharacterService` shows such a store
        // read-only; here, where the caller may be a diff over a revision, it is corrupt: a document
        // this build cannot represent must never reach `serialize`.
        if (isNewerCharacterStore(record.version)) {
            return context.corrupt(
                `written by a newer version of Studio (store version ${String(record.version)}; `
                + `this build reads ${CHARACTER_STORE_VERSION})`,
            );
        }

        // `characters` absent is a store that has never held one, which is what an empty project's
        // file looks like. Present-but-not-an-array is not: every reader indexes it, and the value
        // that would be written back is whatever this parse invented.
        const characters = record.characters;
        if (characters !== undefined && !Array.isArray(characters)) {
            return context.corrupt(`"characters" must be an array, got ${describe(characters)}`);
        }
        requireOptionalMap(record, "groups", context);

        const entries = (characters ?? []) as unknown[];
        // The existing migration, called rather than reimplemented, and it mutates in place. It is
        // idempotent - a character already on the two-kind model is left alone - so parsing a
        // current document is a walk and nothing else.
        migrateCharacterStore(entries);

        const {version: _version, characters: _characters, groups: _groups, ...rest} = record;
        return {
            ...rest,
            version: CHARACTER_STORE_VERSION,
            characters: entries as StoredCharacter[],
            ...(record.groups === undefined ? {} : {groups: record.groups as Record<string, CharacterGroup>}),
        };
    },
    // No authored title: a project has one cast and the history UI labels it by kind. The two counts
    // are what the author would check a revision against - how many characters, how many groups.
    summarize: store => ({
        title: "",
        counts: [
            {key: "characters", value: Array.isArray(store.characters) ? store.characters.length : 0},
            {key: "characterGroups", value: isJsonObject(store.groups) ? Object.keys(store.groups).length : 0},
        ],
    }),
    diff: diffCharacterStore,
});

function describe(value: unknown): string {
    if (value === null) {
        return "null";
    }
    return Array.isArray(value) ? "an array" : `a ${typeof value}`;
}
