import type {
    AppearanceFieldTransition,
    AppearanceModel,
    AppearancePropertyGroup,
    AppearanceSystemCondition,
    AppearanceValueRow,
    AppearanceVariant,
} from "@shared/types/ui-editor/appearance";

function cloneModel(model: AppearanceModel): AppearanceModel {
    return JSON.parse(JSON.stringify(model)) as AppearanceModel;
}

export function setDefaultVariantId(model: AppearanceModel, variantId: string): AppearanceModel {
    const next = cloneModel(model);
    if (!next.variants.some(v => v.id === variantId)) {
        return model;
    }
    next.defaultVariantId = variantId;
    return next;
}

export function renameVariant(model: AppearanceModel, variantId: string, name: string): AppearanceModel {
    const next = cloneModel(model);
    const v = next.variants.find(x => x.id === variantId);
    if (!v) {
        return model;
    }
    v.name = name.trim();
    return next;
}

export function addVariant(model: AppearanceModel, variant: AppearanceVariant): AppearanceModel {
    const next = cloneModel(model);
    if (next.variants.some(v => v.id === variant.id)) {
        return model;
    }
    next.variants.push(variant);
    return next;
}

/**
 * The variant with this id, cloned from the resting one when the element has never had one.
 *
 * Parts of a widget that declares states get their variants this way rather than when they are
 * dropped in: an element reaches a widget through half a dozen paths - inserted, pasted, reparented,
 * arriving inside a component - and only one of them is easy to hook. The first edit made in a state
 * is the moment that state actually needs somewhere to go.
 */
export function ensureVariantExists(model: AppearanceModel, variantId: string, name: string): AppearanceModel {
    if (model.variants.some(v => v.id === variantId)) {
        return model;
    }
    const base = model.variants.find(v => v.id === model.defaultVariantId) ?? model.variants[0];
    if (!base) {
        return model;
    }
    return addVariant(model, { ...cloneVariant(base), id: variantId, name });
}

export function removeVariant(model: AppearanceModel, variantId: string): AppearanceModel {
    if (model.variants.length <= 1) {
        return model;
    }
    const next = cloneModel(model);
    const idx = next.variants.findIndex(v => v.id === variantId);
    if (idx < 0) {
        return model;
    }
    next.variants.splice(idx, 1);
    if (next.defaultVariantId === variantId) {
        next.defaultVariantId = next.variants[0]?.id ?? next.defaultVariantId;
    }
    return next;
}

export function replaceVariant(model: AppearanceModel, variantId: string, variant: AppearanceVariant): AppearanceModel {
    const next = cloneModel(model);
    const idx = next.variants.findIndex(v => v.id === variantId);
    if (idx < 0) {
        return model;
    }
    next.variants[idx] = variant;
    return next;
}

export function updateVariantPropertyGroups(
    model: AppearanceModel,
    variantId: string,
    propertyGroups: AppearancePropertyGroup[]
): AppearanceModel {
    const next = cloneModel(model);
    const v = next.variants.find(x => x.id === variantId);
    if (!v) {
        return model;
    }
    v.propertyGroups = propertyGroups;
    return next;
}

export function updateRowInGroup(
    variant: AppearanceVariant,
    groupKey: string,
    rowIndex: number,
    row: AppearanceValueRow
): AppearanceVariant {
    const next = cloneVariant(variant);
    const g = next.propertyGroups.find(gr => gr.key === groupKey);
    if (!g || rowIndex < 0 || rowIndex >= g.rows.length) {
        return variant;
    }
    g.rows[rowIndex] = row;
    return next;
}

export function addRowToGroup(variant: AppearanceVariant, groupKey: string, row: AppearanceValueRow): AppearanceVariant {
    const next = cloneVariant(variant);
    const g = next.propertyGroups.find(gr => gr.key === groupKey);
    if (!g) {
        return variant;
    }
    g.rows.push(row);
    return next;
}

export function removeRowFromGroup(variant: AppearanceVariant, groupKey: string, rowIndex: number): AppearanceVariant {
    const next = cloneVariant(variant);
    const g = next.propertyGroups.find(gr => gr.key === groupKey);
    if (!g || g.rows.length <= 1 || rowIndex < 0 || rowIndex >= g.rows.length) {
        return variant;
    }
    g.rows.splice(rowIndex, 1);
    return next;
}

export function setRowConditions(
    variant: AppearanceVariant,
    groupKey: string,
    rowIndex: number,
    conditions: AppearanceSystemCondition | null | undefined
): AppearanceVariant {
    const next = cloneVariant(variant);
    const g = next.propertyGroups.find(gr => gr.key === groupKey);
    if (!g || rowIndex < 0 || rowIndex >= g.rows.length) {
        return variant;
    }
    const row = g.rows[rowIndex];
    g.rows[rowIndex] = {
        ...row,
        conditions: conditions && Object.keys(conditions).length ? conditions : null,
    };
    return next;
}

export function setGroupTransition(
    variant: AppearanceVariant,
    groupKey: string,
    transition: AppearanceFieldTransition | null
): AppearanceVariant {
    const next = cloneVariant(variant);
    const g = next.propertyGroups.find(gr => gr.key === groupKey);
    if (!g) {
        return variant;
    }
    g.transition = transition;
    return next;
}

/** Apply the same field-level transition to every variant (motion is shared across variants). */
export function setGroupTransitionOnAllVariants(
    model: AppearanceModel,
    groupKey: string,
    transition: AppearanceFieldTransition | null
): AppearanceModel {
    const next = cloneModel(model);
    for (const v of next.variants) {
        const g = v.propertyGroups.find(gr => gr.key === groupKey);
        if (g) {
            g.transition = transition;
        }
    }
    return next;
}

function cloneVariant(v: AppearanceVariant): AppearanceVariant {
    return JSON.parse(JSON.stringify(v)) as AppearanceVariant;
}

export function newVariantId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `v_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
