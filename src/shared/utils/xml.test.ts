import { describe, expect, it } from "vitest";
import {
    childElements,
    decodeXmlEntities,
    escapeXmlAttribute,
    escapeXmlText,
    findElements,
    firstChildElement,
    parseXml,
    xmlAttributes,
    xmlTextContent,
} from "./xml";

describe("escaping", () => {
    it("escapes the three text characters and leaves the rest alone", () => {
        expect(escapeXmlText("a < b & c > d \"e\"")).toBe("a &lt; b &amp; c &gt; d \"e\"");
    });

    it("escapes quotes and control whitespace in attribute values", () => {
        expect(escapeXmlAttribute("say \"hi\"\nnow")).toBe("say &quot;hi&quot;&#10;now");
    });

    it("skips undefined attributes and keeps declaration order", () => {
        expect(xmlAttributes({ id: "1", missing: undefined, name: "x" })).toBe(" id=\"1\" name=\"x\"");
    });

    it("decodes named and numeric entities, and leaves unknown ones", () => {
        expect(decodeXmlEntities("&lt;&#65;&#x4e2d;&amp;&nbsp;")).toBe("<A中&&nbsp;");
    });
});

describe("parseXml", () => {
    it("reads elements, attributes and nested text in document order", () => {
        const root = parseXml("<a x=\"1\"><b>hi <c>there</c>!</b></a>");
        expect(root?.name).toBe("a");
        expect(root?.attributes).toEqual({ x: "1" });
        expect(xmlTextContent(root!)).toBe("hi there!");
    });

    it("strips namespace prefixes from element names but not from attributes", () => {
        const root = parseXml("<xliff:file xml:space=\"preserve\"><xliff:body/></xliff:file>");
        expect(root?.name).toBe("file");
        expect(root?.attributes["xml:space"]).toBe("preserve");
        expect(firstChildElement(root!, "body")).toBeDefined();
    });

    it("skips the declaration, comments and a DOCTYPE, and unwraps CDATA verbatim", () => {
        const root = parseXml("<?xml version=\"1.0\"?><!DOCTYPE a><a><!-- note --><b><![CDATA[ <raw> & ]]></b></a>");
        expect(xmlTextContent(root!)).toBe(" <raw> & ");
    });

    it("keeps a `>` that lives inside an attribute value", () => {
        const root = parseXml("<a title=\"1 > 0\"/>");
        expect(root?.attributes.title).toBe("1 > 0");
    });

    it("finds descendants at any depth, and direct children only when asked", () => {
        const root = parseXml("<a><g><u id=\"1\"/></g><u id=\"2\"/></a>");
        expect(findElements(root!, "u").map(unit => unit.attributes.id)).toEqual(["1", "2"]);
        expect(childElements(root!, "u").map(unit => unit.attributes.id)).toEqual(["2"]);
    });

    it("returns null when there is no element at all", () => {
        expect(parseXml("")).toBeNull();
        expect(parseXml("plain text")).toBeNull();
    });

    it("recovers what it can from a truncated document", () => {
        const root = parseXml("<a><b>kept</b><c>also kept");
        expect(xmlTextContent(root!)).toBe("keptalso kept");
    });

    it("drops a stray closing tag rather than unwinding the tree", () => {
        const root = parseXml("<a><b>one</c>two</b></a>");
        expect(xmlTextContent(root!)).toBe("onetwo");
    });
});
