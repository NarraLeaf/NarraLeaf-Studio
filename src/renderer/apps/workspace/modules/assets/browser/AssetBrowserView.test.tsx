// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installVirtualLayoutStub } from "@/lib/utils/virtualLayoutTestStub";
import { AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSource, type Asset, type AssetGroup } from "@/lib/workspace/services/assets/types";
import { AssetsPanelContext } from "../AssetsPanelContext";
import { createEmptyAssetCategoryRecord } from "../state/assetCategoryRecord";
import type { ResolvedAssetSet } from "../state/useAssetSets";
import { AssetBrowserView, type AssetBrowserViewProps } from "./AssetBrowserView";
import type { AssetBrowserLocation } from "./assetBrowserModel";

// The real one reads the workspace freeze service through a provider this test has no business
// standing up; nothing here is frozen.
vi.mock("@/apps/workspace/components/ui/freezeGuard", async () => {
    const actual = await vi.importActual<typeof import("@/apps/workspace/components/ui/freezeGuard")>(
        "@/apps/workspace/components/ui/freezeGuard",
    );
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(false, "") };
});

let restoreLayout: () => void = () => undefined;
beforeEach(() => {
    restoreLayout = installVirtualLayoutStub({ viewport: 400, row: 140, width: 900 });
});
afterEach(() => {
    cleanup();
    restoreLayout();
});

function group(id: string, name: string, parentGroupId?: string): AssetGroup {
    return { id, name, category: AssetCategory.Media, parentGroupId, createdAt: 0, updatedAt: 0 };
}

/** Clips rather than pictures: an image tile reaches for a thumbnail cache this test has no window for. */
function clip(id: string, name: string, groupId?: string): Asset {
    return {
        id,
        type: AssetType.Audio,
        name,
        ext: "ogg",
        hash: id,
        source: AssetSource.Local,
        meta: {} as Asset["meta"],
        tags: [],
        description: "",
        ...(groupId ? { groupId } : {}),
    };
}

const MUSIC = group("g-music", "Music");
const THEMES = group("g-themes", "Themes", MUSIC.id);
const FILES = [clip("a-title", "title_theme", MUSIC.id), clip("a-click", "click")];

function Harness({
    location,
    narrowedTo,
    context = {},
    ...props
}: Partial<AssetBrowserViewProps> & {
    location: AssetBrowserLocation;
    /** The files a search left, which puts the browser in its results. */
    narrowedTo?: Asset[];
    context?: Record<string, unknown>;
}) {
    const groups = createEmptyAssetCategoryRecord<AssetGroup>();
    groups[AssetCategory.Media] = [MUSIC, THEMES];
    const assets = createEmptyAssetCategoryRecord<Asset>();
    assets[AssetCategory.Media] = FILES;
    const filteredAssets = createEmptyAssetCategoryRecord<Asset>();
    filteredAssets[AssetCategory.Media] = narrowedTo ?? FILES;
    const sets = createEmptyAssetCategoryRecord<ResolvedAssetSet>();

    const contextValue = {
        assets,
        groups,
        filteredAssets,
        filteredGroups: narrowedTo ? createEmptyAssetCategoryRecord<AssetGroup>() : groups,
        matchedGroupIds: new Set<string>(),
        selectedItems: new Set<string>(),
        focusedItemId: null,
        draggedItem: null,
        dropTargetId: null,
        clipboard: null,
        isMultiSelectMode: false,
        expandedGroups: new Set<string>(),
        setExpandedGroups: () => undefined,
        handleItemSelect: () => undefined,
        publishRowOrder: () => undefined,
        handleAssetClick: () => undefined,
        handleAssetOpen: () => undefined,
        handleGroupFocus: () => undefined,
        showContextMenu: () => undefined,
        assetSets: sets,
        rootAssetSets: sets,
        memberAssetIds: new Set<string>(),
        expandedAssetSets: new Set<string>(),
        setExpandedAssetSets: () => undefined,
        assetSetNaming: {
            locales: new Map(),
            editions: new Map(),
            words: { language: "Language", edition: "Variant", deletedEdition: "Deleted variant" },
        },
        handleAssetSetSelect: () => undefined,
        showAssetSetContextMenu: () => undefined,
        showAssetSetValueContextMenu: () => undefined,
        handleImportToGroup: () => undefined,
        isFocused: () => false,
        isNarrowed: !!narrowedTo,
        mediaSupport: new Map(),
        unreadableCategories: new Set<AssetCategory>(),
        handleConvertMedia: () => undefined,
        assetClaims: {},
        assetTransfers: {},
        ...context,
    };

    return (
        <AssetsPanelContext.Provider value={contextValue as never}>
            <AssetBrowserView
                location={location}
                onNavigate={() => undefined}
                view="grid"
                onViewChange={() => undefined}
                tileSize={96}
                onTileSizeChange={() => undefined}
                sort={null}
                onSortChange={() => undefined}
                openCategories={new Set([AssetCategory.Media])}
                onToggleCategory={() => undefined}
                searchQuery={narrowedTo ? "title" : ""}
                onSearchQueryChange={() => undefined}
                activeQuery={narrowedTo ? "title" : ""}
                filterConfigs={[]}
                activeFilters={[]}
                onFiltersChange={() => undefined}
                onFilterOpen={() => undefined}
                measures={{ bytesByAssetId: null, referenceCountByAssetId: null, usageUnknownAssetIds: null }}
                handleImport={() => undefined}
                handleImportRemote={() => undefined}
                handleCreateGroup={() => undefined}
                handleImportFiles={() => undefined}
                showPlaceContextMenu={() => undefined}
                onClearSelection={() => undefined}
                onSelectKeys={() => undefined}
                {...props}
            />
        </AssetsPanelContext.Provider>
    );
}

