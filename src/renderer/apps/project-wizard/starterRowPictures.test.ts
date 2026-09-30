/**
 * The two pictures the shipped starter draws per row: a save slot's own screenshot, and the face of
 * whoever spoke a backlog line.
 *
 * Both are read from the row rather than fetched by a graph, which is what the `preview` and
 * `avatar` fields on the two engine-owned structs exist for. That makes the wiring a property of the
 * template's own document - one binding, one field id, one struct - and a template that loses it
 * loses it silently: an image with nothing bound draws nothing at all, which on a save screen looks
 * exactly like a run of empty slots.
 *
 * The plate under the auto-save thumbnail is asserted for the same reason the locked gallery tile
 * has one. An `nl.image` with no asset paints nothing - not even its own background colour, because
 * its fill is an image - so without something opaque behind it, a slot written before captures
 * existed would be a hole in the row rather than an empty frame.
 *
 * Comments in English per project convention.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    BUILTIN_UI_STRUCTS,
    UI_STRUCT_ID_HISTORY_ENTRY,
    UI_STRUCT_ID_SAVE_ENTRY,
} from "@shared/types/ui-editor/builtinStructs";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";

const LOCALES = ["content", "content.zh", "content.ja"] as const;

function readDocument(variant: string): UIDocument {
    return JSON.parse(
        fs.readFileSync(
            path.join(process.cwd(), "resources/templates/skeleton", variant, "editor/ui/uidoc.json"),
            "utf-8",
        ),
    ) as UIDocument;
}

/** The one list in the document whose rows are of this struct, and the element template under it. */
function itemTemplate(document: UIDocument, structId: string): { list: UIElement; children: UIElement[] } {
    const lists = Object.values(document.elements).filter(
        element => (element.props as { itemStructId?: unknown } | undefined)?.itemStructId === structId,
    );
    expect(lists).toHaveLength(1);
    const list = lists[0]!;
    const template = (list.childrenIds ?? []).map(id => document.elements[id]!).filter(Boolean);
    expect(template).toHaveLength(1);
    const row = template[0]!;
    return { list, children: (row.childrenIds ?? []).map(id => document.elements[id]!).filter(Boolean) };
}

function boundField(element: UIElement, propPath: string): string | null {
    const binding = element.valueBindings?.[propPath];
    return binding?.kind === "listItemField" ? binding.fieldId : null;
}

describe("the fields these rows read", () => {
    it("declares the save slot's picture and the speaker's face as image fields", () => {
        const save = BUILTIN_UI_STRUCTS[UI_STRUCT_ID_SAVE_ENTRY]!;
        const history = BUILTIN_UI_STRUCTS[UI_STRUCT_ID_HISTORY_ENTRY]!;
        expect(save.fields.find(field => field.key === "preview")?.type).toBe("image");
        expect(history.fields.find(field => field.key === "avatar")?.type).toBe("image");
    });
});

describe.each(LOCALES)("the starter template (%s)", variant => {
    const document = readDocument(variant);

    it("draws each auto-save row's own picture, over a plate that shows when there is none", () => {
        const { children } = itemTemplate(document, UI_STRUCT_ID_SAVE_ENTRY);
        const thumbnail = children.find(child => boundField(child, "imageFill.assetId") === "preview");
        expect(thumbnail?.type).toBe("nl.image");

        // Order is draw order: the plate has to be painted first, or an empty slot would show the
        // plate over the picture on every slot that does have one.
        const plate = children[0]!;
        expect(plate.type).toBe("nl.container");
        expect(children.indexOf(thumbnail!)).toBe(1);
        expect((plate.props as { fillVisible?: unknown }).fillVisible).toBe(true);
        expect((plate.props as { fillType?: unknown }).fillType).toBe("color");
        // The same rectangle, so the empty frame is exactly the space the picture would fill.
        expect(plate.layout).toMatchObject({
            x: thumbnail!.layout.x,
            y: thumbnail!.layout.y,
            width: thumbnail!.layout.width,
            height: thumbnail!.layout.height,
        });
    });

    it("draws the speaker's face on a backlog row, and binds nothing else to a picture there", () => {
        const { children } = itemTemplate(document, UI_STRUCT_ID_HISTORY_ENTRY);
        const pictures = children.filter(child => boundField(child, "imageFill.assetId") !== null);
        expect(pictures).toHaveLength(1);
        expect(pictures[0]!.type).toBe("nl.image");
        expect(boundField(pictures[0]!, "imageFill.assetId")).toBe("avatar");
        // No plate here on purpose: a narration line has no speaker, and an empty frame against
        // every line nobody spoke would read as a picture that failed to load.
        expect(children.filter(child => child.type === "nl.container" && child.layout.width === pictures[0]!.layout.width))
            .toHaveLength(0);
    });
});
