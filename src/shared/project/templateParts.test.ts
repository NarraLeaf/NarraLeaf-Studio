import { describe, expect, it } from "vitest";
import { parseProjectTemplateParts, partsKeptWith, resolveLeftOutParts } from "./templateParts";

const PARTS = parseProjectTemplateParts([
    { id: "story", name: "Story", requires: ["characters", "files"], emptyScene: { name: "Start", locales: { zh: { name: "开始" } } } },
    { id: "characters", name: "Cast" },
    { id: "files", name: "Files" },
]);

describe("template parts", () => {
    it("keeps only the kinds Studio can take out, once each, and requirements on parts that exist", () => {
        const parsed = parseProjectTemplateParts([
            { id: "story", name: "Story", requires: ["characters", "pages", "story"] },
            { id: "pages", name: "Pages" },
            { id: "story", name: "Again" },
            { id: "files" },
            "story",
        ]);
        expect(parsed.map(part => part.id)).toEqual(["story"]);
        expect(parsed[0].requires).toEqual([]);
        expect(PARTS[0].emptyScene?.name).toBe("Start");
    });

    it("leaves out what needs a left-out part, in the template's order", () => {
        expect(resolveLeftOutParts(PARTS, ["files"])).toEqual(["story", "files"]);
        expect(resolveLeftOutParts(PARTS, ["characters", "story"])).toEqual(["story", "characters"]);
        expect(resolveLeftOutParts(PARTS, [])).toEqual([]);
    });

    it("brings back what a ticked part needs, so a tick never leaves the story without its cast", () => {
        expect(partsKeptWith(PARTS, "story").sort()).toEqual(["characters", "files", "story"]);
        expect(partsKeptWith(PARTS, "files")).toEqual(["files"]);
    });
});
