/**
 * The words a struct type is shown with.
 *
 * A pin carrying endings says "Ending list", not `array<struct:nl.ending>`: the type string is how the
 * editor compares pins, and nothing an author reads. One place, so the card, the add-node menu and a
 * diagnostic call one shape by one name.
 *
 * Comments in English per project convention.
 */

import type { TranslationKey } from "@shared/i18n";
import { blueprintArrayElementType } from "@shared/types/blueprint/valueTypes";
import {
    UI_STRUCT_ID_CHOICE_ITEM,
    UI_STRUCT_ID_CONFIRM_BUTTON,
    UI_STRUCT_ID_ENDING,
    UI_STRUCT_ID_HISTORY_ENTRY,
    UI_STRUCT_ID_LANGUAGE,
    UI_STRUCT_ID_NOTIFICATION_ITEM,
    UI_STRUCT_ID_NVL_ITEM,
    UI_STRUCT_ID_SAVE_ENTRY,
    UI_STRUCT_ID_VOICE_LANGUAGE,
    pluginUIStructName,
} from "@shared/types/ui-editor/builtinStructs";
import { i18nStore } from "@/lib/i18n";
import { isUIStructValueType, uiStructIdFromValueType } from "@shared/types/ui-editor/struct";

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

const BUILTIN_STRUCT_NAME_KEYS: Readonly<Record<string, TranslationKey>> = Object.freeze({
    [UI_STRUCT_ID_CHOICE_ITEM]: "blueprint.struct.choiceItem",
    [UI_STRUCT_ID_NOTIFICATION_ITEM]: "blueprint.struct.notificationItem",
    [UI_STRUCT_ID_NVL_ITEM]: "blueprint.struct.nvlItem",
    [UI_STRUCT_ID_HISTORY_ENTRY]: "blueprint.struct.historyEntry",
    [UI_STRUCT_ID_SAVE_ENTRY]: "blueprint.struct.saveEntry",
    [UI_STRUCT_ID_CONFIRM_BUTTON]: "blueprint.struct.confirmButton",
    [UI_STRUCT_ID_ENDING]: "blueprint.struct.ending",
    [UI_STRUCT_ID_LANGUAGE]: "blueprint.struct.language",
    [UI_STRUCT_ID_VOICE_LANGUAGE]: "blueprint.struct.voiceLanguage",
});

/**
 * The catalogue key a struct is named by. The engine's shapes have their own; any other shape is a
 * list's, declared on the list and nameless, so it reads as the row it is.
 *
 * A key rather than words for a reader that may not translate where it runs - a project check rule
 * hands it on to whoever renders the finding.
 */
export function blueprintStructNameKey(structId: string | null | undefined): TranslationKey {
    if (!structId) {
        return "blueprint.struct.any";
    }
    return BUILTIN_STRUCT_NAME_KEYS[structId] ?? "blueprint.struct.listRow";
}

/**
 * A struct's name, in the interface language. See {@link blueprintStructNameKey}; a plugin's shape is
 * named by its manifest, in the editor's language where the manifest gives one.
 */
export function blueprintStructName(structId: string | null | undefined, t: Translate): string {
    return pluginUIStructName(structId, i18nStore.getLocale()) ?? t(blueprintStructNameKey(structId));
}

/**
 * A struct's name as a finding's parameter: a catalogue key for the engine's shapes and a list's own,
 * so the panel renders it in whatever language it is shown in, and the manifest's words for a
 * plugin's, which no catalogue holds.
 */
export function blueprintStructNameParam(structId: string | null | undefined): { value: string; key?: TranslationKey } {
    const plugin = pluginUIStructName(structId, i18nStore.getLocale());
    return plugin ? { value: plugin } : { value: structId ?? "", key: blueprintStructNameKey(structId) };
}

/**
 * A pin's value type as an author reads it: struct types by name, everything else as it is spelled.
 *
 * The other types stay raw on purpose - `string`, `float`, `json` are what the card has always shown
 * and what the documentation names - so only the types this module introduces are given words.
 */
export function formatBlueprintValueTypeLabel(valueType: string | undefined, t: Translate): string {
    if (!valueType) {
        return "";
    }
    if (isUIStructValueType(valueType)) {
        return blueprintStructName(uiStructIdFromValueType(valueType), t);
    }
    const element = blueprintArrayElementType(valueType);
    if (element !== undefined) {
        return t("blueprint.struct.arrayOf", { name: formatBlueprintValueTypeLabel(element, t) });
    }
    return valueType;
}
