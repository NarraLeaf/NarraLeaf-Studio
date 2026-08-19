import { useState, useCallback, useRef } from 'react';

export interface UseMultiSelectionParams {
    onSelectionChange?: (selectedItems: Set<string>) => void;
}

/**
 * The library's marked rows.
 *
 * The hook holds no picture of the library. What a shift range covers is decided by the row order
 * the view publishes through {@link publishRowOrder} - see `assetRowOrder.ts` for why the range
 * cannot be computed from the asset and group records instead.
 */
export function useMultiSelection({ onSelectionChange }: UseMultiSelectionParams = {}) {
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [lastSelectedItem, setLastSelectedItem] = useState<string | null>(null);

    /**
     * What the view drew, last time it drew.
     *
     * A ref rather than state: nothing renders on it, and the only reader is the click that has just
     * happened, by which point the view has drawn and published.
     */
    const rowOrder = useRef<readonly string[]>([]);

    const isMultiSelectMode = selectedItems.size > 1;

    /** Handed the selection keys of the rows a view is drawing, in the order it draws them. */
    const publishRowOrder = useCallback((keys: readonly string[]) => {
        rowOrder.current = keys;
    }, []);

    const handleItemSelect = useCallback((itemId: string, isGroup: boolean, event: React.MouseEvent) => {
        const itemKey = isGroup ? `group:${itemId}` : `asset:${itemId}`;

        let newSelection: Set<string>;

        if (event.ctrlKey || event.metaKey) {
            newSelection = new Set(selectedItems);
            if (newSelection.has(itemKey)) {
                newSelection.delete(itemKey);
            } else {
                newSelection.add(itemKey);
            }
            setSelectedItems(newSelection);
            setLastSelectedItem(itemKey);
        } else if (event.shiftKey && lastSelectedItem) {
            const order = rowOrder.current;
            const anchor = order.indexOf(lastSelectedItem);
            const clicked = order.indexOf(itemKey);
            if (anchor === -1 || clicked === -1) {
                // The row the range would start from is not on screen any more: the folder holding
                // it was collapsed, a search narrowed it away, or the view was switched. There is no
                // range to draw between a row nobody can see and this one, so this is a plain click,
                // and it becomes the row the next range starts from.
                newSelection = new Set([itemKey]);
                setSelectedItems(newSelection);
                setLastSelectedItem(itemKey);
            } else {
                const [from, to] = anchor < clicked ? [anchor, clicked] : [clicked, anchor];
                // The anchor stays where it was, so widening and narrowing the range from the same
                // starting row keeps working the way every file list does it.
                newSelection = new Set(order.slice(from, to + 1));
                setSelectedItems(newSelection);
            }
        } else {
            newSelection = new Set([itemKey]);
            setSelectedItems(newSelection);
            setLastSelectedItem(itemKey);
        }

        if (onSelectionChange) {
            onSelectionChange(newSelection);
        }
    }, [lastSelectedItem, onSelectionChange, selectedItems]);

    const handleClearSelection = useCallback(() => {
        setSelectedItems(new Set());
        setLastSelectedItem(null);
        if (onSelectionChange) {
            onSelectionChange(new Set());
        }
    }, [onSelectionChange]);

    const handleSelectAll = useCallback((items: Array<{ id: string, isGroup: boolean }>) => {
        const allKeys = items.map(item => item.isGroup ? `group:${item.id}` : `asset:${item.id}`);
        const newSelection = new Set(allKeys);
        setSelectedItems(newSelection);
        setLastSelectedItem(null);
        if (onSelectionChange) {
            onSelectionChange(newSelection);
        }
    }, [onSelectionChange]);

    return {
        selectedItems,
        isMultiSelectMode,
        handleItemSelect,
        handleClearSelection,
        handleSelectAll,
        publishRowOrder,
        setSelectedItems, // Expose setter for external control if needed
    };
}
