import type { Manuscript, ManuscriptLine } from "./manuscriptModel";

/**
 * The two renderings of a {@link Manuscript}: an HTML page main prints to PDF, and the XML parts of a
 * Word document main zips. Both are pure and deterministic.
 *
 * Typesetting choices shared by both: speaker in a fixed left column, the line beside it, stage
 * directions indented and muted, line ids in small monospace under the line they name. CJK is not
 * set in italics (most CJK faces have none and the browser shears the glyphs), so emphasis is
 * carried by colour and size instead.
 */

export type ManuscriptLocale = "en" | "zh" | "ja";

export type ManuscriptRenderStrings = {
    /** Printed before a context line's text is muted; screen readers and copy-paste keep it. */
    gap: string;
    /** "Page {page} of {total}" pattern for the PDF footer; `{page}` and `{total}` are replaced. */
    pageOf: string;
};

/** System faces per script, most specific first. No web fonts: the print window loads nothing. */
export function manuscriptFontStack(locale: ManuscriptLocale): string {
    const latin = ["\"Helvetica Neue\"", "Helvetica", "Arial"];
    const zh = ["\"PingFang SC\"", "\"Hiragino Sans GB\"", "\"Noto Sans CJK SC\"", "\"Source Han Sans SC\"", "\"Microsoft YaHei\""];
    const ja = ["\"Hiragino Sans\"", "\"Hiragino Kaku Gothic ProN\"", "\"Noto Sans CJK JP\"", "\"Source Han Sans JP\"", "\"Yu Gothic\"", "Meiryo"];
    const order = locale === "ja" ? [...latin, ...ja, ...zh] : locale === "zh" ? [...latin, ...zh, ...ja] : [...latin, ...zh, ...ja];
    return [...order, "sans-serif"].join(", ");
}

const HTML_LANG: Record<ManuscriptLocale, string> = { en: "en", zh: "zh-CN", ja: "ja" };

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char] ?? char);
}

