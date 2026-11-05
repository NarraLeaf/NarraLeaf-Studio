// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchBox } from "./SearchBox";

/**
 * The box handed every change to its owner, so while an input method composed 你 the owner searched
 * for "n" and then "ni" - pinyin filtering the list it was about to fill.
 */

afterEach(cleanup);

function field(): HTMLInputElement {
    return screen.getByRole("textbox") as HTMLInputElement;
}

function Owned(props: { onQuery: (value: string) => void }) {
    const [value, setValue] = useState("");
    return <SearchBox value={value} onChange={next => { setValue(next); props.onQuery(next); }} />;
}

describe("SearchBox", () => {
    it("searches for what an input method commits, not for what it is composing", () => {
        const onQuery = vi.fn();
        render(<Owned onQuery={onQuery} />);

        fireEvent.compositionStart(field());
        fireEvent.change(field(), { target: { value: "n" } });
        fireEvent.change(field(), { target: { value: "ni" } });
        expect(onQuery).not.toHaveBeenCalled();
        // The field still shows what is being composed.
        expect(field().value).toBe("ni");

        fireEvent.change(field(), { target: { value: "你" } });
        fireEvent.compositionEnd(field());
        expect(onQuery).toHaveBeenCalledTimes(1);
        expect(onQuery).toHaveBeenLastCalledWith("你");
    });

    it("searches on every keystroke outside a composition", () => {
        const onQuery = vi.fn();
        render(<Owned onQuery={onQuery} />);
        fireEvent.change(field(), { target: { value: "fo" } });
        fireEvent.change(field(), { target: { value: "for" } });
        expect(onQuery.mock.calls.map(call => call[0])).toEqual(["fo", "for"]);
    });

    it("follows a value its owner sets", () => {
        const { rerender } = render(<SearchBox value="room" onChange={() => {}} />);
        expect(field().value).toBe("room");
        rerender(<SearchBox value="" onChange={() => {}} />);
        expect(field().value).toBe("");
    });
});
