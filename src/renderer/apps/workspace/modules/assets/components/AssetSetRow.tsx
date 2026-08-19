import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { formatAssetSetCoordinateReading, readAssetSetCoordinate } from "@shared/types/assetSetLabels";
import type { AssetSetAxisNaming } from "@shared/types/assetSetLabels";
import type { AssetSetCell } from "@shared/types/assetSet";
import type { Asset } from "@/lib/workspace/services/assets/types";
import type { ResolvedAssetSet } from "../state/useAssetSets";
import { AssetThumbnail } from "./AssetThumbnail";

/**
 * How a set reads in the library, in both views.
 *
 * One component pair rather than a row and a tile written separately, because what a set says is the
 * same in both: its name, how much of what it promises the library answers, and whether that is all
 * of it. Only the geometry differs.
 *
 * ## In the list it is a folder, because that is what it is to the author
 *
 * A set is the name a reference points at, and the files under it are what that name resolves to.
 * Drawn as a single row it said only how many variants there are, which left the author no way to
 * see what they were without selecting the set and reading the inspector. It opens instead, like the
 * folders above and below it, and each row inside is one variant: the file on the left, and on the
 * right what it is the variant *for*, in the project's own words rather than in tags.
 *
 * The region carries a tint of its own for the length of the set. A set is not a folder - its
 * members are also filed in whatever folder they were imported into, and they stay listed there -
 * so the band is what says "these rows are one thing being shown twice", and it ends where the set
 * ends.
 *
 * ## The warning colour
 *
 * A set that does not resolve everything it promises is drawn in the warning colour, and the count
 * beside it is the whole explanation - `6 of 8 variants` is the sentence, not a label saying
 * "incomplete". The colour is on the count and the icon rather than on the whole row: a row painted
 * end to end reads as selected, and the author needs to be able to select it to go and fix it.
 */

/** The count sentence: how much of what the set promises the library currently answers. */
function useSetSummary(entry: ResolvedAssetSet): string {
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

export function AssetSetListRow({
    entry,
    level,
    selected,
    focused,
    open,
    naming,
    assetsById,
    onSelect,
    onToggle,
    onOpenMember,
    onContextMenu,
}: {
    entry: ResolvedAssetSet;
    level: number;
    selected: boolean;
    focused: boolean;
    open: boolean;
    naming: AssetSetAxisNaming;
    assetsById: ReadonlyMap<string, Asset>;
    onSelect: (event: React.MouseEvent) => void;
    onToggle: () => void;
    onOpenMember: (asset: Asset) => void;
    onContextMenu: (event: React.MouseEvent) => void;
}) {
    const { t } = useTranslation();
    const summary = useSetSummary(entry);
    const cells = entry.contents.cells;

    return (
        <div className={cn("bg-fill-subtle/50", open && "border-y border-edge-subtle")}>
            <div
                data-asset-set-id={entry.set.id}
                className={cn(
                    "flex items-center gap-2 px-3 py-1.5 cursor-default hover:bg-fill",
                    selected && "bg-primary/20 border-l-2 border-primary",
                    focused && !selected && "bg-fill",
                )}
                style={{ paddingLeft: `${20 + level * 12}px` }}
                onClick={event => {
                    onSelect(event);
                    onToggle();
                }}
                onContextMenu={onContextMenu}
            >
                {/* No button of its own: the whole header opens the set, the same gesture a folder
                    row answers to, and a second target that does the same thing is one more thing to
                    aim at. */}
                {cells.length > 0
                    ? open
                        ? <ChevronDown className="h-3 w-3 shrink-0 text-fg-subtle" />
                        : <ChevronRight className="h-3 w-3 shrink-0 text-fg-subtle" />
                    : <span className="w-3 shrink-0" />}
                <Layers className={cn("w-4 h-4 shrink-0", entry.incomplete ? "text-warning" : "text-primary")} />
                <span className="text-sm truncate">{entry.set.name}</span>
                <span className={cn("text-xs shrink-0", entry.incomplete ? "text-warning" : "text-fg-subtle")}>
                    {summary}
                </span>
            </div>

            {open && cells.map(cell => (
                <AssetSetMemberRow
                    key={cell.label}
                    entry={entry}
                    cell={cell}
                    level={level}
                    naming={naming}
                    asset={cell.assetIds.length === 1 ? assetsById.get(cell.assetIds[0]) ?? null : null}
                    missingLabel={t("assets.sets.inspector.variantMissing")}
                    ambiguousLabel={cell.assetIds.length > 1
                        ? t("assets.sets.inspector.variantAmbiguous", { count: String(cell.assetIds.length) })
                        : null}
                    onOpenMember={onOpenMember}
                />
            ))}
        </div>
    );
}

/**
 * One variant of a set: the file, and what it is the variant for.
 *
 * The coordinate sits on the right rather than under the name, so the column of files reads as a
 * column of files. A row with no file keeps its place in that column - the coordinate is the reason
 * the row exists, and dropping it would leave a set that is missing something looking complete.
 */
function AssetSetMemberRow({
    entry,
    cell,
    level,
    naming,
    asset,
    missingLabel,
    ambiguousLabel,
    onOpenMember,
}: {
    entry: ResolvedAssetSet;
    cell: AssetSetCell;
    level: number;
    naming: AssetSetAxisNaming;
    asset: Asset | null;
    missingLabel: string;
    ambiguousLabel: string | null;
    onOpenMember: (asset: Asset) => void;
}) {
    const coordinate = formatAssetSetCoordinateReading(readAssetSetCoordinate(entry.set, cell.coordinate, naming));
    return (
        <div
            data-asset-set-member={cell.label}
            className={cn(
                "flex items-center gap-2 px-3 py-1 cursor-default hover:bg-fill",
                !asset && "text-warning",
            )}
            style={{ paddingLeft: `${32 + level * 12}px` }}
            onClick={() => { if (asset) onOpenMember(asset); }}
        >
            {asset
                ? <AssetThumbnail asset={asset} className="h-4 w-5 shrink-0 rounded-sm" />
                : <span className="h-4 w-5 shrink-0" />}
            <span className="min-w-0 flex-1 truncate text-xs">
                {asset ? asset.name : ambiguousLabel ?? missingLabel}
            </span>
            <span className="shrink-0 truncate text-2xs text-fg-subtle">{coordinate}</span>
        </div>
    );
}

export function AssetSetIconTile({
    entry,
    selected,
    onSelect,
    onContextMenu,
}: {
    entry: ResolvedAssetSet;
    selected: boolean;
    onSelect: (event: React.MouseEvent) => void;
    onContextMenu: (event: React.MouseEvent) => void;
}) {
    const summary = useSetSummary(entry);
    return (
        <div
            data-asset-set-id={entry.set.id}
            className={cn(
                "group relative flex flex-col rounded-md border p-2 cursor-default hover:bg-fill",
                selected ? "border-primary bg-primary/10" : entry.incomplete ? "border-warning/40" : "border-edge",
            )}
            onClick={onSelect}
            onContextMenu={onContextMenu}
        >
            <div className="flex-1 flex items-center justify-center">
                <Layers className={cn("w-8 h-8", entry.incomplete ? "text-warning" : "text-primary")} />
            </div>
            <p className="mt-2 text-xs truncate" data-tip={entry.set.name}>{entry.set.name}</p>
            <p className={cn("text-2xs truncate", entry.incomplete ? "text-warning" : "text-fg-subtle")}>
                {summary}
            </p>
        </div>
    );
}
