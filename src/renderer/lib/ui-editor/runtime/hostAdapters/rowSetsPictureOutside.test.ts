/**
 * Press a tile in a gallery, and the picture that tile holds is shown big, in an image outside the
 * list.
 *
 * The gesture a CG screen is built from: `Item Click` reads the pressed row's picture with
 * `Get Item Field` and hands it to `Set Image Asset` on an image beside the list - here one inside a
 * viewer the same press shows, which is how a viewer is usually built, and one standing on the page.
 * Two things have to be right for it to draw, and neither is visible in the graph: the write has to
 * land on the image the page draws rather than on the pressed row's copy of it, and the row's
 * picture - which arrives as an image-asset value, not as a bare id - has to reach the image's fill
 * as the id it holds.
 *
 * Driven through what a running game uses (the Dev Mode host adapter, the real host API, the built-in
 * nodes) and asserted on what the image holds afterwards, read back through the host the way any
 * other graph would read it.
 *
 * Comments in English per project convention.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_ASSET,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
} from "@shared/types/blueprint/graph";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { buildUIListItemInstanceKey, type UIListItemScope } from "@shared/types/ui-editor/list";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import { buildUIWidgetAddress } from "@shared/types/ui-editor/widgetAddress";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { blueprintOf, createRowRuntime, graphOf } from "../testing/rowRuntimeTestKit";

const PAGE = "extra";

/** One gallery entry: its name and its picture, as the gallery plugin hands them to a list. */
const PICTURE_STRUCT: UIStructDef = {
    id: "galleryPicture",
    fields: [
        { id: "f-name", key: "name", type: "string" },
        { id: "f-image", key: "image", type: "image" },
    ],
};

type Spec = { type: string; parent: string | null; template?: true; hidden?: true };

function elementsOf(specs: Record<string, Spec>): Record<string, UIElement> {
    const out: Record<string, UIElement> = {};
    for (const [id, spec] of Object.entries(specs)) {
        out[id] = {
            id,
            type: spec.type,
            parentId: spec.parent,
            childrenIds: Object.entries(specs).filter(([, child]) => child.parent === id).map(([childId]) => childId),
            layout: { x: 0, y: 0, width: 40, height: 40, visible: !spec.hidden },
            ...(spec.type === "nl.image" ? { props: { fillType: "image", imageFill: { mode: "contain" } } } : {}),
            ...(spec.template ? { extra: { listSlot: "itemTemplate" } } : {}),
        };
    }
    return out;
}

/**
 * A gallery whose tiles each draw their own picture, a viewer beside it holding the big picture,
 * and a poster standing on the page itself.
 */
const document: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [
        {
            id: PAGE,
            name: "Extra",
            host: "app",
            kind: "appSurface",
            designSize: { width: 640, height: 360 },
            rootElementId: "root",
        },
    ],
    structs: { [PICTURE_STRUCT.id]: PICTURE_STRUCT },
    elements: elementsOf({
        root: { type: "nl.root", parent: null },
        grid: { type: "nl.list", parent: "root" },
        tile: { type: "nl.container", parent: "grid", template: true },
        thumbnail: { type: "nl.image", parent: "tile" },
        viewer: { type: "nl.container", parent: "root", hidden: true },
        big: { type: "nl.image", parent: "viewer" },
        poster: { type: "nl.image", parent: "root" },
    }),
};

function ref(elementId: string) {
    return {
        type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
        params: { surfaceId: PAGE, elementId, elementType: document.elements[elementId]!.type },
    };
}

/** The grid's Item Click: show the viewer, then give `target` the pressed tile's picture. */
function gridShowingPictureOn(target: string) {
    return blueprintOf("bp-grid", { kind: "widgetMain", surfaceId: PAGE, elementId: "grid" }, {
        open: {
            graph: graphOf({
                nodes: {
                    head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK },
                    viewer: ref("viewer"),
                    show: { type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY, params: { property: "visible", value: true } },
                    picture: { type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params: { field: "f-image" } },
                    target: ref(target),
                    set: { type: BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_ASSET },
                },
                exec: ["head", "show", "set"],
                data: [
                    ["viewer", "element", "show", "element"],
                    ["target", "element", "set", "element"],
                    ["picture", "value", "set", "asset"],
                ],
            }),
        },
    });
}

/** A row of the gallery as the list hands it to an event: the picture as an image-asset value. */
function pictureRow(key: string, index: number): UIListItemScope {
    return {
        item: { name: key, image: { kind: "imageAsset", assetId: `asset-${key}` } },
        index,
        count: 3,
        key,
        struct: PICTURE_STRUCT,
        selected: false,
    };
}

async function press(page: ReturnType<typeof createRowRuntime>, key: string, index: number): Promise<void> {
    await page.runtime.dispatchElementBlueprintEvent("grid", "itemClick", { index }, {
        listItemScope: pictureRow(key, index),
        instanceKey: buildUIListItemInstanceKey(undefined, "grid", key),
    });
}

beforeAll(() => {
    registerCoreBlueprintNodes();
});

let page: ReturnType<typeof createRowRuntime>;
afterEach(() => {
    page.release();
    expect(page.errors).toEqual([]);
});

describe("a gallery tile's Item Click setting the picture of an image outside the list", () => {
    it.each([
        ["inside a viewer the same press shows", "big"],
        ["standing on the page", "poster"],
    ])("gives the image %s the pressed tile's picture", async (_where, target) => {
        page = createRowRuntime([gridShowingPictureOn(target)], { document });

        await press(page, "washroom", 2);

        expect(page.hostApi.widget.getImageProperties(target).assetId).toBe("asset-washroom");
        // Not the pressed row's copy of the image, which nothing draws.
        const rowCopy = buildUIWidgetAddress(target, buildUIListItemInstanceKey(undefined, "grid", "washroom"));
        expect(page.hostApi.widget.getImageProperties(rowCopy).assetId).toBeNull();
        expect(page.visibleWrites()).toContainEqual(["viewer", true]);
    });

    it("shows the picture of whichever tile was pressed last", async () => {
        page = createRowRuntime([gridShowingPictureOn("big")], { document });

        await press(page, "washroom", 2);
        await press(page, "corridor", 1);

        expect(page.hostApi.widget.getImageProperties("big").assetId).toBe("asset-corridor");
    });
});
