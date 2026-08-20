import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { createDevModeBlueprintHostApi } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { getListProps, resolveListItemsBindingArray } from "./helpers";

function reader(values: Record<string, unknown>) {
    return { get: (key: string) => values[key] };
}

function listDocument(props: Record<string, unknown>): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "page",
                name: "Page",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root",
            },
        ],
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["list"],
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
            list: {
                id: "list",
                type: "nl.list",
                parentId: "root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 320, height: 180 },
                props,
            },
        },
    };
}

function hostApiFor(document: UIDocument, pageProps: Record<string, unknown>) {
    return createDevModeBlueprintHostApi({
        document,
        scope: new ScopeStoreBridge(),
        activeSurfaceId: "page",
        pageProps,
        emit: () => undefined,
        onOpenSurface: () => undefined,
        onPageBack: () => undefined,
        onWidgetPatch: () => undefined,
        widgetRuntimeStore: new WidgetRuntimeStateStore(),
    });
}

function normalizedBinding(props: Record<string, unknown>) {
    return getListProps(listDocument(props).elements.list).itemsBinding;
}

describe("list items binding normalization", () => {
    it("keeps a page prop binding and still rejects unknown kinds", () => {
        expect(normalizedBinding({ itemsBinding: { kind: "pageProp", key: " chapters " } }))
            .toEqual({ kind: "pageProp", key: "chapters" });
        expect(normalizedBinding({ itemsBinding: { kind: "sceneState", key: "chapters" } })).toBeNull();
        expect(normalizedBinding({ itemsBinding: null })).toBeNull();
    });

    it("keeps a source that has no key yet, so the inspector can hold a half-made binding", () => {
        for (const kind of ["surfaceState", "globalState", "pageProp"]) {
            expect(normalizedBinding({ itemsBinding: { kind } })).toEqual({ kind, key: "" });
            expect(normalizedBinding({ itemsBinding: { kind, key: "  " } })).toEqual({ kind, key: "" });
        }
    });
});

describe("resolveListItemsBindingArray", () => {
    const sources = {
        surfaceState: reader({ shared: ["surface"] }),
        globalState: reader({ shared: ["global"] }),
        pageProps: { shared: ["page"], chapters: [{ id: "one" }, { id: "two" }] },
    };

    it("reads each kind from its own source and never from a neighbour", () => {
        expect(resolveListItemsBindingArray({ kind: "surfaceState", key: "shared" }, sources)).toEqual(["surface"]);
        expect(resolveListItemsBindingArray({ kind: "globalState", key: "shared" }, sources)).toEqual(["global"]);
        expect(resolveListItemsBindingArray({ kind: "pageProp", key: "shared" }, sources)).toEqual(["page"]);
        expect(resolveListItemsBindingArray({ kind: "pageProp", key: "chapters" }, sources))
            .toEqual([{ id: "one" }, { id: "two" }]);
    });

    it("reads a missing key as unbound, the same as the two state kinds", () => {
        expect(resolveListItemsBindingArray({ kind: "pageProp", key: "absent" }, sources)).toBeNull();
        expect(resolveListItemsBindingArray({ kind: "surfaceState", key: "absent" }, sources)).toBeNull();
        expect(resolveListItemsBindingArray({ kind: "globalState", key: "absent" }, sources)).toBeNull();
        expect(resolveListItemsBindingArray({ kind: "pageProp", key: "chapters" }, {})).toBeNull();
        expect(resolveListItemsBindingArray(null, sources)).toBeNull();
    });

    it("reads a source with no key yet as unbound", () => {
        expect(resolveListItemsBindingArray({ kind: "pageProp", key: "" }, sources)).toBeNull();
        expect(resolveListItemsBindingArray({ kind: "surfaceState", key: "" }, sources)).toBeNull();
        expect(resolveListItemsBindingArray({ kind: "globalState", key: "" }, sources)).toBeNull();
    });

    it("reads a non-array value as unbound rather than wrapping it", () => {
        const scalars = {
            pageProps: { text: "one", count: 3, flag: true, record: { a: 1 }, nothing: null },
            surfaceState: reader({ text: "one" }),
        };
        for (const key of ["text", "count", "flag", "record", "nothing"]) {
            expect(resolveListItemsBindingArray({ kind: "pageProp", key }, scalars)).toBeNull();
        }
        expect(resolveListItemsBindingArray({ kind: "surfaceState", key: "text" }, scalars)).toBeNull();
    });

    it("does not mistake inherited object members for page props", () => {
        expect(resolveListItemsBindingArray({ kind: "pageProp", key: "constructor" }, { pageProps: {} })).toBeNull();
    });
});

describe("blueprint list properties fallback", () => {
    it("serves the page props array when nothing has been written at runtime", () => {
        const hostApi = hostApiFor(listDocument({ itemsBinding: { kind: "pageProp", key: "chapters" } }), {
            chapters: [{ id: "one" }, { id: "two" }],
        });
        expect(hostApi.widget.getListProperties("list").items).toEqual([{ id: "one" }, { id: "two" }]);
    });

    it("falls back to preview items when the prop is missing or is not an array", () => {
        const document = listDocument({
            itemsBinding: { kind: "pageProp", key: "chapters" },
            previewItems: [{ id: "preview" }],
        });
        expect(hostApiFor(document, {}).widget.getListProperties("list").items).toEqual([{ id: "preview" }]);
        expect(hostApiFor(document, { chapters: "one" }).widget.getListProperties("list").items)
            .toEqual([{ id: "preview" }]);
    });

    it("hands out a copy, so a list cannot write back into the props the page was opened with", () => {
        const pageProps = { chapters: [{ id: "one" }] };
        const hostApi = hostApiFor(listDocument({ itemsBinding: { kind: "pageProp", key: "chapters" } }), pageProps);
        const items = hostApi.widget.getListProperties("list").items;
        expect(items).toEqual([{ id: "one" }]);
        (items[0] as { id: string }).id = "mutated";
        expect(pageProps.chapters[0].id).toBe("one");
    });
});

/**
 * The scrollbar's part styles are a free-form bag on disk, and their fill kind used to be read by
 * an explicit `image ? image : color ? color : fallback` chain - a correct safety net that silently
 * became a downgrade the moment a third kind existed. These pin that the list stays complete.
 */
describe("scrollbar part style fill kind", () => {
    function trackStyle(style: Record<string, unknown>) {
        return getListProps({
            id: "list",
            type: "nl.list",
            name: "List",
            parentId: null,
            childrenIds: [],
            layout: { x: 0, y: 0, width: 200, height: 200 },
            props: { scrollbar: { trackStyle: style } },
        } as never).scrollbar.trackStyle;
    }

    it("reads each fill kind the scrollbar can paint", () => {
        for (const fillType of ["color", "image", "gradient"]) {
            expect(trackStyle({ fillType }).fillType, fillType).toBe(fillType);
        }
    });

    it("keeps the fallback for a kind this build cannot paint", () => {
        expect(trackStyle({ fillType: "mesh" }).fillType).toBe(trackStyle({}).fillType);
    });

    it("carries a stored gradient through, repaired", () => {
        const style = trackStyle({
            fillType: "gradient",
            gradientFill: {
                kind: "linear",
                stops: [{ offset: 0.5, color: "nlbrand:primary" }],
            },
        });

        // One colour is a solid, and a solid is the pair repeated.
        expect(style.gradientFill?.stops).toHaveLength(2);
    });
});
