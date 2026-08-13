import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetSource } from "@/lib/workspace/services/assets/types";
import type { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { useWorkspace } from "../../../context";

/**
 * A remote asset's provenance, and the one verb that belongs to it.
 *
 * A remote asset is a *pinned reference*: the bytes in the project are a snapshot of what the URL
 * served when it was taken, versioned like any other asset content. So the two things worth showing
 * are the address and when the snapshot is from — and the action worth offering is asking the server
 * whether it still stands.
 *
 * Renders nothing for a local asset, which is why it can sit in the common field list.
 */
export function AssetSourceSection({ asset }: { asset: Asset }) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const freeze = useFreezeGuard();
    const [busy, setBusy] = useState(false);
    const [pinned, setPinned] = useState<boolean | null>(null);

    const remote = asset.source === AssetSource.Remote
        ? (asset as Asset<AssetType, AssetSource.Remote>)
        : null;
    const assetId = asset.id;

    // "Pinned but never fetched" is a real state — every record written before pinning existed is in
    // it — and it cannot be read off the record, so it is asked of the disk.
    useEffect(() => {
        if (!context || !remote) {
            return;
        }
        let live = true;
        const assetsService = context.services.get<AssetsService>(Services.Assets);
        void assetsService.hasRemoteSnapshot(assetId).then(exists => {
            if (live) {
                setPinned(exists);
            }
        });
        return () => {
            live = false;
        };
    }, [assetId, asset.hash, context, remote]);

    const handleRefresh = useCallback(async () => {
        if (!context || !remote || busy) {
            return;
        }
        setBusy(true);
        try {
            const assetsService = context.services.get<AssetsService>(Services.Assets);
            const result = await assetsService.refreshRemoteAsset(remote);
            if (!result.success) {
                context.services.get<UIService>(Services.UI).showAlert(
                    t("properties.asset.remote.refreshFailedTitle"),
                    result.error || t("assets.unknownError"),
                );
            }
        } finally {
            setBusy(false);
        }
    }, [busy, context, remote, t]);

    if (!remote) {
        return null;
    }

    return (
        <div className="flex flex-col gap-2">
            <dl className="flex flex-col gap-1.5">
                <SourceRow label={t("properties.asset.remote.url")} value={remote.meta.url} mono />
                <SourceRow
                    label={t("properties.asset.remote.fetched")}
                    // `pinned === false` is the record that has a URL and no bytes. Saying so is the
                    // whole reason the state is looked up: without it the row reads as a date that
                    // simply has not loaded yet.
                    value={pinned === false
                        ? t("properties.asset.remote.neverFetched")
                        : formatFetchedAt(remote.meta.fetchedAt)}
                />
            </dl>
            <button
                type="button"
                onClick={handleRefresh}
                {...freeze.writes(busy || !context)}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-edge bg-surface-raised text-xs text-fg-muted hover:bg-fill transition-colors disabled:opacity-50 cursor-default"
            >
                <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} />
                <span>{t("properties.asset.remote.refresh")}</span>
            </button>
        </div>
    );
}

function SourceRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex items-baseline justify-between gap-2">
            <dt className="shrink-0 text-2xs text-fg-subtle">{label}</dt>
            <dd className={`min-w-0 truncate text-2xs text-fg-muted ${mono ? "font-mono" : ""}`} data-tip={value}>
                {value}
            </dd>
        </div>
    );
}

/** The stored ISO instant in the reader's own locale, or the raw value if it will not parse. */
function formatFetchedAt(fetchedAt: string | undefined): string {
    if (!fetchedAt) {
        return "-";
    }
    const date = new Date(fetchedAt);
    return Number.isNaN(date.getTime()) ? fetchedAt : date.toLocaleString();
}
