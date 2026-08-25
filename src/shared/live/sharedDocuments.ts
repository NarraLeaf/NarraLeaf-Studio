import {
    assetGroupsSpec,
    assetsMetadataSpec,
    charactersSpec,
    localizationDocumentSpec,
    storyDocumentSpec,
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
 * reach the room sliced up beside the operation stream (`LiveBlobChunk`) or, far more often, are
 * already on every machine and are copied there - see `LiveAssetBytes`. The path is writable so that
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
 * **`editor/localization/keys.json` is NOT here**, and its absence is the invariant working. The
 * named-key registry is a document of its own with no verbs, so declaring a UI string stays frozen
 * for the length of a session and says so - which is the harmless half of the trade.
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
 * Every path a session leaves writable that no operation is ever about.
 *
 * Two kinds of file, and neither is a `LiveDocument`:
 *
 *  - **the asset payloads** (`assets/content/`), which are bytes an applier puts down rather than a
 *    document anybody addresses;
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
 * caller and why a session cannot be opened on "some of" it.
 */
export function liveSessionDocuments(
    storyIds: readonly StoryId[],
    locales: LiveSessionLocales = NO_LIVE_LOCALES,
    assetTypes: LiveSessionAssetTypes = NO_LIVE_ASSET_TYPES,
    assetCategories: LiveSessionAssetCategories = NO_LIVE_ASSET_CATEGORIES,
): readonly LiveDocument[] {
    return [
        ...storyIds.map((storyId): LiveDocument => ({ doc: "story", storyId })),
        { doc: "characters" },
        ...locales.translations.map((locale): LiveDocument => ({ doc: "localization", locale })),
        ...locales.voice.map((locale): LiveDocument => ({ doc: "voice", locale })),
        ...assetTypes.map((assetType): LiveDocument => ({ doc: "assets", assetType })),
        ...assetCategories.map((category): LiveDocument => ({ doc: "asset-groups", category })),
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
): readonly string[] {
    return [
        ...liveSessionDocuments(storyIds, locales, assetTypes, assetCategories).map(liveDocumentPath),
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
): boolean {
    return liveSessionDocuments(storyIds, locales, assetTypes, assetCategories)
        .some(carried => sameLiveDocument(carried, document));
}
