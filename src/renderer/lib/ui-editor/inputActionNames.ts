import type { Translator } from "@shared/i18n";
import { UI_NAVIGATION_SLOTS, type UINavigationSlot } from "@shared/types/ui-editor/navigation";

type TranslateFn = Translator["t"];

/** What a navigation slot is called, in the author's language. */
export function navigationSlotName(slot: UINavigationSlot, t: TranslateFn): string {
    switch (slot) {
        case "up":
            return t("uiEditor.inputActions.navigation.up");
        case "down":
            return t("uiEditor.inputActions.navigation.down");
        case "left":
            return t("uiEditor.inputActions.navigation.left");
        case "right":
            return t("uiEditor.inputActions.navigation.right");
        case "next":
            return t("uiEditor.inputActions.navigation.next");
        case "previous":
            return t("uiEditor.inputActions.navigation.previous");
        case "confirm":
            return t("uiEditor.inputActions.navigation.confirm");
        case "cancel":
            return t("uiEditor.inputActions.navigation.cancel");
        case "menu":
            return t("uiEditor.inputActions.navigation.menu");
    }
}

/** Every slot's name, for the intents Studio makes when the author asks it to fill the empty ones. */
export function navigationSlotNames(t: TranslateFn): Record<UINavigationSlot, string> {
    return Object.fromEntries(UI_NAVIGATION_SLOTS.map(slot => [slot, navigationSlotName(slot, t)])) as Record<UINavigationSlot, string>;
}
