// @vitest-environment jsdom
/**
 * A list row reading its own data through a declared field, exercised on the real render path.
 *
 * The shape of the defect this guards against is the one that is easiest to misread: the row count
 * is right and every row shows the same thing. So every assertion here uses rows whose values
 * differ, and checks all of them - a binding that resolved once against the template would pass any
 * test that only counted rows or only looked at the first.
 *
 * No blueprint document and no value runtime: a field binding is a read off the item scope, and
 * proving it needs neither is the point. That is also what makes it work on the design canvas,
 * where there is no runtime at all.
 */
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UISurface } from "@shared/types/ui-editor/document";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { ListRenderer } from "@/lib/ui-editor/widget-modules/builtin/list/renderer";
import { SurfaceElementTree } from "./SurfaceElementTree";

const SURFACE_ID = "surface";

const surface: UISurface = {
    id: SURFACE_ID,
    name: "Surface",
    host: "app",
    kind: "appSurface",
    designSize: { width: 320, height: 240 },
    rootElementId: "root",
};

const STRUCT: UIStructDef = {
    id: "struct-1",
    fields: [
        { id: "f-id", key: "id", type: "string" },
        { id: "f-title", key: "title", type: "string" },
        { id: "f-count", key: "count", type: "number" },
        { id: "f-thumb", key: "thumb", type: "image" },
    ],
};

function listDocument(input: {
    items: unknown[];
    boundFieldId: string | null;
    structId?: string | null;
}): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [surface],
        structs: { [STRUCT.id]: STRUCT },
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["list"],
                layout: { x: 0, y: 0, width: 320, height: 240 },
            },
            list: {
                id: "list",
                type: "nl.list",
                parentId: "root",
                childrenIds: ["row"],
                layout: { x: 0, y: 0, width: 320, height: 240 },
                props: {
                    items: input.items,
                    itemStructId: input.structId === undefined ? STRUCT.id : input.structId,
                    itemKeyFieldId: "f-id",
                },
            },
            row: {
                id: "row",
                type: "nl.text",
                parentId: "list",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 320, height: 30 },
                props: { text: "AUTHORED" },
                extra: { listSlot: "itemTemplate" },
                ...(input.boundFieldId
                    ? { valueBindings: { text: { kind: "listItemField" as const, fieldId: input.boundFieldId } } }
                    : {}),
            },
        },
    };
}

function imageListDocument(items: unknown[]): UIDocument {
    const document = listDocument({ items, boundFieldId: null });
    document.elements.row = {
        id: "row",
        type: "nl.image",
        parentId: "list",
        childrenIds: [],
        layout: { x: 0, y: 0, width: 40, height: 40 },
        props: { imageFill: { mode: "cover", assetId: null } },
        extra: { listSlot: "itemTemplate" },
        valueBindings: { "imageFill.assetId": { kind: "listItemField", fieldId: "f-thumb" } },
    };
    return document;
}

function rendererRegistry(): ElementRendererRegistry {
    return new ElementRendererRegistry([
        { type: "nl.root", render: props => <>{props.children}</> },
        { type: "nl.text", render: props => <span>[{String(props.element.props?.text ?? "")}]</span> },
        {
            type: "nl.image",
            render: props => (
                <span>
                    [{String((props.element.props?.imageFill as { assetId?: unknown } | undefined)?.assetId ?? "")}]
                </span>
            ),
        },
        { type: "nl.list", render: props => <ListRenderer {...props} /> },
    ]);
}

function hostAdapter(): UIHostAdapter {
    return { host: "app" } as unknown as UIHostAdapter;
}

function mount(document: UIDocument) {
    return render(
        <SurfaceElementTree
            document={document}
            surface={surface}
            rootElement={document.elements.root!}
            rendererRegistry={rendererRegistry()}
            hostAdapter={hostAdapter()}
            editorChrome={false}
        />,
    );
}

function renderedTexts(container: HTMLElement): string[] {
    return [...container.querySelectorAll("span")].map(node => node.textContent ?? "");
}

beforeAll(() => {
    if (typeof globalThis.ResizeObserver === "undefined") {
        globalThis.ResizeObserver = class {
            public observe(): void {}
            public unobserve(): void {}
            public disconnect(): void {}
        } as unknown as typeof ResizeObserver;
    }
});

afterEach(() => cleanup());

describe("list item field bindings", () => {
    it("gives every row its own value", () => {
        const { container } = mount(
            listDocument({
                items: [
                    { id: "a", title: "First", count: 1 },
                    { id: "b", title: "Second", count: 2 },
                    { id: "c", title: "Third", count: 3 },
                ],
                boundFieldId: "f-title",
            }),
        );
        expect(renderedTexts(container)).toEqual(["[First]", "[Second]", "[Third]"]);
    });

    it("reads a number field as the text it shows", () => {
        const { container } = mount(
            listDocument({
                items: [{ id: "a", count: 7 }, { id: "b", count: 8 }],
                boundFieldId: "f-count",
            }),
        );
        expect(renderedTexts(container)).toEqual(["[7]", "[8]"]);
    });

    it("binds a picture per row, unwrapping the asset envelope", () => {
        const { container } = mount(
            imageListDocument([
                { id: "a", thumb: { kind: "imageAsset", assetId: "asset-1" } },
                { id: "b", thumb: { kind: "imageAsset", assetId: "asset-2" } },
            ]),
        );
        expect(renderedTexts(container)).toEqual(["[asset-1]", "[asset-2]"]);
    });

    it("leaves the authored prop alone when the field is not declared", () => {
        const { container } = mount(
            listDocument({
                items: [{ id: "a", title: "First" }, { id: "b", title: "Second" }],
                boundFieldId: "f-missing",
            }),
        );
        expect(renderedTexts(container)).toEqual(["[AUTHORED]", "[AUTHORED]"]);
    });

    it("draws placeholder rows in the declared shape when there is no content", () => {
        const { container } = mount(listDocument({ items: [], boundFieldId: "f-title" }));
        // Four blanks rather than four copies of the authored placeholder: the row is bound, so what
        // it shows is the field's empty value, which is what it will show once there is content.
        expect(renderedTexts(container)).toEqual(["[]", "[]", "[]", "[]"]);
    });
});
