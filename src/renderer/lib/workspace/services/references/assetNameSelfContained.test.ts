/**
 * The two row pictures a package carries without the project naming them.
 *
 * A picture bound to a list row is normally traced back to a name written in the project, and a row
 * that arrived from a node whose names are assembled at run time is a refusal - that is the whole of
 * `blueprint/assembled-asset-name`, and it is what stops a build shipping a screen that shows
 * nothing. `List Auto Saves` and `Get History` are two such nodes, so the moment the save and
 * backlog rows gained an image field every binding on one was reported, and the skeleton would not
 * build.
 *
 * Neither is a gap. A save slot's screenshot lives in the save file the player's own machine wrote,
 * so no package could have carried it; a speaker's avatar is baked from the character or picked in
 * the character's own profile, and the packager ships it from there. Both halves are asserted here -
 * the exemption, and that it is exactly two fields wide, because an exemption that swallowed the
 * rest of the row would silently turn the refusal off for pictures that really are missing.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import {
    UI_STRUCT_ID_HISTORY_ENTRY,
    UI_STRUCT_ID_SAVE_ENTRY,
} from "@shared/types/ui-editor/builtinStructs";
import { blueprint, document, element, gapsOf, graph } from "./assetNameTestKit";

const SURFACE = "surface-load";
const ROOT = "root";
const LIST = "list-rows";
const ROW_IMAGE = "row-image";

/** A list of engine-owned rows, with one image in the template bound to `fieldId`. */
function interfaceDocument(structId: string, fieldId: string): UIDocument {
    const elements: UIElement[] = [
        element(ROOT, "nl.container", null, { childrenIds: [LIST] }),
        element(LIST, "nl.list", ROOT, { childrenIds: [ROW_IMAGE], props: { itemStructId: structId } }),
        element(ROW_IMAGE, "nl.image", LIST, {
            valueBindings: { "imageFill.assetId": { kind: "listItemField", fieldId } },
        }),
    ];
    return {
        surfaces: [{ id: SURFACE, name: "Load", rootElementId: ROOT }],
        elements: Object.fromEntries(elements.map(entry => [entry.id, entry])),
    } as unknown as UIDocument;
}

/**
 * The graph the skeleton's own Load screen has: a node whose rows the project does not write down,
 * poured into the list. Without an exemption this is what makes every picture in the row a gap.
 */
function fillFromAssembledRows(nodeType: string) {
    return document(blueprint(
        "bp-fill",
        "Fill",
        { kind: "widgetMain", surfaceId: SURFACE, elementId: LIST },
        {
            main: graph(
                [
                    { id: "head", type: "blueprint.event.head.init" },
                    { id: "rows", type: nodeType },
                    { id: "listRef", type: "blueprint.element.ref", params: { surfaceId: SURFACE, elementId: LIST, elementType: "nl.list" } },
                    { id: "set", type: "blueprint.element.list.setItems" },
                ],
                [
                    ["head", "then", "rows", "in"],
                    ["rows", "next", "set", "in"],
                    ["listRef", "element", "set", "element"],
                    ["rows", "entries", "set", "items"],
                ],
            ),
        },
    ));
}

describe("a row picture the package already carries", () => {
    it("does not report a save slot's own screenshot", () => {
        const gaps = gapsOf({
            uiDocument: interfaceDocument(UI_STRUCT_ID_SAVE_ENTRY, "preview"),
            blueprintDocument: fillFromAssembledRows("blueprint.game.autoSave.list"),
        });
        expect(gaps).toHaveLength(0);
    });

    it("does not report a backlog speaker's avatar", () => {
        const gaps = gapsOf({
            uiDocument: interfaceDocument(UI_STRUCT_ID_HISTORY_ENTRY, "avatar"),
            blueprintDocument: fillFromAssembledRows("blueprint.game.history.get"),
        });
        expect(gaps).toHaveLength(0);
    });

    it("still reports another field of the same row", () => {
        // The exemption is per field, not per shape: a picture read from `id` is a library name the
        // package would have to have been told about, and nothing here tells it.
        const gaps = gapsOf({
            uiDocument: interfaceDocument(UI_STRUCT_ID_SAVE_ENTRY, "id"),
            blueprintDocument: fillFromAssembledRows("blueprint.game.autoSave.list"),
        });
        expect(gaps).toHaveLength(1);
    });

    it("still reports the same field name on a shape the project owns", () => {
        // `preview` is only self-contained because `nl.saveEntry` says what it holds. An authored
        // struct that happens to name a field the same way is an ordinary picture.
        const gaps = gapsOf({
            uiDocument: interfaceDocument("author.row", "preview"),
            blueprintDocument: fillFromAssembledRows("blueprint.game.autoSave.list"),
        });
        expect(gaps).toHaveLength(1);
    });
});
