import type { TranslationKey } from "@shared/i18n";
import { listBlueprintKeyboardBindingKeys } from "@shared/types/blueprint/graph";
import { getKeyName } from "@/lib/i18n/keyNames";

type TranslateFn = (key: TranslationKey) => string;

/**
 * A stored keyboard binding as an author reads it: "Ctrl+Arrow Up" under English, "Ctrl+上方向键"
 * under Chinese. Empty when the binding cannot be read.
 *
 * A binding is stored in one English spelling ("Arrow Up", "Escape", "pageup"), the one the
 * `On Key Down` heads and the input actions match against, and that spelling never changes with
 * the interface language. Every place Studio shows a binding - the key heads, the input action
 * chips, the template preview, the capture preview while a key is being pressed - reads it through
 * here instead, so each key is named as {@link getKeyName} names it and the stored value is never
 * touched.
 *
 * Takes its translator as an argument: components pass the `t` they hold.
 */
export function getKeyboardBindingLabel(binding: unknown, t: TranslateFn): string {
    return listBlueprintKeyboardBindingKeys(binding).map(key => getKeyName(key, t)).join("+");
}