function htmlText(value: string): string {
    return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function htmlLine(line: ManuscriptLine, strings: ManuscriptRenderStrings): string {
    if (line.kind === "gap") {
        return `<div class="gap" aria-label="${escapeHtml(strings.gap)}">⋯</div>`;
    }
    const classes = ["line", line.kind, line.context ? "context" : ""].filter(Boolean).join(" ");
    const indent = line.depth > 0 ? ` style="--depth:${line.depth}"` : "";
    const id = "id" in line && line.id ? `<div class="id">${escapeHtml(line.id)}</div>` : "";
    const speaker = line.kind === "dialogue" ? escapeHtml(line.speaker) : "";
    const marker = line.kind === "option" ? "<span class=\"marker\">›</span>" : "";
    return `<div class="${classes}"${indent}><div class="speaker">${speaker}</div>`
        + `<div class="body"><div class="text">${marker}${htmlText(line.text)}</div>${id}</div></div>`;
}

const STYLE = `
@page { size: A4; margin: 20mm 18mm 18mm 18mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: var(--font); font-size: 10.5pt; line-height: 1.65; color: #1b1d21; }
header.title { margin: 0 0 10mm; padding-bottom: 4mm; border-bottom: 1.2pt solid #1b1d21; }
header.title h1 { margin: 0; font-size: 20pt; font-weight: 600; letter-spacing: 0.01em; line-height: 1.3; }
header.title p { margin: 2mm 0 0; font-size: 9.5pt; color: #5b616b; }
section.scene { margin: 0 0 9mm; }
body:not(.compact) section.scene + section.scene { break-before: page; }
section.scene h2 { margin: 0 0 4mm; padding-bottom: 1.5mm; font-size: 13pt; font-weight: 600; border-bottom: 0.6pt solid #c9ccd1; break-after: avoid; }
.line { display: grid; grid-template-columns: 26mm 1fr; column-gap: 5mm; margin: 0 0 2mm; break-inside: avoid; }
.line .speaker { text-align: right; font-weight: 600; color: #1b1d21; overflow-wrap: anywhere; }
.line .body { min-width: 0; padding-left: calc(var(--depth, 0) * 5mm); }
.line .text { white-space: normal; overflow-wrap: anywhere; }
.line.narration .text { color: #33373d; }
.line.direction .text, .line.note .text { font-size: 9pt; color: #6b717b; }
.line.direction .text::before { content: "["; } .line.direction .text::after { content: "]"; }
html:lang(zh-CN) .line.direction .text::before, html:lang(ja) .line.direction .text::before { content: "［"; }
html:lang(zh-CN) .line.direction .text::after, html:lang(ja) .line.direction .text::after { content: "］"; }
.line.note .text { border-left: 1.5pt solid #d6d9de; padding-left: 2mm; }
.line.choice .text { font-weight: 600; }
.line.option .marker { display: inline-block; width: 4mm; color: rgb(64 168 196); font-weight: 600; }
.line.context { color: #8a9099; }
.line.context .speaker, .line.context .text { color: #8a9099; font-weight: 400; }
.line .id { margin-top: 0.3mm; font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 6.5pt; color: #a1a6ad; letter-spacing: 0.02em; }
.gap { margin: 1mm 0 3mm 31mm; color: #a1a6ad; letter-spacing: 0.3em; }
`;

export function renderManuscriptHtml(manuscript: Manuscript, locale: ManuscriptLocale, strings: ManuscriptRenderStrings): string {
    const scenes = manuscript.scenes.map(scene =>
        `<section class="scene"><h2>${escapeHtml(scene.name)}</h2>${scene.lines.map(line => htmlLine(line, strings)).join("")}</section>`,
    ).join("\n");
    const subtitle = manuscript.subtitle ? `<p>${escapeHtml(manuscript.subtitle)}</p>` : "";
    return `<!doctype html>
<html lang="${HTML_LANG[locale]}"><head><meta charset="utf-8"><title>${escapeHtml(manuscript.title)}</title>
<style>:root { --font: ${manuscriptFontStack(locale)}; }${STYLE}</style></head>
<body${manuscript.compact ? " class=\"compact\"" : ""}><header class="title"><h1>${escapeHtml(manuscript.title)}</h1>${subtitle}</header>
${scenes}
</body></html>
`;
}

/** The PDF footer: page numbers in the same face, centred. Chromium fills the two classes in. */
export function renderManuscriptFooter(locale: ManuscriptLocale, strings: ManuscriptRenderStrings): string {
    const pattern = escapeHtml(strings.pageOf)
        .replace("{page}", "<span class=\"pageNumber\"></span>")
        .replace("{total}", "<span class=\"totalPages\"></span>");
    return `<div style="width:100%;text-align:center;font-size:7.5pt;color:#8a9099;font-family:${escapeHtml(manuscriptFontStack(locale))};">${pattern}</div>`;
}

// ---------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------

export type DocxPart = { name: string; content: string };

function escapeXml(value: string): string {
    // Characters XML 1.0 cannot carry at all are dropped rather than written as an invalid file.
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
        .replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char] ?? char);
}

function run(text: string, props = ""): string {
    const pieces = text.split(/\r?\n/);
    const body = pieces.map((piece, index) =>
        `${index > 0 ? "<w:br/>" : ""}<w:t xml:space="preserve">${escapeXml(piece)}</w:t>`,
    ).join("");
    return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}${body}</w:r>`;
}

const SPEAKER_COLUMN_TWIPS = 1600;
const DEPTH_TWIPS = 280;

function docxParagraph(line: ManuscriptLine, locale: ManuscriptLocale): string {
    if (line.kind === "gap") {
        return `<w:p><w:pPr><w:pStyle w:val="NlGap"/></w:pPr>${run("⋯")}</w:p>`;
    }
    const left = SPEAKER_COLUMN_TWIPS + line.depth * DEPTH_TWIPS;
    const muted = line.context ? "<w:color w:val=\"8A9099\"/>" : "";
    const id = "id" in line && line.id ? `${"<w:r><w:br/></w:r>"}${run(line.id, "<w:rStyle w:val=\"NlLineId\"/>")}` : "";
    let content: string;
    let style = "NlLine";
    let indent = `<w:ind w:left="${left}"/>`;
    switch (line.kind) {
        case "dialogue":
            // Hanging indent with a tab stop at the text column: the name sits in the margin column,
            // wrapped lines align under the first.
            indent = `<w:ind w:left="${left}" w:hanging="${left}"/><w:tabs><w:tab w:val="left" w:pos="${left}"/></w:tabs>`;
            content = run(line.speaker, `<w:b/>${muted}`) + "<w:r><w:tab/></w:r>" + run(line.text, muted);
            break;
        case "direction":
            style = "NlDirection";
            content = run(locale === "en" ? `[${line.text}]` : `［${line.text}］`, muted);
            break;
        case "note":
            style = "NlNote";
            content = run(line.text, muted);
            break;
        case "choice":
            content = run(line.text, `<w:b/>${muted}`);
            break;
        case "option":
            content = run("› ", "<w:b/><w:color w:val=\"40A8C4\"/>") + run(line.text, muted);
            break;
        default:
            content = run(line.text, muted);
    }
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/><w:keepLines/>${indent}</w:pPr>${content}${id}</w:p>`;
}