const IN_MUSIC: AssetBrowserLocation = { category: AssetCategory.Media, groupId: MUSIC.id };

function tile(key: string): HTMLElement {
    const element = document.querySelector(`[data-asset-browser-item="${key}"]`);
    expect(element).not.toBeNull();
    return element as HTMLElement;
}

describe("AssetBrowserView", () => {
    it("names the place it is showing in the path", () => {
        render(<Harness location={IN_MUSIC} />);
        const path = [...document.querySelectorAll("[data-asset-browser-path]")].map(element => element.textContent);
        expect(path).toEqual(["Media", "Music"]);
    });

    it("makes a new group and imports into the folder it is showing", () => {
        const handleCreateGroup = vi.fn();
        const handleImport = vi.fn();
        render(<Harness location={IN_MUSIC} handleCreateGroup={handleCreateGroup} handleImport={handleImport} />);

        fireEvent.click(screen.getByLabelText("New Group"));
        fireEvent.click(screen.getByLabelText("Import"));

        expect(handleCreateGroup).toHaveBeenCalledWith(AssetCategory.Media, MUSIC.id);
        expect(handleImport).toHaveBeenCalledWith(AssetCategory.Media, MUSIC.id);
    });

    it("marks a folder on a click and goes into it on a double click", () => {
        const onNavigate = vi.fn();
        const handleItemSelect = vi.fn();
        render(<Harness location={IN_MUSIC} onNavigate={onNavigate} context={{ handleItemSelect }} />);

        fireEvent.click(tile("group:g-themes"));
        expect(handleItemSelect).toHaveBeenCalledWith(THEMES.id, true, expect.anything());
        expect(onNavigate).not.toHaveBeenCalled();

        fireEvent.doubleClick(tile("group:g-themes"));
        expect(onNavigate).toHaveBeenCalledWith({ category: AssetCategory.Media, groupId: THEMES.id });
    });

    it("opens the folder's own menu on empty space around the contents", () => {
        const showPlaceContextMenu = vi.fn();
        render(<Harness location={IN_MUSIC} showPlaceContextMenu={showPlaceContextMenu} />);

        fireEvent.contextMenu(document.querySelector("[data-asset-browser-contents]") as HTMLElement);

        expect(showPlaceContextMenu).toHaveBeenCalledWith(expect.anything(), AssetCategory.Media, MUSIC.id);
    });

    it("goes up a folder on Backspace", () => {
        const onNavigate = vi.fn();
        render(<Harness location={IN_MUSIC} onNavigate={onNavigate} />);

        fireEvent.keyDown(document.querySelector("[data-asset-browser-contents]") as HTMLElement, { key: "Backspace" });

        expect(onNavigate).toHaveBeenCalledWith({ category: AssetCategory.Media });
    });

    it("goes to a place from the tree", () => {
        const onNavigate = vi.fn();
        render(<Harness location={{ category: AssetCategory.Media }} onNavigate={onNavigate} />);

        fireEvent.click(document.querySelector(`[data-asset-browser-place="group:${MUSIC.id}"]`) as HTMLElement);

        expect(onNavigate).toHaveBeenCalledWith({ category: AssetCategory.Media, groupId: MUSIC.id });
    });

    it("shows results in place of the path, and makes nothing while they are up", () => {
        render(<Harness location={IN_MUSIC} narrowedTo={[FILES[0]]} />);

        expect(screen.getByText("1 result")).toBeTruthy();
        expect(document.querySelectorAll("[data-asset-browser-path]")).toHaveLength(0);
        expect((screen.getByLabelText("New Group") as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByLabelText("Import") as HTMLButtonElement).disabled).toBe(true);
        expect(tile("asset:a-title")).toBeTruthy();
    });
});
