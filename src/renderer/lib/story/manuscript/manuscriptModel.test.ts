import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument, StoryScene, StoryTextSegment } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { buildManuscript, listManuscriptSpeakers, type ManuscriptLabels, type ManuscriptOptions } from "./manuscriptModel";
import { buildManuscriptDocx, renderManuscriptFooter, renderManuscriptHtml } from "./manuscriptRender";

const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const S2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const LIN = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const SANAE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const NAMES: Record<string, string> = { [LIN]: "林", [SANAE]: "早苗" };

function seg(textId: string, value: string, role: StoryTextSegment["role"]): StoryTextSegment {
    return { textId, value, role };
}

function block(id: string, kind: StoryBlock["kind"], payload: unknown, parentId: string | null = null, childrenIds: string[] = []): StoryBlock {
    return { id, kind, parentId, childrenIds, payload } as StoryBlock;
}

function scene(id: string, name: string, blocks: StoryBlock[]): StoryScene {
    return {
        id,
        name,
        runtimeName: name,
        rootBlockIds: blocks.filter(entry => entry.parentId === null).map(entry => entry.id),
        blocks: Object.fromEntries(blocks.map(entry => [entry.id, entry])),
    };
}

function fixture(): StoryDocument {
    const first = scene(S1, "教室", [
        block("b1", "nodeAction", { action: "narration", text: seg("t1", "雨声。", "narration") }),
        block("b2", "nodeAction", { action: "dialogue", characterId: LIN, text: seg("t2", "有人吗？", "dialogue") }),
        block("b3", "action", { action: "setBackground" }),
        block("b4", "nodeAction", { action: "dialogue", characterId: SANAE, text: seg("t4", "我在。", "dialogue") }),
        block("b5", "note", { text: seg("t5", "这里放慢", "note") }),
        block("b6", "nodeAction", { action: "choice", prompt: seg("t6", "怎么办？", "choicePrompt") }, null, ["b7"]),
        block("b7", "nodeAction", { action: "choiceOption", text: seg("t7", "留下", "choiceText") }, "b6", ["b8"]),
        block("b8", "nodeAction", { action: "dialogue", characterId: LIN, text: seg("t8", "那就留下吧。", "dialogue") }, "b7"),
        block("b9", "nodeAction", { action: "dialogue", speakerName: "路人", text: seg("t9", "<让一让>", "dialogue") }),
    ]);
    const second = scene(S2, "屋顶", [
        block("c1", "nodeAction", { action: "dialogue", characterId: SANAE, text: seg("u1", "风好大。", "dialogue") }),
    ]);
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        name: "Story",
        chapters: [{ id: "ffffffff-ffff-4fff-8fff-fffffffffff1", name: "Chapter", sceneIds: [S1, S2] }],
        scenes: { [S1]: first, [S2]: second },
    } as StoryDocument;
}

const labels: ManuscriptLabels = {
    label: (target, blockId) => `label:${target.blocks[blockId]?.kind}`,
    speaker: (target, blockId) => {
        const payload = target.blocks[blockId]?.payload as { action?: string; characterId?: string; speakerName?: string };
        if (payload?.action !== "dialogue") {
            return "";
        }
        return (payload.characterId && NAMES[payload.characterId]) || payload.speakerName || "";
    },
    unnamedSpeaker: "?",
};

const all: ManuscriptOptions = {
    sceneIds: [S1, S2],
    speakers: null,
    contextLines: 1,
    includeIds: true,
    includeDirections: true,
    includeBranches: true,
};

