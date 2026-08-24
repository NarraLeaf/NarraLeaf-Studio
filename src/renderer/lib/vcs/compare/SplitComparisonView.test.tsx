// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentChange, DocumentDiffEntry } from "@shared/documents/diff";
import { SplitComparisonView } from "./SplitComparisonView";

/**
 * The split comparison as a structure, which is as far as a component test can honestly go.
 *
 * **jsdom does no layout**, so nothing here claims a spacer is the same number of pixels tall as the
 * row facing it - that is arithmetic and it is pinned in `splitLayout.test.ts`. What is pinned here
 * is everything a person would otherwise have to look at the screen for: that the second column
 * appears and disappears on a MEASURED width rather than on a media query, that a change present in
 * one version leaves a marked gap in the other rather than a silent one, that previous and next
 * reach every change with a readout that agrees, and that each half is `h-full` with a scroller of
 * its own - which is what the editor tab host requires of everything inside it.
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

/** Every live resize observer, so a test can report a new width to all of them at once. */
const observers = vi.hoisted(() => [] as ((entries: unknown[]) => void)[]);

/** What `clientWidth` answers, which is what the body measures itself with on its first frame. */
const stubbedWidth = vi.hoisted(() => ({ px: 1200 }));

beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
        configurable: true,
        get: () => stubbedWidth.px,
    });
    vi.stubGlobal("ResizeObserver", class {
        constructor(private readonly callback: (entries: unknown[]) => void) {
            observers.push(this.callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
    });
});

beforeEach(() => {
    stubbedWidth.px = 1200;
    observers.length = 0;
});

afterEach(cleanup);

/** Report a new body width the way a dragged editor group does. */
function resizeTo(width: number): void {
    stubbedWidth.px = width;
    act(() => {
        for (const observer of [...observers]) {
            observer([{ contentRect: { width } }]);
        }
    });
}

function change(kind: DocumentChange["kind"], path: string): DocumentChange {
    return { path: [path], kind, label: { key: `documentDiff.test.${kind}` } };
}

function entryOf(changes: readonly DocumentChange[]): DocumentDiffEntry {
    return {
        path: "story/chapter-one.json",
        kind: "changed",
        documentKind: "story",
        diff: { changes, complete: true, total: changes.length, tier: "semantic" },
    };
}

function view(changes: readonly DocumentChange[]) {
    return render(
        <SplitComparisonView
            entry={entryOf(changes)}
            name="Chapter One"
            directory="story"
            baseLabel="#3"
            headLabel="#7"
        />,
    );
}

const FIVE = [
    change("changed", "a"),
    change("removed", "b"),
    change("added", "c"),
    change("moved", "d"),
    change("changed", "e"),
];

describe("SplitComparisonView width", () => {
    it("draws two columns above the threshold and one below it, from an observed width", () => {
        const { container } = view(FIVE);
        expect(container.querySelector("[data-split-columns]")?.getAttribute("data-split-columns"))
            .toBe("2");

        resizeTo(600);
        expect(container.querySelector("[data-split-columns]")?.getAttribute("data-split-columns"))
            .toBe("1");

        // And back, because a tab host can be dragged wider again as easily as narrower.
        resizeTo(1400);
        expect(container.querySelector("[data-split-columns]")?.getAttribute("data-split-columns"))
            .toBe("2");
    });

    it("keeps both versions named at every width", () => {
        const { container } = view(FIVE);
        const named = () => [...container.querySelectorAll("[data-split-half]")]
            .map(half => half.getAttribute("aria-label"));
        expect(named()).toEqual(["#3", "#7"]);
        resizeTo(500);
        expect(named()).toEqual(["#3", "#7"]);
    });
});

