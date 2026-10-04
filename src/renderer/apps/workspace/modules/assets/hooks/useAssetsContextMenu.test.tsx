// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSource, type Asset, type AssetGroup } from "@/lib/workspace/services/assets/types";
import type { ContextMenuItemDef } from "@/lib/components/elements/ContextMenu";
import type { ContextMenuTargetState } from "../state/assetActionTargets";
import { useAssetsContextMenu } from "./useAssetsContextMenu";

vi.mock("@/apps/workspace/components/ui/freezeGuard", async () => {
    const actual = await vi.importActual<typeof import("@/apps/workspace/components/ui/freezeGuard")>(
        "@/apps/workspace/components/ui/freezeGuard",
    );
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(false, "") };
});

vi.mock("@/apps/workspace/hooks/useProjectDistrusted", () => ({
    useProjectDistrusted: () => false,
    useProjectDistrustedReason: () => "",
}));

const FOLDER: AssetGroup = { id: "g-bg", name: "Backgrounds", category: AssetCategory.Image, createdAt: 0, updatedAt: 0 };
const FILE: Asset = {
    id: "a-room",
    type: AssetType.Image,
    name: "room",
    hash: "h",
    source: AssetSource.Local,
    meta: {} as Asset["meta"],
    tags: [],
    description: "",
    groupId: FOLDER.id,
};

function setup() {
    const handleCreateGroup = vi.fn(async () => undefined);
    const handleImportToGroup = vi.fn(async () => undefined);
    const hook = renderHook(() => {
        const [target, setTarget] = useState<ContextMenuTargetState | null>(null);
        return useAssetsContextMenu({
            clipboard: null,
            contextMenuTarget: target,
            setContextMenuTarget: setTarget,
            selectedItems: new Set(),
            isMultiSelectMode: false,
            handleClearSelection: () => undefined,
            handleCopy: () => undefined,
            handleCut: () => undefined,
            handlePaste: async () => undefined,
            handleRename: async () => undefined,
            handleReplaceContent: async () => undefined,
            handleConvertMedia: async () => undefined,
            canConvertMedia: false,
            handleDelete: async () => undefined,
            handleExport: async () => undefined,
            handleCreateGroup,
            handleCreateTextFile: async () => undefined,
            handleImportToGroup,
        });
    });
    const row = (id: string) => {
        const item = hook.result.current.contextMenu.find(entry => "id" in entry && entry.id === id) as ContextMenuItemDef | undefined;
        expect(item).toBeDefined();
        return item!;
    };
    return { hook, row, handleCreateGroup, handleImportToGroup };
}

const fakeEvent = () => ({ preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0 }) as unknown as React.MouseEvent;

describe("the asset menu's New Group and Import", () => {
    it("land in the folder a file row is filed in, not under the file", async () => {
        const { hook, row, handleCreateGroup, handleImportToGroup } = setup();
        act(() => hook.result.current.showContextMenu(fakeEvent(), AssetCategory.Image, FILE, false));

        await act(async () => { await row("new-group").onClick?.(); });
        act(() => hook.result.current.showContextMenu(fakeEvent(), AssetCategory.Image, FILE, false));
        await act(async () => { await row("import-assets").onClick?.(); });

        expect(handleCreateGroup).toHaveBeenCalledWith(AssetCategory.Image, FOLDER.id);
        expect(handleImportToGroup).toHaveBeenCalledWith(AssetCategory.Image, FOLDER.id);
    });

    it("land inside a folder row", async () => {
        const { hook, row, handleCreateGroup } = setup();
        act(() => hook.result.current.showContextMenu(fakeEvent(), AssetCategory.Image, FOLDER, true));

        await act(async () => { await row("new-group").onClick?.(); });

        expect(handleCreateGroup).toHaveBeenCalledWith(AssetCategory.Image, FOLDER.id);
    });

    it("land in the folder whose empty space the menu was opened on", async () => {
        const { hook, row, handleCreateGroup } = setup();
        act(() => hook.result.current.showPlaceContextMenu(fakeEvent(), AssetCategory.Image, FOLDER.id));

        await act(async () => { await row("new-group").onClick?.(); });

        expect(handleCreateGroup).toHaveBeenCalledWith(AssetCategory.Image, FOLDER.id);
    });

    it("land at the root from a section header", async () => {
        const { hook, row, handleCreateGroup } = setup();
        act(() => hook.result.current.showContextMenu(fakeEvent(), AssetCategory.Image, null, false));

        await act(async () => { await row("new-group").onClick?.(); });

        expect(handleCreateGroup).toHaveBeenCalledWith(AssetCategory.Image, undefined);
    });
});
