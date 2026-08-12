// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import { ChangeDetailHost } from "./ChangeDetailHost";
import type { ComparisonSides, SideContent } from "./comparisonSide";

/**
 * What the palette comparison must never do: claim another document, draw a swatch with no border
 * around it, or go blank when the file cannot be read.
 *
 * The colours themselves - whether the two blocks look different, whether a near-background one is
 * visible at all - are only checkable by a person.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            (params ? `${key}(${Object.values(params).join(",")})` : key),
        has: () => false,
        tn: (key: string) => key,
        locale: "en",
    }),
}));

const sideStates = vi.hoisted(() => new Map<string, unknown>());
const ABSENT = { status: "absent", value: null, size: 0, error: null };
vi.mock("./comparisonSide", () => ({
    useSideBytes: (side: { at: string } | null) => {
        if (!side) return ABSENT;
        return sideStates.get(side.at === "revision" ? "before" : "after") ?? ABSENT;
    },
    // The image presenter is imported by the host and reads this one.
    useSideObjectUrl: () => ({ status: "absent", url: null, size: 0, error: null }),
    comparisonSideKey: () => "mocked",
}));

const SIDES: ComparisonSides = {
    before: { at: "revision", revision: "r1" },
    after: { at: "working-tree" },
};

function palette(colors: unknown[]): SideContent<Uint8Array> {
    const value = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, colors }));
    return { status: "ready", value, size: value.length, error: null };
}

function entry(over: Partial<DocumentDiffEntry> = {}): DocumentDiffEntry {
    return {
        path: "editor/brand.json",
        kind: "changed",
        documentKind: "brand",
        contentClass: "text",
        diff: {
            changes: [{ path: [], kind: "changed", label: { key: "documentDiff.content.changed" } }],
            complete: true,
            total: 1,
            tier: "summary",
        },
        ...over,
    };
}

function draw(over: Partial<DocumentDiffEntry> = {}) {
    return render(<ChangeDetailHost entry={entry(over)} sides={SIDES} />);
}

const swatches = (container: HTMLElement): HTMLElement[] =>
    [...container.querySelectorAll("span[style*='background-color']")] as HTMLElement[];

beforeEach(() => {
    sideStates.clear();
});

afterEach(cleanup);

describe("which presenter draws the palette", () => {
    it("hands the palette to the colour presenter rather than to the list of rows", () => {
        const { container } = draw();

        expect(container.querySelector("[data-change-presenter]")?.getAttribute("data-change-presenter"))
            .toBe("brand");
    });

    it("leaves another document at the same kind of path to the generic one", () => {
        const { container } = render(
            <ChangeDetailHost entry={entry({ documentKind: "story" })} sides={SIDES} />,
        );

        expect(container.querySelector("[data-change-presenter]")?.getAttribute("data-change-presenter"))
            .toBe("generic");
    });
});

describe("two columns of colour", () => {
    it("shows the colour that changed as a pair, and counts the ones that did not", async () => {
        sideStates.set("before", palette([
            { id: "primary", value: "#40A8C4" },
            { id: "secondary", value: "#2E6E80" },
        ]));
        sideStates.set("after", palette([
            { id: "primary", value: "#B4553C" },
            { id: "secondary", value: "#2E6E80" },
        ]));

        const { container } = await waitFor(() => {
            const result = draw();
            expect(result.container.textContent).toContain("#B4553C");
            return result;
        });

        expect(container.textContent).toContain("#40A8C4");
        expect(container.textContent).toContain("documentDiff.presenter.brand.unchangedOne");
        const painted = swatches(container).map(element => element.style.backgroundColor);
        expect(painted).toEqual(["rgb(64, 168, 196)", "rgb(180, 85, 60)"]);
    });

    it("gives every swatch a border, so a colour near the background is still a block", async () => {
        // Half a palette is near the panel behind it in one theme or the other, and a borderless
        // block of the background colour is not a swatch, it is a gap.
        sideStates.set("before", palette([{ id: "background", value: "#0F1115" }]));
        sideStates.set("after", palette([{ id: "background", value: "#101317" }]));

        const { container } = draw();

        await waitFor(() => expect(swatches(container)).toHaveLength(2));
        for (const swatch of swatches(container)) {
            expect(swatch.className).toContain("border-edge-strong");
        }
    });

    it("names what happened to an entry only one side holds", async () => {
        sideStates.set("before", palette([{ id: "mood", value: "#101317" }]));
        sideStates.set("after", palette([{ id: "extra", value: "#FFFFFF" }]));

        const { container } = draw();

        await waitFor(() => expect(container.textContent).toContain("documentDiff.presenter.brand.added"));
        expect(container.textContent).toContain("documentDiff.presenter.brand.removed");
    });

    it("says a value that lands on no colour rather than drawing an empty block", async () => {
        sideStates.set("before", palette([{ id: "a", value: "#FFFFFF" }]));
        sideStates.set("after", palette([{ id: "a", value: "nlbrand:nothing" }]));

        const { container } = draw();

        await waitFor(() => expect(container.textContent).toContain("documentDiff.presenter.brand.unresolved"));
        expect(swatches(container)).toHaveLength(1);
    });
});

describe("when the palette cannot be read", () => {
    const broken = (): SideContent<Uint8Array> => {
        const value = new TextEncoder().encode("{ this is not json");
        return { status: "ready", value, size: value.length, error: null };
    };

    it("says so and falls back to the rows, not to a blank pane", async () => {
        sideStates.set("before", broken());
        sideStates.set("after", broken());

        const { container } = draw();

        await waitFor(() => expect(container.textContent).toContain("documentDiff.presenter.brand.unreadable"));
        expect(container.textContent).toContain("documentDiff.content.changed");
    });

    it("does not report the whole palette as new when only the older side is unreadable", async () => {
        // The two sides are merged into rows here, so a missing older side does not read as a
        // missing side: it reads as every colour in the project having just been added.
        sideStates.set("before", broken());
        sideStates.set("after", palette([{ id: "primary", value: "#40A8C4" }]));

        const { container } = draw();

        await waitFor(() => expect(container.textContent).toContain("documentDiff.presenter.brand.unreadable"));
        expect(container.textContent).not.toContain("documentDiff.presenter.brand.added");
        expect(swatches(container)).toHaveLength(0);
    });
});
