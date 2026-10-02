import { describe, expect, it } from "vitest";
import { GALLERY_MESSAGES } from "./messages";

const { en, ...others } = GALLERY_MESSAGES.messages;
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

describe("the Gallery message bundle", () => {
    it.each(Object.entries(others))("says everything English says in %s", (_locale, table) => {
        expect(Object.keys(table).sort()).toEqual(Object.keys(en).sort());
    });

    it.each(Object.entries(others))("fills the same placeholders in %s", (_locale, table) => {
        for (const [key, text] of Object.entries(en)) {
            expect([key, placeholders((table as Record<string, string>)[key] ?? "")]).toEqual([key, placeholders(text)]);
        }
    });

    it("leaves no translation empty", () => {
        for (const table of Object.values(GALLERY_MESSAGES.messages)) {
            for (const [key, text] of Object.entries(table)) {
                expect([key, text.trim().length > 0]).toEqual([key, true]);
            }
        }
    });

    it("uses the interface's words in Chinese: 项目 and 资产, never 工程 or 资源", () => {
        for (const text of Object.values(GALLERY_MESSAGES.messages.zh)) {
            expect(text).not.toMatch(/工程|资源/);
        }
    });

    it("ends no Chinese or Japanese line with a full stop", () => {
        for (const table of [GALLERY_MESSAGES.messages.zh, GALLERY_MESSAGES.messages.ja]) {
            for (const [key, text] of Object.entries(table)) {
                expect([key, text.endsWith("。")]).toEqual([key, false]);
            }
        }
    });
});
