import {buildDocumentDiff, DocumentChange, DocumentDiff} from "../diff";
import {compileDocumentPathPattern} from "../documentPath";
import {defineDocumentSpec} from "../registry";
import {authoredName, change, diffKeyed, fromToParams, sameJsonValue} from "./diffHelpers";
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
});

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
