// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { StoryRichRun } from "@shared/types/story";
import type { RichRenderOptions } from "@/apps/workspace/modules/story/scene-editor/richText";
import {
    caretOffsetIn,
    printTranslationTokens,
    renderTranslationTokens,
    setCaretOffset,
    translationTokens,
    translationTokensFromDom,
} from "./translationField";

/**
 * The field draws tokens into a contentEditable and reads them back out of whatever the browser
 * leaves behind. These are the two halves of that, exercised against a real DOM - the round trip is
 * what a translation is stored from, so a token lost here is styling lost in one language.
 */

const OPTIONS: RichRenderOptions = {
    interactive: false,
    titles: {
        pauseClick: "pause",
        pauseSeconds: seconds => `pause ${seconds}s`,
        insertedValue: name => `value ${name}`,
        valueFallback: "value",
        expressionEvent: "expression",
        soundEvent: "sound",
    },
};

/** One of each shape: plain text, a styled run, a pause, an event and an interpolation. */
const SOURCE: StoryRichRun[] = [
    { text: "I " },
    { text: "decided", marks: { emphasis: "dot", bold: true } },
    { pause: 400 },
    { text: " last year, " },
    { event: { sound: { assetId: "se" } } },
    { interpolation: { kind: "variable", target: { scope: "saved", variableId: "name" } } },
    { text: "." },
];

let root: HTMLElement;

beforeEach(() => {
    root = document.createElement("div");
    document.body.append(root);
});

function roundTrip(target: string): string {
    renderTranslationTokens(root, translationTokens(target), SOURCE, OPTIONS);
    return printTranslationTokens(translationTokensFromDom(root));
}

describe("the translation field's DOM", () => {
    it("takes every token through the DOM and back unchanged", () => {
        for (const target of [
            "私が‹1›去年‹/1›決めた。",
            "‹2/›私が決めた",
            "決めた‹4/›",
            "{0}が‹1›決めた‹/1›",
            "私が‹1›去年‹/1›‹2/›決めた‹4/›{0}。",
            "ただの文。",
            "",
        ]) {
            expect(roundTrip(target), target).toBe(target);
        }
    });

    it("draws a tag as an element the caret cannot enter", () => {
        renderTranslationTokens(root, translationTokens("a‹1›b‹/1›c"), SOURCE, OPTIONS);
        const tags = root.querySelectorAll("[data-tagopen],[data-tagclose]");
        expect(tags).toHaveLength(2);
        for (const tag of tags) {
            expect((tag as HTMLElement).contentEditable).toBe("false");
        }
    });

    it("draws the words inside a pair wearing the run's styling", () => {
        renderTranslationTokens(root, translationTokens("a‹1›b‹/1›c"), SOURCE, OPTIONS);
        const styled = root.querySelector<HTMLElement>("[data-emphasis]");
        expect(styled?.textContent).toBe("b");
        expect(styled?.dataset.emphasis).toBe("dot");
    });

    it("never draws a chip a translator could open", () => {
        renderTranslationTokens(root, translationTokens("‹2/›{0}‹4/›"), SOURCE, OPTIONS);
        for (const chip of root.querySelectorAll<HTMLElement>("[data-pause],[data-interp],[data-event]")) {
            expect(chip.getAttribute("role")).toBeNull();
            expect(chip.className).not.toContain("cursor-pointer");
        }
    });

    it("reads markup a paste or the browser introduced for its words alone", () => {
        renderTranslationTokens(root, translationTokens("a‹1›b‹/1›"), SOURCE, OPTIONS);
        const injected = document.createElement("b");
        injected.textContent = "c";
        root.append(injected);
        expect(printTranslationTokens(translationTokensFromDom(root))).toBe("a‹1›b‹/1›c");
    });

    it("counts a chip as one caret position, and puts the caret back where it counted", () => {
        renderTranslationTokens(root, translationTokens("ab‹2/›cd"), SOURCE, OPTIONS);
        // a b [chip] c d  ->  five positions, the chip being the third.
        setCaretOffset(root, 3);
        const selection = window.getSelection();
        expect(selection).toBeTruthy();
        const range = selection!.getRangeAt(0);
        expect(caretOffsetIn(root, range.startContainer, range.startOffset)).toBe(3);

        setCaretOffset(root, 5);
        const end = selection!.getRangeAt(0);
        expect(caretOffsetIn(root, end.startContainer, end.startOffset)).toBe(5);
    });

    it("keeps a translation that names a run this line does not have out of the DOM, and out of the string", () => {
        expect(roundTrip("a‹9/›b")).toBe("ab");
    });
});
