import type { BlueprintField, LiteralValue } from "@shared/types/blueprint/document";
import type { UIListItemScope } from "@shared/types/ui-editor/list";

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

function readPath(source: unknown, path: string | undefined): unknown {
    const clean = String(path ?? "").trim();
    if (!clean) {
        return source;
    }
    return clean.split(".").reduce<unknown>((current, segment) => {
        if (current == null || !segment) {
            return undefined;
        }
        if (Array.isArray(current)) {
            const index = Number(segment);
            return Number.isInteger(index) ? current[index] : undefined;
        }
        if (typeof current === "object") {
            return (current as Record<string, unknown>)[segment];
        }
        return undefined;
    }, source);
}

/**
 * Resolve a field to a runtime literal.
 * Supports surfaceState and globalState value sources.
 */
export function evaluateFieldValue(
    field: BlueprintField | undefined,
    surfaceState: BlueprintStateReader,
    globalState?: BlueprintStateReader,
    listItemScope?: UIListItemScope | null,
): LiteralValue | undefined {
    if (!field?.valueSource) {
        return undefined;
    }
    const vs = field.valueSource;
    if (vs.kind === "surfaceState") {
        const key = String(vs.key ?? "").trim();
        if (!key) {
            return undefined;
        }
        return coerceToLiteral(surfaceState.get(key));
    }
    if (vs.kind === "globalState") {
        const key = String(vs.key ?? "").trim();
        if (!key) {
            return undefined;
        }
        if (!globalState) {
            return undefined;
        }
        return coerceToLiteral(globalState.get(key));
    }
    if (vs.kind === "listItem") {
        if (!listItemScope) {
            return undefined;
        }
        return coerceToLiteral(readPath(listItemScope.item, vs.path));
    }
    if (vs.kind === "listIndex") {
        return coerceToLiteral(listItemScope?.index);
    }
    if (vs.kind === "listCount") {
        return coerceToLiteral(listItemScope?.count);
    }
    return undefined;
}
