import {registerDocumentSpec} from "../registry";
import {AnyDocumentSpec} from "../types";
import {assetsMetadataSpec} from "./assetsMetadata";
import {audioTracksSpec} from "./audioTracks";
import {charactersSpec} from "./characters";
import {localizationDocumentSpec} from "./localization";
import {localizationKeysSpec} from "./localizationKeys";
import {storyDocumentSpec} from "./story";
import {variableRegistrySpec} from "./variables";
import {voiceDocumentSpec} from "./voice";

export {AUDIO_TRACKS_DOCUMENT_PATH, audioTracksSpec} from "./audioTracks";
export {VARIABLE_REGISTRY_DOCUMENT_PATH, variableRegistrySpec} from "./variables";
export {VOICE_DOCUMENT_PATH, voiceDocumentSpec} from "./voice";
export {LOCALIZATION_DOCUMENT_PATH, localizationDocumentSpec} from "./localization";
export {LOCALIZATION_KEYS_DOCUMENT_PATH, localizationKeysSpec} from "./localizationKeys";
export {CHARACTER_STORE_DOCUMENT_PATH, charactersSpec} from "./characters";
export {STORY_DOCUMENT_PATH, storyDocumentSpec} from "./story";
export {
    ASSETS_METADATA_DOCUMENT_PATH,
    assetsMetadataSpec,
    type AssetMetadataEntry,
    type AssetsMetadataShard,
} from "./assetsMetadata";

/**
 * The document formats Studio can read, and the one place they are registered.
 *
 * Registering is what lets version control answer "what is this changed file?" from a path alone,
 * with no renderer service in the picture. Wave 2 adds the remaining kinds here; the list is
 * deliberately the only thing a new spec has to be added to.
 *
 * Not every spec here is adopted to the same degree, and the difference is worth knowing before
 * reaching for one. The first five are read AND written through their spec by the service that owns
 * them, and `characters` joined them (`CharacterService`). `story` and `assets-metadata` are
 * **read-side only**: they exist so version control can diff the two biggest things in a project,
 * their `parse` is a shape gate rather than a migration, and their `serialize` throws by design.
 * Each says so in its own module.
 */
export const PROJECT_DOCUMENT_SPECS: readonly AnyDocumentSpec[] = [
    audioTracksSpec,
    variableRegistrySpec,
    voiceDocumentSpec,
    localizationDocumentSpec,
    localizationKeysSpec,
    charactersSpec,
    storyDocumentSpec,
    assetsMetadataSpec,
];

// Registration happens on import rather than behind a call, so no consumer can reach the registry
// before it is populated and get a silent `undefined` back. It is safe to leave unguarded because a
// module is evaluated once per process: a second registration of the same kind would mean two
// instances of this module, which is a bundler fault worth failing loudly on rather than papering
// over. Import it as `@shared/documents/specs` everywhere so that stays true.
for (const spec of PROJECT_DOCUMENT_SPECS) {
    registerDocumentSpec(spec);
}
