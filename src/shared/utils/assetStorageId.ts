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

/** Segment lengths of a UUID, in the order the canonical hyphenated form writes them. */
const UUID_GROUP_LENGTHS = [8, 4, 4, 4, 12];

/**
 * The exact inverse of {@link splitAssetStorageId}: rebuild the id a shard path was derived from.
 *
 * Content files are stored with no extension and no manifest beside them, so the only thing that
 * says which asset `assets/content/99/55/3d15…` holds is the path itself. Recovering the id is
 * therefore arithmetic on the path, never a lookup: rejoin the three segments and decide which of
 * the two id shapes the result is by its length alone. Nothing here consults the project, so it
 * answers for an id whose asset has already been deleted exactly as it does for a live one.
 *
 * The rejoined string is validated by {@link isValidAssetStorageId} - the same predicate the
 * forward direction gates on - so the two cannot drift apart on what counts as an id.
 *
 * Case is preserved rather than normalised, because this is the algebraic inverse: every id
 * `splitAssetStorageId` accepts must come back out unchanged. Callers that parse paths off disk
 * want the stricter reading and should use {@link assetStorageIdFromContentPath}.
 *
 * @returns the id, or `null` if these segments were never produced by `splitAssetStorageId`.
 */
export function assetStorageIdFromShards(a: string, b: string, rest: string): string | null {
    if (typeof a !== "string" || typeof b !== "string" || typeof rest !== "string") {
        return null;
    }
    // The first two segments are the fan-out and are always two characters; a path whose
    // directories are any other width did not come from this scheme.
    if (a.length !== 2 || b.length !== 2) {
        return null;
    }

    const joined = `${a}${b}${rest}`;

    // 32 characters is a UUID with its hyphens dropped by the split. Put them back at the fixed
    // group boundaries; a stray hyphen anywhere in the segments lands mid-group and is rejected
    // by the validation below rather than needing a check of its own.
    if (joined.length === 32) {
        let offset = 0;
        const groups: string[] = [];
        for (const length of UUID_GROUP_LENGTHS) {
            groups.push(joined.slice(offset, offset + length));
            offset += length;
        }
        const uuid = groups.join("-");
        return isValidAssetStorageId(uuid) ? uuid : null;
    }

    // 64 characters is a legacy SHA-256 digest, which was never hyphenated and is returned as-is.
    if (joined.length === 64) {
        return isValidAssetStorageId(joined) ? joined : null;
    }

    return null;
}

/**
 * Repository-relative content path -> asset id, or `null` for anything that is not one.
 *
 * `assets/content` is spelled out here rather than imported: the convention that builds these
 * paths (`ProjectNameConvention.AssetsDataShard`) lives in the renderer and imports this module,
 * so the dependency only runs one way.
 *
 * Stricter than {@link assetStorageIdFromShards} in one respect: the segments must be lower case.
 * The writer only ever emits lower-case hex, so an upper-case or mixed-case segment is a path
 * this scheme did not produce - and accepting it would hand back one id for two distinct paths,
 * which on a case-sensitive filesystem are two distinct files.
 *
 * Both separators are accepted because callers hold paths from a diff, a manifest or a walk of
 * the working tree, and those disagree about the slash even within one repository.
 */
export function assetStorageIdFromContentPath(relativePath: string): string | null {
    if (typeof relativePath !== "string") {
        return null;
    }

    const segments = relativePath.split(/[/\\]/).filter(segment => segment.length > 0);
    if (segments.length !== 5 || segments[0] !== "assets" || segments[1] !== "content") {
        return null;
    }

    const [, , a, b, rest] = segments;
    if (a !== a.toLowerCase() || b !== b.toLowerCase() || rest !== rest.toLowerCase()) {
        return null;
    }

    return assetStorageIdFromShards(a, b, rest);
}
