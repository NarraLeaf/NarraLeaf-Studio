import { describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { buildUiPropsPatch, resolveUiElementRef, uiElementPath } from "./uiElementRefs";

/** How an agent names an element of a page - by id, by path, by a unique name - and nothing else. */

function el(id: string, name: string | undefined, parentId: string | null, childrenIds: string[] = [], type = "nl.container"): UIElement {
    return { id, type, name, parentId, childrenIds, layout: { x: 0, y: 0, width: 10, height: 10, opacity: 1, visible: true } } as UIElement;
}

const pool: Record<string, UIElement> = {
    root: el("root", "Title", null, ["menu", "logo"], "nl.root"),
    menu: el("menu", "Menu", "root", ["start", "quit"]),
    start: el("start", "Button", "menu", [], "nl.button"),
    quit: el("quit", "Quit", "menu", [], "nl.button"),
    logo: el("logo", "Button", "root", [], "nl.button"),
    // Another page's element: never found from this page's root.
    other: el("other", "Elsewhere", null, []),
};

describe("resolveUiElementRef", () => {
    it("finds by id, but only under the page's root", () => {
        expect(resolveUiElementRef(pool, "root", "quit")).toMatchObject({ kind: "found", element: { id: "quit" } });
        expect(resolveUiElementRef(pool, "root", "other").kind).toBe("missing");
    });

    it("finds by path, with or without the root's own name", () => {
        expect(resolveUiElementRef(pool, "root", "Menu / Button")).toMatchObject({ kind: "found", element: { id: "start" } });
        expect(resolveUiElementRef(pool, "root", "Title/Menu/Button")).toMatchObject({ kind: "found", element: { id: "start" } });
    });

    it("refuses a bare name two elements share", () => {
        const result = resolveUiElementRef(pool, "root", "Button");
        expect(result.kind).toBe("ambiguous");
        expect(result.kind === "ambiguous" ? result.candidates.map(item => item.id).sort() : []).toEqual(["logo", "start"]);
    });

    it("accepts a unique bare name", () => {
        expect(resolveUiElementRef(pool, "root", "Quit")).toMatchObject({ kind: "found", element: { id: "quit" } });
    });

    it("prints paths in the .ui spelling", () => {
        expect(uiElementPath(pool, pool.start)).toBe("Title / Menu / Button");
    });
});

describe("buildUiPropsPatch", () => {
    it("merges a dotted key into a copy of the nested prop, keeping its siblings", () => {
        const current = { imageFill: { assetId: "old", fit: "cover" }, text: "Hi" };
        const patch = buildUiPropsPatch(current, { "imageFill.assetId": "new" });
        expect(patch).toEqual({ imageFill: { assetId: "new", fit: "cover" } });
        expect(current.imageFill.assetId).toBe("old");
    });

    it("folds several dotted keys under one prop and creates missing levels", () => {
        const patch = buildUiPropsPatch({}, { "a.b.c": 1, "a.d": 2, plain: true });
        expect(patch).toEqual({ a: { b: { c: 1 }, d: 2 }, plain: true });
    });

    it("lets a plain key replace its prop whole", () => {
        expect(buildUiPropsPatch({ imageFill: { fit: "cover" } }, { imageFill: { assetId: "x" } })).toEqual({ imageFill: { assetId: "x" } });
    });
});
