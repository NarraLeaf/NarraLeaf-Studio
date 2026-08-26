import {
    appTagsSpec,
    assetGroupsSpec,
    assetSetsSpec,
    assetsMetadataSpec,
    audioTracksSpec,
    brandSpec,
    charactersSpec,
    dictionarySpec,
    dlcSpec,
    localizationDocumentSpec,
    localizationKeysSpec,
    storyDocumentSpec,
    uiDocumentSpec,
    uiGraphsSpec,
    variableRegistrySpec,
    voiceDocumentSpec,
} from "@shared/documents/specs";
import type { StoryId } from "@shared/types/story";
import { sameLiveDocument, type LiveDocument } from "./ops";

/**
 * Which documents a live session carries, and where each of them lives on disk.
 *
 * **One table with two consumers, and that is the whole point of the file.** The write boundary asks
 * it which paths a session leaves writable (`WorkspaceFreezeReason` of kind `live-session`); the host
 * asks it whether an operation is about a document this session speaks for. Those two questions have
 * to have one answer: a path the boundary allows but the vocabulary cannot carry is an edit that
 * lands on one machine and nowhere else, with no digest over it and nothing anywhere reporting a
 * problem - the silent divergence the whole design is built to make impossible. A path the vocabulary
 * carries but the boundary refuses is the opposite and merely annoying: the operation travels, every
 * machine applies it, and every machine fails to save it.
 *
 * The shape is borrowed from `shared/vcs/workingSet`, which generates its predicate and its ignore
 * file from one table for the same reason, and says so in the same words: two representations of one
 * policy that MUST agree cannot be written down twice.
 *
 * **The invariant to keep when adding a document:**
 *
 * > A document is writable during a session exactly when the session can carry its changes.
 *
 * So a kind arrives here only once it has all three of the things a verb needs - an applier in its
 * owning service, a case in `LiveHost.plan`, and an inverse in `lib/live/inverse` - and until then
 * the boundary keeps refusing its writes. Which means forgetting to do the work costs a harmless
 * no-op and a visible notice, not a working tree with one machine's edits in it.
 *
 * **Every story document, not just the one the room is named after.** A session is *opened* on one
 * story, and that is still the only one anybody is expected to be editing - but deleting a character
 * rewrites the dialogue rows that spoke it wherever they are, and they are wherever the author put
 * them. A session that carried one story would have to refuse that gesture, and refusing it is worse
 * than it sounds: the alternative to rewriting those rows is leaving them pointing at a character
 * that no longer exists, which the compiler renders as "Unknown".
 *
 * So the set is every story, the cast, and one translation library and one voice library per
 * language - and the entries are `LiveDocument` **addresses** rather than document kinds. That
 * distinction goes on mattering for every parameterised kind: widening this to "every path of every
 * shared kind" would make a document writable while the host still refused operations about it,
 * which is an edit that lands on one machine and nowhere else with no digest over it.
 *
 * ⚠ **The languages are the ones a machine actually read, not the ones the project declares.** A
 * library that could not be loaded is one no operation can be applied to - appliers are synchronous,
 * so there is no later moment at which one could be fetched - and carrying it would be the same
 * silent divergence one step removed. The caller passes what it loaded; see `LiveLocalizationPort`.
 *
 * **The asset library joins them whole: its records, its folders and its files.** That last one is
 * the departure, and it is worth saying plainly because everything else here is a document the
 * repository stores and this is not: `assets/content/` is BYTES, and no operation carries them. They
 * reach the room over their own request to the server, beside the operation stream, or - far more
 * often - are already on every machine and are copied there; see `LiveAssetBytes`. The path is writable so that
 * an applier can put them down; nothing else writes there, because every gesture that would has been
 * turned into an operation.
 *
 * ⚠ **The row-order shard is here too, and it is the one entry no operation is about.**
 * `AssetsService.markDirty` queues it beside the metadata shard on every edit, and a session that
 * left it refused would announce work-not-saved on writes that are only the browser's row order
 * catching up with a creation. It is derived - every machine recomputes it from the records and
 * folders it has just applied - and it is deliberately NOT a `LiveDocument`, so no message can be
 * addressed to it.
 *
 * **Three small project tables join them, and they need nothing from the caller.** The dictionary,
 * the mixer and the asset sets are one document each per project, exactly as the cast is, so their
 * addresses are the kind alone. They are here because a session was ruled to be something an author
 * leaves open: adding a term the spellchecker keeps underlining, or nudging a bus that is too loud,
 * is a small thing to want in the middle of writing, and a control that is grey for the length of an
 * afternoon is a control the author works around.
 *
 * **The two project-level registries join them last**: the variable registry (`editor/variables.json`)
 * and the named-string registry (`editor/localization/keys.json`). Both are one per project, so
 * neither is parameterised - and both are carried only when this machine could actually READ them,
 * for the reason a language's library is: an applier is synchronous, so a registry that is not in
 * memory when the session starts is one no effect can ever reach, and carrying it would leave the
 * boundary allowing writes the host refuses.
 *
 * **The three configuration tables joined next**: the build variants, the DLC list and the palette.
 * They are unparameterised, like the cast - one of each per project - and they are here because a
 * session that is meant to stay open all day cannot be one an author has to end in order to add a
 * variant or move the brand colour.
 *
 * ⚠ **Two configuration documents were considered and are deliberately NOT here**, and their absence
 * is the same invariant working:
 *
 *  - **`editor/save-schema.json`.** Its only editing surface is the popover on a `Save Game` /
 *    `Get Save Metadata` node card, which is inside the blueprint editor - a document no session
 *    carries - and its undo rides the blueprint history channel, where `LocalBlueprintService`
 *    snapshots the graph and the schema together. Sharing the schema alone would give an author a
 *    Ctrl+Z that also restores a frozen document. It arrives when the blueprints do.
 *  - **`<projectName>.nlproj`.** Four independent reasons, and the first is enough on its own:
 *    writability is decided by PATH, so the whole file is shared or none of it is, and its writers
 *    are every group of the project's settings rather than one panel. Beyond that, some of what it
 *    holds is deliberately local to a machine (a signing credential is an id into
 *    `<userData>/signing/`, and the selected build variant is a preference); some of it decides which
 *    documents a session carries at all (the language list, the plugin list), which is settled when
 *    the room opens; and renaming the project renames the file, so the writable path would move
 *    mid-session. Its spec refuses to serialize for a related reason - see `specs/project`.
 *
 * ⚠ **`variables.json` being writable does not mean every gesture on it travels.** Removing a
 * variable also clears the params of every blueprint node that named it, which is a write to
 * `editor/ui/uigraphs.json` - a document this table does not carry - so the vocabulary has no verb
 * for it and `VariableRegistryService` refuses the gesture for as long as a sink is installed. That
 * is the same shape the asset library is already in, and it is the safe half of the invariant: the
 * owning service stops what cannot travel, rather than the write boundary allowing an edit that
 * would land on one machine and nowhere else.
 *
 * ⚠ **The Gallery's catalog is not here, and it is the harmless half of the trade for a sharp
 * reason.** It lives in a plugin store (`editor/services/narraleaf.gallery.items.json`) and the only
 * seam Studio owns is `storage.writeJson`, which is handed the whole catalog. The finest thing that
 * can be stated at the one point every gallery edit passes through is therefore "here is the new
 * file" - whole-document last-writer-wins, the one verb this vocabulary refuses. Sharing it needs
 * the plugin storage API to grow a vocabulary of its own, which is a change to what plugins can say
 * rather than to what a session carries.
 */

