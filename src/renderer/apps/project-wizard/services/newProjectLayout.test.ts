import { describe, expect, it } from "vitest";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { ASSET_CATEGORY_ORDER, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { EMPTY_ASSET_ORDER_TEXT } from "@/lib/workspace/services/assets/assetOrder";
import {
    NEW_PROJECT_ASSET_CATEGORIES,
    NEW_PROJECT_ASSET_TYPES,
    NEW_PROJECT_DIRECTORIES,
    NEW_PROJECT_EMPTY_ASSET_ORDER,
    newProjectFiles,
} from "@shared/project/newProject";

/**
 * The new-project layout is spelled out in shared code, because the main process writes it too and
 * cannot import the renderer's naming table. This holds the two to one answer.
 */
describe("new project layout", () => {
    /** A convention path as plain segments, without the trailing slash that marks a directory. */
    const segments = (path: readonly string[]) => path.map(part => part.replace(/\/$/, ""));

    it("creates exactly the directories the naming table names", () => {
        const expected = [
            ProjectNameConvention.NLCache,
            ProjectNameConvention.Assets,
            ProjectNameConvention.AssetsContent,
            ProjectNameConvention.Scripts,
            ProjectNameConvention.Editor,
            ProjectNameConvention.EditorAssets,
            ProjectNameConvention.EditorServices,
            ProjectNameConvention.EditorUI,
            ProjectNameConvention.EditorStory,
            ProjectNameConvention.EditorStoryStories,
        ].map(segments);
        expect(NEW_PROJECT_DIRECTORIES.map(path => [...path])).toEqual(expected);
    });

    it("covers every asset type and category, with the same empty order text", () => {
        expect([...NEW_PROJECT_ASSET_TYPES].sort()).toEqual([...Object.values(AssetType)].sort());
        expect([...NEW_PROJECT_ASSET_CATEGORIES]).toEqual([...ASSET_CATEGORY_ORDER]);
        expect(NEW_PROJECT_EMPTY_ASSET_ORDER).toBe(EMPTY_ASSET_ORDER_TEXT);
    });

    it("writes its files where the naming table says they live", () => {
        let id = 0;
        const paths = newProjectFiles({ width: 1920, height: 1080 }, () => `id-${id++}`).map(file => file.path.join("/"));
        expect(paths).toContain(ProjectNameConvention.EditorConfig.join("/"));
        expect(paths).toContain(ProjectNameConvention.EditorUIDocument.join("/"));
        for (const type of Object.values(AssetType)) {
            expect(paths).toContain(ProjectNameConvention.AssetsMetadataShard(type).join("/"));
        }
        for (const category of ASSET_CATEGORY_ORDER) {
            expect(paths).toContain(ProjectNameConvention.AssetsGroupsShard(category).join("/"));
            expect(paths).toContain(ProjectNameConvention.AssetsOrderShard(category).join("/"));
        }
    });
});
