// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchBox } from "../modules/assets/components/SearchBox";
import { useTextFieldUndo } from "./useTextFieldUndo";

vi.mock("@/lib/app/platform", () => ({ isMacPlatform: () => false }));

/**
 * The Search panel's two boxes, as the panel wires them: the query in a `SearchBox`, the replacement
 * in a plain input, each with a stack of its own. Chromium's single per-page stack is what made
 * Ctrl+Z in the search box put back the replace box's typing; jsdom has no undo at all, so anything
 * these fields undo here they undid themselves.
 */
function SearchAndReplace() {
    const [query, setQuery] = useState("");
    const [replacement, setReplacement] = useState("");
    const attachQuery = useTextFieldUndo(query, setQuery);
    const attachReplacement = useTextFieldUndo(replacement, setReplacement);
    return (
        <>
            <SearchBox value={query} onChange={setQuery} inputRef={attachQuery} placeholder="search" />
            <input
                ref={attachReplacement}
                value={replacement}
                onChange={event => setReplacement(event.target.value)}
                placeholder="replace"
            />
        </>
    );
}

function box(placeholder: string): HTMLInputElement {
    return screen.getByPlaceholderText(placeholder) as HTMLInputElement;
}

/** Type as a browser does: `beforeinput` while the old text is still there, then the new text. */
function type(field: HTMLInputElement, text: string) {
    for (const character of text) {
        const before = new InputEvent("beforeinput", { inputType: "insertText", data: character, cancelable: true, bubbles: true });
        field.dispatchEvent(before);
        fireEvent.input(field, { target: { value: field.value + character } });
    }
}

function press(field: HTMLInputElement, key: string, modifiers: { shift?: boolean } = {}): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key, ctrlKey: true, shiftKey: !!modifiers.shift, cancelable: true, bubbles: true });
    act(() => {
        field.dispatchEvent(event);
    });
    return event;
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["performance"] });
});

afterEach(() => {
    vi.useRealTimers();
    cleanup();
});

describe("useTextFieldUndo", () => {
    it("takes back the typing of the box the caret is in, and leaves the other box alone", () => {
        render(<SearchAndReplace />);
        type(box("search"), "hello");
        vi.advanceTimersByTime(1000);
        type(box("replace"), "hi");

        press(box("search"), "z");

        expect(box("search").value).toBe("");
        expect(box("replace").value).toBe("hi");
    });

    it("takes the key even with nothing left to undo, so the browser never reaches another box", () => {
        render(<SearchAndReplace />);
        type(box("replace"), "hi");

        const event = press(box("search"), "z");

        expect(event.defaultPrevented).toBe(true);
        expect(box("replace").value).toBe("hi");
    });

    it("redoes with Ctrl+Shift+Z and with Ctrl+Y", () => {
        render(<SearchAndReplace />);
        type(box("replace"), "hi");

        press(box("replace"), "z");
        expect(box("replace").value).toBe("");
        press(box("replace"), "z", { shift: true });
        expect(box("replace").value).toBe("hi");
        press(box("replace"), "z");
        press(box("replace"), "y");
        expect(box("replace").value).toBe("hi");
    });

    it("steps back by bursts of typing, not by keystrokes", () => {
        render(<SearchAndReplace />);
        type(box("search"), "good");
        vi.advanceTimersByTime(1000);
        type(box("search"), "bye");

        press(box("search"), "z");
        expect(box("search").value).toBe("good");
        press(box("search"), "z");
        expect(box("search").value).toBe("");
    });

    it("brings back a query the box's clear button emptied", () => {
        render(<SearchAndReplace />);
        type(box("search"), "hello");

        fireEvent.click(screen.getByRole("button"));
        expect(box("search").value).toBe("");

        press(box("search"), "z");
        expect(box("search").value).toBe("hello");
    });

    it("answers an Undo handed over by the Edit menu from the box's own stack", () => {
        render(<SearchAndReplace />);
        type(box("search"), "hello");
        vi.advanceTimersByTime(1000);
        type(box("replace"), "hi");

        const undo = new InputEvent("beforeinput", { inputType: "historyUndo", cancelable: true, bubbles: true });
        act(() => {
            box("search").dispatchEvent(undo);
        });

        expect(undo.defaultPrevented).toBe(true);
        expect(box("search").value).toBe("");
        expect(box("replace").value).toBe("hi");
    });
});
