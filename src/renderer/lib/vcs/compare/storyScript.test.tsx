// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import { diffStoryDocument } from "@shared/documents/specs/storyDiff";
import type { StoryBlock, StoryDocument, StoryScene } from "@shared/types/story/document";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story/document";
import type { StoryRowLookups } from "@/lib/story/storyRowProjection";
import { buildDocumentChangeRows } from "../documentChangeView";
import { SplitComparisonView } from "./SplitComparisonView";
import { renderStoryScriptSlot, type StoryScriptWords } from "./StoryScriptRow";
import { buildStoryScriptPlan, type StoryScriptSlot } from "./storyScriptPlan";

/**
 * A story comparison as two scripts, as far as a component test can honestly go.
 *
 * The arithmetic - which line goes in which half, which mark it wears, where a deleted line belongs -
 * is pinned in `storyScriptPlan.test.ts` against the real story diff. What is pinned here is what
 * only a rendered half can answer: that each half prints the words of the version IT is showing and
 * not the other one's, that a line one version does not have is still a reserved gap in the other,
 * that previous and next walk the changes rather than the lines, and that there is nothing in either
 * half a person could press, type into or focus.
 *
 * **jsdom does no layout**, so nothing here claims a spacer is as tall as the row facing it.
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

const observers = vi.hoisted(() => [] as ((entries: unknown[]) => void)[]);
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

function resizeTo(width: number): void {
    stubbedWidth.px = width;
    act(() => {
        for (const observer of [...observers]) {
            observer([{ contentRect: { width } }]);
        }
    });
}

// --- The story both halves are built from ---------------------------------------------------------

function narration(id: string, text: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "narration", text: { textId: `t-${id}`, value: text, role: "narration" } },
    } as StoryBlock;
}

function dialogue(id: string, characterId: string, text: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "dialogue", characterId, text: { textId: `t-${id}`, value: text, role: "dialogue" } },
    } as StoryBlock;
}

function story(blocks: StoryBlock[]): StoryDocument {
    const scene = {
        id: "s1",
        name: "Opening",
        runtimeName: "Opening",
        rootBlockIds: blocks.map(one => one.id),
        blocks: Object.fromEntries(blocks.map(one => [one.id, one])),
    } as StoryScene;
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "A Story",
        chapters: [{ id: "ch1", name: "Chapter One", sceneIds: ["s1"] }],
        scenes: { s1: scene },
    } as StoryDocument;
}

const BASE = story([
    narration("b1", "The rain had not started."),
    narration("b2", "Before the storm."),
    narration("b3", "A door closed downstairs."),
    dialogue("b4", "c1", "You came back."),
]);

const HEAD = story([
    narration("b1", "The rain had not started."),
    narration("b2", "After the storm."),
    dialogue("b4", "c1", "You came back."),
]);

const WORDS: StoryScriptWords = { narrator: "Narration", unassigned: "No one", unnamedScene: "Untitled" };

/** The cast at each version, so a rename between them is visible in the halves. */
const CAST: Record<"base" | "head", StoryRowLookups["character"]> = {
    base: id => (id === "c1" ? { name: "Alice" } : null),
    head: id => (id === "c1" ? { name: "Alicia" } : null),
};

function entryOf(base: StoryDocument, head: StoryDocument): DocumentDiffEntry {
    return {
        path: "editor/story/stories/story-1/storydoc.json",
        kind: "changed",
        documentKind: "story",
        diff: diffStoryDocument(base, head, { limit: 200 }),
    };
}

function view(base: StoryDocument = BASE, head: StoryDocument = HEAD) {
    const entry = entryOf(base, head);
    const plan = buildStoryScriptPlan(buildDocumentChangeRows(entry.diff, 200).rows, base, head);
    return {
        plan,
        ...render(
            <SplitComparisonView
                entry={entry}
                name="A Story"
                directory={null}
                baseLabel="#3"
                headLabel="#7"
                content={{
                    slots: plan.slots,
                    render: (slot, side, active) => renderStoryScriptSlot(
                        slot as StoryScriptSlot,
                        side,
                        active,
                        {
                            words: WORDS,
                            lookupsFor: half => ({
                                character: CAST[half],
                                scenes: (half === "base" ? base : head).scenes,
                                scene: (half === "base" ? base : head).scenes.s1,
                            }),
                        },
                    ),
                }}
            />,
        ),
    };
}

function half(container: HTMLElement, side: "base" | "head"): HTMLElement {
    return container.querySelector<HTMLElement>(`[data-split-half="${side}"]`)!;
}

function slotText(container: HTMLElement, side: "base" | "head", key: string): string {
    return half(container, side).querySelector(`[data-split-slot="${key}"]`)?.textContent ?? "";
}

