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

import { isBuiltinUIStructId, resolveUIStruct } from "./builtinStructs";
import type { UIDocument, UIElement, UIElementId, UIElementValueBinding } from "./document";
import { findOwningListItemTemplate } from "./listItemContext";
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

export type UIStructShapeApplication = {
    /** The id the owner should now store. */
    structId: UIStructId | null;
    /** The replacement library table. */
    structs: Record<UIStructId, UIStructDef>;
    /**
     * Each field of the old shape, by id, to the field of the same name in the new one. A field the
     * new shape has no namesake for is absent, and what named it is left naming nothing.
     */
    fieldIds: Record<string, string>;
};

/**
 * Point one owner at one of the engine's shapes, or (`null`) give it back a shape of its own.
 *
 * Picking an engine shape stores the engine's id rather than a copy: the engine fills those rows, so
 * their fields are the engine's and the inspector shows them as such. Going back copies the engine's
 * fields into a shape of the owner's own under the same ids, so everything that named a field keeps
 * naming it and the author edits from there. An owner already on a shape of its own is left as it is.
 *
 * The owner's own prop is not written here, for the reason {@link applyUIStructFieldsForOwner} gives.
 */
export function applyUIStructShapeForOwner(input: {
    document: Pick<UIDocument, "elements" | "components" | "structs">;
    currentStructId: string | null | undefined;
    shapeId: string | null;
    generateId: () => string;
}): UIStructShapeApplication {
    const structs = { ...(input.document.structs ?? {}) };
    const currentId = typeof input.currentStructId === "string" ? input.currentStructId.trim() : "";
    const current = resolveUIStruct(input.document, currentId);
    if (input.shapeId && isBuiltinUIStructId(input.shapeId)) {
        const shape = resolveUIStruct(null, input.shapeId) as UIStructDef;
        return { structId: input.shapeId, structs, fieldIds: fieldIdsByKey(current, shape) };
    }
    if (!current || !isBuiltinUIStructId(currentId)) {
        return { structId: currentId || null, structs, fieldIds: {} };
    }
    const nextId = input.generateId();
    structs[nextId] = { id: nextId, fields: current.fields.map(field => ({ ...field })) };
    return {
        structId: nextId,
        structs,
        fieldIds: Object.fromEntries(current.fields.map(field => [field.id, field.id])),
    };
}

function fieldIdsByKey(from: UIStructDef | null, to: UIStructDef): Record<string, string> {
    const out: Record<string, string> = {};
    for (const field of from?.fields ?? []) {
        const namesake = to.fields.find(candidate => candidate.key === field.key);
        if (namesake) {
            out[field.id] = namesake.id;
        }
    }
    return out;
}

/**
 * Rewrite what one list's rows name by field id after its shape changed: the list's own key field and
 * every field binding in its item template.
 *
 * `elements` is the table the list lives in - a page's elements or one definition's. Mutates in place.
 * A binding to a field `fieldIds` has no entry for is left as it was; the inspector and the project
 * check both report a binding to a field the shape does not have.
 */
export function remapUIListFieldIds(
    elements: Record<UIElementId, UIElement>,
    listElementId: UIElementId,
    fieldIds: Readonly<Record<string, string>>,
): void {
    const list = elements[listElementId];
    if (!list) {
        return;
    }
    // A key field the new shape has no namesake for goes back to keying rows by position, which is
    // what an unset key means, rather than naming a field no row carries.
    const keyFieldId = (list.props as Record<string, unknown> | undefined)?.itemKeyFieldId;
    if (typeof keyFieldId === "string" && keyFieldId && fieldIds[keyFieldId] !== keyFieldId) {
        const { itemKeyFieldId: _previous, ...rest } = (list.props ?? {}) as Record<string, unknown>;
        list.props = fieldIds[keyFieldId] ? { ...rest, itemKeyFieldId: fieldIds[keyFieldId] } : rest;
    }
    for (const element of Object.values(elements)) {
        if (!element.valueBindings || findOwningListItemTemplate({ elements }, element)?.listElementId !== listElementId) {
            continue;
        }
        let changed = false;
        const bindings: Record<string, UIElementValueBinding> = {};
        for (const [path, binding] of Object.entries(element.valueBindings)) {
            const next = binding.kind === "listItemField" ? fieldIds[binding.fieldId] : undefined;
            if (next && binding.kind === "listItemField" && next !== binding.fieldId) {
                bindings[path] = { ...binding, fieldId: next };
                changed = true;
            } else {
                bindings[path] = binding;
            }
        }
        if (changed) {
            element.valueBindings = bindings;
        }
    }
}
