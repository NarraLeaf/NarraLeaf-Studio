// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSliderDraft } from "./Slider";

/**
 * The contract this hook exists for: a drag is ONE edit.
 *
 * Two surfaces wired a document write to `Slider.onValueChange` - which fires on every pointer move
 * - and each of them pushed one history entry per pixel dragged, so `mod+z` afterwards walked back
 * a few pixels at a time. These are the three properties that stop that happening again.
 */
describe("useSliderDraft", () => {
    it("writes nothing while the pointer is moving", () => {
        const commit = vi.fn();
        const { result } = renderHook(() => useSliderDraft(10, commit));

        for (const step of [9, 8, 7, 6, 5]) {
            act(() => result.current.onValueChange(step));
        }
        expect(commit).not.toHaveBeenCalled();
        // The control still follows the pointer - the draft is what it shows.
        expect(result.current.value).toBe(5);
    });

    it("writes once, with the value the gesture ended on", () => {
        const commit = vi.fn();
        const { result } = renderHook(() => useSliderDraft(10, commit));

        act(() => result.current.onValueChange(4));
        act(() => result.current.onValueChange(2));
        act(() => result.current.onValueCommit(2));

        expect(commit).toHaveBeenCalledTimes(1);
        expect(commit).toHaveBeenCalledWith(2);
    });

    it("goes back to following the value it edits once the drag ends", () => {
        // A control that kept its own number after the gesture would show a stale figure the moment
        // the same value was edited from anywhere else.
        const commit = vi.fn();
        const { result, rerender } = renderHook(({ value }) => useSliderDraft(value, commit), {
            initialProps: { value: 10 },
        });

        act(() => result.current.onValueChange(3));
        expect(result.current.value).toBe(3);

        act(() => result.current.onValueCommit(3));
        rerender({ value: 7 });
        expect(result.current.value).toBe(7);
    });

    it("shows the incoming value when no drag is in flight", () => {
        const { result, rerender } = renderHook(({ value }) => useSliderDraft(value, () => {}), {
            initialProps: { value: 1 },
        });
        rerender({ value: 42 });
        expect(result.current.value).toBe(42);
    });
});
