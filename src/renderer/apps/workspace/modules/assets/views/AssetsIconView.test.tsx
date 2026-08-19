// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import { AssetsPanelContext, type AssetsIconViewToolbarCenter } from "../AssetsPanelContext";
import { createEmptyAssetCategoryRecord } from "../state/assetCategoryRecord";
import type { ResolvedAssetSet } from "../state/useAssetSets";
import { AssetsIconView } from "./AssetsIconView";

// The real one reads the workspace freeze service through a provider this test has no business
// standing up; nothing here is frozen.
vi.mock("@/apps/workspace/components/ui/freezeGuard", async () => {
    const actual = await vi.importActual<typeof import("@/apps/workspace/components/ui/freezeGuard")>(
        "@/apps/workspace/components/ui/freezeGuard",
    );
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(false, "") };
});

afterEach(cleanup);

function group(id: string, name: string, parentGroupId?: string): AssetGroup {
    return { id, name, category: AssetCategory.Image, parentGroupId, createdAt: 0, updatedAt: 0 };
}

const OUTER = group("g-outer", "UI");
const INNER = group("g-inner", "Buttons", OUTER.id);

/**
 * The panel around the grid, kept as unhelpful as a caller is allowed to be: `onGroupPathChange` is a
 * fresh closure on every render, and so is the context object. That is what {@link AssetsPanel} used
 * to pass, and the grid has to settle anyway - it publishes its "leave this folder" handler into the
 * panel's own state, so a handler identity that moves every render is a render loop.
 */
function Harness({ onRender }: { onRender?: () => void }) {
    const [pathIds, setPathIds] = useState<string[]>([]);
    const [toolbarCenter, setToolbarCenter] = useState<AssetsIconViewToolbarCenter | null>(null);
    onRender?.();

    const groups = createEmptyAssetCategoryRecord<AssetGroup>();
    groups[AssetCategory.Image] = [OUTER, INNER];

    const contextValue = {
        assets: createEmptyAssetCategoryRecord<Asset>(),
        groups,
        filteredAssets: createEmptyAssetCategoryRecord<Asset>(),
        filteredGroups: groups,
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
        handleImportToGroup: () => undefined,
        isFocused: () => false,
        isNarrowed: false,
        compactToolbar: true,
        setAssetsIconToolbarCenter: setToolbarCenter,
        mediaSupport: new Map(),
        handleConvertMedia: () => undefined,
    };

    return (
        <AssetsPanelContext.Provider value={contextValue}>
            {/* Stands in for the compact toolbar's centre slot. */}
            {toolbarCenter && (
                <button type="button" data-testid="crumb" onClick={toolbarCenter.onBack}>
                    {toolbarCenter.title}
                </button>
            )}
            <AssetsIconView
                dropTargetId={null}
                handleRootDrop={async () => undefined}
                actionLoading={false}
                setDropTargetId={() => undefined}
                handleImport={() => undefined}
                handleImportRemote={() => undefined}
                handleCreateGroup={() => undefined}
                iconSize={120}
                onIconSizeChange={() => undefined}
                groupPathIds={pathIds}
                onGroupPathChange={(next) => setPathIds(next)}
            />
        </AssetsPanelContext.Provider>
    );
}

function enter(groupId: string): void {
    const tile = document.querySelector(`[data-asset-group-id="${groupId}"]`);
    expect(tile).not.toBeNull();
    fireEvent.click(tile as HTMLElement);
}

describe("AssetsIconView breadcrumb on a compact toolbar", () => {
    it("settles after entering a folder", () => {
        let renders = 0;
        render(<Harness onRender={() => { renders += 1; }} />);
        const beforeEnter = renders;

        enter(OUTER.id);

        expect(screen.getByTestId("crumb").textContent).toBe("UI");
        // Entering costs a render for the path and a render for the published breadcrumb. The
        // number is loose on purpose; what it rules out is the runaway that made React throw
        // "Maximum update depth exceeded" and take the panel down with it.
        expect(renders - beforeEnter).toBeLessThan(10);
    });

    it("goes back to where the grid is now, not where it was when the handler was published", () => {
        render(<Harness />);

        enter(OUTER.id);
        enter(INNER.id);
        expect(screen.getByTestId("crumb").textContent).toBe("Buttons");

        fireEvent.click(screen.getByTestId("crumb"));
        expect(screen.getByTestId("crumb").textContent).toBe("UI");

        fireEvent.click(screen.getByTestId("crumb"));
        expect(screen.queryByTestId("crumb")).toBeNull();
    });
});
