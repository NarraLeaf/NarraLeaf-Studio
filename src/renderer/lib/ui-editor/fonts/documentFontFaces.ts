/**
 * Putting a game font on the document so that a picture of the stage is set in it too.
 *
 * # Why a face registered from script is not enough
 *
 * A game window registers a project font as a `FontFace` built from the file's bytes and added to
 * `document.fonts` (see `fontFaceFromUrl` for why from the bytes). That is all the live page needs,
 * and every page of the interface is drawn in the author's font.
 *
 * The engine's stage picture is not drawn by the page. `LiveGame.capturePng` hands the stage to
 * html-to-image, which copies it into an SVG `foreignObject` and rasterises that as an image - and an
 * image is a document of its own, with none of the page's fonts. The library carries fonts across by
 * reading `@font-face` **rules** out of `document.styleSheets` and inlining them; a face that exists
 * only in `document.fonts` is not in any stylesheet, so it never reaches the picture, and everything
 * on the stage - the dialogue box, the quick menu, every Game UI slot - came out in the system's
 * sans-serif. Pages looked right only because a play-test picture taken before the story starts is
 * the window's own pixels rather than the engine's.
 *
 * That picture is what a save shows on its slot, what a page opened over the game keeps of the screen
 * it covers, and what an agent sees when it play-tests in Dev Mode.
 *
 * # The rule beside the face
 *
 * So the same bytes are also published as a stylesheet `@font-face` rule under the same family, read
 * from a `blob:` URL of them. The live page goes on drawing with the face it already had: a face added
 * from script is ordered after every face a stylesheet declares, and the last face of a family that
 * covers a character is the one used, so the rule's copy is never loaded for drawing. html-to-image
 * finds the rule, fetches the blob once and inlines it as a `data:` URL, and the picture is set in the
 * author's font.
 *
 * A `blob:` URL rather than a `data:` one, so the stylesheet holds a short string instead of a base64
 * copy of a typeface that may be tens of megabytes - the bytes sit once in blob storage, and are only
 * encoded when a picture is first taken. Every game window's CSP lets the page fetch `blob:`.
 *
 * Comments in English per project convention.
 */

import type { LoadedFontFace } from "./fontFaceFromUrl";

/** The attribute on the one `<style>` element per document that holds these rules. */
export const DOCUMENT_FONT_FACES_ATTRIBUTE = "data-nl-font-faces";

/**
 * The families each rule sheet already holds, so a second registration adds nothing. Keyed by the
 * `<style>` element rather than the document: a sheet that has been taken out of the document takes
 * its record with it, and the next registration starts a fresh one.
 */
const publishedFamilies = new WeakMap<HTMLStyleElement, Set<string>>();

/**
 * Register a loaded face on `doc` for drawing, and publish the rule a stage picture reads.
 *
 * `family` is the family the face was built under, and the one text is set in.
 */
export function addFontFaceToDocument(
    family: string,
    loaded: LoadedFontFace,
    doc: Document = document,
): void {
    doc.fonts.add(loaded.face);
    publishFontFaceRule(family, loaded.bytes, doc);
}

/**
 * Publish an `@font-face` rule for `family`, read from a `blob:` URL of `bytes`.
 *
 * Once per family per document. Returns whether the document now carries a rule for it - false where
 * there is no stylesheet to write to or no way to make a URL of the bytes, which is a picture set in
 * the fallback face and nothing worse: the live page has the face either way.
 */
export function publishFontFaceRule(family: string, bytes: ArrayBuffer, doc: Document = document): boolean {
    const style = documentFontFacesStyle(doc);
    if (!style) {
        return false;
    }
    let families = publishedFamilies.get(style);
    if (families?.has(family)) {
        return true;
    }
    if (typeof Blob === "undefined" || typeof URL?.createObjectURL !== "function") {
        return false;
    }
    let url: string;
    try {
        url = URL.createObjectURL(new Blob([bytes], { type: fontMimeType(bytes) }));
    } catch {
        return false;
    }
    style.appendChild(doc.createTextNode(fontFaceRuleText(family, url)));
    if (!families) {
        families = new Set();
        publishedFamilies.set(style, families);
    }
    families.add(family);
    return true;
}

/**
 * The rule as written. No descriptors beyond the family, matching a `FontFace` built with none, so
 * the picture picks and synthesises weights exactly as the page does.
 */
export function fontFaceRuleText(family: string, url: string): string {
    return `@font-face { font-family: "${escapeCssString(family)}"; src: url("${escapeCssString(url)}"); }\n`;
}

/**
 * What the bytes are, from their signature.
 *
 * Carried on the blob, so the `data:` URL the picture inlines names its format. Anything not
 * recognised is called TrueType, which is what the browser sniffs it as anyway.
 */
export function fontMimeType(bytes: ArrayBuffer): string {
    if (bytes.byteLength < 4) {
        return "font/ttf";
    }
    const view = new Uint8Array(bytes, 0, 4);
    const tag = String.fromCharCode(view[0]!, view[1]!, view[2]!, view[3]!);
    switch (tag) {
        case "wOF2":
            return "font/woff2";
        case "wOFF":
            return "font/woff";
        case "OTTO":
            return "font/otf";
        case "ttcf":
            return "font/collection";
        default:
            return "font/ttf";
    }
}

function escapeCssString(value: string): string {
    return value.replace(/["\\\n]/g, character => (character === "\n" ? "\\a " : `\\${character}`));
}

/** The document's rule sheet, made on first use. Null where the document cannot hold one. */
function documentFontFacesStyle(doc: Document): HTMLStyleElement | null {
    if (typeof doc.createElement !== "function" || typeof doc.createTextNode !== "function" || !doc.head) {
        return null;
    }
    const existing = doc.head.querySelector<HTMLStyleElement>(`style[${DOCUMENT_FONT_FACES_ATTRIBUTE}]`);
    if (existing) {
        return existing;
    }
    const style = doc.createElement("style");
    style.setAttribute(DOCUMENT_FONT_FACES_ATTRIBUTE, "");
    doc.head.appendChild(style);
    return style;
}
