/**
 * The rules that keep an unmanaged struct library safe to edit.
 *
 * Nobody opens this table. An author adds a column to a list and expects that list to change, and
 * nothing else - so every write here answers one question first: is this shape mine alone? The three
 * operations below are the whole contract.
 *
 *  - {@link listUIStructOwnerIds} - who names this shape.
 *  - {@link applyUIStructFieldsForOwner} - edit in place when the owner is alone with it, fork when
 *    it is not, and reuse an identical shape when one already exists.
 *  - {@link collectReachableUIStructIds} - what is still named, so the rest can be dropped.
 *
 * Kept pure and in `shared` because three hosts have to agree: the editor writes through it, the
 * build reads it, and a test can drive it without a workspace.
 *
 * Comments in English per project convention.
 */

import { isBuiltinUIStructId } from "./builtinStructs";
import type { UIDocument, UIElement, UIElementId } from "./document";
import type { UIStructDef, UIStructField, UIStructId } from "./struct";
import { normalizeUIStructDef, structsAreCompatible } from "./struct";

/**
 * Prop names that hold a struct id.
 *
 * One literal list, for the reason `UI_ASSET_ID_PROPERTY_NAMES` keeps one: a name only the owner
 * walk knows is a shape that looks unreferenced and gets collected out from under a live widget,
 * and a name only the writer knows is a widget whose shape nothing can reach.
 */
export const UI_STRUCT_ID_PROPERTY_NAMES: ReadonlySet<string> = Object.freeze(
    new Set(["itemStructId"]),
) as ReadonlySet<string>;

/** Every struct id one element names, in prop order. */
export function readUIElementStructIds(element: Pick<UIElement, "props"> | null | undefined): string[] {
    const props = element?.props;
    if (!props || typeof props !== "object") {
        return [];
    }
    const out: string[] = [];
    for (const key of UI_STRUCT_ID_PROPERTY_NAMES) {
        const value = (props as Record<string, unknown>)[key];
        if (typeof value === "string" && value.trim()) {
            out.push(value.trim());
        }
    }
    return out;
}

/**
 * Which elements name this shape.
 *
 * Walks `document.elements` flat rather than descending surfaces: an element detached from every
 * surface (mid-drag, in an undo buffer, inside a component definition) still holds its props, and a
 * shape it names is a shape an edit elsewhere must not reshape.
 */
export function listUIStructOwnerIds(
    document: Pick<UIDocument, "elements" | "components">,
    structId: string,
): UIElementId[] {
    const id = structId.trim();
    if (!id) {
        return [];
    }
    const out: UIElementId[] = [];
    for (const [elementId, element] of Object.entries(document.elements ?? {})) {
        if (readUIElementStructIds(element).includes(id)) {
            out.push(elementId);
        }
    }
    for (const component of document.components ?? []) {
        for (const [elementId, element] of Object.entries(component.elements ?? {})) {
            if (readUIElementStructIds(element).includes(id)) {
                out.push(elementId);
            }
        }
    }
    return out;
}

/** Every struct id anything in the document still names. Built-ins are not in it - nothing stores them. */
export function collectReachableUIStructIds(
    document: Pick<UIDocument, "elements" | "components">,
): Set<UIStructId> {
    const out = new Set<UIStructId>();
    for (const element of Object.values(document.elements ?? {})) {
        for (const id of readUIElementStructIds(element)) {
            out.add(id);
        }
    }
    for (const component of document.components ?? []) {
        for (const element of Object.values(component.elements ?? {})) {
            for (const id of readUIElementStructIds(element)) {
                out.add(id);
            }
        }
    }
    return out;
}

/** The table with every shape nothing names any more removed. */
export function pruneUIStructs(
    document: Pick<UIDocument, "elements" | "components" | "structs">,
): Record<UIStructId, UIStructDef> {
    const reachable = collectReachableUIStructIds(document);
    const out: Record<UIStructId, UIStructDef> = {};
    for (const [id, struct] of Object.entries(document.structs ?? {})) {
        if (reachable.has(id)) {
            out[id] = struct;
        }
    }
    return out;
}

/** An existing shape identical to `fields`, if the library already holds one. */
export function findCompatibleUIStructId(
    structs: Record<UIStructId, UIStructDef> | undefined,
    fields: readonly UIStructField[],
    options: { exclude?: string } = {},
): UIStructId | null {
    const probe: UIStructDef = { id: "", fields: [...fields] };
    for (const [id, struct] of Object.entries(structs ?? {})) {
        if (id === options.exclude) {
            continue;
        }
        if (structsAreCompatible(struct, probe)) {
            return id;
        }
    }
    return null;
}

export type UIStructFieldsApplication = {
    /** The id the owner should now store. Unchanged when the edit landed in place. */
    structId: UIStructId;
    /** The replacement library table. */
    structs: Record<UIStructId, UIStructDef>;
    /** True when the shape was forked because someone else was still using the old one. */
    forked: boolean;
};

/**
 * Give one owner the shape it just declared, without reshaping anybody else's.
 *
 * Four cases, in the order they are tested:
 *
 *  1. **A built-in, or a shape nothing else names but the library already holds under another id** -
 *     reuse that id. Two lists that agree end up the same type, which is what lets one feed the
 *     other and what keeps a project from accumulating a shape per widget.
 *  2. **The owner is alone with this shape** - write the fields where they are. Ids stay put, so
 *     every binding, pin and stored snapshot pointing at this shape keeps pointing at it.
 *  3. **Somebody else names it too** - mint a new id and hand it back for the owner to store. The
 *     other owners keep the shape they had, which is the promise the widget's inspector makes.
 *  4. **No shape yet** - mint one.
 *
 * The owner's own prop is NOT written here; the caller stores `structId`. Keeping the table and the
 * pointer as two writes is what lets a caller do both inside one document transaction.
 */
export function applyUIStructFieldsForOwner(input: {
    document: Pick<UIDocument, "elements" | "components" | "structs">;
    ownerElementId: UIElementId;
    currentStructId: string | null | undefined;
    fields: readonly UIStructField[];
    generateId: () => string;
}): UIStructFieldsApplication {
    const { document, ownerElementId, fields, generateId } = input;
    const structs = { ...(document.structs ?? {}) };
    const currentId = typeof input.currentStructId === "string" ? input.currentStructId.trim() : "";

    const reuseId = findCompatibleUIStructId(structs, fields, { exclude: currentId });
    if (reuseId) {
        return { structId: reuseId, structs, forked: false };
    }

    const sharedWithOthers =
        currentId.length > 0 &&
        (isBuiltinUIStructId(currentId) ||
            listUIStructOwnerIds(document, currentId).some(id => id !== ownerElementId));

    if (currentId && structs[currentId] && !sharedWithOthers) {
        structs[currentId] = { id: currentId, fields: [...fields] };
        return { structId: currentId, structs, forked: false };
    }

    const nextId = generateId();
    structs[nextId] = { id: nextId, fields: [...fields] };
    return { structId: nextId, structs, forked: Boolean(currentId) };
}

/** Read a stored table, dropping entries this build cannot make sense of. */
export function normalizeUIStructLibrary(value: unknown): Record<UIStructId, UIStructDef> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    const out: Record<UIStructId, UIStructDef> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        const struct = normalizeUIStructDef(entry);
        if (!struct) {
            continue;
        }
        // Keyed by the table's key, not by the entry's own id: the key is what widgets store, and an
        // entry whose id drifted from its key would become unreachable while looking present.
        out[key] = struct.id === key ? struct : { ...struct, id: key };
    }
    return out;
}
