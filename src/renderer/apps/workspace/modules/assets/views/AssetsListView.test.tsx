// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSource, type Asset, type AssetGroup } from "@/lib/workspace/services/assets/types";
import { AssetsPanelContext } from "../AssetsPanelContext";
import { createEmptyAssetCategoryRecord } from "../state/assetCategoryRecord";
import type { ResolvedAssetSet } from "../state/useAssetSets";
import { installVirtualLayoutStub } from "@/lib/utils/virtualLayoutTestStub";
import { AssetsListView } from "./AssetsListView";

// The real one reads the workspace freeze service through a provider this test has no business
// standing up; nothing here is frozen.
vi.mock("@/apps/workspace/components/ui/freezeGuard", async () => {
    const actual = await vi.importActual<typeof import("@/apps/workspace/components/ui/freezeGuard")>(
        "@/apps/workspace/components/ui/freezeGuard",
    );
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(false, "") };
});

// The tree is windowed, and a virtualiser reads a layout jsdom does not run. See the stub's note.
let restoreLayout: () => void = () => undefined;
beforeEach(() => {
    restoreLayout = installVirtualLayoutStub({ viewport: 600, row: 32, width: 320 });
});
afterEach(() => {
    cleanup();
    restoreLayout();
    importToGroup.mockReset();
});

const LIBRARY_SIZE = 4000;

function asset(index: number, groupId?: string): Asset {
    return {
        id: `a-${index}`,
        type: AssetType.Image,
        name: `sprite-${index}.png`,
        hash: `h-${index}`,
        source: AssetSource.Local,
        meta: {} as Asset["meta"],
        tags: [],
        description: "",
        ...(groupId ? { groupId } : {}),
    };
}

const FOLDER: AssetGroup = {
    id: "g-cast",
    name: "Cast",
    category: AssetCategory.Image,
    createdAt: 0,
    updatedAt: 0,
};

const importToGroup = vi.fn();

function Harness({ publishRowOrder = () => undefined, assetTransfers = {} }: {
    publishRowOrder?: (keys: readonly string[]) => void;
    assetTransfers?: Readonly<Record<string, number>>;
}) {
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    const assets = createEmptyAssetCategoryRecord<Asset>();
    // Half loose in the section, half filed in one folder, so the tree has a level to walk into.
    assets[AssetCategory.Image] = Array.from({ length: LIBRARY_SIZE }, (_, index) => (
        index % 2 === 0 ? asset(index) : asset(index, FOLDER.id)
    ));
    const groups = createEmptyAssetCategoryRecord<AssetGroup>();
    groups[AssetCategory.Image] = [FOLDER];

    const contextValue = {
        assets,
        groups,
        filteredAssets: assets,
        filteredGroups: groups,
        matchedGroupIds: new Set<string>(),
        selectedItems: new Set<string>(),
        focusedItemId: null,
        draggedItem: null,
        dropTargetId: null,
        clipboard: null,
        isMultiSelectMode: false,
        expandedGroups,
        setExpandedGroups,
        handleItemSelect: () => undefined,
        publishRowOrder,
        handleAssetClick: () => undefined,
        handleGroupFocus: () => undefined,
        showContextMenu: () => undefined,
        assetSets: createEmptyAssetCategoryRecord<ResolvedAssetSet>(),
        rootAssetSets: createEmptyAssetCategoryRecord<ResolvedAssetSet>(),
        memberAssetIds: new Set<string>(),
        expandedAssetSets: new Set<string>(),
        setExpandedAssetSets: () => undefined,
        assetSetNaming: { locales: new Map(), editions: new Map(), words: { language: "Language", edition: "Variant" } },
        handleAssetSetSelect: () => undefined,
        showAssetSetContextMenu: () => undefined,
        showAssetSetValueContextMenu: () => undefined,
        handleImportToGroup: importToGroup,
        isFocused: () => false,
        isNarrowed: false,
        compactToolbar: false,
        setAssetsIconToolbarCenter: () => undefined,
        mediaSupport: new Map(),
        handleConvertMedia: () => undefined,
        assetClaims: {},
        assetTransfers,
    };

    return (
        <AssetsPanelContext.Provider value={contextValue}>
            <div ref={setScrollElement} style={{ overflowY: "auto" }}>
                <AssetsListView
                    dropTargetId={null}
                    handleRootDrop={async () => undefined}
                    handleImport={() => undefined}
                    handleImportRemote={() => undefined}
                    handleCreateGroup={() => undefined}
                    actionLoading={false}
                    setDropTargetId={() => undefined}
                    openItems={[AssetCategory.Image]}
                    onOpenChange={() => undefined}
                    disableAnimation
                    scrollElement={scrollElement}
                />
            </div>
        </AssetsPanelContext.Provider>
    );
}

