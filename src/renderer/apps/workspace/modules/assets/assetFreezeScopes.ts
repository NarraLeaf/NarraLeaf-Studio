import { ASSET_CATEGORY_ORDER, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { assetGroupsSpec, assetSetsSpec, assetsMetadataSpec } from "@shared/documents/specs";
import { ASSET_PAYLOAD_ROOT } from "@shared/live/sharedDocuments";

/**
 * Everything the asset library writes, as the project-relative paths the freeze policy takes.
 *
 * **All of it rather than the part a panel is looking at**: "may I change the library" has one
 * answer. A guard scoped to a single type would ask a narrower question than the surface actually
 * poses - the panel's rename shortcut acts on a selection, which may be of any type, and a drop can
 * import, re-file a row and move a folder depending on what was dragged.
 *
 * Three kinds of path, and the third is the one worth naming:
 *
 *  - the **metadata shards**, one per asset type;
 *  - the **folder shards**, one per section, which are a different axis - a folder under Media holds
 *    audio and video alike;
 *  - the **payloads**, `assets/content`, which is where a file's bytes are. `freezeAllowsWrite` takes
 *    an entry as standing for everything under it, so this one directory covers every file.
 *
 * The first two come from their document specs rather than being spelled here, for the reason
 * `writeFreeze` gives: a path written a second time is a path that falls behind the one the service
 * actually saves to. The third has no spec because a payload is not a document anything parses.
 */
export function assetLibraryFreezeScope(): readonly string[] {
    return [
        ...Object.values(AssetType).map(type => assetsMetadataSpec.pathFor({ type })),
        ...ASSET_CATEGORY_ORDER.map(category => assetGroupsSpec.pathFor({ category })),
        ASSET_PAYLOAD_ROOT,
    ];
}

/**
 * Which file the asset set editors write, as the project-relative path the freeze policy takes.
 *
 * Its own scope beside {@link assetLibraryFreezeScope} because it is its own document: a set holds
 * no files, and everything about which files belong to one is read off the library's tags at the
 * moment it is resolved.
 */
export function assetSetDocumentFreezeScope(): string {
    return assetSetsSpec.pathFor();
}

/**
 * What a gesture on a set row has to be allowed to write: the declaration AND the library.
 *
 * Both, because the panel's set gestures reach both documents and a guard that asked about one
 * would answer for a control that writes the other. Making a set writes the tags that make its
 * members members; deleting one offers to delete their files; filing one moves the rows drawn
 * inside it. Only renaming stays inside the declaration, and there is no freeze in this build that
 * allows one of the two and not the other.
 */
export function assetSetFreezeScope(): readonly string[] {
    return [assetSetDocumentFreezeScope(), ...assetLibraryFreezeScope()];
}