/** The languages a session carries libraries for. Two lists, because the two are configured apart. */
export type LiveSessionLocales = {
    /** Languages whose translations this machine holds. */
    translations: readonly string[];
    /** Languages whose voice takes this machine holds. */
    voice: readonly string[];
};

/** No libraries at all - what a caller that has not read any passes. */
export const NO_LIVE_LOCALES: LiveSessionLocales = { translations: [], voice: [] };

/**
 * The asset metadata shards a session carries, named by asset type.
 *
 * Strings rather than the renderer's `AssetType` enum, which lives under `renderer/lib` and cannot be
 * imported here - the same reason the document spec that owns the path is structural about its
 * records. Passed in by the caller for {@link LiveSessionLocales}' reason: what a machine holds is
 * what it managed to read, and a shard nothing loaded is one no operation can be applied to.
 */
export type LiveSessionAssetTypes = readonly string[];

/** No asset shards at all - what a caller with no asset library open passes. */
export const NO_LIVE_ASSET_TYPES: LiveSessionAssetTypes = [];

/**
 * The sections whose folders a session carries.
 *
 * Beside the types rather than derived from them, because the two are different axes: a section holds
 * one or two types, and which is which is the asset browser's table rather than this module's. The
 * caller passes both.
 */
export type LiveSessionAssetCategories = readonly string[];

/** No folder shards at all. */
export const NO_LIVE_ASSET_CATEGORIES: LiveSessionAssetCategories = [];

