const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_STORAGE_ID_PATTERN = /^[0-9a-f]{64}$/i;

/**
 * Asset content/cache files are addressed only by generated UUIDs or legacy
 * SHA-256 hex digests. Rejecting every other character prevents metadata-
 * controlled identifiers from becoming path traversal segments.
 */
export function isValidAssetStorageId(id: unknown): id is string {
    return typeof id === "string" && (UUID_PATTERN.test(id) || HEX_STORAGE_ID_PATTERN.test(id));
}

/**
 * Split UUID or hash into path segments for storage.
 * UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (36 chars with dashes)
 * Hash format: 64 hex characters
 */
export function splitAssetStorageId(id: string): [string, string, string] {
    if (!isValidAssetStorageId(id)) {
        throw new Error(`Invalid asset storage id: ${id}`);
    }

    const cleanId = id.replace(/-/g, "");
    return [cleanId.slice(0, 2), cleanId.slice(2, 4), cleanId.slice(4)];
}
