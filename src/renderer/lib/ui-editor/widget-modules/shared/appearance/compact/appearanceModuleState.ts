import type {
    AppearanceRowValue,
    AppearanceSystemCondition,
    AppearanceVariant,
    ButtonAppearancePropertyKey,
    ContainerAppearancePropertyKey,
    TextAppearancePropertyKey,
} from "@shared/types/ui-editor/appearance";
import { addRowToGroup, removeRowFromGroup, updateRowInGroup } from "../appearancePatch";
import { findPropertyGroup } from "./appearanceCompactHelpers";

/** Single-flag conditions used by compact module state authoring (matches ConditionRowToggles keys). */
export const SYSTEM_STATE_KEYS = ["hovered", "active", "disabled", "focused"] as const;
export type SystemStateKey = (typeof SYSTEM_STATE_KEYS)[number];

export type ContainerAppearanceModuleId = "background" | "stroke" | "corners" | "transform" | "effects";
export type ButtonAppearanceModuleId = "typography" | "background" | "border" | "spacing" | "transform" | "effects";
export type TextAppearanceModuleId = "typography" | "transform" | "effects";

export type ModuleEditMode = "default" | SystemStateKey;

export const CONTAINER_MODULE_KEYS: Record<ContainerAppearanceModuleId, readonly ContainerAppearancePropertyKey[]> = {
    background: [
        "fillType",
        "backgroundColor",
        "fillOpacity",
        "fillVisible",
        "imageFill",
        "gradientFill",
        "backgroundImage",
        "backgroundFit",
    ],
    stroke: [
        "strokeAlign",
        "borderWidth",
        "borderStyle",
        "borderJoin",
        "strokeSide",
        "borderColor",
        "strokeOpacity",
        "strokeVisible",
    ],
    corners: [
        "borderRadius",
        "borderRadiusTL",
        "borderRadiusTR",
        "borderRadiusBL",
        "borderRadiusBR",
        "borderRadiusLinked",
        "cornerAdvanced",
    ],
    transform: [
        "transformOffsetX",
        "transformOffsetY",
        "transformScale",
        "transformRotation",
        "transformOpacity",
    ],
    effects: [
        "effectBlur",
        "effectBackgroundBlur",
        "effectShadow",
        "effectInnerShadow",
        "effectBlend",
        "effectGlow",
        "effectFilter",
    ],
};

export const BUTTON_MODULE_KEYS: Record<ButtonAppearanceModuleId, readonly ButtonAppearancePropertyKey[]> = {
    // The same module `nl.text` offers, minus the italic toggle a button label has no prop for.
    typography: ["fontAssetId", "fontSize", "fontWeight", "color", "lineHeight"],
    background: [
        "fillType",
        "backgroundColor",
        "fillOpacity",
        "fillVisible",
        "imageFill",
        "gradientFill",
        "backgroundImage",
        "backgroundFit",
    ],
    border: [
        "borderRadius",
        "borderWidth",
        "borderColor",
        "borderStyle",
        "strokeOpacity",
        "strokeSide",
        "borderJoin",
        "strokeAlign",
    ],
    spacing: ["paddingX", "paddingY", "clipContent"],
    transform: [
        "transformOffsetX",
        "transformOffsetY",
        "transformScale",
        "transformRotation",
        "transformOpacity",
    ],
    effects: [
        "effectBlur",
        "effectBackgroundBlur",
        "effectShadow",
        "effectTextShadow",
        "effectInnerShadow",
        "effectBlend",
        "effectGlow",
        "effectFilter",
    ],
};

export const TEXT_MODULE_KEYS: Record<TextAppearanceModuleId, readonly TextAppearancePropertyKey[]> = {
    typography: ["fontAssetId", "fontSize", "fontWeight", "fontStyle", "color", "lineHeight"],
    transform: [
        "transformOffsetX",
        "transformOffsetY",
        "transformScale",
        "transformRotation",
        "transformOpacity",
    ],
    effects: ["effectBlur", "effectTextShadow", "effectBlend", "effectFilter"],
};

export function exclusiveStateCondition(state: SystemStateKey): AppearanceSystemCondition {
    return { [state]: true } as AppearanceSystemCondition;
}

/** True when conditions are exactly one key set to true (single required flag). */
export function isExclusiveTrueState(
    conditions: AppearanceSystemCondition | null | undefined,
    state: SystemStateKey
): boolean {
    if (!conditions) {
        return false;
    }
    const keys = Object.keys(conditions).filter(k => conditions[k as keyof AppearanceSystemCondition] !== undefined);
    if (keys.length !== 1) {
        return false;
    }
    return conditions[state] === true;
}

export function findExclusiveStateRowIndex(
    rows: { conditions?: AppearanceSystemCondition | null }[],
    state: SystemStateKey
): number {
    for (let i = 1; i < rows.length; i++) {
        if (isExclusiveTrueState(rows[i]?.conditions ?? null, state)) {
            return i;
        }
    }
    return -1;
}

