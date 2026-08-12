// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import { ChangeDetailHost } from "./ChangeDetailHost";
import type { ComparisonSides, SideContent } from "./comparisonSide";

/**
 * What the type comparison must never do: claim a file it cannot load, leave a face behind in the
 * document, set the two sides at different sizes, or show a specimen in the system's default face
 * when the file was refused.
 *
 * **jsdom loads no fonts.** `FontFace` and `document.fonts` are stubbed below, so what is asserted
 * is which faces were added and removed and what the specimen is asked to be set in. Whether the
 * two versions actually look different is only checkable by a person.
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

/** Which first byte the stubbed font system accepts. Anything else is refused. */
const loadable = new Set<number>();
let added: FakeFontFace[];
let removed: FakeFontFace[];

class FakeFontFace {
    constructor(public readonly family: string, private readonly source: ArrayBuffer) {}

    load(): Promise<FakeFontFace> {
        return loadable.has(new Uint8Array(this.source)[0])
            ? Promise.resolve(this)
            : Promise.reject(new Error("not a font"));
    }
}

const SIDES: ComparisonSides = {
    before: { at: "revision", revision: "r1" },
    after: { at: "working-tree" },
};

function ready(mark: number, size = 4096): SideContent<Uint8Array> {
    return { status: "ready", value: new Uint8Array([mark, 0, 0, 0]), size, error: null };
}

function entry(over: Partial<DocumentDiffEntry> = {}): DocumentDiffEntry {
    return {
        path: "assets/content/99/55/3d15abb54213bad7203798a1adc4",
        kind: "changed",
        contentClass: "font",
        diff: {
            changes: [{ path: [], kind: "changed", label: { key: "documentDiff.content.changed" } }],
            complete: true,
            total: 1,
            tier: "content",
        },
        ...over,
    };
}

function draw(over: Partial<DocumentDiffEntry> = {}) {
    return render(<ChangeDetailHost entry={entry(over)} sides={SIDES} />);
}

const specimens = (container: HTMLElement): HTMLElement[] =>
    [...container.querySelectorAll("figure p")] as HTMLElement[];

beforeEach(() => {
    sideStates.clear();
    loadable.clear();
    added = [];
    removed = [];
    vi.stubGlobal("FontFace", FakeFontFace);
    Object.defineProperty(document, "fonts", {
        configurable: true,
        value: {
            add: (face: FakeFontFace) => added.push(face),
            delete: (face: FakeFontFace) => removed.push(face),
        },
    });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("which presenter draws a font", () => {
    it("hands a font to the type presenter rather than to the list of rows", () => {
        const { container } = draw();

        expect(container.querySelector("[data-change-presenter]")?.getAttribute("data-change-presenter"))
            .toBe("font");
    });
});

describe("setting the same words twice", () => {
    it("sets each side in its own face, so neither draws the other's", async () => {
        loadable.add(1);
        loadable.add(2);
        sideStates.set("before", ready(1));
        sideStates.set("after", ready(2));

        const { container } = draw();

        await waitFor(() => expect(added).toHaveLength(2));
        const families = specimens(container).map(element => element.style.fontFamily);
        expect(families).toHaveLength(2);
        expect(new Set(families).size).toBe(2);
        expect(families).toEqual(added.map(face => face.family));
    });

    it("moves both sides to the size that was picked", async () => {
        loadable.add(1);
        loadable.add(2);
        sideStates.set("before", ready(1));
        sideStates.set("after", ready(2));

        const { container } = draw();
        await waitFor(() => expect(specimens(container)).toHaveLength(2));
        const sizes = () => specimens(container).map(element => element.style.fontSize);
        const opened = sizes();

        const controls = [...container.querySelectorAll("[role=group] button")];
        fireEvent.click(controls[controls.length - 1]);

        // Both, and to the same one: a size per side would make a difference in how they were
        // drawn look like a difference in the files.
        expect(sizes()).not.toEqual(opened);
        expect(new Set(sizes()).size).toBe(1);
    });

    it("draws one side for a file that exists on one side", async () => {
        loadable.add(2);
        sideStates.set("after", ready(2));

        const { container } = draw({ kind: "added" });

        await waitFor(() => expect(added).toHaveLength(1));
        expect(specimens(container)).toHaveLength(1);
        expect(container.textContent).toContain("documentDiff.shell.fileAdded");
    });
});

describe("what happens to the faces", () => {
    it("removes every face it added when the pane goes away", async () => {
        // `document.fonts` belongs to the document rather than to this pane. A face left behind
        // outlives the comparison, and an author working through a folder of type accumulates one
        // per file for as long as the window is open.
        loadable.add(1);
        loadable.add(2);
        sideStates.set("before", ready(1));
        sideStates.set("after", ready(2));

        const { unmount } = draw();
        await waitFor(() => expect(added).toHaveLength(2));
        unmount();

        expect(removed).toEqual(added);
    });

    it("removes nothing it never managed to add", async () => {
        sideStates.set("before", ready(9));
        sideStates.set("after", ready(9));

        const { unmount } = draw();
        await waitFor(() => expect(added).toHaveLength(0));
        unmount();

        expect(removed).toEqual([]);
    });
});

describe("when a font cannot be shown", () => {
    it("says the file was refused rather than setting the sample in something else", async () => {
        // The failure this sentence exists for: with no face installed, a specimen with no message
        // beside it is drawn in the system's default face and reads as a typeface that happens to
        // look ordinary.
        sideStates.set("before", ready(9));
        sideStates.set("after", ready(9));

        const { container } = draw();

        await waitFor(() => expect(container.textContent).toContain("documentDiff.presenter.font.unreadable"));
        expect(container.textContent).toContain("documentDiff.content.changed");
    });

    it("keeps the side that loaded, and states the reason on the side that did not", async () => {
        loadable.add(1);
        sideStates.set("before", ready(1));
        sideStates.set("after", { status: "tooLarge", value: null, size: 0, error: null });

        const { container } = draw();

        await waitFor(() => expect(added).toHaveLength(1));
        expect(container.textContent).toContain("documentDiff.presenter.font.tooLarge");
        expect(container.textContent).toContain("documentDiff.presenter.font.sample");
    });
});
