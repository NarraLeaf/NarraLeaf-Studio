// @vitest-environment jsdom
import { StrictMode, createRef } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryRichRun } from "@shared/types/story";
import type { SpellcheckRange } from "@shared/types/spellcheck";
import { RichTextInput, type RichTextInputHandle } from "./RichTextInput";

/**
 * That the field actually draws.
 *
 * The gap this closes was found in the running app and not by any test here: every unit above
 * asserts about offsets, marks and geometry, and all of them passed while the editor drew nothing at
 * all. Nothing exercised the whole chain - a language arrives, a check is asked for, an answer comes
 * back, elements appear - so every way of breaking that chain was invisible.
 *
 * Two things have to be faked and only two. `getClientRects` returns nothing in jsdom because there
 * is no layout, so the range geometry is stubbed; and the checker is the main process, which is not
 * here. Everything between them is the real component.
 */

const RANGES: SpellcheckRange[] = [{ start: 5, end: 12, word: "recieve" }];
const check = vi.fn(async () => ({ success: true as const, data: { ranges: RANGES } }));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ app: { spellcheck: { check } } }),
    getPrivilegedInterface: () => ({}),
}));

/** One rect per range, so a mark that is measured produces exactly one underline. */
const originalGetClientRects = Range.prototype.getClientRects;
beforeEach(() => {
    check.mockClear();
    Range.prototype.getClientRects = function stub(this: Range) {
        const rects = [{ left: 10, top: 4, right: 60, bottom: 20, width: 50, height: 16, x: 10, y: 4, toJSON: () => ({}) }];
        return Object.assign(rects, { item: (index: number) => rects[index] ?? null }) as unknown as DOMRectList;
    };
});
afterEach(() => {
    Range.prototype.getClientRects = originalGetClientRects;
    cleanup();
});

const RUNS: StoryRichRun[] = [{ text: "I am recieve" }];

function field(props: { language: string | null; strict?: boolean }) {
    const ref = createRef<RichTextInputHandle>();
    const element = (
        <RichTextInput
            ref={ref}
            initialRuns={RUNS}
            spellcheck={{ language: props.language, isKnownWord: () => false, revision: 1 }}
            onChange={() => {}}
            onShiftEnter={() => {}}
            onEnter={() => {}}
            onExit={() => {}}
            onBlur={() => {}}
        />
    );
    return render(props.strict ? <StrictMode>{element}</StrictMode> : element);
}

const underlines = (view: ReturnType<typeof render>) => view.container.querySelectorAll(".story-rt-spell");

describe("the underline overlay", () => {
    it("draws an underline once the checker answers", async () => {
        const view = field({ language: "en" });
        await waitFor(() => expect(check).toHaveBeenCalledWith("I am recieve", "en"));
        await waitFor(() => expect(underlines(view).length).toBe(1));
    });

    it("still draws after a StrictMode remount, which is how the app runs in development", async () => {
        // The defect this was written for: the runner was built once into a ref and disposed by the
        // throwaway mount's cleanup. React keeps refs across that remount, so the second mount reused
        // an instance that had latched itself shut, and every answer after it was discarded.
        const view = field({ language: "en", strict: true });
        await waitFor(() => expect(underlines(view).length).toBe(1));
    });

    it("asks for nothing and draws nothing when no dictionary covers the language", async () => {
        const view = field({ language: null });
        await act(async () => { await Promise.resolve(); });
        expect(check).not.toHaveBeenCalled();
        expect(underlines(view).length).toBe(0);
    });
});
