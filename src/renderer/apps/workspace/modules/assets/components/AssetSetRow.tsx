import { Layers } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { ResolvedAssetSet } from "../state/useAssetSets";

/**
 * What a set says about itself, in both views.
 *
 * The list draws a set through the same tree row a folder is drawn with (`AssetsListView`), because
 * a set is a folder to the author browsing the library - it opens, it holds rows, it nests. Only
 * this summary and the tile below are its own.
 *
 * ## The warning colour
 *
 * A set that does not resolve everything it promises is drawn in the warning colour, and the count
 * beside it is the whole explanation - `6 of 8 variants` is the sentence, not a label saying
 * "incomplete". The colour is on the count and the icon rather than on the whole row: a row painted
 * end to end reads as selected, and the author needs to be able to select it to go and fix it.
 */

/** The count sentence: how much of what the set promises the library currently answers. */
export function useSetSummary(entry: ResolvedAssetSet): string {
    const { t, tn } = useTranslation();
    if (entry.problems.length > 0) {
        // A set whose declaration is incoherent has no coordinates, so a count would read "0 of 0" -
        // which says the library is missing something when the declaration is what is unfinished.
        return t("assets.sets.unfinished");
    }
    const total = entry.contents.cells.length;
    const resolved = total - entry.contents.missing.length - entry.contents.ambiguous.length;
    return resolved === total
        ? tn("assets.sets.variantCount", total)
        : t("assets.sets.variantsResolved", { resolved: String(resolved), total: String(total) });
}

export function AssetSetIconTile({
    entry,
    selected,
    caption,
    dragging,
    onSelect,
    onNavigate,
    onContextMenu,
    onDragStart,
    onDragEnd,
}: {
    entry: ResolvedAssetSet;
    selected: boolean;
    /** What this set is the variant for, when it is being drawn inside another one. */
    caption?: string;
    /** This tile is the one being dragged. */
    dragging?: boolean;
    onSelect: (event: React.MouseEvent) => void;
    /** Walk into it. The same gesture a folder tile answers to, for the same reason. */
    onNavigate?: () => void;
    onContextMenu: (event: React.MouseEvent) => void;
    /** Drag it to another folder. Absent for a set drawn inside another one, which moves with it. */
    onDragStart?: (event: React.DragEvent) => void;
    onDragEnd?: () => void;
}) {
    const summary = useSetSummary(entry);
    return (
        <div
            data-asset-set-id={entry.set.id}
            draggable={!!onDragStart}
            className={cn(
                "group relative flex flex-col rounded-md border p-2 cursor-pointer hover:bg-fill",
                onDragStart && "nl-drag-source",
                selected ? "border-primary bg-primary/10" : entry.incomplete ? "border-warning/40" : "border-edge",
                dragging && "opacity-50",
            )}
            onClick={event => {
                onSelect(event);
                if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
                    onNavigate?.();
                }
            }}
            onContextMenu={onContextMenu}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
        >
            <div className="flex-1 flex items-center justify-center">
                <Layers className={cn("w-8 h-8", entry.incomplete ? "text-warning" : "text-primary")} />
            </div>
            <p className="mt-2 text-xs truncate" data-tip={entry.set.name}>{entry.set.name}</p>
            <p className={cn("text-2xs truncate", entry.incomplete ? "text-warning" : "text-fg-subtle")}>
                {summary}
            </p>
            {caption && <p className="truncate text-2xs text-fg-subtle" data-tip={caption}>{caption}</p>}
        </div>
    );
}
