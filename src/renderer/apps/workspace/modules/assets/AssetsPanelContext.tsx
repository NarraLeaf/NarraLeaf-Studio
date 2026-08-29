import { AssetCategory } from '@/lib/workspace/services/assets/assetTypes';
import { Asset, AssetGroup } from '@/lib/workspace/services/assets/types';
import type { MediaAssetSupportRecord } from '@/lib/workspace/services/media/mediaAssetSupport';
import { createContext, useContext } from 'react';
import type { AssetSetAxisNaming } from '@shared/types/assetSetLabels';
import type { ResolvedAssetSet } from './state/useAssetSets';
import { ClipboardState } from './state/useClipboard';
import { DraggedAssetSetState, DraggedItemState } from './state/useDragAndDrop';
import type { AssetClaims, AssetTransfers } from './assetLiveSession';

/** Breadcrumb shown in the panel toolbar center when the assets panel uses a compact (bottom) toolbar. */
export interface AssetsIconViewToolbarCenter {
    title: string;
    onBack: () => void;
}

/**
 * The set a jump asked this panel to put on screen.
 *
 * The panel opens the section, the folders and the enclosing sets itself, because those are its own
 * state. What the views take from here is the last step, which only they can do: scrolling the row
 * into view and marking it, and - for the grid, which walks into one level at a time rather than
 * opening them in place - which sets to step into first.
 */
export interface AssetSetRevealState {
    setId: string;
    /** The sets the grid steps into before the target is a tile in it. Outermost first, target excluded. */
    ancestorSetIds: readonly string[];
    /** Bumped per request, so asking for the same set twice marks it twice. */
    nonce: number;
}

interface AssetsPanelContextType {
    /**
     * Asset id to the account editing that record in a live session, for every record somebody else
     * has open. Empty outside one.
     *
     * Here rather than in a context of its own so that one subscription serves every row: a session
     * publishes on every operation anybody in the room applies.
     */
    assetClaims: AssetClaims;
    /**
     * How far each file that is still arriving has got, by asset id. Empty when none is.
     *
     * Alongside the claims and for the same reason: the service reports progress in steps, and a row
     * that subscribed for itself would be one subscription per row of a library that has hundreds.
     */
    assetTransfers: AssetTransfers;
    /**
     * Keyed by sidebar section. The assets inside still carry their own `type`; what a section, a
     * folder and a drop target belong to is the category.
     */
    assets: Record<AssetCategory, Asset[]>;
    groups: Record<AssetCategory, AssetGroup[]>;
    /**
     * The project's asset sets, already measured against the library above, filed under the section
     * each one's type belongs to.
     *
     * Not filtered by the search box. A set is not a file and does not match on a file name; what it
     * would match on is the tags it declares, and a set silently disappearing while an author narrows
     * the library is how the row they were about to fix stops being findable.
     */
    assetSets: Record<AssetCategory, ResolvedAssetSet[]>;
    /** Only the sets that hang under nothing: what a section lists at its root. */
    rootAssetSets: Record<AssetCategory, ResolvedAssetSet[]>;
    /** Files some set answers with. Listed inside their set, and not again beside it. */
    memberAssetIds: ReadonlySet<string>;
    filteredAssets: Record<AssetCategory, Asset[]>;
    filteredGroups: Record<AssetCategory, AssetGroup[]>;
    /**
     * Groups whose own name matched the search. `filteredGroups` also carries the ancestors needed
     * to draw a tree; those are scaffolding, and a flat result grid must not present them as hits.
     */
    matchedGroupIds: ReadonlySet<string>;

    // State
    selectedItems: Set<string>;
    focusedItemId: string | null;
    draggedItem?: DraggedItemState | null;
    /** Non-null while a set's row is being dragged to another folder. */
    draggedAssetSet?: DraggedAssetSetState | null;
    dropTargetId?: string | null;
    clipboard: ClipboardState | null;
    isMultiSelectMode: boolean;
    expandedGroups: Set<string>;
    setExpandedGroups: React.Dispatch<React.SetStateAction<Set<string>>>;
    /** Sets drawn open, listing one row per variant. Kept apart from folders: different ids, different rows. */
    expandedAssetSets: Set<string>;
    setExpandedAssetSets: React.Dispatch<React.SetStateAction<Set<string>>>;
    /**
     * Non-null while a jump is landing on a set's row. See {@link AssetSetRevealState}.
     *
     * Optional like the drag fields above: a surface that draws the library without a panel around it
     * is never jumped into, and marking a row is the one thing it has nothing to say about.
     */
    assetSetReveal?: AssetSetRevealState | null;
    /** What lets a variant row name its axis in the project's words instead of in tags. */
    assetSetNaming: AssetSetAxisNaming;