describe("a story half draws its own version", () => {
    it("prints the words of the version it is showing, not the other half's", () => {
        const { container } = view();
        expect(slotText(container, "base", "block:s1/b2")).toContain("Before the storm.");
        expect(slotText(container, "base", "block:s1/b2")).not.toContain("After the storm.");
        expect(slotText(container, "head", "block:s1/b2")).toContain("After the storm.");
        expect(slotText(container, "head", "block:s1/b2")).not.toContain("Before the storm.");
    });

    it("names a speaker from the cast at that version", () => {
        const { container } = view();
        expect(slotText(container, "base", "block:s1/b4")).toContain("Alice");
        expect(slotText(container, "base", "block:s1/b4")).not.toContain("Alicia");
        expect(slotText(container, "head", "block:s1/b4")).toContain("Alicia");
    });

    it("numbers the lines the way that version reads them", () => {
        const { container } = view();
        // The deleted line is line 3 of the older version; the line after it is line 3 of the newer.
        const numbered = (side: "base" | "head", key: string) =>
            half(container, side)
                .querySelector(`[data-split-slot="${key}"] [data-script-line]`)
                ?.getAttribute("data-script-line");
        expect(numbered("base", "block:s1/b4")).toBe("4");
        expect(numbered("head", "block:s1/b4")).toBe("3");
    });
});

describe("a story half marks what changed", () => {
    it("marks the changed line and leaves the lines around it unmarked", () => {
        const { container } = view();
        const tone = (side: "base" | "head", key: string) =>
            half(container, side)
                .querySelector(`[data-split-slot="${key}"] [data-script-tone]`)
                ?.getAttribute("data-script-tone") ?? null;
        expect(tone("base", "block:s1/b2")).toBe("changed");
        expect(tone("head", "block:s1/b2")).toBe("changed");
        expect(tone("base", "block:s1/b1")).toBeNull();
    });

    it("keeps a deleted line as a marked gap in the newer half rather than closing it", () => {
        const { container } = view();
        expect(half(container, "base").querySelector('[data-split-slot="block:s1/b3"] [data-script-line]'))
            .not.toBeNull();
        expect(half(container, "head").querySelector('[data-split-slot="block:s1/b3"] [data-split-spacer]'))
            .not.toBeNull();

        // Both halves hold every slot in the same order, deletions included - which is what makes
        // the line facing a line its counterpart.
        const order = (side: "base" | "head") =>
            [...half(container, side).querySelectorAll("[data-split-slot]")]
                .map(slot => slot.getAttribute("data-split-slot"));
        expect(order("base")).toEqual(order("head"));
    });
});

describe("a story half cannot be operated", () => {
    it("holds nothing a person could press, type into or focus", () => {
        const { container } = view();
        for (const side of ["base", "head"] as const) {
            const pane = half(container, side);
            expect(pane.querySelectorAll("button, a, input, textarea, select").length).toBe(0);
            expect(pane.querySelectorAll('[role="button"], [role="textbox"], [role="link"]').length).toBe(0);
            expect(pane.querySelectorAll("[tabindex], [contenteditable], [draggable='true']").length).toBe(0);
            expect(pane.querySelectorAll("[data-split-select]").length).toBe(0);
        }
    });

    it("still gives each half the full height and a scroller of its own", () => {
        const { container } = view();
        for (const side of ["base", "head"] as const) {
            expect(half(container, side).className).toContain("h-full");
            expect(half(container, side).querySelector("[data-split-scroller]")?.className)
                .toContain("overflow-y-auto");
        }
    });
});

describe("a story half at every width", () => {
    it("falls back to one column on a measured width and comes back", () => {
        const { container } = view();
        const columns = () => container.querySelector("[data-split-columns]")?.getAttribute("data-split-columns");
        expect(columns()).toBe("2");
        resizeTo(600);
        expect(columns()).toBe("1");
        // Both versions are still named and still whole - the narrow arrangement drops nothing.
        expect([...container.querySelectorAll("[data-split-half]")].map(one => one.getAttribute("aria-label")))
            .toEqual(["#3", "#7"]);
        expect(slotText(container, "base", "block:s1/b2")).toContain("Before the storm.");
        resizeTo(1400);
        expect(columns()).toBe("2");
    });
});

describe("a story half's navigation", () => {
    it("walks the changes rather than the lines, with a readout that agrees", () => {
        const { container, plan } = view();
        const stops = plan.slots.filter(slot => slot.stop);
        // Fewer stops than slots: a script is mostly lines nobody touched, and stopping on those
        // would make "next change" mean "next line".
        expect(stops.length).toBeGreaterThan(0);
        expect(stops.length).toBeLessThan(plan.slots.length);

        const readout = () => container.querySelector("[data-split-position]")?.textContent;
        expect(readout()).toBe(`documentDiff.split.position(0,${stops.length})`);

        const next = screen.getByLabelText("documentDiff.split.next");
        for (let press = 1; press <= stops.length; press += 1) {
            fireEvent.click(next);
            expect(readout()).toBe(`documentDiff.split.position(${press},${stops.length})`);
        }
        // Wrapping rather than disabling itself, as it does for every other document.
        fireEvent.click(next);
        expect(readout()).toBe(`documentDiff.split.position(1,${stops.length})`);
    });
});
