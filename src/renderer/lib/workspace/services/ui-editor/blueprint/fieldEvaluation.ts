import type { BlueprintField, LiteralValue } from "@shared/types/blueprint/document";

/** Minimal read surface for field evaluation (implemented by SurfaceStateStore / ScopeStoreBridge). */
export type BlueprintStateReader = {
    get(key: string): unknown;
};

/** @deprecated Alias kept for backward compatibility. */
export type BlueprintSurfaceStateReader = BlueprintStateReader;

function coerceToLiteral(raw: unknown): LiteralValue | undefined {
    if (raw === undefined || raw === null) {
        return raw as null | undefined;
    }
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
        return raw;
    }
    return String(raw);
}

/**
 * Resolve a field to a runtime literal.
 * Supports surfaceState and globalState value sources.
 */
export function evaluateFieldValue(
    field: BlueprintField | undefined,
    surfaceState: BlueprintStateReader,
    globalState?: BlueprintStateReader,
): LiteralValue | undefined {
    if (!field?.valueSource) {
        return undefined;
    }
    const vs = field.valueSource;
    const key = String(vs.key ?? "").trim();
    if (!key) {
        return undefined;
    }
    if (vs.kind === "surfaceState") {
        return coerceToLiteral(surfaceState.get(key));
    }
    if (vs.kind === "globalState") {
        if (!globalState) {
            return undefined;
        }
        return coerceToLiteral(globalState.get(key));
    }
    return undefined;
}
