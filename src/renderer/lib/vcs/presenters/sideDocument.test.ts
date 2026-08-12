// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { uiDocumentSpec } from "@shared/documents/specs";
import { UI_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/document";
import { parseSideDocument, SideDocumentParseError } from "./sideDocument";

/**
 * Bytes out of a revision, back into the document they are.
 *
 * The three ways this fails are three different sentences at the author and none of them is
 * reachable from a component test, which is why the parse is a function of its own. The one that
 * matters most is the middle one: a decoder that substitutes replacement characters would turn a
 * truncated file into one that parses to something nobody wrote, and the canvas would then draw it.
 */

const PATH = "editor/ui/uidoc.json";

function bytesOf(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

const MINIMAL = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "ui-1",
    name: "Interface",
    surfaces: [],
    components: [],
    elements: {},
};

describe("reading one side of a comparison as a document", () => {
    it("parses bytes the spec accepts", () => {
        const document = parseSideDocument(uiDocumentSpec, PATH, bytesOf(JSON.stringify(MINIMAL)));

        expect(document.name).toBe("Interface");
    });

    it("refuses bytes that are not UTF-8 text rather than decoding them lossily", () => {
        // A multi-byte sequence cut in half, which is what a truncated write leaves behind.
        expect(() => parseSideDocument(uiDocumentSpec, PATH, new Uint8Array([0x7b, 0xe2, 0x28])))
            .toThrow(SideDocumentParseError);
    });

    it("refuses text that is not JSON", () => {
        expect(() => parseSideDocument(uiDocumentSpec, PATH, bytesOf("not json")))
            .toThrow(SideDocumentParseError);
    });

    /**
     * The spec's own refusal, carried through verbatim: it is the same gate the comparison went
     * through in the main process, so a document this refuses is one whose change list is also
     * missing - and the author is better told which field was wrong than "unreadable".
     */
    it("carries the spec's reason when the document is not of this format", () => {
        expect(() => parseSideDocument(uiDocumentSpec, PATH, bytesOf(JSON.stringify({ ...MINIMAL, surfaces: {} }))))
            .toThrow(/"surfaces" must be an array/);
    });

    it("refuses a document a newer Studio wrote", () => {
        const newer = { ...MINIMAL, schemaVersion: UI_DOCUMENT_SCHEMA_VERSION + 1 };

        expect(() => parseSideDocument(uiDocumentSpec, PATH, bytesOf(JSON.stringify(newer))))
            .toThrow(SideDocumentParseError);
    });
});
