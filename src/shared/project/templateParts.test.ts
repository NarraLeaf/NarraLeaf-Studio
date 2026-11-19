import { describe, expect, it } from "vitest";
import { leaveOutTemplateParts, parseProjectTemplateParts, partsKeptWith, resolveLeftOutParts, type TemplatePartFiles } from "./templateParts";

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

function memoryFiles(entries: Record<string, unknown>): { files: TemplatePartFiles; data: Map<string, string> } {
    const data = new Map(Object.entries(entries).map(([path, value]) => [path, JSON.stringify(value)]));
    return {
        data,
        files: {
            list: async () => [...data.keys()],
            read: async path => {
                const text = data.get(path);
                if (text === undefined) throw new Error(`Missing ${path}`);
                return text;
            },
            write: async (path, text) => { data.set(path, text); },
            remove: async path => { data.delete(path); },
        },
    };
}

describe("leaving out template content", () => {
    it("clears the entry scene's sample music with its story", async () => {
        const path = "editor/story/stories/story/storydoc.json";
        const { files, data } = memoryFiles({
            "editor/story/index.json": { stories: [{ documentPath: path }] },
            [path]: { entrySceneId: "scene", scenes: { scene: {
                id: "scene", name: "Sample", rootBlockIds: [], blocks: {},
                defaultBackgroundAssetId: "background", bgm: { assetId: "sample-music" },
            } } },
        });

        await leaveOutTemplateParts(files, PARTS, ["story"], "en");
        const scene = JSON.parse(data.get(path)!).scenes.scene;
        expect(scene.defaultBackgroundAssetId).toBeUndefined();
        expect(scene.bgm).toBeUndefined();
        expect(scene.name).toBe("Start");
    });

    it("keeps the ancestors of asset groups that still contain files", async () => {
        const groupsPath = "assets/assets.groups.image.json";
        const orderPath = "assets/assets.order.image.json";
        const { files, data } = memoryFiles({
            "editor/ui/uidoc.json": { assetId: "keep-id" },
            "assets/assets.metadata.image.json": {
                "keep-id": { id: "keep-id", groupId: "child" },
                "drop-id": { id: "drop-id", groupId: "parent" },
                "drop-other": { id: "drop-other", groupId: "grandparent" },
            },
            [groupsPath]: {
                grandparent: { id: "grandparent", name: "Grandparent" },
                parent: { id: "parent", name: "Parent", parentGroupId: "grandparent" },
                child: { id: "child", name: "Child", parentGroupId: "parent" },
            },
            [orderPath]: { assetIds: ["keep-id", "drop-id", "drop-other"], groupIds: ["grandparent", "parent", "child"] },
        });

        await leaveOutTemplateParts(files, PARTS, ["files"], "en");
        expect(Object.keys(JSON.parse(data.get(groupsPath)!))).toEqual(["grandparent", "parent", "child"]);
        expect(JSON.parse(data.get(orderPath)!).groupIds).toEqual(["grandparent", "parent", "child"]);
    });
});
