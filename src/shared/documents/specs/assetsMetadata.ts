import {
    buildDocumentDiff,
    DocumentChange,
    DocumentDiff,
    DocumentMerge3,
    DocumentMergeDecision,
} from "../diff";
import {compileDocumentPathPattern} from "../documentPath";
import {defineDocumentSpec} from "../registry";
import {authoredName, change, diffKeyed, fromToParams, sameJsonValue} from "./diffHelpers";
import {countConflicts, decision, mergeKeyed} from "./mergeHelpers";
import {isJsonObject, parameterFromPath, requireDocumentObject} from "./parseHelpers";

/**
 * `assets/assets.metadata.<type>.json` - one shard per asset type, holding the author's metadata for
 * every asset of that type: its name, its content hash, its tags, its folder, its description.
 *
 * The shard is a flat map keyed by asset id, which is what makes the collaboration case in plan
 * 2026-07-31-004 §4.3 come out right for free: **two people importing different assets are two
 * independent additions**, not a conflict. Nothing here aligns anything positionally, so nothing
 * here can decide that two unrelated imports touched the same thing.
 *
 * **Read-side only, like the story spec.** `AssetsService.writeAssetsMetadata` still owns writing
 * (`AssetsService.ts:551`, `JSON.stringify` with no indent), and the asset services still carry
 * unaudited `undefined` assignments (plan 2026-07-27-001 §3.3.2 names `RemoteAssetsManager.ts:38`
 * and `LocalAssetsManager.ts:283`), which the canonical encoder rejects by name. So `serialize`
 * refuses rather than quietly producing bytes nothing writes and nothing checks.
 *
 * The record type below is structural on purpose. The renderer's `Asset` interface is the same shape
 * and cannot be imported here (it lives under `renderer/lib`), and the alternative - moving the
 * asset model into shared - is the assets service's adoption, not this milestone's. An index
 * signature keeps a field this build has not heard of from being dropped or mis-typed.
 */
export const ASSETS_METADATA_DOCUMENT_PATH = "assets/assets.metadata.<type>.json";

const ASSETS_METADATA_PATTERN = compileDocumentPathPattern(ASSETS_METADATA_DOCUMENT_PATH);

/** One asset's authored metadata, read defensively - this is what is on disk, not what is in memory. */
export interface AssetMetadataEntry {
    readonly id?: unknown;
    readonly type?: unknown;
    readonly name?: unknown;
    /** Content digest. A change here means the bytes were replaced, which is a real event. */
    readonly hash?: unknown;
    readonly ext?: unknown;
    readonly source?: unknown;
    readonly meta?: unknown;
    readonly tags?: unknown;
    readonly description?: unknown;
    readonly groupId?: unknown;
    readonly extras?: unknown;
    readonly [key: string]: unknown;
}

export interface AssetsMetadataShard {
    /** The asset type this shard holds, taken from the file name rather than from any field. */
    readonly type: string;
    readonly assets: Readonly<Record<string, AssetMetadataEntry>>;
}

const LABEL = {
    added: "documentDiff.assets.added",
    removed: "documentDiff.assets.removed",
    changed: "documentDiff.assets.changed",
    renamed: "documentDiff.assets.renamed",
    content: "documentDiff.assets.content",
    field: "documentDiff.assets.field",
} as const;

/** Compared one by one under a changed asset. `name` and `hash` have their own labels. */
const ASSET_FIELDS = ["tags", "description", "groupId", "ext", "source", "meta", "extras", "type"] as const;

export const assetsMetadataSpec = defineDocumentSpec<AssetsMetadataShard>({
    kind: "assets-metadata",
    // The shard has never carried a version field of its own - it is a bare map - so there is no
    // schema to reject a future one by. Stated as 1 because the interface requires a number, and
    // `parse` accordingly gates on shape alone.
    version: 1,
    paths: [ASSETS_METADATA_DOCUMENT_PATH],
    parse: (raw, context) => {
        const type = parameterFromPath(ASSETS_METADATA_PATTERN, "type", context);
        const record = requireDocumentObject(raw, context, "an asset metadata shard");
        const assets: Record<string, AssetMetadataEntry> = {};
        for (const [id, entry] of Object.entries(record)) {
            // An entry that is not an object is what a half-written or hand-edited shard holds, and
            // the reader that owns this file already skips those with a warning
            // (`AssetsMetadataManager.assignValidAssets`). Refusing the whole shard over one would
            // make one bad row cost the author every asset of that type.
            if (isJsonObject(entry)) {
                assets[id] = entry as AssetMetadataEntry;
            }
        }
        return {type, assets};
    },
    /** Refused for the same reason the story spec refuses; see the note at the top of this module. */
    serialize: () => {
        throw new Error(
            "The assets-metadata spec is read-only in this build: AssetsService owns writing the shard, "
            + "and the asset services still assign `undefined` where the canonical encoder requires the key "
            + "to be absent. Adopting it is the assets service's own migration.",
        );
    },
    summarize: shard => ({
        // No authored title: the shard is named by its asset type, which is Studio's vocabulary and
        // belongs in a translated label rather than in a field printed verbatim.
        title: "",
        counts: [{key: "assets", value: Object.keys(shard.assets).length}],
    }),
    diff: diffAssetsMetadata,
    merge3: merge3AssetsMetadata,
});

