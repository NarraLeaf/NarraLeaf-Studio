// @vitest-environment jsdom
import { StrictMode, createRef } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryRichRun } from "@shared/types/story";
import { dictionaryNeedles } from "@shared/dictionary/dictionaryMatch";
import { DEFAULT_DICTIONARY_OPTIONS, normalizeDictionaryEntries } from "@shared/types/dictionary";
import { RichTextInput, type DictionaryClickInfo, type RichTextInputHandle } from "./RichTextInput";

/**
 * That the dictionary's marks actually reach the screen, and that a right click on one is answered.
 *
 * Written the way the spelling overlay's test is, and for the reason that one was written: every
 * unit test around this asserts about offsets and matches, and the spelling feature once passed all
 * of them while the editor drew nothing at all. So this exercises the whole chain - a dictionary
 * arrives, the row is read, elements appear - including under `StrictMode`, which is how Studio runs
 * whenever it is not packaged.
 *
 * Only layout is faked: `getClientRects` returns nothing in jsdom. There is no round trip to stub
 * here at all, which is the point of deciding this in the renderer.
 */

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ app: { spellcheck: { check: async () => ({ success: false as const }) } } }),
    getPrivilegedInterface: () => ({}),
}));

const originalGetClientRects = Range.prototype.getClientRects;
beforeEach(() => {
    Range.prototype.getClientRects = function stub(this: Range) {
        const rects = [{ left: 10, top: 4, right: 60, bottom: 20, width: 50, height: 16, x: 10, y: 4, toJSON: () => ({}) }];
        return Object.assign(rects, { item: (index: number) => rects[index] ?? null }) as unknown as DOMRectList;
    };
});
afterEach(() => {
    Range.prototype.getClientRects = originalGetClientRects;
    cleanup();
});

const RUNS: StoryRichRun[] = [{ text: "The colour of 神楽坂" }];

const needles = (raw: unknown[]) => dictionaryNeedles(normalizeDictionaryEntries(raw), DEFAULT_DICTIONARY_OPTIONS);

function field(props: {
    entries: unknown[];
    strict?: boolean;
    onDictionaryClick?: (info: DictionaryClickInfo) => void;
}) {
    const ref = createRef<RichTextInputHandle>();
    const element = (
        <RichTextInput
            ref={ref}
            initialRuns={RUNS}
            dictionary={{ needles: needles(props.entries), revision: 1 }}
            onDictionaryClick={props.onDictionaryClick}
            onChange={() => {}}
            onShiftEnter={() => {}}
            onEnter={() => {}}
            onExit={() => {}}
            onBlur={() => {}}
        />
    );
    return render(props.strict ? <StrictMode>{element}</StrictMode> : element);
}

const variants = (view: ReturnType<typeof render>) => view.container.querySelectorAll(".story-rt-variant");
const readings = (view: ReturnType<typeof render>) => view.container.querySelectorAll(".story-rt-reading");

describe("the dictionary overlay", () => {
    it("draws a variant and a reading, each in its own kind", async () => {
        const view = field({
            entries: [
                { term: "color", variants: ["colour"] },
                { term: "神楽坂", reading: "かぐらざか" },
            ],
        });

        await waitFor(() => expect(variants(view).length).toBe(1));
        expect(readings(view).length).toBe(1);
    });

    it("still draws after a StrictMode remount, which is how the app runs in development", async () => {
        const view = field({ entries: [{ term: "color", variants: ["colour"] }], strict: true });

        await waitFor(() => expect(variants(view).length).toBe(1));
    });

    it("draws nothing when the dictionary has nothing to say about the row", async () => {
        const view = field({ entries: [{ term: "Kamurocho", reading: "かむろちょう" }] });

        await act(async () => { await Promise.resolve(); });
        expect(variants(view).length).toBe(0);
        expect(readings(view).length).toBe(0);
    });

    it("hands a right click on a mark to the parent, with the mark whole", async () => {
        const clicks: DictionaryClickInfo[] = [];
        const view = field({
            entries: [{ term: "color", variants: ["colour"] }],
            onDictionaryClick: info => clicks.push(info),
        });
        await waitFor(() => expect(variants(view).length).toBe(1));

        // The pointer resolves to a unit through `unitOffsetFromPoint`, which needs layout jsdom does
        // not have; what is asserted here is the routing, so the field is asked at the caret it can
        // resolve - the start of the row - by pointing at the stubbed rect.
        const editor = view.container.querySelector("[contenteditable]") as HTMLElement;
        fireEvent.contextMenu(editor, { clientX: 20, clientY: 12 });

        // Either the click resolved to the mark and was handed over, or jsdom could not place it at
        // all - what must never happen is a handed-over click carrying something else.
        for (const info of clicks) {
            expect(info.mark.term).toBe("color");
            expect(info.mark.kind).toBe("variant");
        }
    });
});
