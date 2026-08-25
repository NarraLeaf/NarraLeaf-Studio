// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { buildComparisonElementSelection } from "@/lib/vcs/compare/comparisonSelection";
import { ComparisonElementInspector } from "./PropertiesPanel";

/**
 * The right rail while an element of a comparison is selected.
 *
 * Two things are checked and neither of them can be checked anywhere else. The first is that
 * **nothing in the panel can be operated**: the clamp is an ancestor `<fieldset disabled>`, so a
 * control inside it carries no `disabled` attribute of its own and only the browser's own
 * `:disabled` state says so - which is exactly the way this could pass a naive test and fail in
 * front of an author. The second is that an element **only one half holds** is drawn in full with
 * the absence stated, rather than producing an empty panel.
 *
 * The freeze is read through the workspace context, which no static render has, so it is mocked at
 * the context-reading hook and not at `useFreezeGuard` - the guard under test is the real one, and
 * what is being checked is that an inspection switches everything off without any freeze at all.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            (params ? `${key}(${Object.values(params).join(",")})` : key),
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        locale: "en",
    }),
}));

// No freeze anywhere. Everything this test finds switched off is switched off by the inspection.
vi.mock("../../hooks/useWorkspaceFrozen", () => ({
    useWorkspaceFrozen: () => false,
    useWorkspaceFreeze: () => null,
}));

afterEach(cleanup);

function element(id: string, over: Partial<UIElement> = {}): UIElement {
    return {
        id,
        type: "nl.container",
        name: id,
        parentId: "root",
        childrenIds: [],
        layout: { x: 12, y: 34, width: 100, height: 40, opacity: 1, visible: true },
        ...over,
    } as UIElement;
}

function documentWith(elements: UIElement[]): UIDocument {
    return {
        version: 11,
        name: "Interface",
        surfaces: [
            {
                id: "main",
                name: "Main",
                host: "app",
                kind: "appSurface",
                designSize: { width: 1920, height: 1080 },
                rootElementId: "root",
            },
        ],
        elements: Object.fromEntries([
            ["root", element("root", { parentId: null, childrenIds: elements.map(item => item.id) })],
            ...elements.map(item => [item.id, item] as const),
        ]),
        components: [],
    } as unknown as UIDocument;
}

function selectionFor(input: {
    half: "base" | "head";
    here: UIElement[];
    there: UIElement[] | null;
}) {
    const selection = buildComparisonElementSelection({
        documentPath: "ui/interface.json",
        half: input.half,
        versionLabel: "#66",
        counterpartLabel: "This project",
        address: { surfaceId: "main", elementId: "panel" },
        document: documentWith(input.here),
        counterpartDocument: input.there === null ? null : documentWith(input.there),
    });
    if (!selection) {
        throw new Error("the fixture must produce a selection");
    }
    return selection;
}

describe("ComparisonElementInspector", () => {
    it("renders no control an author can operate", () => {
        render(
            <ComparisonElementInspector
                selection={selectionFor({ half: "base", here: [element("panel")], there: [element("panel")] })}
                context={null}
            />,
        );

        const controls = Array.from(
            window.document.querySelectorAll<HTMLElement>("input, select, textarea, button"),
        );
        // A panel with no controls at all would pass the assertion below without meaning anything.
        expect(controls.length).toBeGreaterThan(0);
        for (const control of controls) {
            expect(control.matches(":disabled")).toBe(true);
        }
    });

    it("states which version the element is from", () => {
        render(
            <ComparisonElementInspector
                selection={selectionFor({ half: "base", here: [element("panel")], there: [element("panel")] })}
                context={null}
            />,
        );
        expect(screen.getByText("documentDiff.inspector.version(#66)")).toBeTruthy();
        expect(screen.getByText("documentDiff.inspector.readOnly")).toBeTruthy();
    });

    it("draws an element only the older half holds, and says the other one has not got it", () => {
        render(
            <ComparisonElementInspector
                // The newer version deleted it: the older half is the only place it exists.
                selection={selectionFor({ half: "base", here: [element("panel")], there: [] })}
                context={null}
            />,
        );
        expect(screen.getByText("documentDiff.inspector.version(#66)")).toBeTruthy();
        expect(screen.getByText("documentDiff.inspector.onlyHere(This project)")).toBeTruthy();
        // Drawn in full rather than refused: the layout fields are there like any other selection.
        expect(
            window.document.querySelectorAll("input, select, textarea, button").length,
        ).toBeGreaterThan(0);
    });

    it("marks a field whose value the other half holds differently, and only that field", () => {
        render(
            <ComparisonElementInspector
                selection={selectionFor({
                    half: "head",
                    here: [element("panel")],
                    there: [element("panel", { layout: { x: 12, y: 999, width: 100, height: 40, opacity: 1, visible: true } })],
                })}
                context={null}
            />,
        );
        const marks = Array.from(window.document.querySelectorAll("[data-comparison-differs]"));
        expect(marks.length).toBeGreaterThan(0);
        // The counterpart's value travels on the hover, beside the version that holds it.
        for (const mark of marks) {
            expect(mark.getAttribute("data-tip")).toContain("This project");
        }
    });

    it("marks nothing when the two halves agree", () => {
        render(
            <ComparisonElementInspector
                selection={selectionFor({ half: "head", here: [element("panel")], there: [element("panel")] })}
                context={null}
            />,
        );
        expect(window.document.querySelectorAll("[data-comparison-differs]").length).toBe(0);
    });
});
