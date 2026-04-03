import type { BlueprintDeclaration, LiteralValue } from "@shared/types/blueprint/document";

/** Minimal read surface for declaration evaluation (implemented by SurfaceStateStore in Dev Mode). */
export type BlueprintSurfaceStateReader = {
    get(key: string): unknown;
};

/**
 * Resolve a declaration to a runtime literal using M3-min rules (surface state only).
 * Returns undefined when the declaration cannot be evaluated (missing source, unknown variant).
 */
export function evaluateDeclarationValue(
    decl: BlueprintDeclaration | undefined,
    surfaceState: BlueprintSurfaceStateReader,
): LiteralValue | undefined {
    if (!decl?.valueSource) {
        return undefined;
    }
    const vs = decl.valueSource;
    if (vs.kind !== "surfaceState") {
        return undefined;
    }
    const key = String(vs.key ?? "").trim();
    if (!key) {
        return undefined;
    }
    const raw = surfaceState.get(key);
    if (raw === undefined || raw === null) {
        return raw as null | undefined;
    }
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
        return raw;
    }
    return String(raw);
}
