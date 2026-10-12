// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    DOCUMENT_FONT_FACES_ATTRIBUTE,
    addFontFaceToDocument,
    fontFaceRuleText,
    fontMimeType,
    publishFontFaceRule,
} from "./documentFontFaces";

/**
 * The engine's stage picture (html-to-image) carries a font into the picture only when it finds an
 * `@font-face` rule for it in `document.styleSheets`, and only for a family the captured element is
 * set in. These read the document the way that library does, so a face that would be missing from
 * the picture is missing here too.
 */
function fontFaceRulesOf(doc: Document): CSSFontFaceRule[] {
    const rules: CSSFontFaceRule[] = [];
    for (const sheet of Array.from(doc.styleSheets)) {
        for (const rule of Array.from(sheet.cssRules)) {
            if (rule.type === CSSRule.FONT_FACE_RULE) {
                rules.push(rule as CSSFontFaceRule);
            }
        }
    }
    return rules;
}

function familyOf(rule: CSSFontFaceRule): string {
    // Normalised as html-to-image normalises it before matching against the families in use.
    return rule.style.getPropertyValue("font-family").trim().replace(/["']/g, "");
}

function bytesOf(tag: string, length = 16): ArrayBuffer {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < tag.length; index += 1) {
        bytes[index] = tag.charCodeAt(index);
    }
    return bytes.buffer;
}

describe("a game font on the document", () => {
    let doc: Document;
    let createdBlobs: Blob[];

    beforeEach(() => {
        // The window's own document: jsdom builds style sheets only for a document with a window.
        doc = document;
        for (const node of Array.from(doc.head.querySelectorAll("style"))) {
            node.remove();
        }
        createdBlobs = [];
        let next = 0;
        // jsdom has no object URLs; the shape is all the rule needs.
        vi.stubGlobal("URL", Object.assign(Object.create(URL), {
            createObjectURL: (blob: Blob) => {
                createdBlobs.push(blob);
                next += 1;
                return `blob:nlgame://runtime/font-${next}`;
            },
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        delete (doc as { fonts?: unknown }).fonts;
    });

    it("is invisible to a stage picture when it is registered from script alone", () => {
        // What a game window did before: the face drew on the page and was in no stylesheet.
        const fonts = { add: vi.fn() };
        Object.defineProperty(doc, "fonts", { value: fonts, configurable: true });

        doc.fonts.add({ family: "nlRuntimeFont_body" } as unknown as FontFace);

        expect(fonts.add).toHaveBeenCalledTimes(1);
        expect(fontFaceRulesOf(doc)).toEqual([]);
    });

    it("draws with the face and publishes a rule a stage picture can find, under the same family", () => {
        const fonts = { add: vi.fn() };
        Object.defineProperty(doc, "fonts", { value: fonts, configurable: true });
        const face = { family: "nlRuntimeFont_body" } as unknown as FontFace;

        addFontFaceToDocument("nlRuntimeFont_body", { face, bytes: bytesOf("wOF2") }, doc);

        expect(fonts.add).toHaveBeenCalledWith(face);
        const rules = fontFaceRulesOf(doc);
        expect(rules).toHaveLength(1);
        expect(familyOf(rules[0]!)).toBe("nlRuntimeFont_body");
        // Read from the sheet's source: jsdom's CSSOM drops a `src` it does not know, where a
        // browser keeps it - and it is the URL html-to-image fetches and inlines.
        const sheet = doc.head.querySelector(`style[${DOCUMENT_FONT_FACES_ATTRIBUTE}]`)!;
        expect(sheet.textContent).toContain('src: url("blob:nlgame://runtime/font-1")');
        expect(createdBlobs[0]!.type).toBe("font/woff2");
        expect(createdBlobs[0]!.size).toBe(16);
    });

    it("writes one rule per family however many times the family is registered", () => {
        publishFontFaceRule("nlDevFont_body", bytesOf("OTTO"), doc);
        publishFontFaceRule("nlDevFont_body", bytesOf("OTTO"), doc);
        publishFontFaceRule("nlDevFont_title", bytesOf("\u0000\u0001\u0000\u0000"), doc);

        expect(fontFaceRulesOf(doc).map(familyOf)).toEqual(["nlDevFont_body", "nlDevFont_title"]);
        expect(createdBlobs).toHaveLength(2);
        expect(doc.head.querySelectorAll(`style[${DOCUMENT_FONT_FACES_ATTRIBUTE}]`)).toHaveLength(1);
    });

    it("starts a fresh record when the sheet has been taken out of the document", () => {
        publishFontFaceRule("nlDevFont_body", bytesOf("OTTO"), doc);
        doc.head.querySelector(`style[${DOCUMENT_FONT_FACES_ATTRIBUTE}]`)!.remove();

        publishFontFaceRule("nlDevFont_body", bytesOf("OTTO"), doc);

        expect(fontFaceRulesOf(doc).map(familyOf)).toEqual(["nlDevFont_body"]);
    });

    it("does nothing where the document has no head to hold a stylesheet", () => {
        const bare = { fonts: { add: vi.fn() } } as unknown as Document;

        expect(() => addFontFaceToDocument("nlDevFont_body", {
            face: {} as FontFace,
            bytes: bytesOf("OTTO"),
        }, bare)).not.toThrow();
        expect(publishFontFaceRule("nlDevFont_body", bytesOf("OTTO"), bare)).toBe(false);
        expect(createdBlobs).toHaveLength(0);
    });

    it("does nothing where no object URL can be made", () => {
        vi.stubGlobal("URL", {});

        expect(publishFontFaceRule("nlDevFont_body", bytesOf("OTTO"), doc)).toBe(false);
        expect(fontFaceRulesOf(doc)).toEqual([]);
    });
});

describe("the rule's text", () => {
    it("quotes the family and the URL, escaping what would end either", () => {
        expect(fontFaceRuleText('a"b\\c', "blob:x/1")).toBe(
            '@font-face { font-family: "a\\"b\\\\c"; src: url("blob:x/1"); }\n',
        );
    });

    it("names the format from the file's signature", () => {
        expect(fontMimeType(bytesOf("wOF2"))).toBe("font/woff2");
        expect(fontMimeType(bytesOf("wOFF"))).toBe("font/woff");
        expect(fontMimeType(bytesOf("OTTO"))).toBe("font/otf");
        expect(fontMimeType(bytesOf("ttcf"))).toBe("font/collection");
        expect(fontMimeType(bytesOf("\u0000\u0001\u0000\u0000"))).toBe("font/ttf");
        expect(fontMimeType(new ArrayBuffer(2))).toBe("font/ttf");
    });
});
