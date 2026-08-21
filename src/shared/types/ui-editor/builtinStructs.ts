/**
 * Shapes the engine owns, and the one place a struct id is turned into a struct.
 *
 * The Game UI slot lists (choice, notification, NVL) never receive authored content: the NarraLeaf
 * slot bridge writes their rows, so their shape is decided by the engine and an author who could
 * edit it would only be able to make it wrong. Declaring them here gives those lists the same field
 * pickers, typed pins and item table headers an authored list gets, without putting a shape that
 * nobody may change into every project's document.
 *
 * Comments in English per project convention.
 */

import type { UIDocument } from "./document";
import type { UIStructDef, UIStructId } from "./struct";

export const UI_STRUCT_ID_CHOICE_ITEM = "nl.choiceItem" as const;
export const UI_STRUCT_ID_NOTIFICATION_ITEM = "nl.notificationItem" as const;
export const UI_STRUCT_ID_NVL_ITEM = "nl.nvlItem" as const;

/**
 * Field ids equal their keys here, and only here.
 *
 * An authored struct mints an id so a rename is free; these keys are the engine's wire format and
 * cannot be renamed at all, so a separate id would be a second name for something that has exactly
 * one. Keeping them equal also makes a graph that names `voiceId` readable in the raw document.
 */
function field(key: string, type: UIStructDef["fields"][number]["type"]): UIStructDef["fields"][number] {
    return { id: key, key, type };
}

/** Mirrors the rows `ChoiceSlotSurface` writes. */
const CHOICE_ITEM_STRUCT: UIStructDef = {
    id: UI_STRUCT_ID_CHOICE_ITEM,
    fields: [
        field("text", "string"),
        field("index", "number"),
        field("disabled", "boolean"),
        field("voiceId", "string"),
    ],
};

/** Mirrors the rows `NotificationSlotSurface` writes. */
const NOTIFICATION_ITEM_STRUCT: UIStructDef = {
    id: UI_STRUCT_ID_NOTIFICATION_ITEM,
    fields: [field("id", "string"), field("message", "string")],
};

/** Mirrors the rows `NvlSlotSurface` writes. */
const NVL_ITEM_STRUCT: UIStructDef = {
    id: UI_STRUCT_ID_NVL_ITEM,
    fields: [field("index", "number"), field("nametag", "string"), field("isActive", "boolean")],
};

export const BUILTIN_UI_STRUCTS: Readonly<Record<UIStructId, UIStructDef>> = Object.freeze({
    [UI_STRUCT_ID_CHOICE_ITEM]: CHOICE_ITEM_STRUCT,
    [UI_STRUCT_ID_NOTIFICATION_ITEM]: NOTIFICATION_ITEM_STRUCT,
    [UI_STRUCT_ID_NVL_ITEM]: NVL_ITEM_STRUCT,
});

/** True for a shape the engine owns: its fields are shown, never edited. */
export function isBuiltinUIStructId(structId: string | null | undefined): boolean {
    return Boolean(structId) && Object.prototype.hasOwnProperty.call(BUILTIN_UI_STRUCTS, structId as string);
}

/**
 * The struct behind an id, from the document first and the built-ins second.
 *
 * Document first so a project that has somehow stored an entry under a built-in id still renders
 * from what it stores rather than from something it cannot see. `null` for an id that resolves
 * nowhere - a shape that was deleted while a widget still names it, which is a diagnostic, not a
 * reason to guess.
 */
export function resolveUIStruct(
    document: Pick<UIDocument, "structs"> | null | undefined,
    structId: string | null | undefined,
): UIStructDef | null {
    const id = typeof structId === "string" ? structId.trim() : "";
    if (!id) {
        return null;
    }
    return document?.structs?.[id] ?? BUILTIN_UI_STRUCTS[id] ?? null;
}
