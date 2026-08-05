/**
 * Small XML primitives for the localization exchange formats (XLIFF is the only
 * XML dialect Studio reads or writes).
 *
 * Deliberately hand-rolled rather than pulled from a dependency: the subset in
 * play is elements, attributes, text, CDATA and comments, and the reader has to
 * survive whatever a translation tool wrote - a namespace prefix on every tag, a
 * DOCTYPE, a pretty-printer's indentation. A DOM parser is not an option either:
 * this module is shared, and the main process has no `DOMParser`.
 *
 * Nodes keep text and elements in one ordered child list. That ordering is the
 * whole point for inline markup: a CAT tool may hand back
 * `<source>Hi <g id="1">there</g>!</source>`, and the text of that unit is
 * "Hi there!" only if the pieces are read in document order.
 *
 * Comments in English per project convention.
 */

export type XmlText = { kind: "text"; value: string };

export type XmlElement = {
    kind: "element";
    /** Local name - any namespace prefix is stripped (`xliff:file` reads as `file`). */
    name: string;
    /** Attribute names keep their prefix (`xml:space`), values are entity-decoded. */
    attributes: Record<string, string>;
    children: XmlNode[];
};

export type XmlNode = XmlElement | XmlText;

const NAMED_ENTITIES: Record<string, string> = {
    lt: "<",
    gt: ">",
    amp: "&",
    quot: "\"",
    apos: "'",
};

/** Decode the entity forms XML guarantees, plus numeric ones. Unknown entities are left verbatim. */
export function decodeXmlEntities(text: string): string {
    if (!text.includes("&")) {
        return text;
    }
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity: string) => {
        if (entity.startsWith("#x") || entity.startsWith("#X")) {
            const code = Number.parseInt(entity.slice(2), 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        if (entity.startsWith("#")) {
            const code = Number.parseInt(entity.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        return NAMED_ENTITIES[entity] ?? match;
    });
}

/** Escape text content. `>` is escaped too so a stray `]]>` can never form. */
export function escapeXmlText(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape an attribute value (double-quoted). Tabs and newlines go numeric so they survive. */
export function escapeXmlAttribute(value: string): string {
    return escapeXmlText(value)
        .replace(/"/g, "&quot;")
        .replace(/\r/g, "&#13;")
        .replace(/\n/g, "&#10;")
        .replace(/\t/g, "&#9;");
}

/** Serialize attributes in the given order, skipping undefined values. */
export function xmlAttributes(attributes: Record<string, string | undefined>): string {
    return Object.entries(attributes)
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .map(([name, value]) => ` ${name}="${escapeXmlAttribute(value)}"`)
        .join("");
}

/** All text under an element, in document order, with inline markup flattened away. */
export function xmlTextContent(element: XmlElement): string {
    let out = "";
    for (const child of element.children) {
        out += child.kind === "text" ? child.value : xmlTextContent(child);
    }
    return out;
}

/** Direct children with this local name. */
export function childElements(element: XmlElement, name: string): XmlElement[] {
    return element.children.filter((child): child is XmlElement => child.kind === "element" && child.name === name);
}

/** First direct child with this local name, if any. */
export function firstChildElement(element: XmlElement, name: string): XmlElement | undefined {
    return childElements(element, name)[0];
}

/** Every descendant with this local name, in document order (the element itself excluded). */
export function findElements(element: XmlElement, name: string): XmlElement[] {
    const found: XmlElement[] = [];
    const visit = (node: XmlElement): void => {
        for (const child of node.children) {
            if (child.kind !== "element") {
                continue;
            }
            if (child.name === name) {
                found.push(child);
            }
            visit(child);
        }
    };
    visit(element);
    return found;
}

/** Strip a namespace prefix: `xliff:trans-unit` reads as `trans-unit`. */
function localName(name: string): string {
    const colon = name.indexOf(":");
    return colon < 0 ? name : name.slice(colon + 1);
}

/** Index of the `>` closing a tag that starts at `start`, ignoring `>` inside quoted values. */
function findTagEnd(text: string, start: number): number {
    let quote: string | null = null;
    for (let index = start + 1; index < text.length; index += 1) {
        const char = text[index];
        if (quote) {
            if (char === quote) {
                quote = null;
            }
            continue;
        }
        if (char === "\"" || char === "'") {
            quote = char;
            continue;
        }
        if (char === ">") {
            return index;
        }
    }
    return -1;
}

const ATTRIBUTE_PATTERN = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttributes(source: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    ATTRIBUTE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ATTRIBUTE_PATTERN.exec(source)) !== null) {
        attributes[match[1]] = decodeXmlEntities(match[2] ?? match[3] ?? "");
    }
    return attributes;
}

/**
 * Parse a document and return its root element, or null when there is no
 * element to speak of. Recovery is deliberate where it costs nothing: a stray
 * closing tag is dropped, and a document that ends mid-tree still returns
 * everything read so far - refusing the whole file would tell the author less
 * than the units it did contain.
 */
export function parseXml(text: string): XmlElement | null {
    const stack: XmlElement[] = [];
    let root: XmlElement | null = null;
    let index = 0;

    const pushText = (value: string): void => {
        const parent = stack[stack.length - 1];
        if (!parent || !value) {
            return;
        }
        const last = parent.children[parent.children.length - 1];
        if (last && last.kind === "text") {
            last.value += value;
            return;
        }
        parent.children.push({ kind: "text", value });
    };

    while (index < text.length) {
        const open = text.indexOf("<", index);
        if (open < 0) {
            pushText(decodeXmlEntities(text.slice(index)));
            break;
        }
        if (open > index) {
            pushText(decodeXmlEntities(text.slice(index, open)));
        }
        if (text.startsWith("<!--", open)) {
            const end = text.indexOf("-->", open + 4);
            index = end < 0 ? text.length : end + 3;
            continue;
        }
        if (text.startsWith("<![CDATA[", open)) {
            const end = text.indexOf("]]>", open + 9);
            pushText(end < 0 ? text.slice(open + 9) : text.slice(open + 9, end));
            index = end < 0 ? text.length : end + 3;
            continue;
        }
        if (text.startsWith("<?", open)) {
            const end = text.indexOf("?>", open + 2);
            index = end < 0 ? text.length : end + 2;
            continue;
        }
        const end = findTagEnd(text, open);
        if (end < 0) {
            break;
        }
        if (text.startsWith("<!", open)) {
            // DOCTYPE and friends. An internal subset (`[...]`) is not supported;
            // no translation tool emits one for XLIFF.
            index = end + 1;
            continue;
        }
        const raw = text.slice(open + 1, end).trim();
        index = end + 1;
        if (raw.startsWith("/")) {
            const name = localName(raw.slice(1).trim());
            const depth = stack.map(node => node.name).lastIndexOf(name);
            if (depth >= 0) {
                stack.length = depth;
            }
            continue;
        }
        const selfClosing = raw.endsWith("/");
        const body = selfClosing ? raw.slice(0, -1) : raw;
        const nameMatch = /^[^\s]+/.exec(body);
        if (!nameMatch) {
            continue;
        }
        const element: XmlElement = {
            kind: "element",
            name: localName(nameMatch[0]),
            attributes: parseAttributes(body.slice(nameMatch[0].length)),
            children: [],
        };
        const parent = stack[stack.length - 1];
        if (parent) {
            parent.children.push(element);
        } else if (!root) {
            root = element;
        } else {
            // A second root: not well-formed. The first tree is the document.
            continue;
        }
        if (!selfClosing) {
            stack.push(element);
        }
    }

    return root;
}
