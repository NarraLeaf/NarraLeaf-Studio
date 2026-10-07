/**
 * The words a value type is shown with.
 *
 * A pin carrying endings says "Ending list", not `array<struct:nl.ending>`: the type string is how the
 * editor compares pins, and nothing an author reads. One place, so the card, the type pickers, the
 * variables, the add-node menu and a diagnostic call one type by one name.
 *
 * Comments in English per project convention.
 */

import type { TranslationKey } from "@shared/i18n";
import {
    BLUEPRINT_VALUE_TYPE_ANIMATION_TOKEN,
    BLUEPRINT_VALUE_TYPE_ARRAY,
    BLUEPRINT_VALUE_TYPE_ELEMENT,
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET,
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE,
    BLUEPRINT_VALUE_TYPE_RECT,
    BLUEPRINT_VALUE_TYPE_RESPONSE_BODY,
    BLUEPRINT_VALUE_TYPE_RGBA_COLOR,
    BLUEPRINT_VALUE_TYPE_SAVE_SLOT,
    BLUEPRINT_VALUE_TYPE_SOUND_HANDLE,
    BLUEPRINT_VALUE_TYPE_TIMER,
    BLUEPRINT_VALUE_TYPE_VECTOR2D,
    blueprintArrayElementType,
    blueprintElementTypeFromValueType,
    isBlueprintElementValueType,
} from "@shared/types/blueprint/valueTypes";
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
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";

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
 * The catalogue word of each type an author picks or meets, keyed by its id.
 *
 * One table across the type spaces, not one per picker: a list field's `number`, a page param's
 * `number` and a story variable's `number` are what a pin carries as `float`, and the author is shown
 * one word for it wherever it appears. The ids that only one space uses (`text` and `audioTrack` for
 * page and component params, `image` and `color` for list fields, `list` for page params) are here
 * for the same reason, so a picker never keeps a word list of its own.
 */
const VALUE_TYPE_NAME_KEYS: Readonly<Record<string, TranslationKey>> = Object.freeze({
    string: "blueprint.valueType.string",
    integer: "blueprint.valueType.integer",
    float: "blueprint.valueType.float",
    number: "blueprint.valueType.number",
    boolean: "blueprint.valueType.boolean",
    json: "blueprint.valueType.json",
    [BLUEPRINT_VALUE_TYPE_ARRAY]: "blueprint.valueType.array",
    list: "blueprint.valueType.list",
    any: "blueprint.valueType.any",
    text: "blueprint.valueType.text",
    audioTrack: "blueprint.valueType.audioTrack",
    image: "blueprint.valueType.image",
    [BLUEPRINT_VALUE_TYPE_IMAGE_ASSET]: "blueprint.valueType.imageAsset",
    [BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE]: "blueprint.valueType.imageAssetOrNull",
    color: "blueprint.valueType.color",
    [BLUEPRINT_VALUE_TYPE_RGBA_COLOR]: "blueprint.valueType.rgbaColor",
    [BLUEPRINT_VALUE_TYPE_VECTOR2D]: "blueprint.valueType.vector2D",
    [BLUEPRINT_VALUE_TYPE_RECT]: "blueprint.valueType.rect",
    [BLUEPRINT_VALUE_TYPE_TIMER]: "blueprint.valueType.timer",
    [BLUEPRINT_VALUE_TYPE_ANIMATION_TOKEN]: "blueprint.valueType.animationToken",
    [BLUEPRINT_VALUE_TYPE_SOUND_HANDLE]: "blueprint.valueType.soundHandle",
    [BLUEPRINT_VALUE_TYPE_RESPONSE_BODY]: "blueprint.valueType.responseBody",
    [BLUEPRINT_VALUE_TYPE_SAVE_SLOT]: "blueprint.valueType.saveSlot",
    [BLUEPRINT_VALUE_TYPE_ELEMENT]: "blueprint.valueType.element",
});

/**
 * Where a type's words appear, which decides how English writes them.
 *
 * - `"inline"` - beside a pin's name, on a variable's chip, in the add-node menu's header and in a
 *   message. English writes the type id there, the spelling the node reference, the command line and
 *   the files use; the other languages write the type's word.
 * - `"option"` - as an entry of a type picker, where every language, English included, writes a word.
 */
export type BlueprintValueTypeLabelForm = "inline" | "option";

/** A type's word, or undefined for a type no catalogue names (a plugin's own). */
function valueTypeName(valueType: string, t: Translate): string | undefined {
    const key = VALUE_TYPE_NAME_KEYS[valueType];
    if (key) {
        return t(key);
    }
    if (isBlueprintElementValueType(valueType)) {
        // An element of one kind of widget is named after the widget, by the name the insert palette
        // gives it. A widget no loaded module draws has no name to give, so it reads as an element.
        const widgetType = blueprintElementTypeFromValueType(valueType);
        const widget = widgetType ? widgetModuleRegistry.get(widgetType)?.displayName : undefined;
        return widget ? t("blueprint.valueType.elementOf", { widget }) : t("blueprint.valueType.element");
    }
    return undefined;
}

/**
 * A value type as an author reads it: the one formatter every pin, type picker, variable, menu and
 * message names a type through.
 *
 * Struct types read by the struct's name and `array<T>` as a list of `T`, in every language. Every
 * other type reads by its catalogue word (`blueprint.valueType.*`), written as {@link
 * BlueprintValueTypeLabelForm} says - so English keeps the type ids beside pins and in messages. A
 * type no catalogue names, a plugin's own, is shown as it is spelled.
 *
 * Only for the interface: what an author types, and what a file or the command line holds, keeps the
 * type id.
 */
export function formatBlueprintValueTypeLabel(
    valueType: string | undefined,
    t: Translate,
    form: BlueprintValueTypeLabelForm = "inline",
): string {
    if (!valueType) {
        return "";
    }
    if (isUIStructValueType(valueType)) {
        return blueprintStructName(uiStructIdFromValueType(valueType), t);
    }
    const element = blueprintArrayElementType(valueType);
    if (element !== undefined) {
        return t("blueprint.struct.arrayOf", { name: formatBlueprintValueTypeLabel(element, t, form) });
    }
    const name = valueTypeName(valueType, t);
    if (name === undefined) {
        return valueType;
    }
    return form === "option" ? name : t("blueprint.valueType.inline", { id: valueType, name });
}
