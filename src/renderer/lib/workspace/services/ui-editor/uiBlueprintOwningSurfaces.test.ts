import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { resolveOwningSurfaceIds } from "./UIBlueprintLifecycleCoordinator";

function element(id: string, parentId: string | null, childrenIds: string[] = []): UIElement {
    return {
        id,
        type: "nl.container",
        name: id,
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 10, height: 10, visible: true, opacity: 1 },
    };
}

function baseDocument(elements: Record<string, UIElement>, roots: string[]): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "ui-doc",
        name: "UI",
        surfaces: roots.map((rootElementId, index) => ({
            id: `surface-${index}`,
            name: `S${index}`,
            host: "app" as const,
            kind: "appSurface" as const,
            designSize: { width: 1280, height: 720 },
            rootElementId,
        })),
        elements,
        meta: {},
    };
}

describe("resolveOwningSurfaceIds", () => {
    it("maps every element in a nested tree to its surface", () => {
        const document = baseDocument(
            {
                "root-0": element("root-0", null, ["a"]),
                a: element("a", "root-0", ["b"]),
                b: element("b", "a", ["c"]),
                c: element("c", "b"),
                "root-1": element("root-1", null, ["d"]),
                d: element("d", "root-1"),
            },
            ["root-0", "root-1"],
        );

        const owners = resolveOwningSurfaceIds(document);

        expect(owners.get("root-0")).toBe("surface-0");
        expect(owners.get("a")).toBe("surface-0");
        expect(owners.get("b")).toBe("surface-0");
        expect(owners.get("c")).toBe("surface-0");
        expect(owners.get("root-1")).toBe("surface-1");
        expect(owners.get("d")).toBe("surface-1");
    });

    it("leaves out elements whose root is not a surface root", () => {
        const document = baseDocument(
            {
                "root-0": element("root-0", null, ["a"]),
                a: element("a", "root-0"),
                orphan: element("orphan", null, ["orphan-child"]),
                "orphan-child": element("orphan-child", "orphan"),
                dangling: element("dangling", "does-not-exist"),
            },
            ["root-0"],
        );

        const owners = resolveOwningSurfaceIds(document);

        expect(owners.has("orphan")).toBe(false);
        expect(owners.has("orphan-child")).toBe(false);
        expect(owners.has("dangling")).toBe(false);
        expect(owners.get("a")).toBe("surface-0");
    });

    // A damaged document must not hang the editor: this runs after every mutation.
    it("terminates on a parent cycle", () => {
        const document = baseDocument(
            {
                "root-0": element("root-0", null),
                x: element("x", "y"),
                y: element("y", "x"),
            },
            ["root-0"],
        );

        const owners = resolveOwningSurfaceIds(document);

        expect(owners.has("x")).toBe(false);
        expect(owners.has("y")).toBe(false);
        expect(owners.get("root-0")).toBe("surface-0");
    });
});
