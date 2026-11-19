import { useEffect, useMemo, useState } from "react";
import { transferShare } from "@shared/live/blobs";
import { cn } from "@/lib/utils/cn";
import { Services } from "@/lib/workspace/services/services";
import type { AssetsService, AssetTransfer } from "@/lib/workspace/services/core/AssetsService";
import { useWorkspace } from "../../context";

/** How far one file has got, by asset id. Between 0 and 1. */
export type AssetTransfers = Readonly<Record<string, number>>;

export const NO_ASSET_TRANSFERS: AssetTransfers = {};

/**
 * The files on their way into this library, and how far each has got.
 *
 * **The same on every machine**: a file being carried in through the Team server is a file arriving
 * everywhere the project is open - including on the screen of the author who dragged it in. Neither
 * side is watching an estimate.
 *
 * One subscription for the whole panel: the service reports progress in steps
 * rather than per slice, and a row that subscribed for itself would still be one subscription per
 * row of a library that has hundreds.
 */
export function useAssetTransfers(): AssetTransfers {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null),
        [context, isInitialized],
    );
    const [transfers, setTransfers] = useState<AssetTransfers>(NO_ASSET_TRANSFERS);

    useEffect(() => {
        if (!service) {
            setTransfers(NO_ASSET_TRANSFERS);
            return;
        }
        const read = (arriving: readonly AssetTransfer[]) => setTransfers(
            arriving.length === 0 ? NO_ASSET_TRANSFERS : shareOf(arriving),
        );
        // On the way in as well: a panel opened while a file is arriving has missed the step that
        // said it started.
        read(service.transfers());
        return service.getEvents().on("transfers", read);
    }, [service]);

    return transfers;
}

/** What a band is drawn from. The arithmetic is shared, so a band is never asked to draw past a row. */
function shareOf(arriving: readonly AssetTransfer[]): AssetTransfers {
    const out: Record<string, number> = {};
    for (const transfer of arriving) {
        out[transfer.assetId] = transferShare(transfer.bytes, transfer.total);
    }
    return out;
}

/**
 * What a row wears while its file is still arriving.
 *
 * **A band across the row rather than a bar beside it.** The row is where the file will be - its
 * name, its type, the folder it was dropped into - so filling that row says which file is coming and
 * how far it has got in one place, without a second list of transfers to read alongside the library.
 *
 * Drawn behind the row's own text: the caller gives the row `relative isolate` and this sits under
 * it, so a name stays legible over the band at any width.
 */
export function AssetTransferSweep({ share, className }: { share: number; className?: string }) {
    return (
        <span
            aria-hidden
            data-asset-transfer={Math.round(share * 100)}
            className={cn(
                "pointer-events-none absolute inset-y-0 left-0 -z-10 bg-primary/20 transition-[width] duration-200",
                className,
            )}
            style={{ width: `${Math.round(share * 100)}%` }}
        />
    );
}
