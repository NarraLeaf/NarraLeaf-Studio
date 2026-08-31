// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { compileMatcher } from "@/lib/workspace/services/search/textMatcher";
import { MarkedText, TextareaMarkLayer } from "./FindMarks";

const PLAIN = { caseSensitive: false, wholeWord: false, regex: false };

afterEach(cleanup);

describe("MarkedText", () => {
    it("marks every hit and leaves the rest of the sentence alone", () => {
        const { container } = render(
            <MarkedText text="The corridor, and the corridor again." matcher={compileMatcher("corridor", PLAIN)} />,
        );

        const marks = [...container.querySelectorAll("mark")].map(node => node.textContent);
        expect(marks).toEqual(["corridor", "corridor"]);
        // The text the reader sees is untouched - marking is a background, never an edit.
        expect(container.textContent).toBe("The corridor, and the corridor again.");
    });

    it("marks what the matcher matched, not what was typed", () => {
        const { container } = render(
            <MarkedText text="The Corridor" matcher={compileMatcher("corridor", PLAIN)} />,
        );

        // Case folding is the matcher's, so the mark carries the row's own capitals.
        expect(container.querySelector("mark")?.textContent).toBe("Corridor");
    });

    it("adds no elements at all when nothing is being searched", () => {
        const { container } = render(<MarkedText text="The corridor" matcher={null} />);

        // Every row in a windowed table renders this, most of them with no query at all, so the
        // resting cost has to be the string and nothing else.
        expect(container.querySelector("mark")).toBeNull();
        expect(container.innerHTML).toBe("The corridor");
    });

    it("adds no elements for a row the query does not reach", () => {
        const { container } = render(
            <MarkedText text="The clubroom" matcher={compileMatcher("corridor", PLAIN)} />,
        );

        expect(container.innerHTML).toBe("The clubroom");
    });
});

describe("TextareaMarkLayer", () => {
    it("draws the hits and nothing else, so only the box's own text is read", () => {
        const { container } = render(
            <TextareaMarkLayer value="The corridor" matcher={compileMatcher("corridor", PLAIN)} />,
        );

        const layer = container.firstElementChild as HTMLElement;
        expect(layer.querySelector("mark")?.textContent).toBe("corridor");
        // The mirror's own letters are invisible and untouchable: the textarea over it holds the
        // real text, and two copies of the same sentence must not be selectable or readable twice.
        expect(layer.className).toContain("text-transparent");
        expect(layer.className).toContain("pointer-events-none");
        expect(layer.getAttribute("aria-hidden")).toBe("true");
    });

    it("is absent when there is nothing to mark", () => {
        expect(render(<TextareaMarkLayer value="The clubroom" matcher={compileMatcher("corridor", PLAIN)} />)
            .container.innerHTML).toBe("");
        cleanup();
        expect(render(<TextareaMarkLayer value="The corridor" matcher={null} />).container.innerHTML).toBe("");
    });
});
