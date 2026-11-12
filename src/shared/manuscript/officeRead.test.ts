import { describe, expect, it } from "vitest";
import { decodeXmlEntities, isXlsxPart, readDocxParagraphs, readXlsxSheets } from "./officeRead";

const W = "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"";

function docx(body: string): string {
    return `<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`;
}

describe("readDocxParagraphs", () => {
    it("reads runs, tabs and breaks, and keeps empty paragraphs", () => {
        const parts = {
            "word/document.xml": docx(
                "<w:p><w:r><w:t>林：</w:t></w:r><w:r><w:t xml:space=\"preserve\">你好 &amp; 早安</w:t></w:r></w:p>"
                + "<w:p/>"
                + "<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t></w:r></w:p>"
                + "<w:p><w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:r><w:t>kept</w:t></w:r></w:p>",
            ),
        };
        expect(readDocxParagraphs(parts)).toEqual([
            { text: "林：你好 & 早安" },
            { text: "" },
            { text: "A\tB\nC" },
            { text: "kept" },
        ]);
    });

    it("finds headings through localised style ids and outline levels", () => {
        const parts = {
            "word/styles.xml": `<w:styles ${W}>`
                + "<w:style w:type=\"paragraph\" w:styleId=\"1\"><w:name w:val=\"heading 1\"/></w:style>"
                + "<w:style w:type=\"paragraph\" w:styleId=\"a3\"><w:name w:val=\"Title\"/></w:style>"
                + "<w:style w:type=\"paragraph\" w:styleId=\"Chapter\"><w:name w:val=\"章\"/><w:pPr><w:outlineLvl w:val=\"1\"/></w:pPr></w:style>"
                + "</w:styles>",
            "word/document.xml": docx(
                "<w:p><w:pPr><w:pStyle w:val=\"a3\"/></w:pPr><w:r><w:t>剧本</w:t></w:r></w:p>"
                + "<w:p><w:pPr><w:pStyle w:val=\"1\"/></w:pPr><w:r><w:t>第一场</w:t></w:r></w:p>"
                + "<w:p><w:pPr><w:pStyle w:val=\"Chapter\"/></w:pPr><w:r><w:t>二</w:t></w:r></w:p>"
                + "<w:p><w:pPr><w:pStyle w:val=\"Heading3\"/></w:pPr><w:r><w:t>三</w:t></w:r></w:p>",
            ),
        };
        expect(readDocxParagraphs(parts)).toEqual([
            { text: "剧本", headingLevel: 0 },
            { text: "第一场", headingLevel: 1 },
            { text: "二", headingLevel: 2 },
            { text: "三", headingLevel: 3 },
        ]);
    });

    it("reads a table row as cells joined by a tab", () => {
        const cell = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
        const parts = {
            "word/document.xml": docx(`<w:tbl><w:tr>${cell("林")}${cell("你好")}</w:tr><w:tr>${cell("")}${cell("旁白")}</w:tr></w:tbl>`),
        };
        expect(readDocxParagraphs(parts)).toEqual([{ text: "林\t你好" }, { text: "\t旁白" }]);
    });

    it("refuses an archive with no document part", () => {
        expect(() => readDocxParagraphs({})).toThrow();
    });
});

describe("readXlsxSheets", () => {
    const workbook = "<workbook xmlns:r=\"r\"><sheets><sheet name=\"台词\" sheetId=\"1\" r:id=\"rId1\"/><sheet name=\"空\" sheetId=\"2\" r:id=\"rId2\"/></sheets></workbook>";
    const rels = "<Relationships><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\"/><Relationship Id=\"rId2\" Target=\"/xl/worksheets/sheet2.xml\"/></Relationships>";

    it("resolves shared strings, inline strings, numbers and sparse cells", () => {
        const shared = "<sst><si><t>角色</t></si><si><t>台词</t></si><si><r><t>林</t></r><r><t>檎</t></r></si>"
            + "<si><t>こんにちは</t><rPh sb=\"0\" eb=\"1\"><t>コンニチハ</t></rPh></si></sst>";
        const sheet = "<worksheet><sheetData>"
            + "<row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c></row>"
            + "<row r=\"3\"><c r=\"A3\" t=\"s\"><v>2</v></c><c r=\"C3\" t=\"inlineStr\"><is><t>a&lt;b</t></is></c></row>"
            + "<row r=\"4\"><c r=\"B4\" t=\"s\"><v>3</v></c><c r=\"D4\"><v>42</v></c></row>"
            + "</sheetData></worksheet>";
        const sheets = readXlsxSheets({
            "xl/workbook.xml": workbook,
            "xl/_rels/workbook.xml.rels": rels,
            "xl/sharedStrings.xml": shared,
            "xl/worksheets/sheet1.xml": sheet,
            "xl/worksheets/sheet2.xml": "<worksheet><sheetData/></worksheet>",
        });
        expect(sheets).toEqual([
            { name: "台词", rows: [["角色", "台词"], [], ["林檎", "", "a<b"], ["", "こんにちは", "", "42"]] },
            { name: "空", rows: [] },
        ]);
    });

    it("knows which parts it needs", () => {
        expect(isXlsxPart("xl/worksheets/sheet3.xml")).toBe(true);
        expect(isXlsxPart("xl/worksheets/_rels/sheet3.xml.rels")).toBe(false);
        expect(isXlsxPart("xl/media/image1.png")).toBe(false);
    });
});

describe("decodeXmlEntities", () => {
    it("decodes named and numeric entities", () => {
        expect(decodeXmlEntities("&lt;&#x6797;&#26519;&quot;&apos;&amp;")).toBe("<林林\"'&");
    });
});
