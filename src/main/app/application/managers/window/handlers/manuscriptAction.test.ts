import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: class {}, session: { fromPartition: () => ({}) } }));

import { readOfficeArchive, zipDocxParts } from "./manuscriptAction";

describe("manuscript archives", () => {
    it("reads back the paragraphs of a docx it wrote", async () => {
        const bytes = await zipDocxParts([
            { name: "[Content_Types].xml", content: "<Types/>" },
            {
                name: "word/document.xml",
                content: "<w:document><w:body><w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>第一场</w:t></w:r></w:p>"
                    + "<w:p><w:r><w:t>林：你好</w:t></w:r></w:p></w:body></w:document>",
            },
        ]);
        expect(readOfficeArchive(bytes)).toEqual({
            ok: true,
            kind: "docx",
            paragraphs: [{ text: "第一场", headingLevel: 1 }, { text: "林：你好" }],
        });
    });

    it("reads an xlsx and refuses what is not an office archive", async () => {
        const bytes = await zipDocxParts([
            { name: "xl/workbook.xml", content: "<workbook><sheets><sheet name=\"A\" r:id=\"rId1\"/></sheets></workbook>" },
            { name: "xl/_rels/workbook.xml.rels", content: "<Relationships><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\"/></Relationships>" },
            { name: "xl/worksheets/sheet1.xml", content: "<worksheet><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>林</t></is></c></row></sheetData></worksheet>" },
        ]);
        expect(readOfficeArchive(bytes)).toEqual({ ok: true, kind: "xlsx", sheets: [{ name: "A", rows: [["林"]] }] });
        expect(readOfficeArchive(Buffer.from("not a zip"))).toEqual({ ok: false, reason: "notOffice" });
        expect(readOfficeArchive(await zipDocxParts([{ name: "a.txt", content: "x" }]))).toEqual({ ok: false, reason: "notOffice" });
    });
});
