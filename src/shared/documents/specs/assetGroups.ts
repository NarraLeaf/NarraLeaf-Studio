import {compileDocumentPathPattern} from "../documentPath";
import {defineDocumentSpec} from "../registry";
import {isJsonObject, parameterFromPath, requireDocumentObject} from "./parseHelpers";

/**
 * `assets/assets.groups.<category>.json` - the folders one section of the asset browser is
 * organised into.
 *
 * A flat map keyed by folder id, where a folder names its parent rather than holding its children.
 * That shape is what makes two people making folders in the same section two independent additions:
 * nothing here is aligned by position, so nothing here can decide that two unrelated folders touched
 * the same thing. The same property the metadata shard beside it rests on.
 *
 * **Read-side only, exactly as `assets-metadata` is.** `GroupAssetsManager` still owns writing
 * (`JSON.stringify` with no indent, so an older Studio keeps reading the file byte for byte), and the
 * records it writes carry `parentGroupId: undefined` where a canonical encoder requires the key to be
 * absent. So `serialize` refuses rather than quietly producing bytes nothing writes and nothing
 * checks; adopting it is the assets service's own migration.
 *
 * **Why it has a spec at all**, when it went without one for so long: a live session now carries it,
 * and the write boundary is handed the paths a session leaves writable. Those paths must come from
 * the module that owns them rather than be spelled a second time next to the freeze - a path written
 * twice is a path that falls behind the one the service actually saves to, and this one decides
 * whether an author's folder is saved or silently discarded.
 *
 * The record type is structural for the reason the metadata shard's is: `AssetGroup` lives under
 * `renderer/lib` and cannot be imported here.
 */
export const ASSET_GROUPS_DOCUMENT_PATH = "assets/assets.groups.<category>.json";

const ASSET_GROUPS_PATTERN = compileDocumentPathPattern(ASSET_GROUPS_DOCUMENT_PATH);

/** One folder as it is on disk, read defensively. */
export interface AssetGroupEntry {
    readonly id?: unknown;
    readonly name?: unknown;
    /** The section this folder belongs to. Taken from the file name rather than trusted from here. */
    readonly category?: unknown;
    /** Absent for a folder at the section root. */
    readonly parentGroupId?: unknown;
    readonly createdAt?: unknown;
    readonly updatedAt?: unknown;
    readonly [key: string]: unknown;
}

export interface AssetGroupsShard {
    /** The section this shard holds, taken from the file name rather than from any field. */
    readonly category: string;
    readonly folders: Readonly<Record<string, AssetGroupEntry>>;
}

export const assetGroupsSpec = defineDocumentSpec<AssetGroupsShard>({
    kind: "assets-groups",
    // The shard has never carried a version field - it is a bare map - so there is no schema to
    // reject a future one by. Stated as 1 because the interface requires a number, and `parse`
    // accordingly gates on shape alone.
    version: 1,
    paths: [ASSET_GROUPS_DOCUMENT_PATH],
    parse: (raw, context) => {
        const category = parameterFromPath(ASSET_GROUPS_PATTERN, "category", context);
        const record = requireDocumentObject(raw, context, "an asset folder shard");
        const folders: Record<string, AssetGroupEntry> = {};
        for (const [id, entry] of Object.entries(record)) {
            // One malformed row must not cost the author every folder in the section - the reader
            // that owns this file skips those with a warning, and so does this.
            if (isJsonObject(entry)) {
                folders[id] = entry as AssetGroupEntry;
            }
        }
        return {category, folders};
    },
    /** Refused; see the note at the top of this module for what has to land before it can write. */
    serialize: () => {
        throw new Error(
            "The assets-groups spec is read-only in this build: GroupAssetsManager owns writing the "
            + "shard, and it assigns `undefined` where the canonical encoder requires the key to be "
            + "absent. Adopting it is the assets service's own migration.",
        );
    },
    summarize: shard => ({
        // No authored title: the shard is named by its section, which is Studio's vocabulary and
        // belongs in a translated label rather than in a field printed verbatim.
        title: "",
        counts: [{key: "folders", value: Object.keys(shard.folders).length}],
    }),
});
