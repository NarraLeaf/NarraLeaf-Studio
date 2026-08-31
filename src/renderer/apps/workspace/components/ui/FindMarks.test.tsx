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

    it("wears the quiet wash by default and the strong one on the entry the cursor is on", () => {
        const { container: quiet } = render(
            <MarkedText text="The corridor" matcher={compileMatcher("corridor", PLAIN)} />,
        );
        const quietClass = quiet.querySelector("mark")!.className;
        cleanup();
        const { container: strong } = render(
            <MarkedText text="The corridor" matcher={compileMatcher("corridor", PLAIN)} active />,
        );
        const strongClass = strong.querySelector("mark")!.className;

        // Two weights of one colour, not two colours: the ring around the row and the wash inside it
        // are the same answer at two scales.
        expect(quietClass).not.toBe(strongClass);
        expect(quietClass).toContain("bg-primary/20");
        expect(strongClass).toContain("bg-primary/45");
        // Neither may set a colour of its own - the mirror behind a textarea paints its letters
        // transparent, and a mark that overrode that would light up a second copy of the sentence.
        expect(quietClass).toContain("text-inherit");
        expect(strongClass).toContain("text-inherit");
    });

    it("marks every hit in the current entry, because the cursor steps entries and not words", () => {
        const { container } = render(
            <MarkedText text="corridor and corridor" matcher={compileMatcher("corridor", PLAIN)} active />,
        );

        const classes = [...container.querySelectorAll("mark")].map(node => node.className);
        expect(classes).toHaveLength(2);
        expect(new Set(classes).size).toBe(1);
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

    it("carries the same two weights as the text it sits behind", () => {
        const { container } = render(
            <TextareaMarkLayer value="The corridor" matcher={compileMatcher("corridor", PLAIN)} active />,
        );

        expect(container.querySelector("mark")!.className).toContain("bg-primary/45");
    });

    it("is absent when there is nothing to mark", () => {
        expect(render(<TextareaMarkLayer value="The clubroom" matcher={compileMatcher("corridor", PLAIN)} />)
            .container.innerHTML).toBe("");
        cleanup();
        expect(render(<TextareaMarkLayer value="The corridor" matcher={null} />).container.innerHTML).toBe("");
    });
});