/**
 * Whether a session carries the interface and its blueprints.
 *
 * A boolean rather than a list, because both are one document per project - `{ doc: "ui" }` and
 * `{ doc: "ui-graphs" }` are whole addresses the way the cast's is. Passed in for
 * {@link LiveSessionLocales}' reason all the same: what a machine holds is what it managed to read,
 * and a document nothing loaded is one no operation can be applied to.
 *
 * ⚠ **The two travel together and there is no shape in which one is carried without the other.**
 * They are one editing surface pretending to be two files: adding a widget to a Surface writes
 * `uidoc.json` and then reconciles a private blueprint for it in `uigraphs.json`, in the same
 * synchronous step. Carrying the interface alone would announce work-not-saved on every element
 * anybody added; carrying the blueprints alone would be a canvas whose owners never appear.
 */
export type LiveSessionInterface = {
    /** `editor/ui/uidoc.json` and `editor/ui/uigraphs.json`, both or neither. */
    carried: boolean;
};

/** Neither interface document - what a caller that has not read them passes. */
export const NO_LIVE_INTERFACE: LiveSessionInterface = { carried: false };

/**
 * Which of the two project-level registries this machine holds.
 *
 * Booleans rather than a list, because neither is parameterised: there is one variable registry and
 * one named-string registry per project, so the whole question is whether this machine read it.
 * Passed in for {@link LiveSessionLocales}' reason - a document nothing loaded is one no operation
 * can be applied to, and carrying it would make it writable while the host refused every operation
 * about it.
 */
export type LiveSessionRegistries = {
    /** Whether this machine holds `editor/variables.json`. */
    variables: boolean;
    /** Whether this machine holds `editor/localization/keys.json`. */
    localizationKeys: boolean;
};

/** Neither registry - what a caller that has read neither passes. */
export const NO_LIVE_REGISTRIES: LiveSessionRegistries = { variables: false, localizationKeys: false };

/**
 * Every path a session leaves writable that no operation is ever about.
 *
 * Two kinds of file, and neither is a `LiveDocument`:
 *
 *  - **the asset payloads** (`assets/content/`), which are bytes an applier puts down rather than a
 *    document anybody addresses
/**
 *  - **the row-order shards**, which every machine recomputes from what it has just applied.
 *
 * ⚠ Held apart from {@link liveSessionDocuments} on purpose. The invariant that file states is about
 * documents the vocabulary can carry, and widening it to cover these would make "writable" and
 * "addressable" the same set again - which is exactly how a path becomes writable while the host
 * refuses every operation about it.
 */
function liveSessionDerivedPaths(assetCategories: LiveSessionAssetCategories): readonly string[] {
    if (assetCategories.length === 0) {
        return [];
    }
    return [
        ASSET_PAYLOAD_ROOT,
        ...assetCategories.map(category => ASSET_ORDER_PATH_FOR(category)),
    ];
}

/**
 * Where an asset's bytes live, as a directory the write boundary matches by prefix.
 *
 * ⚠ **The one path in this module not taken from a document spec, because there is no document
 * there.** A payload is not a format anything parses - it is a png, an mp3, a directory of a model's
 * files - so the registry has nothing to say about it and never will. Spelled once, beside the reason
 * it is needed, and pinned to `ProjectNameConvention.AssetsContent` by a test.
 */
export const ASSET_PAYLOAD_ROOT = "assets/content";

/** The row-order shard of one section. Pinned to `ProjectNameConvention.AssetsOrderShard` by a test. */
const ASSET_ORDER_PATH_FOR = (category: string): string => `assets/assets.order.${category}.json`;

/**
 * The documents a session carries: every story in the project, the cast, and each language's two
 * libraries.
 *
 * The cast is not parameterised - there is one per project - which is why it needs nothing from the
 * caller and why a session cannot be opened on "some of" it. The dictionary, the mixer and the asset
 * sets are the same shape, and are here for the same reason.
 */