describe("SplitComparisonView halves", () => {
    it("gives each half the full height and a scroller of its own", () => {
        const { container } = view(FIVE);
        const halves = [...container.querySelectorAll("[data-split-half]")];
        expect(halves).toHaveLength(2);
        for (const half of halves) {
            // The editor tab host never scrolls; a tab that is not `h-full` with its own scroller
            // makes it try - see the comment in `EditorGroup.tsx`.
            expect(half.className).toContain("h-full");
            const scroller = half.querySelector("[data-split-scroller]");
            expect(scroller?.className).toContain("overflow-y-auto");
        }
        // And nothing between the halves and the tab root scrolls instead of them.
        expect(container.firstElementChild?.className).toContain("overflow-hidden");
    });

    it("marks the gap where one version has a change the other does not", () => {
        const { container } = view(FIVE);
        const half = (side: string) => container.querySelector(`[data-split-half="${side}"]`)!;

        // The removal is drawn in the older half and is a marked gap in the newer one; the addition
        // is the same fact the other way round.
        const removed = "1:b";
        const added = "2:c";
        expect(half("base").querySelector(`[data-split-slot="${removed}"] [data-change-row]`))
            .not.toBeNull();
        expect(half("head").querySelector(`[data-split-slot="${removed}"] [data-split-spacer]`))
            .not.toBeNull();
        expect(half("head").querySelector(`[data-split-slot="${added}"] [data-change-row]`))
            .not.toBeNull();
        expect(half("base").querySelector(`[data-split-slot="${added}"] [data-split-spacer]`))
            .not.toBeNull();

        // Both halves hold every slot, in the same order. That is what makes the row facing a row
        // its counterpart rather than whatever happened to land opposite it.
        const order = (side: string) => [...half(side).querySelectorAll("[data-split-slot]")]
            .map(slot => slot.getAttribute("data-split-slot"));
        expect(order("base")).toEqual(order("head"));
        expect(order("base")).toHaveLength(FIVE.length);
    });

    it("puts the change's own path on the row, not only in its tooltip", () => {
        const { container } = view(FIVE);
        const paths = [...container.querySelectorAll("[data-split-half='base'] [data-change-path]")]
            .map(row => row.getAttribute("data-change-path"));
        expect(paths).toEqual(["a", "b", "d", "e"]);
    });
});

describe("SplitComparisonView navigation", () => {
    it("visits every change once, in order, with a readout that agrees", () => {
        const { container } = view(FIVE);
        const readout = () => container.querySelector("[data-split-position]")?.textContent;
        const activeRow = () => container
            .querySelector("[data-split-half='base'] .bg-fill[data-change-row]")
            ?.getAttribute("data-change-path")
            ?? container
                .querySelector("[data-split-half='head'] .bg-fill[data-change-row]")
                ?.getAttribute("data-change-path");

        // Nothing selected on arrival: the tab opens at the top of the document, not on a change.
        expect(readout()).toBe("documentDiff.split.position(0,5)");

        const next = screen.getByLabelText("documentDiff.split.next");
        const visited: (string | null | undefined)[] = [];
        const counted: (string | undefined)[] = [];
        for (let press = 0; press < FIVE.length; press += 1) {
            fireEvent.click(next);
            visited.push(activeRow());
            counted.push(readout());
        }
        expect(visited).toEqual(["a", "b", "c", "d", "e"]);
        expect(counted).toEqual([1, 2, 3, 4, 5].map(at => `documentDiff.split.position(${at},5)`));

        // Past the last one it wraps rather than disabling itself, which would leave an author who
        // wants the first change again with nowhere to press.
        fireEvent.click(next);
        expect(activeRow()).toBe("a");

        fireEvent.click(screen.getByLabelText("documentDiff.split.previous"));
        expect(activeRow()).toBe("e");
        expect(readout()).toBe("documentDiff.split.position(5,5)");
    });

    it("offers no navigation for a document with nothing in its list", () => {
        const { container } = view([]);
        expect(container.querySelector("[data-split-position]")).toBeNull();
        expect(screen.queryByLabelText("documentDiff.split.next")).toBeNull();
    });
});
