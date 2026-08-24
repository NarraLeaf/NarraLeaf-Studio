import type { DocumentChange, DocumentDiffEntry } from "@shared/documents/diff";
import type { TranslationKey } from "@shared/i18n";
import { assetStorageIdFromContentPath, isValidAssetStorageId } from "@shared/utils/assetStorageId";
import { isWholeDocumentChange } from "./documentChangeView";

/**
 * One asset is one line, however many files it is stored in.
 *
 * An asset in a project is two files that have nothing to do with each other on paper. Its authored
 * metadata - the name, the tags, the digest of its bytes - is one record inside
 * `assets/assets.metadata.<type>.json`; its bytes are content-addressed, sharded two levels deep and
 * carry no extension, so they live at `assets/content/99/55/3d15abb…`. Replace one background and
 * the comparison reports two rows in the same group: a text row carrying the name, and a bitmap row
 * whose title is a hex string. Neither one is enough on its own, and nothing on either says they are
 * the same asset.
 *
 * This is the pre-pass that puts them back together, and it is **presentation only**. Nothing here
 * is written down, sent over IPC or handed to a merge: the producer still reports the two files it
 * really compared, the resolve panel still addresses a decision by document path, and this module
 * decides only what the index draws. That is the whole reason the join can be arithmetic on a path
 * (`assetStorageIdFromContentPath`) rather than a new address that `diff`, `merge3` and the resolve
 * panel would all have to agree on.
 *
 * **Nothing is hidden.** A content file the walk cannot pair with a record - a real state after a
 * bad merge, and the state a truncated comparison leaves behind - keeps its own line and says what
 * it is. Dropping it would make the one case where the join is wrong the one case nobody can see.
 */

/**
 * One line of the index before it has been grouped.
 *
 * Either a whole document, as the comparison reported it, or one asset out of a metadata shard with
 * the file holding its bytes attached. The second kind is why {@link key} exists: several units can
 * come out of one shard, so they share a path and the path can no longer be the selection handle.
 */
export interface ChangeIndexUnit {
    /**
     * What the selection is on, unique within one comparison.
     *
     * **A React handle and nothing else.** It is not an address, it is never persisted, and no
     * producer, merger or resolver sees it - those all address a document by its path, which is
     * what {@link entry} still carries unchanged.
     */
    readonly key: string;
    /** The document this line came out of. Its path is still the row's path. */
    readonly entry: DocumentDiffEntry;
    /**
     * The one record inside {@link entry} this line stands for, when the line is an asset.
     *
     * Absent for an ordinary document, where the line stands for the whole file. Present, the
     * detail pane scopes itself to this change rather than drawing the whole shard - which is what
     * keeps a project's three hundred assets from all reading the same.
     */
    readonly change?: DocumentChange;
    /** The file holding this asset's bytes, when the comparison carries one. */
    readonly member?: DocumentDiffEntry;
    /** The name the author gave this asset. Absent means the row is named by its file. */
    readonly name?: string;
    /** What to call a file whose own name says nothing. See {@link ORPHAN_CONTENT_NAME_KEY}. */
    readonly nameKey?: TranslationKey;
}

/**
 * What a content file with no asset record is called.
 *
 * Its file name is the shard of an id, so there is nothing to draw from the path, and the honest
 * answer is what the state is rather than what the comparison did to look for it.
 */
export const ORPHAN_CONTENT_NAME_KEY = "documentDiff.assets.orphanContent" as TranslationKey;

/** Where an `assets-metadata` change list keys its records. See `specs/assetsMetadata.ts`. */
const ASSET_RECORD_SEGMENT = "assets";

/**
 * Fold each asset's two files into one line, in arrival order.
 *
 * The order is the main process's - conflicts first, then path ascending - and the fold keeps it: a
 * shard's records take the shard's own position, and an unpaired content file stays where it was.
 * Nothing here sorts, because the budget is spent on this list and a sort would decide which files
 * a large comparison lists.
 */
export interface JoinAssetOptions {
    /**
     * Whether the comparison listed every document that changed.
     *
     * The one thing the join cannot work out for itself, and the thing the orphan label depends on.
     * A content file with no record beside it means "the record is gone" only if the records were
     * read at all; if the shard naming this asset was dropped at the unit budget, the same row means
     * "nobody looked", and the two are indistinguishable from the entries alone - a shard that was
     * never listed and a shard that never changed arrive as the same absence.
     *
     * False suppresses the label rather than guessing at it. A caveat elsewhere on the screen does
     * not make a false row true, and the row without the label is exactly what an author saw before
     * the fold existed.
     */
    readonly complete: boolean;
}

