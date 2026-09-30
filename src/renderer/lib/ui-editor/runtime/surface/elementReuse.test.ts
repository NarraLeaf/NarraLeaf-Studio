import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { isListLikeWidgetType } from "@shared/types/ui-editor/list";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import {
    componentParamsKey,
    isReusableElementType,
    resolveElementReuseCache,
    sameDeps,
    sameResolvedElement,
} from "./elementReuse";

function element(overrides: Partial<UIElement> = {}): UIElement {
    return {
        id: "e",
        type: "nl.text",
        parentId: "root",
        childrenIds: ["a", "b"],
        layout: { x: 0, y: 0, width: 10, height: 10 },
        props: { text: "Hello", appearance: { variants: [] } },
        ...overrides,
    };
}

/** The shape `cloneElementRenderSnapshot` hands a renderer: every record copied one level down. */
function snapshotOf(source: UIElement): UIElement {
    return {
        ...source,
        childrenIds: [...source.childrenIds],
        layout: { ...source.layout },
        props: source.props ? { ...source.props } : undefined,
        style: source.style ? { ...source.style } : undefined,
        valueBindings: source.valueBindings ? { ...source.valueBindings } : undefined,
        extra: source.extra ? { ...source.extra } : undefined,
    };
}

describe("sameResolvedElement", () => {
    it("reads a fresh snapshot of an unchanged element as unchanged", () => {
        // The case the whole cache exists for: every pass clones every element, so identity says
        // nothing and contents have to be compared.
        const source = element();
        expect(sameResolvedElement(snapshotOf(source), source)).toBe(true);
    });

    it("sees a prop that moved", () => {
        const source = element();
        expect(sameResolvedElement(snapshotOf(source), { ...source, props: { ...source.props, text: "Bye" } })).toBe(false);
    });

    it("sees a layout field that moved, which is how a hidden element shows", () => {
        const source = element();
        expect(sameResolvedElement(snapshotOf(source), { ...source, layout: { ...source.layout, visible: false } })).toBe(false);
    });

    it("sees children reordered", () => {
        const source = element();
        expect(sameResolvedElement(snapshotOf(source), { ...source, childrenIds: ["b", "a"] })).toBe(false);
    });

    it("compares nested values by identity, so a rewritten appearance counts as changed", () => {
        // Deeper than one level the comparison does not look. A patch that rebuilds a nested record
        // with the same contents costs a rebuild; it can never cost a stale drawing.
        const source = element();
        const rewritten = { ...source, props: { ...source.props, appearance: { variants: [] } } };
        expect(sameResolvedElement(snapshotOf(source), rewritten)).toBe(false);
    });

    it("sees a field that exists on only one side", () => {
        const source = element();
        expect(sameResolvedElement(snapshotOf(source), { ...source, extra: { listSlot: "itemTemplate" } })).toBe(false);
        expect(sameResolvedElement({ ...snapshotOf(source), animation: { enter: "fade" } } as UIElement, source)).toBe(false);
    });
});

describe("what may be reused", () => {
    it("refuses every widget that places its own children, the list family included", () => {
        // They draw their rows from data this walk never sees, so last pass's node would keep last
        // pass's rows. The built-in list variants inherit from `nl.list`, and that is what the walk
        // asks about.
        for (const type of ["nl.list", "nl.choice.list", "nl.notification.list", "nl.nvl.list"]) {
            expect(isListLikeWidgetType(type)).toBe(true);
            expect(isReusableElementType(type, isListLikeWidgetType(type))).toBe(false);
        }
        expect(isReusableElementType("nl.slider", true)).toBe(false);
        expect(isReusableElementType("nl.switch", true)).toBe(false);
    });

    it("refuses a frame, which mounts a whole surface of its own", () => {
        expect(isReusableElementType("nl.frame", false)).toBe(false);
    });

    it("allows the ordinary widgets", () => {
        for (const type of ["nl.container", "nl.text", "nl.button", "nl.image"]) {
            expect(isReusableElementType(type, false)).toBe(true);
        }
    });
});

describe("the cache's lifetime", () => {
    const surface: UISurface = {
        id: "s",
        name: "S",
        host: "app",
        kind: "appSurface",
        designSize: { width: 10, height: 10 },
        rootElementId: "root",
    };
    const document = (): UIDocument => ({
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [surface],
        elements: {},
    });

    it("is kept while the tree draws the same document, surface and registry", () => {
        const input = { document: document(), surface, rendererRegistry: new ElementRendererRegistry() };
        const first = resolveElementReuseCache(null, input);
        expect(resolveElementReuseCache(first, input)).toBe(first);
    });

    it("starts over for a new document, which is what a hot reload hands over", () => {
        const registry = new ElementRendererRegistry();
        const first = resolveElementReuseCache(null, { document: document(), surface, rendererRegistry: registry });
        first.entries.set("k", { resolved: element(), deps: [], children: [], node: null });

        const next = resolveElementReuseCache(first, { document: document(), surface, rendererRegistry: registry });

        expect(next).not.toBe(first);
        expect(next.entries.size).toBe(0);
    });

    it("starts over for a new registry, where a type may now be drawn by other code", () => {
        const doc = document();
        const first = resolveElementReuseCache(null, { document: doc, surface, rendererRegistry: new ElementRendererRegistry() });
        const next = resolveElementReuseCache(first, { document: doc, surface, rendererRegistry: new ElementRendererRegistry() });
        expect(next).not.toBe(first);
    });
});

describe("small comparisons", () => {
    it("compares deps element by element", () => {
        const shared = {};
        expect(sameDeps([1, "a", shared], [1, "a", shared])).toBe(true);
        expect(sameDeps([1, "a", shared], [1, "a", {}])).toBe(false);
        expect(sameDeps([1], [1, 2])).toBe(false);
    });

    it("folds component params to one value that ignores key order", () => {
        expect(componentParamsKey({ slot: "3", title: "A" })).toBe(componentParamsKey({ title: "A", slot: "3" }));
        expect(componentParamsKey({ slot: "3" })).not.toBe(componentParamsKey({ slot: "4" }));
        expect(componentParamsKey(null)).toBe("");
    });
});