describe("buildManuscript", () => {
    it("prints every row in reading order, with ids from the text segments", () => {
        const manuscript = buildManuscript(fixture(), all, labels, { title: "Story" });
        expect(manuscript.scenes[0].lines).toEqual([
            { kind: "narration", text: "雨声。", depth: 0, id: "t1" },
            { kind: "dialogue", speaker: "林", text: "有人吗？", depth: 0, id: "t2" },
            { kind: "direction", text: "label:action", depth: 0 },
            { kind: "dialogue", speaker: "早苗", text: "我在。", depth: 0, id: "t4" },
            { kind: "note", text: "这里放慢", depth: 0 },
            { kind: "choice", text: "怎么办？", depth: 0, id: "t6" },
            { kind: "option", text: "留下", depth: 1, id: "t7" },
            { kind: "dialogue", speaker: "林", text: "那就留下吧。", depth: 2, id: "t8" },
            { kind: "dialogue", speaker: "路人", text: "<让一让>", depth: 0, id: "t9" },
        ]);
    });

    it("leaves out ids, directions and branches on request, without stranding nested lines", () => {
        const manuscript = buildManuscript(fixture(), { ...all, includeIds: false, includeDirections: false, includeBranches: false }, labels, { title: "Story" });
        expect(manuscript.scenes[0].lines.map(line => (line.kind === "gap" ? "gap" : `${line.kind}:${line.depth}`))).toEqual([
            "narration:0", "dialogue:0", "dialogue:0", "dialogue:0", "dialogue:0",
        ]);
        expect(manuscript.scenes[0].lines.some(line => "id" in line)).toBe(false);
    });

    it("filters to one speaker with context and drops the scenes they are not in", () => {
        const manuscript = buildManuscript(fixture(), { ...all, speakers: new Set([`character:${LIN}`]), includeDirections: false }, labels, { title: "Story" });
        expect(manuscript.scenes.map(entry => entry.name)).toEqual(["教室"]);
        expect(manuscript.scenes[0].lines).toEqual([
            { kind: "narration", text: "雨声。", depth: 0, id: "t1", context: true },
            { kind: "dialogue", speaker: "林", text: "有人吗？", depth: 0, id: "t2" },
            { kind: "gap" },
            { kind: "option", text: "留下", depth: 1, id: "t7", context: true },
            { kind: "dialogue", speaker: "林", text: "那就留下吧。", depth: 2, id: "t8" },
            { kind: "gap" },
        ]);
    });

    it("lists speakers by line count, temp speakers by name", () => {
        expect(listManuscriptSpeakers(fixture(), [S1, S2], labels.speaker, "?")).toEqual([
            { key: `character:${LIN}`, name: "林", count: 2 },
            { key: `character:${SANAE}`, name: "早苗", count: 2 },
            { key: "name:路人", name: "路人", count: 1 },
        ]);
    });
});

describe("rendering", () => {
    const strings = { gap: "Omitted", pageOf: "{page} / {total}" };

    it("writes a self-contained, escaped HTML page with the CJK face for the language", () => {
        const manuscript = buildManuscript(fixture(), all, labels, { title: "剧本 <一>", subtitle: "林" });
        const html = renderManuscriptHtml(manuscript, "zh", strings);
        expect(html).toMatch(/^<!doctype html>\n<html lang="zh-CN">/);
        expect(html).toContain("<h1>剧本 &lt;一&gt;</h1><p>林</p>");
        expect(html.match(/<section class="scene">/g)).toHaveLength(2);
        expect(html).toContain("<h2>教室</h2>");
        expect(html).toContain("<div class=\"line dialogue\"><div class=\"speaker\">林</div><div class=\"body\"><div class=\"text\">有人吗？</div><div class=\"id\">t2</div></div></div>");
        expect(html).toContain("<div class=\"line dialogue\" style=\"--depth:2\">");
        expect(html).toContain("&lt;让一让&gt;");
        expect(html).toContain("\"PingFang SC\"");
        expect(html.indexOf("\"PingFang SC\"")).toBeLessThan(html.indexOf("\"Hiragino Sans\""));
        // Nothing for the print window to fetch.
        expect(html).not.toMatch(/<script|<link|src=|url\(/);
    });

    it("marks context lines and gaps", () => {
        const manuscript = buildManuscript(fixture(), { ...all, speakers: new Set([`character:${LIN}`]) }, labels, { title: "t" });
        const html = renderManuscriptHtml(manuscript, "ja", strings);
        expect(html).toContain("<html lang=\"ja\">");
        expect(html).toContain("class=\"line narration context\"");
        expect(html).toContain("<div class=\"gap\" aria-label=\"Omitted\">⋯</div>");
    });

    it("puts page numbers in the footer", () => {
        expect(renderManuscriptFooter("en", strings)).toContain("<span class=\"pageNumber\"></span> / <span class=\"totalPages\"></span>");
    });

    it("builds the parts of a Word document with headings and east-Asian fonts", () => {
        const parts = buildManuscriptDocx(buildManuscript(fixture(), all, labels, { title: "剧本 & 一" }), "ja");
        expect(parts.map(part => part.name)).toEqual([
            "[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "word/_rels/document.xml.rels", "word/document.xml", "word/styles.xml",
        ]);
        const document = parts.find(part => part.name === "word/document.xml")!.content;
        expect(document).toContain("<w:t xml:space=\"preserve\">剧本 &amp; 一</w:t>");
        expect(document.match(/<w:pStyle w:val="Heading1"\/>/g)).toHaveLength(2);
        expect(document).toContain("<w:t xml:space=\"preserve\">［label:action］</w:t>");
        expect(document).toContain("&lt;让一让&gt;");
        const styles = parts.find(part => part.name === "word/styles.xml")!.content;
        expect(styles).toContain("w:eastAsia=\"Yu Gothic\"");
        expect(styles).toContain("w:eastAsia=\"ja-JP\"");
    });
});