function drawnRows(): number {
    return document.querySelectorAll("[data-index]").length;
}

describe("AssetsListView on a large library", () => {
    it("draws a screenful of rows, not the library", () => {
        render(<Harness />);

        // A screenful at 32px plus the overscan either side. What this rules out is the shape the
        // panel had before: one row in the DOM per file, on a library where that is thousands.
        expect(drawnRows()).toBeGreaterThan(0);
        expect(drawnRows()).toBeLessThan(80);
    });

    it("keeps the range covering every row the tree lays out, drawn or not", () => {
        const published: string[][] = [];
        render(<Harness publishRowOrder={keys => published.push([...keys])} />);

        // 2000 loose files and the folder's own row; the folder is collapsed, so its 2000 stay out.
        expect(published[published.length - 1]).toHaveLength(LIBRARY_SIZE / 2 + 1);
    });

    it("drops onto the folder a row is filed in, which no longer wraps it", () => {
        render(<Harness />);
        fireEvent.click(document.querySelector(`[data-asset-group-id="${FOLDER.id}"]`) as HTMLElement);

        // The folder's own row is first, its files follow it: this one is inside it, and under the
        // tree the panel used to draw it was inside the folder's drop target as well.
        const inside = document.querySelector("[data-index='1']") as HTMLElement;
        fireEvent.drop(inside, { dataTransfer: { files: [], types: [] } });

        expect(importToGroup).toHaveBeenCalledTimes(1);
        expect(importToGroup.mock.calls[0][0]).toBe(AssetCategory.Image);
        expect(importToGroup.mock.calls[0][1]).toBe(FOLDER.id);
    });

    it("leaves a row filed at the section root to the section's own drop target", () => {
        render(<Harness />);

        // The folder is shut, so everything after its row is loose in the section.
        const loose = document.querySelector("[data-index='2']") as HTMLElement;
        fireEvent.drop(loose, { dataTransfer: { files: [], types: [] } });

        expect(importToGroup).not.toHaveBeenCalled();
    });

    it("fills the row of a file that is still arriving, at the share that has landed", () => {
        // The library is the only place this is said. A file coming in over a session is a row that
        // is already there and a file that is not, so the row is what fills up.
        render(<Harness assetTransfers={{ "a-0": 0.42 }} />);

        const bands = document.querySelectorAll("[data-asset-transfer]");
        expect(bands).toHaveLength(1);
        expect((bands[0] as HTMLElement).dataset.assetTransfer).toBe("42");
        expect((bands[0] as HTMLElement).style.width).toBe("42%");
    });

    it("draws no band on a library where nothing is arriving, which is every ordinary moment", () => {
        render(<Harness />);

        expect(document.querySelectorAll("[data-asset-transfer]")).toHaveLength(0);
    });

    it("opens a folder without mounting what is inside it", () => {
        render(<Harness />);
        const folder = document.querySelector(`[data-asset-group-id="${FOLDER.id}"]`);
        expect(folder).not.toBeNull();

        fireEvent.click(folder as HTMLElement);

        expect(drawnRows()).toBeLessThan(80);
    });
});