const EAST_ASIA_FONT: Record<ManuscriptLocale, string> = { en: "Microsoft YaHei", zh: "Microsoft YaHei", ja: "Yu Gothic" };
const EAST_ASIA_LANG: Record<ManuscriptLocale, string> = { en: "zh-CN", zh: "zh-CN", ja: "ja-JP" };
const LATIN_LANG: Record<ManuscriptLocale, string> = { en: "en-GB", zh: "en-US", ja: "en-US" };

function docxStyles(locale: ManuscriptLocale): string {
    const fonts = `<w:rFonts w:ascii="Helvetica Neue" w:hAnsi="Helvetica Neue" w:eastAsia="${EAST_ASIA_FONT[locale]}" w:cs="Arial"/>`;
    const paragraph = (id: string, name: string, pPr: string, rPr: string) =>
        `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr></w:style>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>${fonts}<w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="${LATIN_LANG[locale]}" w:eastAsia="${EAST_ASIA_LANG[locale]}"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="1B1D21"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="8" w:color="1B1D21"/></w:pBdr><w:spacing w:after="360"/></w:pPr><w:rPr><w:color w:val="5B616B"/><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="NlLine"/><w:qFormat/><w:pPr><w:keepNext/><w:pageBreakBefore/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="C9CCD1"/></w:pBdr><w:spacing w:before="0" w:after="200"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
${paragraph("NlLine", "Script Line", "", "")}
${paragraph("NlDirection", "Script Direction", "", "<w:color w:val=\"6B717B\"/><w:sz w:val=\"18\"/>")}
${paragraph("NlNote", "Script Note", "<w:pBdr><w:left w:val=\"single\" w:sz=\"8\" w:space=\"6\" w:color=\"D6D9DE\"/></w:pBdr>", "<w:color w:val=\"6B717B\"/><w:sz w:val=\"18\"/>")}
${paragraph("NlGap", "Script Gap", `<w:ind w:left="${SPEAKER_COLUMN_TWIPS}"/>`, "<w:color w:val=\"A1A6AD\"/>")}
<w:style w:type="character" w:customStyle="1" w:styleId="NlLineId"><w:name w:val="Script Line Id"/><w:rPr><w:rFonts w:ascii="Menlo" w:hAnsi="Menlo" w:cs="Consolas"/><w:color w:val="A1A6AD"/><w:sz w:val="13"/></w:rPr></w:style>
</w:styles>`;
}

/** The parts of a .docx, ready for main to zip. */
export function buildManuscriptDocx(manuscript: Manuscript, locale: ManuscriptLocale): DocxPart[] {
    const body: string[] = [];
    body.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${run(manuscript.title)}</w:p>`);
    body.push(`<w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr>${manuscript.subtitle ? run(manuscript.subtitle) : ""}</w:p>`);
    manuscript.scenes.forEach((scene, index) => {
        // The first scene follows the title on the same page.
        const pageBreak = index === 0 || manuscript.compact ? "<w:pageBreakBefore w:val=\"0\"/>" : "";
        body.push(`<w:p><w:pPr><w:pStyle w:val="Heading1"/>${pageBreak}</w:pPr>${run(scene.name)}</w:p>`);
        for (const line of scene.lines) {
            body.push(docxParagraph(line, locale));
        }
    });
    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${body.join("\n")}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1020" w:bottom="1020" w:left="1020" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
    return [
        {
            name: "[Content_Types].xml",
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`,
        },
        {
            name: "_rels/.rels",
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`,
        },
        {
            name: "docProps/core.xml",
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(manuscript.title)}</dc:title><dc:creator>NarraLeaf Studio</dc:creator></cp:coreProperties>`,
        },
        {
            name: "word/_rels/document.xml.rels",
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
        },
        { name: "word/document.xml", content: document },
        { name: "word/styles.xml", content: docxStyles(locale) },
    ];
}
