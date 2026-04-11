import type { BlueprintField, LiteralValue } from "@shared/types/blueprint/document";

/** Minimal read surface for field evaluation (implemented by SurfaceStateStore in Dev Mode). */
export type BlueprintSurfaceStateReader = {
    get(key: string): unknown;
};

/**
 * Resolve a field to a runtime literal using M3-min rules (surface state only).
 * Returns undefined when the field cannot be evaluated (missing source, unknown variant).
 */
export function evaluateFieldValue(
    field: BlueprintField | undefined,
    surfaceState: BlueprintSurfaceStateReader,
): LiteralValue | undefined {
    if (!field?.valueSource) {
        return undefined;
    }
    const vs = field.valueSource;
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
