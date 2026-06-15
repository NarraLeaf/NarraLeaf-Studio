import type { AppearanceRowValue, AppearanceVariant, AppearanceValueRow } from "@shared/types/ui-editor/appearance";
import { updateRowInGroup } from "../appearancePatch";

export function findPropertyGroup(variant: AppearanceVariant, groupKey: string) {
    return variant.propertyGroups.find(g => g.key === groupKey);
}

export function getDefaultRowValue(variant: AppearanceVariant, groupKey: string): AppearanceRowValue | undefined {
    return findPropertyGroup(variant, groupKey)?.rows[0]?.value;
}

export function commitDefaultRowValue(
    variant: AppearanceVariant,
    groupKey: string,
    value: AppearanceRowValue,
    commitVariant: (v: AppearanceVariant) => void
) {
    const nextRow: AppearanceValueRow = { conditions: null, value };
    commitVariant(updateRowInGroup(variant, groupKey, 0, nextRow));
}

export function formatPercentDisplay(value: number) {
    return String(Math.round(value * 10000) / 100);
}

export function readFiniteNumber(value: unknown, fallback = 0): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
