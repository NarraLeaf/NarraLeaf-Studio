import type { UIElement } from "@shared/types/ui-editor/document";
import { isAppearanceModel } from "@shared/types/ui-editor/appearance";
import { replaceVariant } from "@/lib/ui-editor/widget-modules/shared/appearance/appearancePatch";
import { updateRowValueForModuleEdit } from "@/lib/ui-editor/widget-modules/shared/appearance/compact/appearanceModuleState";
import {
    ensureButtonAppearanceHasAllKeys,
    isUsableAppearanceModel,
} from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { getButtonProps } from "./helpers";
import type { ButtonWidgetProps } from "./types";

/** Keep the resting appearance in step with the typography and spacing fields. */
export function patchButtonAuthoringProps(element: UIElement, partial: Partial<ButtonWidgetProps>): Record<string, unknown> {
    const next = { ...getButtonProps(element), ...partial };
    const keys = (["fontAssetId", "fontSize", "fontWeight", "color", "lineHeight", "paddingX", "paddingY"] as const)
        .filter(key => key in partial);
    if (keys.length === 0 || !isAppearanceModel(next.appearance) || !isUsableAppearanceModel(next.appearance)) {
        return partial;
    }
    const appearance = ensureButtonAppearanceHasAllKeys(next.appearance, next);
    let variant = appearance.variants.find(item => item.id === appearance.defaultVariantId);
    if (!variant) {
        return partial;
    }
    for (const key of keys) {
        variant = updateRowValueForModuleEdit(variant, key, "default", next[key] ?? null);
    }
    return { ...partial, appearance: replaceVariant(appearance, variant.id, variant) };
}
