/**
 * XLIFF for translation exchange: writes 1.2, reads 1.2 and 2.0.
 *
 * The asymmetry is deliberate. 1.2 is what every CAT tool on the market opens
 * without a word - Trados, memoQ, OmegaT, Smartcat, Weblate - while 2.0 is the
 * newer standard with far thinner support, so writing 1.2 is what actually gets
 * a file translated. Reading both costs one extra branch and means a file that
 * came back from a 2.0 tool is not a dead end.
 *
 * Studio's unit id is the `trans-unit` id (1.2) or the `unit` id (2.0), and
 * `resname` carries it a second time because some tools show `resname` to the
 * translator and hide the id.
 *
 * Comments in English per project convention.
 */

import type {
    ParsedTranslationExchange,
    TranslationExchangeDocument,
    TranslationExchangeRow,
} from "./localizationExchange";
import {
    escapeXmlText,
    findElements,
    firstChildElement,
    parseXml,
    xmlAttributes,
    xmlTextContent,
    type XmlElement,
} from "./xml";

/** Studio state to XLIFF 1.2 `state`. Every value here is legal in the 1.2 schema. */
const STATE_TO_XLIFF: Record<string, string> = {
    "": "new",
    machine: "needs-review-translation",
    stale: "needs-translation",
    translated: "translated",
    reviewed: "final",
};

/**
 * XLIFF `state` back to Studio's vocabulary, covering 1.2 and 2.0 values.
 *
 * Everything that means "a human still has to look at this" collapses to
 * `machine`, which is the state Studio's review pass queues up. `stale` is only
 * produced by Studio's own export; a tool that dropped the state leaves the
 * decision to the caller, which reads a present target as translated.
 */
const XLIFF_TO_STATE: Record<string, string> = {
    new: "",
    initial: "",
    "needs-translation": "stale",
    "needs-review-translation": "machine",
    "needs-adaptation": "machine",
    "needs-l10n": "machine",
    "needs-review-adaptation": "machine",
    "needs-review-l10n": "machine",
    translated: "translated",
    reviewed: "reviewed",
    final: "reviewed",
    "signed-off": "reviewed",
};

/**
 * Escape element content so it survives an XML round-trip byte for byte.
 *
 * Two escapes beyond the usual three. `\r` goes numeric because XML parsers are
 * required to normalize literal CRLF to LF, which would silently rewrite every
 * line a Windows author typed. A leading or trailing newline goes numeric
 * because a pretty-printing tool would otherwise be indistinguishable from
 * content, and the reader below trims exactly that shape.
 */
function encodeSegment(text: string): string {
    return escapeXmlText(text)
        .replace(/\r/g, "&#13;")
        .replace(/^\n/, "&#10;")
        .replace(/\n$/, "&#10;");
}

/**
 * Undo a pretty-printer's indentation, and nothing else.
 *
 * Only text that both starts and ends on its own line is trimmed - the shape a
 * formatter produces and content never does, because {@link encodeSegment}
 * writes those newlines as entities.
 */
function decodeSegment(raw: string): string {
    return /^[ \t]*\r?\n/.test(raw) && /\r?\n[ \t]*$/.test(raw) ? raw.trim() : raw;
}

function elementText(element: XmlElement | undefined): string {
    return element ? decodeSegment(xmlTextContent(element)) : "";
}

export function serializeTranslationXliff(document: TranslationExchangeDocument): string {
    const lines = [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<xliff xmlns=\"urn:oasis:names:tc:xliff:document:1.2\" version=\"1.2\">",
        `  <file${xmlAttributes({
            original: document.projectName || "narraleaf",
            "source-language": document.sourceLocale || "und",
            "target-language": document.targetLocale || "und",
            datatype: "plaintext",
        })}>`,
        "    <body>",
    ];

    for (const row of document.rows) {
        const state = STATE_TO_XLIFF[row.status] ?? "new";
        lines.push(`      <trans-unit${xmlAttributes({ id: row.unitId, resname: row.unitId, "xml:space": "preserve" })}>`);
        lines.push(`        <source>${encodeSegment(row.source)}</source>`);
        lines.push(row.target
            ? `        <target${xmlAttributes({ state })}>${encodeSegment(row.target)}</target>`
            : `        <target${xmlAttributes({ state })}/>`);
        if (row.context) {
            lines.push(`        <note${xmlAttributes({ from: "developer", annotates: "source" })}>${encodeSegment(row.context)}</note>`);
        }
        if (row.note) {
            lines.push(`        <note${xmlAttributes({ from: "translator" })}>${encodeSegment(row.note)}</note>`);
        }
        lines.push("      </trans-unit>");
    }

    lines.push("    </body>", "  </file>", "</xliff>", "");
    return lines.join("\n");
}

