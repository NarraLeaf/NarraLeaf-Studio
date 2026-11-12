/**
 * Reading the text out of a Word document (.docx) and a spreadsheet (.xlsx).
 *
 * Both are a zip of XML parts. Unzipping happens in main (it has zlib); everything here is pure and
 * takes the parts as strings, so it is unit tested without an archive. Only text is read: no
 * formatting beyond "is this paragraph a heading", no formulas, no images.
 *
 * The XML is machine-written and regular, so it is scanned with patterns rather than a DOM parser -
 * which is also what lets this module run in main and under vitest's node environment alike.
 */

/** The parts a docx read needs. Missing optional parts are fine. */
export const DOCX_PARTS = ["word/document.xml", "word/styles.xml"] as const;

/** Whether an archive entry is a part an xlsx read needs. */
export function isXlsxPart(name: string): boolean {
    return name === "xl/workbook.xml"
        || name === "xl/_rels/workbook.xml.rels"
        || name === "xl/sharedStrings.xml"
        || /^xl\/worksheets\/[^/]+\.xml$/.test(name);
}

export type DocxParagraph = {
    text: string;
    /** 1-based heading level when the paragraph is a heading (or the document title, level 0). */
    headingLevel?: number;
};

export type XlsxSheet = {
    name: string;
    /** Dense rows of cell text; trailing empty cells trimmed, empty rows kept as `[]`. */
    rows: string[][];
};

export function decodeXmlEntities(value: string): string {
    return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_match, entity: string) => {
        switch (entity) {
            case "amp": return "&";
            case "lt": return "<";
            case "gt": return ">";
            case "quot": return "\"";
            case "apos": return "'";
            default: {
                const code = entity.startsWith("#x") ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
                return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
            }
        }
    });
}

function attribute(tag: string, name: string): string | undefined {
    const match = new RegExp(`\\s${name.replace(":", "\\:")}="([^"]*)"`).exec(tag);
    return match ? decodeXmlEntities(match[1]) : undefined;
}

// ---------------------------------------------------------------------------
// docx
// ---------------------------------------------------------------------------

/**
 * Which style ids are headings, read from styles.xml.
 *
 * The id alone is not enough: Word localises it, so a Chinese document's "Heading 1" is saved under
 * the id `1`. The style's `w:name` (always the English built-in name) and its outline level are what
 * say it is a heading.
 */
function readHeadingStyles(stylesXml: string | undefined): Map<string, number> {
    const levels = new Map<string, number>();
    if (!stylesXml) {
        return levels;
    }
    for (const match of stylesXml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
        const styleId = attribute(match[1], "w:styleId");
        if (!styleId) {
            continue;
        }
        const nameTag = /<w:name\b[^>]*\/?>/.exec(match[2])?.[0];
        const name = nameTag ? attribute(nameTag, "w:val")?.toLowerCase() ?? "" : "";
        const heading = /^heading\s*(\d)$/.exec(name);
        if (heading) {
            levels.set(styleId, Number(heading[1]));
            continue;
        }
        if (name === "title") {
            levels.set(styleId, 0);
            continue;
        }
        const outline = /<w:outlineLvl\b[^>]*w:val="(\d)"/.exec(match[2]);
        if (outline) {
            levels.set(styleId, Number(outline[1]) + 1);
        }
    }
    return levels;
}

function headingLevelFromStyleId(styleId: string): number | undefined {
    const heading = /^heading\s*(\d)$/i.exec(styleId);
    if (heading) {
        return Number(heading[1]);
    }
    return /^title$/i.test(styleId) ? 0 : undefined;
}

/** The visible text of one `<w:p>`'s inner XML. Deleted revisions are `w:delText`, so never read. */
function paragraphText(inner: string): string {
    let text = "";
    for (const token of inner.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr|noBreakHyphen)\b[^>]*\/>/g)) {
        if (token[1] !== undefined) {
            text += decodeXmlEntities(token[1]);
        } else if (token[2] === "tab") {
            text += "\t";
        } else if (token[2] === "noBreakHyphen") {
            text += "-";
        } else {
            text += "\n";
        }
    }
    return text;
}

function readParagraph(xml: string, headingStyles: Map<string, number>): DocxParagraph {
    const inner = xml.replace(/^<w:p\b[^>]*>/, "").replace(/<\/w:p>$/, "");
    const text = paragraphText(inner);
    const styleTag = /<w:pStyle\b[^>]*\/>/.exec(inner)?.[0];
    const styleId = styleTag ? attribute(styleTag, "w:val") : undefined;
    let headingLevel = styleId !== undefined ? headingStyles.get(styleId) ?? headingLevelFromStyleId(styleId) : undefined;
    const outline = /<w:pPr>[\s\S]*?<w:outlineLvl\b[^>]*w:val="(\d)"/.exec(inner);
    if (headingLevel === undefined && outline && Number(outline[1]) < 9) {
        headingLevel = Number(outline[1]) + 1;
    }
    return headingLevel === undefined ? { text } : { text, headingLevel };
}

