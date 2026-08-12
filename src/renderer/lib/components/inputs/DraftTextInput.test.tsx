// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftTextInput } from "./DraftTextInput";

function field(): HTMLInputElement | HTMLTextAreaElement {
    return screen.getByRole("textbox") as HTMLInputElement | HTMLTextAreaElement;
}

function type(text: string): void {
    fireEvent.change(field(), { target: { value: text } });
}

function settle(ms = 200): void {
    act(() => {
        vi.advanceTimersByTime(ms);
    });
}

describe("DraftTextInput", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it("shows every keystroke but writes the burst once", () => {
        const commit = vi.fn();
        render(<DraftTextInput value="" onCommit={commit} />);

        type("h");
        type("he");
        type("hel");

        expect(field().value).toBe("hel");
        expect(commit).not.toHaveBeenCalled();

        settle();

        expect(commit).toHaveBeenCalledTimes(1);
        expect(commit).toHaveBeenCalledWith("hel");
    });

    it("writes what is pending as soon as the field is left", () => {
        const commit = vi.fn();
        render(<DraftTextInput value="" onCommit={commit} />);

        type("done");
        fireEvent.blur(field());

        expect(commit).toHaveBeenCalledWith("done");
    });

    /**
     * The guard that makes deferred writing safe: keystrokes still in hand belong to the element
     * they were typed into, never to the one that has just been selected.
     */
    it("writes a pending draft to what it was typed into when the subject changes", () => {
        const commitFirst = vi.fn();
        const commitSecond = vi.fn();
        const { rerender } = render(
            <DraftTextInput value="first" onCommit={commitFirst} draftResetKey="first" />
        );

        type("first edited");
        rerender(<DraftTextInput value="second" onCommit={commitSecond} draftResetKey="second" />);

        expect(commitFirst).toHaveBeenCalledWith("first edited");
        expect(commitSecond).not.toHaveBeenCalled();
        expect(field().value).toBe("second");
    });

    it("writes a pending draft on unmount", () => {
        const commit = vi.fn();
        const { unmount } = render(<DraftTextInput value="" onCommit={commit} />);

        type("half typed");
        unmount();

        expect(commit).toHaveBeenCalledWith("half typed");
    });

    it("holds everything an IME composes until a candidate is chosen", () => {
        const commit = vi.fn();
        render(<DraftTextInput value="" onCommit={commit} />);

        fireEvent.compositionStart(field());
        type("n");
        type("ni");
        settle(1000);

        expect(commit).not.toHaveBeenCalled();

        fireEvent.compositionEnd(field());
        type("你");
        settle();

        expect(commit).toHaveBeenCalledTimes(1);
        expect(commit).toHaveBeenCalledWith("你");
    });

    it("shows changes made elsewhere once the value it wrote comes back round", () => {
        const commit = vi.fn();
        const { rerender } = render(<DraftTextInput value="" onCommit={commit} />);

        type("mine");
        settle();
        rerender(<DraftTextInput value="mine" onCommit={commit} />);
        rerender(<DraftTextInput value="undone" onCommit={commit} />);

        expect(field().value).toBe("undone");
    });

    it("adopts a value the document rewrote when the field is left", () => {
        const commit = vi.fn();
        render(
            <DraftTextInput value="12345" onCommit={commit} readCommittedValue={() => "12345"} />
        );

        type("123456");
        fireEvent.blur(field());

        expect(commit).toHaveBeenCalledWith("123456");
        expect(field().value).toBe("12345");
    });

    it("never writes while read only", () => {
        const commit = vi.fn();
        render(<DraftTextInput value="" onCommit={commit} readOnly />);

        type("ignored");
        settle();
        fireEvent.blur(field());

        expect(commit).not.toHaveBeenCalled();
    });
});
