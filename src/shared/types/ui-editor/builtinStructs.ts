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
export const UI_STRUCT_ID_HISTORY_ENTRY = "nl.historyEntry" as const;
export const UI_STRUCT_ID_SAVE_ENTRY = "nl.saveEntry" as const;
export const UI_STRUCT_ID_CONFIRM_BUTTON = "nl.confirmButton" as const;
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

/**
 * Mirrors `BlueprintGameHistoryEntry`, the rows `Get History` and `Get Future` hand out.
 *
 * Not a slot shape but engine-owned all the same, and declared here for the same reason: a backlog
 * is a list of these in every project there will ever be, so binding one should not begin with an
 * author writing down what the engine already knows.
 *
 * `avatar` is the one field the engine does not hand over: the backlog records who spoke, and the
 * picture that stands for them is the project's own answer, resolved from the character table the
 * dialog avatar is resolved from. Null for narration, for a menu row and for a speaker this project
 * has no character for.
 */
const HISTORY_ENTRY_STRUCT: UIStructDef = {
    id: UI_STRUCT_ID_HISTORY_ENTRY,
    fields: [
        field("id", "string"),
        field("type", "string"),
        field("text", "string"),
        field("character", "string"),
        field("avatar", "image"),
        field("voice", "string"),
        field("voiceId", "string"),
        field("selected", "string"),
        field("isPending", "boolean"),
    ],
};

/**
 * Mirrors the entries the save nodes list.
 *
 * `metadata` stays `json`: what is in it is the project's own save schema, which differs per
 * project and is read through the save nodes that grow pins for it.
 *
 * `preview` is the slot's own picture - the same one `Get Save Preview` hands back for this id, and
 * null for a slot written without one (an older save, or a write whose capture failed). It rides the
 * row rather than only the node so that a save screen built as a list can show a thumbnail per row
 * with no graph at all: a row is what a list draws, and a picture that differs per row has to be a
 * field to be one.
 */
const SAVE_ENTRY_STRUCT: UIStructDef = {
    id: UI_STRUCT_ID_SAVE_ENTRY,
    fields: [
        field("id", "string"),
        field("slot", "number"),
        field("timestamp", "number"),
        field("createdAt", "number"),
        field("preview", "image"),
        field("metadata", "json"),
    ],
};

/** Mirrors the `buttons` prop `Show Confirm` opens its page with. */
const CONFIRM_BUTTON_STRUCT: UIStructDef = {
    id: UI_STRUCT_ID_CONFIRM_BUTTON,
    fields: [
        field("id", "string"),
        field("text", "string"),
        field("index", "number"),
        field("disabled", "boolean"),
    ],
};

export const BUILTIN_UI_STRUCTS: Readonly<Record<UIStructId, UIStructDef>> = Object.freeze({
    [UI_STRUCT_ID_CHOICE_ITEM]: CHOICE_ITEM_STRUCT,
    [UI_STRUCT_ID_NOTIFICATION_ITEM]: NOTIFICATION_ITEM_STRUCT,
    [UI_STRUCT_ID_NVL_ITEM]: NVL_ITEM_STRUCT,
    [UI_STRUCT_ID_HISTORY_ENTRY]: HISTORY_ENTRY_STRUCT,
    [UI_STRUCT_ID_SAVE_ENTRY]: SAVE_ENTRY_STRUCT,
    [UI_STRUCT_ID_CONFIRM_BUTTON]: CONFIRM_BUTTON_STRUCT,
});

/** True for a shape the engine owns: its fields are shown, never edited. */
export function isBuiltinUIStructId(structId: string | null | undefined): boolean {
    return Boolean(structId) && Object.prototype.hasOwnProperty.call(BUILTIN_UI_STRUCTS, structId as string);
}

/**
 * The image fields of these shapes whose picture the package already accounts for.
 *
 * A picture bound to a list row normally has to be traced back to a name written in the project,
 * because a package carries only the library assets it can see named - that is what
 * `blueprint/assembled-asset-name` refuses. These two are the exceptions, and each for its own
 * reason rather than as a blanket exemption for engine-owned rows:
 *
 *  - `nl.saveEntry.preview` is a slot's own screenshot, addressed the way `Get Save Preview`
 *    addresses it. It is not a library asset at all - the bytes live in the save file the player's
 *    own machine wrote, and no package could have carried them.
 *  - `nl.historyEntry.avatar` is a character's dialog avatar, which is either a file baked from the
 *    character (a derived project file the packager ships from the character table) or the asset
 *    the author picked in the character's own profile (written down there, and swept from there).
 *
 * So a binding on either names nothing the package would miss. Kept beside the structs rather than
 * in the rule, because it is a fact about what these fields hold.
 */
const ENGINE_OWNED_IMAGE_FIELDS: Readonly<Record<UIStructId, readonly string[]>> = Object.freeze({
    [UI_STRUCT_ID_SAVE_ENTRY]: ["preview"],
    [UI_STRUCT_ID_HISTORY_ENTRY]: ["avatar"],
});

/**
 * Whether a picture read from this field of this shape is one the package already carries.
 *
 * Asked by the asset-name sweep before it reports a row-bound picture as a name assembled at run
 * time. Takes the field *id*, which for a built-in struct equals its key - see {@link field}.
 */
export function isSelfContainedStructImageField(
    structId: string | null | undefined,
    fieldId: string | null | undefined,
): boolean {
    const id = typeof structId === "string" ? structId.trim() : "";
    const field = typeof fieldId === "string" ? fieldId.trim() : "";
    return Boolean(id && field && ENGINE_OWNED_IMAGE_FIELDS[id]?.includes(field));
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