/**
 * Three-way merge of one asset shard - the commonest collaboration case in the whole system.
 *
 * Two people importing different assets must come out as two independent additions, and it is
 * free rather than clever: the shard is a flat map keyed by asset id, so nothing here lines
 * anything up by position and nothing can decide that two unrelated imports touched the same
 * thing. The same property the semantic diff rests on.
 *
 * **Order is appended, never conflicted.** The shard's key order is data - it is the asset
 * browser's row order, and the order file beside it exists precisely to preserve it against a
 * canonical write (`renderer/lib/workspace/services/assets/assetOrder.ts`). But it is *recovered
 * import order*, not something the author arranged: there is no reorder gesture in the panel and
 * every insertion appends. So two sides that both appended have not disagreed about anything, and
 * {@link mergeKeyed} answers with mine's order followed by the ids only theirs has. This is the
 * contrast with an author-arranged array, which is taken whole from one side and never interleaved.
 *
 * **One decision per asset, not per field.** Fields inside one record are not merged across sides
 * even though they could be, because `hash` is the digest of the bytes actually stored under this
 * id: a record built from one side's `hash` and the other side's `name` or `ext` describes a file
 * that does not exist, and it would look perfectly well-formed doing it.
 */
export function merge3AssetsMetadata(
    base: AssetsMetadataShard | undefined,
    mine: AssetsMetadataShard,
    theirs: AssetsMetadataShard,
): DocumentMerge3<AssetsMetadataShard> {
    const assets = mergeKeyed(base?.assets, mine.assets, theirs.assets);
    const decisions: DocumentMergeDecision[] = assets.rows.map(row => {
        const present = (row.mine.value ?? row.theirs.value ?? row.base.value) as AssetMetadataEntry | undefined;
        // Which of the three words this row gets is decided by the BASE, not by which side is
        // empty: "mine does not have it" is an addition by them when the base did not have it
        // either, and a removal by me when it did. The two read identically from the sides alone.
        const label = row.mine.present && row.theirs.present && row.base.present ? LABEL.changed
            : !row.mine.present || !row.theirs.present ? (row.base.present ? LABEL.removed : LABEL.added)
                : LABEL.added;
        return decision(["assets", row.key], row, {
            label,
            subject: authoredName(present?.name),
        });
    });

    return {
        // From mine because it is read off the file name, so all three sides carry the same one -
        // `parse` takes it from the path, not from a field, and the three sides are three versions
        // of one path.
        document: {type: mine.type, assets: assets.merged},
        decisions,
        conflicts: countConflicts(decisions),
    };
}

export function diffAssetsMetadata(
    base: AssetsMetadataShard,
    head: AssetsMetadataShard,
    options: {limit: number},
): DocumentDiff {
    const rows: DocumentChange[] = [];

    for (const entry of diffKeyed(base.assets, head.assets)) {
        const path = ["assets", entry.key];
        if (!entry.base || !entry.head) {
            const present = (entry.head ?? entry.base) as AssetMetadataEntry;
            // The commonest collaboration case in the whole system: one row per asset, standing on
            // its own. Nothing about an import can collide with somebody else's import here, because
            // nothing lines these up by anything but the id they were given.
            rows.push(change(path, entry.kind, entry.head ? LABEL.added : LABEL.removed, {
                subject: authoredName(present?.name),
            }));
            continue;
        }

        const subject = authoredName(entry.head.name) ?? authoredName(entry.base.name);
        const children: DocumentChange[] = [];
        if (!sameJsonValue(entry.base.name, entry.head.name)) {
            children.push(change([...path, "name"], "changed", LABEL.renamed, {
                params: fromToParams(entry.base.name, entry.head.name),
                subject,
            }));
        }
        // The bytes behind the record were replaced. Worth its own label: everything else in this
        // shard is metadata about a file, and this is the file.
        if (!sameJsonValue(entry.base.hash, entry.head.hash)) {
            children.push(change([...path, "hash"], "changed", LABEL.content, {subject}));
        }
        for (const field of ASSET_FIELDS) {
            if (!sameJsonValue(entry.base[field], entry.head[field])) {
                children.push(change([...path, field], presence(entry.base[field], entry.head[field]), LABEL.field, {
                    params: {field, ...fromToParams(entry.base[field], entry.head[field])},
                    subject,
                }));
            }
        }
        rows.push(change(path, "changed", LABEL.changed, {subject, children}));
    }

    // By the author's own name, then by id, and before anything is truncated - an asset shard is the
    // one document that routinely holds hundreds of entries, so this is the list most likely to meet
    // the budget and the one where keeping an arbitrary half would show.
    rows.sort(byNameThenPath);
    return buildDocumentDiff(rows, {tier: "semantic", limit: options.limit});
}

function presence(base: unknown, head: unknown): "added" | "removed" | "changed" {
    if (base === undefined) {
        return "added";
    }
    return head === undefined ? "removed" : "changed";
}

function byNameThenPath(a: DocumentChange, b: DocumentChange): number {
    const left = a.subject ?? "";
    const right = b.subject ?? "";
    if (left !== right) {
        if (left === "") return 1;
        if (right === "") return -1;
        return left < right ? -1 : 1;
    }
    const leftPath = a.path.join("/");
    const rightPath = b.path.join("/");
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
}
