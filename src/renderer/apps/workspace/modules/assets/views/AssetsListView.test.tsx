// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeAssetSetAxis, resolveAssetSetContents, validateAssetSet, type AssetSet } from "@shared/types/assetSet";
import { AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSource, type Asset, type AssetGroup } from "@/lib/workspace/services/assets/types";
import { AssetsPanelContext } from "../AssetsPanelContext";
import { createEmptyAssetCategoryRecord } from "../state/assetCategoryRecord";
import type { ResolvedAssetSet } from "../state/useAssetSets";
import { installVirtualLayoutStub } from "@/lib/utils/virtualLayoutTestStub";
import { AssetsListView } from "./AssetsListView";
import { ASSET_DRAG_MIME } from "../dnd/assetDragContract";

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
    dropOnItem.mockReset();
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
const dropOnItem = vi.fn();

function Harness({ publishRowOrder = () => undefined, assetTransfers = {}, unreadableCategories = new Set<AssetCategory>() }: {
    publishRowOrder?: (keys: readonly string[]) => void;
    assetTransfers?: Readonly<Record<string, number>>;
    unreadableCategories?: ReadonlySet<AssetCategory>;
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
        handleAssetOpen: () => undefined,
        handleGroupFocus: () => undefined,
        showContextMenu: () => undefined,
        assetSets: createEmptyAssetCategoryRecord<ResolvedAssetSet>(),
        rootAssetSets: createEmptyAssetCategoryRecord<ResolvedAssetSet>(),
        memberAssetIds: new Set<string>(),
        expandedAssetSets: new Set<string>(),
        setExpandedAssetSets: () => undefined,
        assetSetNaming: { locales: new Map(), editions: new Map(), words: { language: "Language", edition: "Variant", deletedEdition: "Deleted variant" } },
        handleAssetSetSelect: () => undefined,
        showAssetSetContextMenu: () => undefined,
        showAssetSetValueContextMenu: () => undefined,
        handleImportToGroup: importToGroup,
        handleDropOnItem: dropOnItem,
        isFocused: () => false,
        isNarrowed: false,
        mediaSupport: new Map(),
        unreadableCategories,
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

    it("drops onto a folder's own row into that folder", () => {
        render(<Harness />);

        // The name is the first thing dropped on. Read as "the folder the row is filed in" it was the
        // section root, and the file landed beside the folder instead of in it.
        const folderRow = document.querySelector("[data-index='0']") as HTMLElement;
        fireEvent.drop(folderRow, { dataTransfer: { files: [], types: [] } });

        expect(importToGroup).toHaveBeenCalledTimes(1);
        expect(importToGroup.mock.calls[0][1]).toBe(FOLDER.id);
    });

    it("files what the other assets panel is dragging, and never offers it to the import", () => {
        render(<Harness />);

        // Nothing is being dragged in this panel; the payload is the other panel's. Handed to the
        // import it opened a file picker; it is a move into the folder.
        const folderRow = document.querySelector("[data-index='0']") as HTMLElement;
        fireEvent.drop(folderRow, { dataTransfer: { files: [], types: [ASSET_DRAG_MIME, "text/plain"] } });

        expect(importToGroup).not.toHaveBeenCalled();
        expect(dropOnItem).toHaveBeenCalledTimes(1);
        expect(dropOnItem.mock.calls[0][1]).toBe(AssetCategory.Image);
        expect(dropOnItem.mock.calls[0][2]).toEqual(FOLDER);
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

/** A set resolved against a library the way the panel resolves one. */
function resolvedSet(set: AssetSet, library: readonly Asset[]): ResolvedAssetSet {
    const candidates = library.map(entry => ({ id: entry.id, type: entry.type, tags: entry.tags }));
    const contents = resolveAssetSetContents(set, candidates, [set]);
    const problems = validateAssetSet(set, [set]);
    return {
        set,
        category: AssetCategory.Image,
        contents,
        problems,
        incomplete: problems.length > 0 || contents.missing.length > 0 || contents.ambiguous.length > 0,
    };
}

function member(id: string, name: string, tags: string[]): Asset {
    return { ...asset(0), id, name, tags };
}

/**
 * Two sets, both open: one whose `ja` has no file of its own and is answered by the fallback, and one
 * whose fallback has no file, so its `main` is answered by nothing.
 */
function SetHarness({ publishRowOrder = () => undefined }: { publishRowOrder?: (keys: readonly string[]) => void }) {
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
    const library = [
        member("title-en", "title_en", ["set:s-title", "locale:en"]),
        member("cover-demo", "cover_demo", ["set:s-cover", "release:demo"]),
    ];
    const sets = [
        resolvedSet({
            id: "s-title",
            name: "Title card",
            type: AssetType.Image,
            filter: ["set:s-title"],
            axis: makeAssetSetAxis("locale", ["en", "ja"], "en"),
        }, library),
        resolvedSet({
            id: "s-cover",
            name: "Cover",
            type: AssetType.Image,
            filter: ["set:s-cover"],
            axis: makeAssetSetAxis("release", ["main", "demo"], "main"),
        }, library),
    ];
    const assets = createEmptyAssetCategoryRecord<Asset>();
    assets[AssetCategory.Image] = library;
    const byCategory = createEmptyAssetCategoryRecord<ResolvedAssetSet>();
    byCategory[AssetCategory.Image] = sets;
    const memberAssetIds = new Set(sets.flatMap(entry => entry.contents.cells.flatMap(cell => cell.assetIds)));

    const contextValue = {
        assets,
        groups: createEmptyAssetCategoryRecord<AssetGroup>(),
        filteredAssets: assets,
        filteredGroups: createEmptyAssetCategoryRecord<AssetGroup>(),
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
        publishRowOrder,
        handleAssetClick: () => undefined,
        handleAssetOpen: () => undefined,
        handleGroupFocus: () => undefined,
        showContextMenu: () => undefined,
        assetSets: byCategory,
        rootAssetSets: byCategory,
        memberAssetIds,
        expandedAssetSets: new Set(sets.map(entry => entry.set.id)),
        setExpandedAssetSets: () => undefined,
        assetSetNaming: {
            locales: new Map([["en", "English"], ["ja", "日本語"]]),
            editions: new Map([["main", "main"], ["demo", "Demo"]]),
            words: { language: "Language", edition: "Variant", deletedEdition: "Deleted variant" },
        },
        handleAssetSetSelect: () => undefined,
        showAssetSetContextMenu: () => undefined,
        showAssetSetValueContextMenu: () => undefined,
        handleImportToGroup: importToGroup,
        handleDropOnItem: dropOnItem,
        isFocused: () => false,
        isNarrowed: false,
        mediaSupport: new Map(),
        unreadableCategories: new Set<AssetCategory>(),
        handleConvertMedia: () => undefined,
        assetClaims: {},
        assetTransfers: {},
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

/** The row a value of a set is drawn as, by the words on its right. */
function valueRow(coordinate: string): HTMLElement {
    const rows = [...document.querySelectorAll<HTMLElement>("[data-index] > div")];
    const row = rows.find(candidate => candidate.textContent?.endsWith(coordinate));
    expect(row).toBeDefined();
    return row as HTMLElement;
}

describe("a set's values in the tree", () => {
    it("draws a value the fallback answers as the fallback's file, marked, and not as a hole", () => {
        render(<SetHarness />);

        // The same thing the set's count says - every value is answered - and the inspector says: the
        // game shows title_en for Japanese.
        const row = valueRow("Language: 日本語");
        expect(row.hasAttribute("data-asset-set-inherited")).toBe(true);
        expect(row.textContent).toContain("title_en");
        expect(row.textContent).toContain("fallback");
        expect(row.textContent).not.toContain("No file");
        expect(row.querySelector(".text-warning")).toBeNull();
    });

    it("still draws a value nothing answers as a hole", () => {
        render(<SetHarness />);

        const row = valueRow("Variant: main");
        expect(row.hasAttribute("data-asset-set-inherited")).toBe(false);
        expect(row.textContent).toContain("No file");
    });

    it("keeps the fallback's file one row in a range, however many values it answers", () => {
        const published: string[][] = [];
        render(<SetHarness publishRowOrder={keys => published.push([...keys])} />);

        const keys = published[published.length - 1];
        expect(keys.filter(key => key.endsWith("title-en"))).toHaveLength(1);
    });
});

describe("a section whose metadata file could not be read", () => {
    it("says so, where an ordinary empty section says nothing", () => {
        // The whole point: with no rows and nothing said, the author reads it as a category they
        // have not used yet, while the file behind it still holds everything they imported. Media
        // is empty in this harness either way, so the only difference is the sentence.
        const { container } = render(<Harness unreadableCategories={new Set([AssetCategory.Media])} />);

        expect(document.querySelector(`[data-asset-category="${AssetCategory.Media}"]`)).not.toBeNull();
        expect(container.textContent).toContain("could not be read");
    });

    it("stays quiet about every section that was read", () => {
        const { container } = render(<Harness />);

        expect(container.textContent).not.toContain("could not be read");
    });
});