    // Handlers
    handleItemSelect: (itemId: string, isGroup: boolean, event: React.MouseEvent) => void;
    /**
     * The selection keys of the rows this view is drawing, in the order it draws them.
     *
     * A shift range is a slice of this list. The view is the only thing that knows what is on
     * screen - which section is open, which folder is walked into, which set is stepped inside - and
     * a range sliced out of the library records instead marks rows the author cannot see. Published
     * from a layout effect, and cleared when the view goes away.
     */
    publishRowOrder: (keys: readonly string[]) => void;
    handleAssetClick: (asset: Asset, isMultiSelectMode: boolean) => void;
    /** Double click: the same asset, in a tab the next click will not take over. */
    handleAssetOpen: (asset: Asset) => void;
    handleGroupFocus: (groupId: string) => void;
    /** Puts a set in the properties panel, which is where its axes are edited. */
    handleAssetSetSelect: (entry: ResolvedAssetSet) => void;
    showAssetSetContextMenu: (event: React.MouseEvent, entry: ResolvedAssetSet) => void;
    /**
     * The menu on one value of a set, which is where a sub-set is made.
     *
     * A value is the only place the gesture makes sense: a sub-set hangs at a value, and a set has
     * several of them.
     */
    showAssetSetValueContextMenu: (event: React.MouseEvent, entry: ResolvedAssetSet, value: string) => void;
    /**
     * The library's own menu for a row.
     *
     * `assetSetValue` is passed by a row drawn inside a set: the file's own commands are the same
     * ones it has anywhere else, and the value only adds the sub-set that hangs there.
     */
    showContextMenu: (
        e: React.MouseEvent,
        category: AssetCategory,
        item: Asset | AssetGroup | null,
        isGroup: boolean,
        assetSetValue?: { setId: string; value: string },
    ) => void;
    handleDragStart?: (e: React.DragEvent, category: AssetCategory, item: Asset | AssetGroup, isGroup: boolean) => void;
    /** Starts dragging a set's row. Folders and section roots are the only things that answer to it. */
    handleAssetSetDragStart?: (e: React.DragEvent, category: AssetCategory, setId: string) => void;
    handleDragEnd?: () => void;
    handleDragOverItem?: (e: React.DragEvent, targetId: string) => void;
    handleDropOnItem?: (e: React.DragEvent, targetCategory: AssetCategory, targetGroup: AssetGroup | null) => void;
    handleImportToGroup: (category: AssetCategory, groupId?: string, files?: FileList, dataTransfer?: DataTransfer) => void;
    isFocused: (id: string) => boolean;

    /**
     * True when a search or a filter is currently narrowing `filteredAssets` / `filteredGroups`.
     *
     * The views read this to stop hiding hits behind folders: a match filed inside a collapsed group
     * has to be on screen, so the tree force-opens and the grid goes flat while this is set.
     */
    isNarrowed: boolean;

    /** True when the panel uses the compact toolbar (e.g. bottom dock). Icon view can merge group navigation there. */
    compactToolbar: boolean;
    /** Takes an updater as well, so a view can leave the breadcrumb alone when nothing about it moved. */
    setAssetsIconToolbarCenter: React.Dispatch<React.SetStateAction<AssetsIconViewToolbarCenter | null>>;

    /**
     * Assets that will not play as they are, keyed by asset id.
     *
     * Only assets with something wrong appear, so a lookup that misses means "nothing to say" -
     * which is also the honest answer before the first scan has finished and on a host that cannot
     * check at all. Keyed by id rather than by `Asset`, because the library edits its records in
     * place and a reference to one never changes.
     */
    mediaSupport: ReadonlyMap<string, MediaAssetSupportRecord>;
    /** Opens the conversion for one asset. Refused for anything the scan did not mark. */
    handleConvertMedia: (asset: Asset) => void;
}

export const AssetsPanelContext = createContext<AssetsPanelContextType | null>(null);

export function useAssetsPanelContext() {
    const context = useContext(AssetsPanelContext);
    if (!context) {
        throw new Error('useAssetsPanelContext must be used within an AssetsPanelContextProvider');
    }
    return context;
}
