import { describe, expect, it, vi } from "vitest";
import { AssetCategory, type AssetType } from "../assets/assetTypes";
import type { Asset, AssetGroup, AssetSource } from "../assets/types";
import { fileUnderCharacterFolder, findCharacterImageFolder, type PsdImportFolderLibrary } from "./psdImportFolder";

/**
 * Where a PSD import files its layer images.
 *
 * They used to land loose in the root of 图片, a dozen layers per sheet. They go into the image folder
 * named after the character: made the first time, the same folder on every import after.
 */

function folder(id: string, name: string, parentGroupId?: string): AssetGroup {
    return { id, name, category: AssetCategory.Image, ...(parentGroupId ? { parentGroupId } : {}), createdAt: 0, updatedAt: 0 };
}

const LAYERS = [{ id: "a1" }, { id: "a2" }] as unknown as Asset<AssetType, AssetSource>[];

function library(groups: AssetGroup[]) {
    const createGroup = vi.fn(async (category: AssetCategory, name: string) => {
        const made = folder(`made-${name}`, name);
        groups.push(made);
        return { success: true as const, data: made };
    });
    const moveAssetsToGroup = vi.fn(async () => ({ success: true as const, data: undefined }));
    const service: PsdImportFolderLibrary = {
        getGroupAssetsManager: () => ({ getGroups: () => groups }),
        createGroup,
        moveAssetsToGroup,
    };
    return { service, createGroup, moveAssetsToGroup };
}

describe("a PSD import's folder", () => {
    it("is made after the character the first time, and the layers go in it", async () => {
        const { service, createGroup, moveAssetsToGroup } = library([folder("bg", "背景")]);

        const filed = await fileUnderCharacterFolder(service, LAYERS, "美绪");

        expect(createGroup).toHaveBeenCalledWith(AssetCategory.Image, "美绪");
        expect(moveAssetsToGroup).toHaveBeenCalledWith(LAYERS, "made-美绪");
        expect(filed).toEqual({ success: true, data: "made-美绪" });
    });

    it("is reused when it exists, so a re-import lands beside the first", async () => {
        const { service, createGroup, moveAssetsToGroup } = library([folder("mio", "美绪")]);

        await fileUnderCharacterFolder(service, LAYERS, "美绪");

        expect(createGroup).not.toHaveBeenCalled();
        expect(moveAssetsToGroup).toHaveBeenCalledWith(LAYERS, "mio");
    });

    it("prefers a top-level folder of that name, and otherwise takes one the author moved", () => {
        expect(findCharacterImageFolder([folder("deep", "美绪", "cast"), folder("top", "美绪")], "美绪")?.id).toBe("top");
        expect(findCharacterImageFolder([folder("cast", "角色"), folder("deep", "美绪", "cast")], "美绪")?.id).toBe("deep");
        expect(findCharacterImageFolder([folder("other", "Narra")], "美绪")).toBeNull();
    });

    it("answers a failure instead of throwing, since the import has already happened", async () => {
        const service = {
            getGroupAssetsManager: () => {
                throw new Error("groups not loaded");
            },
        } as unknown as PsdImportFolderLibrary;

        await expect(fileUnderCharacterFolder(service, LAYERS, "美绪")).resolves.toEqual({ success: false, error: "groups not loaded" });
    });

    it("files nothing without a name or without layers", async () => {
        const { service, createGroup } = library([]);
        expect(await fileUnderCharacterFolder(service, LAYERS, "  ")).toEqual({ success: true, data: null });
        expect(await fileUnderCharacterFolder(service, [], "美绪")).toEqual({ success: true, data: null });
        expect(createGroup).not.toHaveBeenCalled();
    });
});
