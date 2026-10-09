import type { Translator } from "@shared/i18n";
import type { UIInputActionDef } from "@shared/types/ui-editor/inputAction";
import { readUINavigationActionIntent, type UINavigationIntent } from "@shared/types/ui-editor/navigation";

type TranslateFn = Translator["t"];

/** What a navigation action is called, in the author's language. */
export function navigationActionName(intent: UINavigationIntent, t: TranslateFn): string {
    switch (intent) {
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

/**
 * The name an author reads for an action: its own for one the project made, Studio's for a
 * navigation action - whose stored name is only its intent, written when the project first rebound
 * it, and not something to show.
 */
export function inputActionDisplayName(action: Pick<UIInputActionDef, "id" | "name">, t: TranslateFn): string {
    const intent = readUINavigationActionIntent(action.id);
    return intent ? navigationActionName(intent, t) : action.name;
}