export function joinAssetEntries(
    entries: readonly DocumentDiffEntry[],
    options: JoinAssetOptions,
): ChangeIndexUnit[] {
    const contentById = new Map<string, DocumentDiffEntry>();
    for (const entry of entries) {
        const id = assetStorageIdFromContentPath(entry.path);
        // First wins: two entries cannot honestly recover one id, and a later one overwriting the
        // earlier would make which file is drawn depend on the order the comparison arrived in.
        if (id !== null && !contentById.has(id)) {
            contentById.set(id, entry);
        }
    }

    // Which records exist has to be settled before anything is emitted, because a content file may
    // arrive before the shard that names it - `assets/assets.metadata.image.json` sorts after
    // `assets/content/…` - and a file that IS paired must not be listed on its own.
    const recordsByPath = new Map<string, readonly AssetRecord[]>();
    const paired = new Set<string>();
    /**
     * Whether some shard's records could not be read one by one - it was added or removed whole, or
     * compared below the semantic tier, or cut short at the budget.
     *
     * One of the three things {@link JoinAssetOptions.complete} is weighed with: with a shard left
     * whole, the record naming an unpaired file may well be inside that shard, and "no asset record"
     * would be a statement about this pass rather than about the project.
     */
    let shardLeftWhole = false;
    for (const entry of entries) {
        if (entry.documentKind !== "assets-metadata") {
            continue;
        }
        const records = assetRecordsOf(entry);
        if (records.length === 0) {
            shardLeftWhole = true;
            continue;
        }
        recordsByPath.set(entry.path, records);
        for (const record of records) {
            const member = contentFor(record.key, contentById);
            if (member) {
                paired.add(member.path);
            }
        }
    }

    /**
     * Whether "no asset record" is a claim this pass is entitled to make.
     *
     * Three conditions, and each one is a way of not having looked. The comparison must have listed
     * every document that changed, or a shard may simply be missing from it. No shard may have been
     * left whole, or the record may be inside one that was not read record by record. And at least
     * one shard must have been read, because a comparison carrying no metadata at all is not
     * evidence about metadata - which is the state a comparison of nothing but contents is in.
     */
    const recordsWereRead = options.complete && !shardLeftWhole && recordsByPath.size > 0;

    const units: ChangeIndexUnit[] = [];
    for (const entry of entries) {
        const records = recordsByPath.get(entry.path);
        if (records) {
            for (const record of records) {
                const member = contentFor(record.key, contentById);
                units.push({
                    key: `asset:${entry.path}|${record.key}`,
                    entry,
                    change: record.change,
                    ...(member ? { member } : {}),
                    ...(record.change.subject ? { name: record.change.subject } : {}),
                });
            }
            continue;
        }

        if (assetStorageIdFromContentPath(entry.path) !== null) {
            if (paired.has(entry.path)) {
                continue;
            }
            units.push({
                key: `document:${entry.path}`,
                entry,
                ...(recordsWereRead ? { nameKey: ORPHAN_CONTENT_NAME_KEY } : {}),
            });
            continue;
        }

        units.push({ key: `document:${entry.path}`, entry });
    }
    return units;
}

/** One asset's record inside a shard: the id it is filed under, and what happened to it. */
interface AssetRecord {
    readonly key: string;
    readonly change: DocumentChange;
}

/** The bytes stored under an asset id, if this comparison carries them. */
function contentFor(key: string, contentById: ReadonlyMap<string, DocumentDiffEntry>): DocumentDiffEntry | undefined {
    if (!isValidAssetStorageId(key)) {
        // A shard is a plain map and may have been hand-edited, so a key is not certainly an id.
        // One that is not cannot name a content file, and looking it up would be a lookup that can
        // only miss.
        return undefined;
    }
    // Lower-cased on both sides: `assetStorageIdFromContentPath` accepts lower-case shards only,
    // because two spellings of one path are two files on a case-sensitive host, while a shard's
    // KEY is whatever was written into the JSON.
    return contentById.get(key.toLowerCase());
}

/**
 * The asset records inside one metadata shard, or nothing when it cannot be read as a list of them.
 *
 * Four conditions, and each of them is a case where splitting the shard would say something untrue.
 * A shard that was added or removed whole has one row about the file, not one row per asset. A shard
 * compared below the semantic tier has rows keyed by JSON path rather than by asset id. A shard
 * whose change list was cut short would lose its "may have changes not listed" caveat the moment its
 * rows became rows about assets - the shortfall is a fact about the shard, and there would be no
 * shard left on screen to carry it. And a list holding one row that is not an asset record is a
 * shape this does not recognise, so it is left whole rather than half read.
 */
function assetRecordsOf(entry: DocumentDiffEntry): readonly AssetRecord[] {
    if (isWholeDocumentChange(entry.kind)) {
        return [];
    }
    if (entry.diff.tier !== "semantic" || !entry.diff.complete || entry.diff.changes.length === 0) {
        return [];
    }

    const records: AssetRecord[] = [];
    for (const change of entry.diff.changes) {
        const [segment, key] = change.path;
        if (segment !== ASSET_RECORD_SEGMENT || typeof key !== "string" || key.length === 0) {
            return [];
        }
        records.push({ key, change });
    }
    return records;
}
