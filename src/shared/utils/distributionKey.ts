/**
 * Reading the project's distribution key out of a project manifest.
 *
 * One reader, shared by the build (which needs the key) and the panel that mints
 * it (which needs the date beside it), because "does this project have a key"
 * must have exactly one answer. A build that read it more leniently than the
 * panel would ship a title whose key the author does not believe they set.
 *
 * Nothing here interprets the value. It is opaque - produced by the protection
 * component and handed back to it verbatim - so the only judgement made is
 * whether a non-empty one is present.
 */

export type DistributionRecord = {
    key: string;
    /** ISO timestamp of the last mint; may be empty on a hand-edited manifest. */
    rotatedAt: string;
};

/**
 * The distribution record in a project manifest's `app` section, or null.
 *
 * A record whose key is missing or blank reads as absent rather than as a record
 * with an empty key: a build that accepted a blank key would produce a title that
 * can never be patched, and nothing downstream could tell that apart from a
 * project that simply never minted one.
 */
export function readDistributionRecord(app: unknown): DistributionRecord | null {
    if (!app || typeof app !== "object") {
        return null;
    }
    const value = (app as { distribution?: unknown }).distribution;
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key.trim() : "";
    if (!key) {
        return null;
    }
    return {
        key,
        rotatedAt: typeof record.rotatedAt === "string" ? record.rotatedAt.trim() : "",
    };
}

/** The key alone, for callers that only need to know what to build under. */
export function readDistributionKey(app: unknown): string | null {
    return readDistributionRecord(app)?.key ?? null;
}
