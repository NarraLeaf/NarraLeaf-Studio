/**
 * Serialized `strokeSide` on rectangle-like chrome:
 * - "all" — all four edges
 * - single edge: "top" | "right" | "bottom" | "left"
 * - multiple edges: comma-separated, canonical order (e.g. "bottom,left")
 */

export const STROKE_EDGE_ORDER = ["top", "right", "bottom", "left"] as const;
export type StrokeEdge = (typeof STROKE_EDGE_ORDER)[number];

export type ParsedStrokeSide = { kind: "all" } | { kind: "edges"; edges: Set<StrokeEdge> };

function isStrokeEdge(token: string): token is StrokeEdge {
    return (STROKE_EDGE_ORDER as readonly string[]).includes(token);
}

/** Parse stored strokeSide string; invalid tokens are ignored except full-string validation uses {@link isValidStrokeSideSpec}. */
export function parseStrokeSideSpec(raw: string): ParsedStrokeSide {
    const t = String(raw ?? "")
        .trim()
        .toLowerCase();
    if (!t || t === "all") {
        return { kind: "all" };
    }
    const parts = t.split(",").map(p => p.trim().toLowerCase()).filter(Boolean);
    const edges = new Set<StrokeEdge>();
    for (const p of parts) {
        if (p === "all") {
            return { kind: "all" };
        }
        if (isStrokeEdge(p)) {
            edges.add(p);
        }
    }
    if (edges.size === 0) {
        return { kind: "all" };
    }
    if (edges.size >= 4) {
        return { kind: "all" };
    }
    return { kind: "edges", edges };
}

export function serializeStrokeSideSpec(parsed: ParsedStrokeSide): string {
    if (parsed.kind === "all") {
        return "all";
    }
    if (parsed.edges.size >= 4) {
        return "all";
    }
    const ordered = STROKE_EDGE_ORDER.filter(e => parsed.edges.has(e));
    if (ordered.length === 0) {
        return "all";
    }
    if (ordered.length === 1) {
        return ordered[0];
    }
    return ordered.join(",");
}

export function strokeSideApplies(raw: string, side: StrokeEdge): boolean {
    const p = parseStrokeSideSpec(raw);
    if (p.kind === "all") {
        return true;
    }
    return p.edges.has(side);
}

/** True if every comma-separated token is a valid edge, or the whole value is "all". */
export function isValidStrokeSideSpec(raw: unknown): boolean {
    if (typeof raw !== "string") {
        return false;
    }
    const t = raw.trim().toLowerCase();
    if (t === "all") {
        return true;
    }
    const parts = t.split(",").map(p => p.trim().toLowerCase()).filter(Boolean);
    if (parts.length === 0) {
        return false;
    }
    if (parts.some(p => p === "all")) {
        return false;
    }
    return parts.every(p => isStrokeEdge(p));
}

export function normalizeStrokeSideInput(raw: string): string | undefined {
    if (!isValidStrokeSideSpec(raw)) {
        return undefined;
    }
    return serializeStrokeSideSpec(parseStrokeSideSpec(raw));
}

/**
 * Toggle UI: "all" selects only all; an edge toggles membership and clears all; empty edge set becomes "all".
 */
export function toggleStrokeSideOption(current: string, option: "all" | StrokeEdge): string {
    if (option === "all") {
        return "all";
    }
    const p = parseStrokeSideSpec(current);
    if (p.kind === "all") {
        return option;
    }
    const next = new Set(p.edges);
    if (next.has(option)) {
        next.delete(option);
        return next.size === 0 ? "all" : serializeStrokeSideSpec({ kind: "edges", edges: next });
    }
    next.add(option);
    return serializeStrokeSideSpec({ kind: "edges", edges: next });
}

/** Selected option ids for seamless icon group: `["all"]` or ordered edge ids. */
export function strokeSideSelectedIds(raw: string): string[] {
    const p = parseStrokeSideSpec(raw);
    if (p.kind === "all") {
        return ["all"];
    }
    return STROKE_EDGE_ORDER.filter(e => p.edges.has(e));
}

/** Inverse of {@link strokeSideSelectedIds} for persisting from multi-select UI. */
export function strokeSideSpecFromSelectedIds(ids: string[]): string {
    const uniq = [...new Set(ids.map(s => String(s).trim().toLowerCase()))];
    if (uniq.length === 0) {
        return "all";
    }
    if (uniq.length === 1 && uniq[0] === "all") {
        return "all";
    }
    if (uniq.includes("all")) {
        const edges = uniq.filter(x => x !== "all").filter((x): x is StrokeEdge => isStrokeEdge(x));
        if (edges.length === 0) {
            return "all";
        }
        return serializeStrokeSideSpec({ kind: "edges", edges: new Set(edges) });
    }
    const edgesOnly = uniq.filter((x): x is StrokeEdge => isStrokeEdge(x));
    if (edgesOnly.length === 0) {
        return "all";
    }
    return serializeStrokeSideSpec({ kind: "edges", edges: new Set(edgesOnly) });
}