/**
 * Whether the module has this state at all: at least one of its properties carries a row for it.
 *
 * This is what the module's title bar answers with its chips. A state is authored property by
 * property - the shipped title buttons give `hovered` a text shadow in Effects and an X offset in
 * Transform and nothing else - so asking for every property would hide a hover the canvas visibly
 * plays, and the author could not find where it was set. Properties without a row show and keep
 * the default's value while the state is being edited.
 */
export function moduleHasExclusiveState(
    variant: AppearanceVariant,
    moduleKeys: readonly string[],
    state: SystemStateKey
): boolean {
    return moduleKeys.some(key => {
        const g = findPropertyGroup(variant, key);
        return g != null && findExclusiveStateRowIndex(g.rows, state) >= 0;
    });
}

/**
 * Ensures each key in the module has one row with conditions `{ [state]: true }` only.
 * Copies value from the group's last row (usually default) when adding.
 */
export function ensureModuleExclusiveState(
    variant: AppearanceVariant,
    moduleKeys: readonly string[],
    state: SystemStateKey
): AppearanceVariant {
    let v = variant;
    const cond = exclusiveStateCondition(state);
    for (const key of moduleKeys) {
        const g = findPropertyGroup(v, key);
        if (!g) {
            continue;
        }
        if (findExclusiveStateRowIndex(g.rows, state) >= 0) {
            continue;
        }
        const last = g.rows[g.rows.length - 1];
        const newRow = {
            conditions: cond,
            value: last?.value ?? null,
        };
        v = addRowToGroup(v, key, newRow);
    }
    return v;
}

/** Removes the exclusive `{ [state]: true }` row from each property group in the module (if present). */
export function removeModuleExclusiveState(
    variant: AppearanceVariant,
    moduleKeys: readonly string[],
    state: SystemStateKey
): AppearanceVariant {
    let v = variant;
    for (const key of moduleKeys) {
        const g = findPropertyGroup(v, key);
        if (!g) {
            continue;
        }
        const idx = findExclusiveStateRowIndex(g.rows, state);
        if (idx >= 0) {
            v = removeRowFromGroup(v, key, idx);
        }
    }
    return v;
}

export function getRowIndexForModuleEdit(
    variant: AppearanceVariant,
    groupKey: string,
    editMode: ModuleEditMode
): number {
    if (editMode === "default") {
        return 0;
    }
    const g = findPropertyGroup(variant, groupKey);
    if (!g) {
        return 0;
    }
    const idx = findExclusiveStateRowIndex(g.rows, editMode);
    return idx >= 0 ? idx : 0;
}

export function getRowValueForModuleEdit(
    variant: AppearanceVariant,
    groupKey: string,
    editMode: ModuleEditMode
): AppearanceRowValue | undefined {
    const g = findPropertyGroup(variant, groupKey);
    if (!g) {
        return undefined;
    }
    const idx = getRowIndexForModuleEdit(variant, groupKey, editMode);
    return g.rows[idx]?.value;
}

/** Update value for default row or an existing exclusive-state row; does not create rows. */
export function updateRowValueForModuleEdit(
    variant: AppearanceVariant,
    groupKey: string,
    editMode: ModuleEditMode,
    value: AppearanceRowValue
): AppearanceVariant {
    const g = findPropertyGroup(variant, groupKey);
    if (!g) {
        return variant;
    }
    const idx = getRowIndexForModuleEdit(variant, groupKey, editMode);
    const row = g.rows[idx];
    if (!row) {
        return variant;
    }
    if (editMode !== "default" && !isExclusiveTrueState(row.conditions ?? null, editMode)) {
        return variant;
    }
    return updateRowInGroup(variant, groupKey, idx, { ...row, value });
}

/**
 * Like updateRowValueForModuleEdit, but creates the exclusive-state row it writes to when it is missing.
 *
 * A module that does not have the state yet gets it whole, as "Add" in the module's menu does. A
 * module that already has it - on some of its properties - gets a row for this one property only:
 * the others keep following the default, which is what they showed while the state was being
 * edited, rather than being pinned to a copy of today's default value.
 */
export function updateRowValueForModuleEditOrEnsure(
    variant: AppearanceVariant,
    moduleKeys: readonly string[],
    groupKey: string,
    editMode: ModuleEditMode,
    value: AppearanceRowValue
): AppearanceVariant {
    if (editMode === "default") {
        return updateRowValueForModuleEdit(variant, groupKey, editMode, value);
    }
    const v = moduleHasExclusiveState(variant, moduleKeys, editMode)
        ? ensureModuleExclusiveState(variant, [groupKey], editMode)
        : ensureModuleExclusiveState(variant, moduleKeys, editMode);
    return updateRowValueForModuleEdit(v, groupKey, editMode, value);
}

/** The states the module's title bar offers a chip for: those any of its properties has a row for. */
export function listModuleExclusiveStatesPresent(
    variant: AppearanceVariant,
    moduleKeys: readonly string[]
): SystemStateKey[] {
    return SYSTEM_STATE_KEYS.filter(state => moduleHasExclusiveState(variant, moduleKeys, state));
}