/**
 * Every paragraph of the document body, in order.
 *
 * A table row reads as one paragraph whose cells are joined by a tab: a two-column "speaker | line"
 * table is a common way to lay out a script in Word, and a tab is the separator the paste wizard
 * already recognises as "a spreadsheet column pair".
 */
export function readDocxParagraphs(parts: Partial<Record<string, string>>): DocxParagraph[] {
    const documentXml = parts["word/document.xml"];
    if (!documentXml) {
        throw new Error("The document has no word/document.xml");
    }
    const headingStyles = readHeadingStyles(parts["word/styles.xml"]);
    const body = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(documentXml)?.[1] ?? documentXml;
    const out: DocxParagraph[] = [];
    // Tables first-class, paragraphs otherwise; a self-closing `<w:p/>` is an empty paragraph.
    const pattern = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
    for (const match of body.matchAll(pattern)) {
        const xml = match[0];
        if (xml.startsWith("<w:tbl")) {
            for (const row of xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
                const cells = [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map(cell =>
                    [...cell[0].matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
                        .map(paragraph => readParagraph(paragraph[0], headingStyles).text)
                        .join(" ")
                        .trim(),
                );
                out.push({ text: cells.join("\t").replace(/\t+$/, "") });
            }
            continue;
        }
        if (xml.endsWith("/>")) {
            out.push({ text: "" });
            continue;
        }
        out.push(readParagraph(xml, headingStyles));
    }
    return out;
}

// ---------------------------------------------------------------------------
// xlsx
// ---------------------------------------------------------------------------

/** Text of an `<si>` or `<is>`: every `<t>`, minus the phonetic guide runs Japanese Excel adds. */
function richText(xml: string): string {
    const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").replace(/<phoneticPr\b[^>]*\/>/g, "");
    let text = "";
    for (const match of withoutPhonetic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) {
        text += decodeXmlEntities(match[1] ?? "");
    }
    return text;
}

function columnIndex(reference: string): number {
    const letters = /^[A-Z]+/.exec(reference.toUpperCase())?.[0] ?? "";
    let index = 0;
    for (const letter of letters) {
        index = index * 26 + (letter.charCodeAt(0) - 64);
    }
    return index - 1;
}

function readSheetRows(sheetXml: string, sharedStrings: string[]): string[][] {
    const rows: string[][] = [];
    const data = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(sheetXml)?.[1] ?? "";
    let nextRow = 0;
    for (const rowMatch of data.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        const declared = attribute(rowMatch[1], "r");
        const rowIndex = declared ? Number(declared) - 1 : nextRow;
        while (rows.length < rowIndex) {
            rows.push([]);
        }
        const cells: string[] = [];
        let nextColumn = 0;
        for (const cell of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const reference = attribute(cell[1], "r");
            const column = reference ? columnIndex(reference) : nextColumn;
            nextColumn = column + 1;
            const type = attribute(cell[1], "t");
            const inner = cell[2] ?? "";
            const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
            let value = "";
            if (type === "s") {
                value = sharedStrings[Number(raw)] ?? "";
            } else if (type === "inlineStr") {
                value = richText(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
            } else if (type === "b") {
                value = raw === "1" ? "TRUE" : "FALSE";
            } else if (raw !== undefined) {
                value = decodeXmlEntities(raw);
            }
            while (cells.length < column) {
                cells.push("");
            }
            cells[column] = value;
        }
        while (cells.length > 0 && cells[cells.length - 1] === "") {
            cells.pop();
        }
        rows[rowIndex] = cells;
        nextRow = rowIndex + 1;
    }
    return rows;
}

/** Every worksheet, in workbook order, as rows of text. */
export function readXlsxSheets(parts: Partial<Record<string, string>>): XlsxSheet[] {
    const workbook = parts["xl/workbook.xml"];
    if (!workbook) {
        throw new Error("The workbook has no xl/workbook.xml");
    }
    const sharedStrings = [...(parts["xl/sharedStrings.xml"] ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)]
        .map(match => richText(match[1] ?? ""));
    const targets = new Map<string, string>();
    for (const match of (parts["xl/_rels/workbook.xml.rels"] ?? "").matchAll(/<Relationship\b[^>]*\/?>/g)) {
        const id = attribute(match[0], "Id");
        const target = attribute(match[0], "Target");
        if (id && target) {
            const normalized = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
            targets.set(id, normalized.replace(/\/\.\//g, "/"));
        }
    }
    const sheets: XlsxSheet[] = [];
    let ordinal = 0;
    for (const match of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
        ordinal += 1;
        const name = attribute(match[0], "name") ?? `Sheet${ordinal}`;
        const relId = attribute(match[0], "r:id");
        const path = (relId && targets.get(relId)) ?? `xl/worksheets/sheet${ordinal}.xml`;
        const xml = parts[path];
        if (xml === undefined) {
            continue;
        }
        sheets.push({ name, rows: readSheetRows(xml, sharedStrings) });
    }
    return sheets;
}

export type OfficeReadResult =
    | { ok: true; kind: "docx"; paragraphs: DocxParagraph[] }
    | { ok: true; kind: "xlsx"; sheets: XlsxSheet[] }
    | { ok: false; reason: "unreadable" | "notOffice" | "tooLarge" };
