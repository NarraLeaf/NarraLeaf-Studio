import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import { formatBlueprintKeyboardBinding } from "@shared/types/blueprint/graph";
import type { UIInputBinding, UIInputPointerGesture } from "@shared/types/ui-editor/inputAction";

export type TranslateFn = (key: TranslationKey, params?: InterpolationParams) => string;

/**
 * What to call one binding.
 *
 * Both halves of the input model show the same chips - the library panel where the project's
 * defaults are set, and the interface's own Input section where a surface adds to them - so the
 * words come from one place, the way `getStageSlotLabel` keeps the five stage slots to one.
 *
 * A key is shown through `formatBlueprintKeyboardBinding` rather than raw, so an author who bound
 * "esc" reads "Escape" here and on the `On Key Down` head that answers the same key.
 */
export function getInputPointerGestureLabel(gesture: UIInputPointerGesture, t: TranslateFn): string {
    return t(`uiEditor.inputActions.gesture.${gesture}`);
}

export function getInputBindingLabel(binding: UIInputBinding, t: TranslateFn): string {
    return binding.kind === "pointer"
        ? getInputPointerGestureLabel(binding.gesture, t)
        : formatBlueprintKeyboardBinding(binding.key) || binding.key;
}
