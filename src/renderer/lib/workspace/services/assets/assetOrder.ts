/**
 * Row order for the asset browser, kept in `assets/assets.order.<type>.json` beside the metadata
 * and groups shards it orders.
 *
 * `AssetsMap[type]` and `AssetGroupMap[type]` are ordered maps: the browser draws
 * `Object.values(...)` with no sort, and shift-range selection slices that same sequence. Canonical
 * serialization sorts object keys, so the first canonical write of a shard would renumber the grid
 * under the author — and a shift-range would then cover a different set of rows than the one on
 * screen. This file is what survives the sort.
 *
 * The order is not authored. There is no reorder gesture in the panel; dragging a row only moves it
 * between groups, and every insertion appends. So this records import order — a fact recovered from
 * the shard's key order, not a decision the author made — which is why an id the arrays do not
 * mention is appended rather than hidden.
 *
 * Recovery has one shot. `JSON.parse` preserves insertion order for these keys (asset ids are UUIDs
 * or 64-char hex digests, group ids start with `group_`, so none is an array index), so a shard's
 * key order *is* the order until something rewrites the file. It is captured in the pass that parses
 * the shard and written out on the same open; an order file populated after a normalizing write
 * would only be recording what the sort had already destroyed.
 */

/** Contents of one `assets.order.<type>.json`. Absent entries mean "no opinion", never "empty". */
export interface AssetOrderDocument {
    assetIds: string[];
    groupIds: string[];
}

function readIdArray(source: Record<string, unknown>, key: string): string[] {
    const raw = source[key];
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Read an order file. Anything unreadable yields empty arrays, which
 * {@link reconcileAssetOrder} turns into today's behaviour — the shard's own key order — rather
 * than into an empty library.
 */
export function parseAssetOrderDocument(parsed: unknown): AssetOrderDocument {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { assetIds: [], groupIds: [] };
    }
    const source = parsed as Record<string, unknown>;
    return {
        assetIds: readIdArray(source, "assetIds"),
        groupIds: readIdArray(source, "groupIds"),
    };
}

/**
 * The drawing order for `record`, using `ids` as a hint and never as a filter.
 *
 * Listed-but-absent ids are dropped; present-but-unlisted ids are appended in the record's own key
 * order. The asymmetry is the point: the order file is always one write behind the shards it
 * describes, and a *newly imported* asset is precisely an entry it cannot mention yet — as is every
 * asset in a project that predates the file. An asset missing from the browser reads to the author
 * as a failed import, so they import it again and the library now holds it twice; an asset in the
 * wrong position is merely wrong-looking. Membership is decided by the record, alone, always.
 *
 * Total (any input yields a permutation of the record's keys) and idempotent, so it can run on every
 * read and again on every write rather than trusting each mutation site to maintain the arrays.
 */
export function reconcileAssetOrder(
    ids: readonly unknown[] | undefined,
    record: Readonly<Record<string, unknown>>,
): string[] {
    const ordered: string[] = [];
    const placed = new Set<string>();

    for (const id of ids ?? []) {
        if (typeof id !== "string" || placed.has(id) || !Object.prototype.hasOwnProperty.call(record, id)) {
            continue;
        }
        placed.add(id);
        ordered.push(id);
    }

    for (const id of Object.keys(record)) {
        if (placed.has(id)) {
            continue;
        }
        placed.add(id);
        ordered.push(id);
    }

    return ordered;
}

export function serializeAssetOrderDocument(document: AssetOrderDocument): string {
    return JSON.stringify(document);
}

/** The text a fresh order file is created with, so a new project starts with the file present. */
export const EMPTY_ASSET_ORDER_TEXT = serializeAssetOrderDocument({ assetIds: [], groupIds: [] });
