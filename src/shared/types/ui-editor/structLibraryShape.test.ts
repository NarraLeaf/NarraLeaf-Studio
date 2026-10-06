/**
 * Giving a list one of the engine's shapes, and taking it back.
 *
 * What an author sees is a list whose rows still show what they showed: a label bound to the name
 * field keeps showing the name after the list becomes an ending list, because the binding is moved to
 * the ending's field of that name. And going back to a shape of the list's own changes nothing that
 * names a field - the fields are copied under the ids they had.
 */

import { describe, expect, it } from "vitest";
import { UI_STRUCT_ID_ENDING, resolveUIStruct } from "./builtinStructs";
import type { UIDocument, UIElement } from "./document";
import type { UIStructDef } from "./struct";
import { applyUIStructShapeForOwner, remapUIListFieldIds } from "./structLibrary";

const OWN: UIStructDef = {
    id: "own",
    fields: [
        { id: "f-name", key: "name", type: "string" },
        { id: "f-reached", key: "isReached", type: "boolean" },
        { id: "f-note", key: "note", type: "string" },
    ],
};

function element(id: string, type: string, parentId: string | null, extra: Partial<UIElement> = {}): UIElement {
    return {
        id,
        type,
        name: id,
        parentId,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10 },
        ...extra,
    };
}

function listDocument(): Pick<UIDocument, "elements" | "components" | "structs"> {
    return {
        elements: {
            list: element("list", "nl.list", null, {
                childrenIds: ["title", "outside"],
                props: { itemStructId: "own", itemKeyFieldId: "f-name" },
            }),
            title: element("title", "nl.text", "list", {
                valueBindings: {
                    text: { kind: "listItemField", fieldId: "f-name" },
                    "layout.visible": { kind: "listItemField", fieldId: "f-reached" },
                },
            }),
            note: element("note", "nl.text", "list", {
                valueBindings: { text: { kind: "listItemField", fieldId: "f-note" } },
            }),
            outside: element("outside", "nl.text", null, {
                valueBindings: { text: { kind: "listItemField", fieldId: "f-name" } },
            }),
        },
        structs: { own: OWN },
    };
}

describe("picking one of the engine's shapes", () => {
    it("stores the engine's id and maps each field to the engine's field of the same name", () => {
        const applied = applyUIStructShapeForOwner({
            document: listDocument(),
            currentStructId: "own",
            shapeId: UI_STRUCT_ID_ENDING,
            generateId: () => "minted",
        });
        expect(applied.structId).toBe(UI_STRUCT_ID_ENDING);
        expect(applied.fieldIds).toEqual({ "f-name": "name", "f-reached": "isReached" });
    });

    it("moves the item template's bindings and the key field, and leaves a field with no namesake alone", () => {
        const document = listDocument();
        remapUIListFieldIds(document.elements, "list", { "f-name": "name", "f-reached": "isReached" });
        expect(document.elements.title!.valueBindings).toEqual({
            text: { kind: "listItemField", fieldId: "name" },
            "layout.visible": { kind: "listItemField", fieldId: "isReached" },
        });
        expect(document.elements.note!.valueBindings?.text).toEqual({ kind: "listItemField", fieldId: "f-note" });
        expect((document.elements.list!.props as Record<string, unknown>).itemKeyFieldId).toBe("name");
        // Not drawn by this list, so not this list's field.
        expect(document.elements.outside!.valueBindings?.text).toEqual({ kind: "listItemField", fieldId: "f-name" });
    });

    it("keys rows by position when the key field has no namesake", () => {
        const document = listDocument();
        remapUIListFieldIds(document.elements, "list", { "f-reached": "isReached" });
        expect(document.elements.list!.props).not.toHaveProperty("itemKeyFieldId");
    });
});

describe("going back to a shape of the list's own", () => {
    it("copies the engine's fields under the ids they had", () => {
        const document = { ...listDocument(), structs: {} };
        const applied = applyUIStructShapeForOwner({
            document,
            currentStructId: UI_STRUCT_ID_ENDING,
            shapeId: null,
            generateId: () => "minted",
        });
        expect(applied.structId).toBe("minted");
        expect(applied.structs.minted!.fields).toEqual(resolveUIStruct(null, UI_STRUCT_ID_ENDING)!.fields);
        expect(Object.entries(applied.fieldIds).every(([from, to]) => from === to)).toBe(true);
    });

    it("leaves a list already on its own shape as it is", () => {
        const applied = applyUIStructShapeForOwner({
            document: listDocument(),
            currentStructId: "own",
            shapeId: null,
            generateId: () => "minted",
        });
        expect(applied.structId).toBe("own");
        expect(applied.fieldIds).toEqual({});
    });
});