export function liveSessionDocuments(
    storyIds: readonly StoryId[],
    locales: LiveSessionLocales = NO_LIVE_LOCALES,
    assetTypes: LiveSessionAssetTypes = NO_LIVE_ASSET_TYPES,
    assetCategories: LiveSessionAssetCategories = NO_LIVE_ASSET_CATEGORIES,
    ui: LiveSessionInterface = NO_LIVE_INTERFACE,
    registries: LiveSessionRegistries = NO_LIVE_REGISTRIES,
): readonly LiveDocument[] {
    return [
        ...storyIds.map((storyId): LiveDocument => ({ doc: "story", storyId })),
        { doc: "characters" },
        ...locales.translations.map((locale): LiveDocument => ({ doc: "localization", locale })),
        ...locales.voice.map((locale): LiveDocument => ({ doc: "voice", locale })),
        ...assetTypes.map((assetType): LiveDocument => ({ doc: "assets", assetType })),
        ...assetCategories.map((category): LiveDocument => ({ doc: "asset-groups", category })),
        // The three configuration tables, unparameterised for the cast's reason: there is one of each
        // per project, so a session either carries it or the window is not in a session. They need
        // nothing from the caller for the same reason.
        { doc: "app-tags" },
        { doc: "dlc" },
        { doc: "brand" },
        // Both or neither. See {@link LiveSessionInterface}: the interface and its blueprints are
        // one editing surface written to two files, and a session that carried one of them would
        // refuse the writes the other one makes on its behalf.
        ...(ui.carried ? ([{ doc: "ui" }, { doc: "ui-graphs" }] as LiveDocument[]) : []),
        // Unparameterised with the cast: one of each per project, so there is nothing to expand and
        // nothing a caller could get wrong about which of them a session carries.
        { doc: "dictionary" },
        { doc: "audio-tracks" },
        { doc: "asset-sets" },
        ...(registries.variables ? [{ doc: "variables" } as const] : []),
        ...(registries.localizationKeys ? [{ doc: "localization-keys" } as const] : []),
    ];
}

/**
 * Where one shared document lives, as the project-relative path the freeze policy takes.
 *
 * Derived from each document's own spec rather than assembled here, for the reason `writeFreeze`
 * gives for naming its derived libraries by kind: a path spelled a second time is a path that falls
 * behind the one the owning service actually saves to, and this one is compared against the set a
 * live session declares writable. A document that moves house takes this with it.
 */
export function liveDocumentPath(document: LiveDocument): string {
    switch (document.doc) {
        case "story":
            return storyDocumentSpec.pathFor({ storyId: document.storyId });
        case "characters":
            return charactersSpec.pathFor();
        case "localization":
            return localizationDocumentSpec.pathFor({ locale: document.locale });
        case "voice":
            return voiceDocumentSpec.pathFor({ locale: document.locale });
        case "assets":
            return assetsMetadataSpec.pathFor({ type: document.assetType });
        case "asset-groups":
            return assetGroupsSpec.pathFor({ category: document.category });
        case "app-tags":
            return appTagsSpec.pathFor();
        case "dlc":
            return dlcSpec.pathFor();
        case "brand":
            return brandSpec.pathFor();
        case "ui":
            return uiDocumentSpec.pathFor();
        case "ui-graphs":
            return uiGraphsSpec.pathFor();
        case "dictionary":
            return dictionarySpec.pathFor();
        case "audio-tracks":
            return audioTracksSpec.pathFor();
        case "asset-sets":
            return assetSetsSpec.pathFor();
        case "variables":
            return variableRegistrySpec.pathFor();
        case "localization-keys":
            return localizationKeysSpec.pathFor();
    }
}

/**
 * Every path a session over these documents leaves writable.
 *
 * What `WorkspaceFreezeReason`'s `writable` is built from. Nothing else may build it: a caller that
 * assembled the list itself would be the second representation this file exists to prevent.
 */
export function liveSessionWritablePaths(
    storyIds: readonly StoryId[],
    locales: LiveSessionLocales = NO_LIVE_LOCALES,
    assetTypes: LiveSessionAssetTypes = NO_LIVE_ASSET_TYPES,
    assetCategories: LiveSessionAssetCategories = NO_LIVE_ASSET_CATEGORIES,
    ui: LiveSessionInterface = NO_LIVE_INTERFACE,
    registries: LiveSessionRegistries = NO_LIVE_REGISTRIES,
): readonly string[] {
    return [
        ...liveSessionDocuments(storyIds, locales, assetTypes, assetCategories, ui, registries).map(liveDocumentPath),
        ...liveSessionDerivedPaths(assetCategories),
    ];
}

/**
 * Whether a session over these documents carries this one.
 *
 * The host's half of the same table. Every parameterised kind is compared against the set rather
 * than assumed, because a document created *during* a session is in nobody else's copy - the room
 * agreed a revision on the way in, and a document that was not in it is one the others cannot apply
 * an operation to.
 */
export function liveSessionCarries(
    storyIds: readonly StoryId[],
    document: LiveDocument,
    locales: LiveSessionLocales = NO_LIVE_LOCALES,
    assetTypes: LiveSessionAssetTypes = NO_LIVE_ASSET_TYPES,
    assetCategories: LiveSessionAssetCategories = NO_LIVE_ASSET_CATEGORIES,
    ui: LiveSessionInterface = NO_LIVE_INTERFACE,
    registries: LiveSessionRegistries = NO_LIVE_REGISTRIES,
): boolean {
    return liveSessionDocuments(storyIds, locales, assetTypes, assetCategories, ui, registries)
        .some(carried => sameLiveDocument(carried, document));
}
