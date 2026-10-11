import { describe, expect, it } from "vitest";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { navigationTargetOptions } from "./navigationTargetOptions";

const t = ((key: string, params?: Record<string, string>) =>
    key === "properties.navigation.numbered" ? `${params?.name} ${params?.index}` : key) as any;

function element(id: string, type: string, extra: Partial<UIElement> = {}): UIElement {
    return {
        id,
        type,
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 100, height: 40 },
        ...extra,
    };
}

/** A page whose root holds `children`, each element listed with the ids of its own children. */
function page(...elements: UIElement[]): UIDocument {
    const root = element("root", "nl.root", { childrenIds: elements.filter(item => item.parentId === "root").map(item => item.id) });
    return {
        elements: Object.fromEntries([root, ...elements].map(item => [item.id, item])),
        surfaces: [],
    } as unknown as UIDocument;
}

describe("navigationTargetOptions", () => {
    it("offers what the focus can rest on, and nothing inside an element taken out of navigation", () => {
        const document = page(
            element("start", "nl.button", { name: "Start", parentId: "root" }),
            element("caption", "nl.text", { name: "Caption", parentId: "root" }),
            element("portrait", "nl.image", { name: "Portrait", parentId: "root", navigation: { focusable: "always" } }),
            element("decor", "nl.container", { name: "Decor", parentId: "root", childrenIds: ["hidden"], navigation: { focusable: "never" } }),
            element("hidden", "nl.button", { name: "Hidden", parentId: "decor" }),
            element("menu", "nl.container", { name: "Menu", parentId: "root", childrenIds: ["quit"] }),
            element("quit", "nl.button", { name: "Quit", parentId: "menu" }),
        );

        const options = navigationTargetOptions({ document, rootId: "root", t });

        expect(options.map(option => option.label)).toEqual(["Start", "Portrait", "Quit"]);
    });

    it("leaves out what it is told to, and still offers the element a setting names now", () => {
        const document = page(
            element("start", "nl.button", { name: "Start", parentId: "root" }),
            element("caption", "nl.text", { name: "Caption", parentId: "root" }),
        );

        const options = navigationTargetOptions({ document, rootId: "root", t, exclude: new Set(["start"]), current: "caption" });

        expect(options.map(option => option.value)).toEqual(["caption"]);
    });

    it("tells apart controls that share a name by their words, and numbers the ones whose words match too", () => {
        const document = page(
            element("a", "nl.button", { name: "Button", parentId: "root", props: { label: "New game" } }),
            element("b", "nl.button", { name: "Button", parentId: "root", props: { label: "Load" } }),
            element("c", "nl.button", { name: "Button", parentId: "root", props: { label: "Load" } }),
            element("d", "nl.button", { name: "Settings", parentId: "root", props: { label: "Settings" } }),
        );

        const options = navigationTargetOptions({ document, rootId: "root", t });

        expect(options.map(option => [option.label, option.secondaryLabel])).toEqual([
            ["Button", "New game"],
            ["Button 1", "Load"],
            ["Button 2", "Load"],
            ["Settings", undefined],
        ]);
        expect(options.some(option => /\b[abcd]\b/.test(`${option.label} ${option.secondaryLabel ?? ""}`))).toBe(false);
    });

    it("names an unnamed control by its kind, never by its id", () => {
        const document = page(element("0f8c2a9e-4b1d-4c3a-9e2f-7a6b5c4d3e21", "nl.button", { parentId: "root" }));

        const [option] = navigationTargetOptions({ document, rootId: "root", t });

        expect(option.label).not.toBe("");
        expect(option.label).not.toContain("0f8c2a9e");
    });
});