/**
 * Notes split by who wrote them: the developer describes the line, the
 * translator comments on it. 1.2 says so with `from`, 2.0 with `category`.
 */
function readNotes(notes: XmlElement[]): { context: string; note: string } {
    const context: string[] = [];
    const note: string[] = [];
    for (const element of notes) {
        const from = (element.attributes.from ?? element.attributes.category ?? "").toLowerCase();
        const text = elementText(element);
        if (!text) {
            continue;
        }
        if (from === "developer" || from === "context" || from === "source") {
            context.push(text);
        } else {
            note.push(text);
        }
    }
    return { context: context.join("\n"), note: note.join("\n") };
}

function readXliff12(root: XmlElement): ParsedTranslationExchange {
    const file = findElements(root, "file")[0];
    const rows: TranslationExchangeRow[] = [];
    const errors: string[] = [];

    for (const unit of findElements(root, "trans-unit")) {
        const unitId = (unit.attributes.id || unit.attributes.resname || "").trim();
        if (!unitId) {
            errors.push("A trans-unit has no id and was skipped");
            continue;
        }
        const target = firstChildElement(unit, "target");
        const targetText = elementText(target);
        const state = (target?.attributes.state ?? "").toLowerCase();
        const { context, note } = readNotes(findElements(unit, "note"));
        rows.push({
            unitId,
            context,
            source: elementText(firstChildElement(unit, "source")),
            target: targetText,
            status: XLIFF_TO_STATE[state] ?? (targetText ? "translated" : ""),
            note,
        });
    }

    return {
        rows,
        sourceLocale: file?.attributes["source-language"],
        targetLocale: file?.attributes["target-language"],
        errors,
    };
}

function readXliff20(root: XmlElement): ParsedTranslationExchange {
    const rows: TranslationExchangeRow[] = [];
    const errors: string[] = [];

    for (const unit of findElements(root, "unit")) {
        const unitId = (unit.attributes.id || unit.attributes.name || "").trim();
        if (!unitId) {
            errors.push("A unit has no id and was skipped");
            continue;
        }
        // A unit may be split into several segments; the text of the unit is
        // their concatenation, which is how a tool that re-segmented a line
        // hands it back.
        const segments = findElements(unit, "segment");
        let source = "";
        let target = "";
        let state = "";
        for (const segment of segments) {
            source += elementText(firstChildElement(segment, "source"));
            target += elementText(firstChildElement(segment, "target"));
            state = (segment.attributes.state ?? state).toLowerCase();
        }
        const { context, note } = readNotes(findElements(unit, "note"));
        rows.push({
            unitId,
            context,
            source,
            target,
            status: XLIFF_TO_STATE[state] ?? (target ? "translated" : ""),
            note,
        });
    }

    return {
        rows,
        sourceLocale: root.attributes.srcLang,
        targetLocale: root.attributes.trgLang,
        errors,
    };
}

export function parseTranslationXliff(text: string): ParsedTranslationExchange {
    const root = parseXml(text);
    if (!root) {
        return { rows: [], errors: ["Not a readable XML file"] };
    }
    if (root.name !== "xliff") {
        return { rows: [], errors: [`Not an XLIFF file: the root element is <${root.name}>`] };
    }
    // By content, not by the version attribute: a 1.2 file mislabelled 2.0 is
    // still full of trans-units, and that is what can actually be read.
    if (findElements(root, "trans-unit").length > 0) {
        return readXliff12(root);
    }
    if (findElements(root, "unit").length > 0) {
        return readXliff20(root);
    }
    return { rows: [], errors: ["This XLIFF file has no translation units"] };
}
