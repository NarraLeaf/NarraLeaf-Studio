import type { BlueprintElementRef } from "@shared/types/blueprint/valueTypes";

export const ELEMENT_REF_PARAM_SURFACE_ID = "surfaceId" as const;
export const ELEMENT_REF_PARAM_ELEMENT_ID = "elementId" as const;
export const ELEMENT_REF_PARAM_ELEMENT_TYPE = "elementType" as const;

function readString(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function readBlueprintElementRefParams(
    params: Record<string, unknown> | undefined,
): BlueprintElementRef | undefined {
    if (!params) {
        return undefined;
    }
    const surfaceId = readString(params, ELEMENT_REF_PARAM_SURFACE_ID);
    const elementId = readString(params, ELEMENT_REF_PARAM_ELEMENT_ID);
    const elementType = readString(params, ELEMENT_REF_PARAM_ELEMENT_TYPE);
    if (!surfaceId || !elementId || !elementType) {
        return undefined;
    }
    return { surfaceId, elementId, elementType };
}

export function normalizeBlueprintElementRefValue(value: unknown): BlueprintElementRef | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    return readBlueprintElementRefParams(value as Record<string, unknown>);
}
