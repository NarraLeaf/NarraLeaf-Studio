// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installVirtualLayoutStub } from "@/lib/utils/virtualLayoutTestStub";
import { makeAssetSetAxis, resolveAssetSetContents, validateAssetSet, type AssetSet } from "@shared/types/assetSet";
import { AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSource, type Asset, type AssetGroup } from "@/lib/workspace/services/assets/types";
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

// The grid is windowed, and a virtualiser reads a layout jsdom does not run. See the stub's note.
let restoreLayout: () => void = () => undefined;
beforeEach(() => {
    restoreLayout = installVirtualLayoutStub({ viewport: 800, row: 180, width: 420 });
});
afterEach(() => {
    cleanup();
    restoreLayout();
});

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
/**
 * A clip rather than a picture: an image tile draws a real thumbnail, which reaches for a cache this
 * test has no window to stand it up in. What is being counted is tiles, and a clip is one.
 */
function clip(index: number): Asset {
    return {
        id: `a-${index}`,
        type: AssetType.Audio,
        name: `line-${index}.ogg`,
        hash: `h-${index}`,
        source: AssetSource.Local,
        meta: {} as Asset["meta"],
        tags: [],
        description: "",
    };
}

function Harness({ onRender, library = [], sets = [], assetTransfers = {}, unreadableCategories = new Set<AssetCategory>() }: {
    onRender?: () => void;
    library?: Asset[];
    /** Sets of clips, filed at the top of the Media section. */
    sets?: ResolvedAssetSet[];
    assetTransfers?: Readonly<Record<string, number>>;
    unreadableCategories?: ReadonlySet<AssetCategory>;
}) {
    const [pathIds, setPathIds] = useState<string[]>([]);
    const [toolbarCenter, setToolbarCenter] = useState<AssetsIconViewToolbarCenter | null>(null);
    onRender?.();

    const groups = createEmptyAssetCategoryRecord<AssetGroup>();
    groups[AssetCategory.Image] = [OUTER, INNER];
    const assets = createEmptyAssetCategoryRecord<Asset>();
    assets[AssetCategory.Media] = library;
    const assetSets = createEmptyAssetCategoryRecord<ResolvedAssetSet>();
    assetSets[AssetCategory.Media] = sets;

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
        expandedGroups: new Set<string>(),
        setExpandedGroups: () => undefined,
        handleItemSelect: () => undefined,
        publishRowOrder: () => undefined,
        handleAssetClick: () => undefined,
        handleAssetOpen: () => undefined,
        handleGroupFocus: () => undefined,
        showContextMenu: () => undefined,
        assetSets,
        rootAssetSets: assetSets,
        memberAssetIds: new Set(sets.flatMap(entry => entry.contents.cells.flatMap(cell => cell.assetIds))),
        expandedAssetSets: new Set<string>(),
        setExpandedAssetSets: () => undefined,
        assetSetNaming: {
            locales: new Map([["en", "English"], ["ja", "日本語"]]),
            editions: new Map([["main", "main"], ["demo", "Demo"]]),
            words: { language: "Language", edition: "Variant", deletedEdition: "Deleted variant" },
        },
        handleAssetSetSelect: () => undefined,
        showAssetSetContextMenu: () => undefined,
        showAssetSetValueContextMenu: () => undefined,
        handleImportToGroup: () => undefined,
        isFocused: () => false,
        isNarrowed: false,
        compactToolbar: true,
        setAssetsIconToolbarCenter: setToolbarCenter,
        mediaSupport: new Map(),
        unreadableCategories,
        handleConvertMedia: () => undefined,
        assetClaims: {},
        assetTransfers,
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

describe("AssetsIconView on a large library", () => {
    it("draws a screenful of tiles, not the library", () => {
        render(<Harness library={Array.from({ length: 2000 }, (_, index) => clip(index))} />);

        // Three columns at this width, a screenful of rows plus the overscan. What this rules out is
        // the shape the grid had before: a thumbnail in the DOM for every file in the project.
        const tiles = document.querySelectorAll("[data-tip]").length;
        expect(tiles).toBeGreaterThan(0);
        expect(document.querySelectorAll("[data-index]").length).toBeLessThan(30);
    });
});

describe("AssetsIconView while a file is arriving", () => {
    it("fills the tile of a file that is still coming in, at the share that has landed", () => {
        // The same band the list draws, in the view an author is just as likely to be looking at.
        const library = [clip(0), clip(1)];
        render(<Harness library={library} assetTransfers={{ [library[1].id]: 0.6 }} />);

        const bands = document.querySelectorAll("[data-asset-transfer]");
        expect(bands).toHaveLength(1);
        expect((bands[0] as HTMLElement).dataset.assetTransfer).toBe("60");
        expect((bands[0] as HTMLElement).style.width).toBe("60%");
    });

    it("draws no band when nothing is arriving", () => {
        render(<Harness library={[clip(0)]} />);

        expect(document.querySelectorAll("[data-asset-transfer]")).toHaveLength(0);
    });
});

/** A set of clips resolved against a library the way the panel resolves one. */
function clipSet(set: Omit<AssetSet, "type">, library: readonly Asset[]): ResolvedAssetSet {
    const typed: AssetSet = { ...set, type: AssetType.Audio };
    const candidates = library.map(entry => ({ id: entry.id, type: entry.type, tags: entry.tags }));
    const contents = resolveAssetSetContents(typed, candidates, [typed]);
    const problems = validateAssetSet(typed, [typed]);
    return {
        set: typed,
        category: AssetCategory.Media,
        contents,
        problems,
        incomplete: problems.length > 0 || contents.missing.length > 0 || contents.ambiguous.length > 0,
    };
}

describe("AssetsIconView inside a set", () => {
    // A clip whose Japanese take is the English one, by way of the fallback; and a clip whose
    // fallback has no file, so `main` has nothing to answer it.
    const library = [
        { ...clip(0), id: "line-en", name: "line_en", tags: ["set:s-line", "locale:en"] },
        { ...clip(1), id: "chime-demo", name: "chime_demo", tags: ["set:s-chime", "release:demo"] },
    ];
    const sets = [
        clipSet({ id: "s-line", name: "Line", filter: ["set:s-line"], axis: makeAssetSetAxis("locale", ["en", "ja"], "en") }, library),
        clipSet({ id: "s-chime", name: "Chime", filter: ["set:s-chime"], axis: makeAssetSetAxis("release", ["main", "demo"], "main") }, library),
    ];

    function walkInto(setId: string): void {
        const tile = document.querySelector(`[data-asset-set-id="${setId}"]`);
        expect(tile).not.toBeNull();
        fireEvent.click(tile as HTMLElement);
    }

    it("draws a value the fallback answers as the fallback's file, marked, and not as a hole", () => {
        render(<Harness library={library} sets={sets} />);
        walkInto("s-line");

        const inherited = document.querySelectorAll("[data-asset-set-inherited]");
        expect(inherited).toHaveLength(1);
        expect(inherited[0].textContent).toContain("line_en");
        expect(inherited[0].textContent).toContain("fallback");
        expect(inherited[0].textContent).toContain("Language: 日本語");
        expect(document.body.textContent).not.toContain("No file");
    });

    it("still draws a value nothing answers as a hole", () => {
        render(<Harness library={library} sets={sets} />);
        walkInto("s-chime");

        expect(document.querySelectorAll("[data-asset-set-inherited]")).toHaveLength(0);
        expect(document.body.textContent).toContain("No file");
    });
});

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
