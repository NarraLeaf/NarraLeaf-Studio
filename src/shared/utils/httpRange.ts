export type ResolvedByteRange =
    | { kind: "full" }
    | { kind: "partial"; start: number; end: number }
    | { kind: "unsatisfiable" };

/**
 * Resolve a request's Range header against a known payload size. Only single
 * byte ranges are honored; anything else (absent, malformed, or multi-range)
 * resolves to a full response, which is always a valid answer to a Range
 * request. Unsatisfiable ranges must be answered with 416 per RFC 9110.
 */
export function resolveSingleByteRange(rangeHeader: string | null | undefined, totalSize: number): ResolvedByteRange {
    const header = String(rangeHeader ?? "").trim();
    if (!header) {
        return { kind: "full" };
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(header);
    if (!match) {
        return { kind: "full" };
    }
    const [, rawStart = "", rawEnd = ""] = match;
    if (!rawStart && !rawEnd) {
        return { kind: "full" };
    }
    if (!rawStart) {
        // Suffix range: the last N bytes of the payload.
        const suffixLength = Number(rawEnd);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || totalSize <= 0) {
            return { kind: "unsatisfiable" };
        }
        return { kind: "partial", start: Math.max(0, totalSize - suffixLength), end: totalSize - 1 };
    }
    const start = Number(rawStart);
    if (!Number.isSafeInteger(start)) {
        return { kind: "full" };
    }
    if (start >= totalSize) {
        return { kind: "unsatisfiable" };
    }
    const end = rawEnd ? Math.min(Number(rawEnd), totalSize - 1) : totalSize - 1;
    if (end < start) {
        // last-byte-pos below first-byte-pos is invalid; ignore the header.
        return { kind: "full" };
    }
    return { kind: "partial", start, end };
}
