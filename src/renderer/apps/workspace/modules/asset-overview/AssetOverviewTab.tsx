import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { EditorTabComponentProps } from "@/lib/workspace/services/ui/types";
import { Services } from "@/lib/workspace/services/services";
import { ReferenceService } from "@/lib/workspace/services/references/ReferenceService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSource, type Asset } from "@/lib/workspace/services/assets/types";
import { Button } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "../../context";
import { DashboardSection, StatTile } from "../dashboard/DashboardPrimitives";
import { AssetReferencesSection } from "../properties/components/AssetReferencesSection";
import { useBadgeImageUrl } from "../story/scene-editor/storyBadgeImageCache";
import {
    byteShare,
    formatByteSize,
    type AssetOverviewEntry,
    type AssetOverviewSummary,
} from "./assetOverviewModel";
import { assetContentRelativePath, computeAssetOverviewSnapshot } from "./assetOverviewSnapshot";

/**
 * The asset overview: one page that answers "what is in this library and what uses it".
 *
 * Read-only by construction. The page derives everything from `AssetsService` and
 * `ReferenceService` and writes nothing back - not to the documents, and above all not to the
 * build. The sidebar keeps its job as the drag-in surface; this is the reading surface.
 *
 * It used to carry a packaging read-out as well (overhaul plan §5.5's "predict before you trim").
 * That section is no longer rendered - see the note where it used to sit - though the summary still
 * carries the figures.
 */
export function AssetOverviewTab({ active }: EditorTabComponentProps) {
    const { context } = useWorkspace();
    const { t, tn, formatNumber } = useTranslation();

    const [snapshot, setSnapshot] = useState<AssetOverviewSummary | null>(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
    const requestRef = useRef(0);
    /**
     * A snapshot builds the reference index and flushes its pending rebuilds, and both of those
     * *announce a change* — so a listener that recomputed on every announcement would recompute on
     * its own footsteps forever. Announcements arriving mid-run are recorded instead of acted on,
     * and settle into at most one further run: the second pass finds nothing left to flush, so it
     * announces nothing. Recording rather than dropping is what keeps a real edit landing during
     * the directory walk from being lost.
     */
    const runningRef = useRef(false);
    const changedWhileRunningRef = useRef(false);
    const refreshRef = useRef<() => void>(() => {});

    const refresh = useCallback(() => {
        if (!context) {
            return;
        }
        const requestId = ++requestRef.current;
        runningRef.current = true;
        changedWhileRunningRef.current = false;
        setLoading(true);
        setFailed(false);
        void computeAssetOverviewSnapshot(context)
            .then(next => {
                if (requestRef.current === requestId) {
                    setSnapshot(next);
                    setLoading(false);
                }
            })
            .catch(error => {
                console.warn("[AssetOverview] Failed to compute the asset snapshot", error);
                if (requestRef.current === requestId) {
                    setFailed(true);
                    setLoading(false);
                }
            })
            .finally(() => {
                if (requestRef.current !== requestId) {
                    return;
                }
                runningRef.current = false;
                if (changedWhileRunningRef.current) {
                    changedWhileRunningRef.current = false;
                    refreshRef.current();
                }
            });
    }, [context]);
    refreshRef.current = refresh;

    // The snapshot stats every file under `assets/`, so it only runs while the tab is on screen -
    // editor tabs are keep-alive, and a hidden page must not pay for a walk nobody is reading.
    useEffect(() => {
        if (active) {
            refresh();
        }
    }, [active, refresh]);

    // An edit that adds or removes a reference changes which assets are orphans, which is the
    // reading most likely to be acted on. Follow the index rather than leaving a stale answer up.
    useEffect(() => {
        if (!context || !active) {
            return;
        }
        const referenceService = context.services.get<ReferenceService>(Services.Reference);
        return referenceService.onIndexChanged(() => {
            if (runningRef.current) {
                changedWhileRunningRef.current = true;
                return;
            }
            refreshRef.current();
        });
    }, [context, active]);

    const selected = useMemo(
        () => snapshot?.entries.find(entry => entry.asset.id === selectedAssetId) ?? null,
        [snapshot, selectedAssetId],
    );

    const unreferenced = useMemo(
        () =>
            (snapshot?.entries ?? [])
                .filter(entry => !entry.referenced)
                .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0) || a.asset.name.localeCompare(b.asset.name)),
        [snapshot],
    );

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface">
            <div className="flex shrink-0 items-center gap-3 border-b border-edge px-3 py-1.5">
                {/* No count/size readout here: the Library section below opens with exactly these two
                    numbers, and the page is short enough that printing them twice reads as two
                    different figures rather than one. */}
                <span className="truncate text-xs font-medium text-fg">{t("assets.overview.tabTitle")}</span>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    <button
                        type="button"
                        onClick={refresh}
                        disabled={loading}
                        title={t("common.refresh")}
                        className="rounded-md p-1 text-fg-muted hover:bg-fill"
                    >
                        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    </button>
                </div>
            </div>

            <div className="flex min-h-0 flex-1">
                <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
                    <div className="mx-auto flex max-w-3xl flex-col gap-7 px-6 py-5">
                        {failed && (
                            <div className="flex items-center justify-between gap-3 rounded-md border border-edge bg-fill-subtle px-3 py-2">
                                <span className="text-xs text-fg-muted">{t("assets.overview.failed")}</span>
                                <Button size="sm" variant="secondary" onClick={refresh}>
                                    {t("assets.overview.retry")}
                                </Button>
                            </div>
                        )}

                        {!snapshot ? (
                            <p className="text-xs text-fg-subtle">
                                {failed ? t("assets.overview.failed") : t("assets.overview.loading")}
                            </p>
                        ) : snapshot.total.count === 0 ? (
                            <p className="text-xs text-fg-subtle">{t("assets.overview.empty")}</p>
                        ) : (
                            <>
                                <DashboardSection title={t("assets.overview.section.library")}>
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                        <StatTile
                                            label={t("assets.overview.stat.total")}
                                            value={formatNumber(snapshot.total.count)}
                                            hint={formatByteSize(snapshot.total.bytes)}
                                        />
                                        <StatTile
                                            label={t("assets.overview.stat.referenced")}
                                            value={formatNumber(snapshot.referenced.count)}
                                            hint={formatByteSize(snapshot.referenced.bytes)}
                                        />
                                        <StatTile
                                            label={t("assets.overview.stat.unreferenced")}
                                            value={formatNumber(snapshot.orphan.count)}
                                            hint={formatByteSize(snapshot.orphan.bytes)}
                                        />
                                    </div>
                                </DashboardSection>

                                {/* The packaging read-out ("what ships today" vs "if trimmed") used to sit
                                    here. It is not rendered any more: it predicted a saving no build acts
                                    on, its "actual" figure restated the Library total, and Studio's users
                                    do not make decisions on a megabyte. `AssetOverviewSummary.packaging`
                                    is still computed — whether the trimming feature itself lives on is a
                                    separate call (overhaul plan §5.5), and this page is not the place to
                                    prejudge it. */}

                                <DashboardSection title={t("assets.overview.section.byType")}>
                                    <ul className="flex flex-col gap-2.5">
                                        {snapshot.byType.map(bucket => (
                                            <li key={bucket.type} className="flex flex-col gap-1">
                                                <div className="flex items-baseline justify-between gap-3">
                                                    <span className="min-w-0 truncate text-xs text-fg-muted">
                                                        {t(`assets.types.${bucket.type}` as `assets.types.${AssetType}`)}
                                                    </span>
                                                    <span className="shrink-0 text-2xs tabular-nums text-fg-subtle">
                                                        {tn("assets.itemCount", bucket.count)}
                                                        {" · "}
                                                        {formatByteSize(bucket.bytes)}
                                                    </span>
                                                </div>
                                                <div className="h-1.5 overflow-hidden rounded-full bg-fill">
                                                    <div
                                                        className="h-full bg-primary"
                                                        style={{ width: `${byteShare(bucket.bytes, snapshot.total.bytes)}%` }}
                                                    />
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </DashboardSection>

                                <DashboardSection title={t("assets.overview.section.largest")}>
                                    <ul className="flex flex-col gap-0.5">
                                        {snapshot.largest.map(entry => (
                                            <AssetRow
                                                key={entry.asset.id}
                                                entry={entry}
                                                selected={entry.asset.id === selectedAssetId}
                                                onSelect={setSelectedAssetId}
                                            />
                                        ))}
                                    </ul>
                                </DashboardSection>

                                {unreferenced.length > 0 && (
                                    <DashboardSection title={t("assets.overview.section.unreferenced")}>
                                        <ul className="flex flex-col gap-0.5">
                                            {unreferenced.map(entry => (
                                                <AssetRow
                                                    key={entry.asset.id}
                                                    entry={entry}
                                                    selected={entry.asset.id === selectedAssetId}
                                                    onSelect={setSelectedAssetId}
                                                />
                                            ))}
                                        </ul>
                                    </DashboardSection>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {selected && (
                    <aside className="w-72 shrink-0 overflow-y-auto border-l border-edge px-3 py-4">
                        <AssetDetail entry={selected} />
                    </aside>
                )}
            </div>
        </div>
    );
}

function AssetRow({
    entry,
    selected,
    onSelect,
}: {
    entry: AssetOverviewEntry;
    selected: boolean;
    onSelect: (assetId: string) => void;
}) {
    const { t, tn } = useTranslation();

    return (
        <li>
            <button
                type="button"
                onClick={() => onSelect(entry.asset.id)}
                className={cn(
                    "flex w-full items-baseline gap-3 rounded-md px-2 py-1 text-left transition-colors",
                    selected ? "bg-fill" : "hover:bg-surface-raised",
                )}
            >
                <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{entry.asset.name}</span>
                <span className="shrink-0 text-2xs text-fg-subtle">
                    {t(`assets.types.${entry.asset.type}` as `assets.types.${AssetType}`)}
                </span>
                <span className="shrink-0 text-2xs tabular-nums text-fg-subtle">
                    {tn("assets.overview.uses", entry.referenceCount)}
                </span>
                <span className="w-16 shrink-0 text-right text-2xs tabular-nums text-fg-subtle">
                    {formatByteSize(entry.bytes)}
                </span>
            </button>
        </li>
    );
}

/**
 * One asset, in full: what it is, where its bytes are, and - through the same section the
 * properties panel mounts - every place that points at it, each row jumping to the site.
 */
function AssetDetail({ entry }: { entry: AssetOverviewEntry }) {
    const { t } = useTranslation();
    const asset = entry.asset;
    const relativePath = assetContentRelativePath(asset);
    const previewUrl = useBadgeImageUrl(
        asset.type === AssetType.Image ? { kind: "project", asset: asset as Asset<AssetType.Image> } : null,
    );

    return (
        <div className="flex flex-col gap-3">
            <div className="min-w-0">
                <p className="truncate text-xs font-medium text-fg" title={asset.name}>
                    {asset.name}
                </p>
                <p className="truncate text-2xs text-fg-subtle">
                    {t(`assets.types.${asset.type}` as `assets.types.${AssetType}`)}
                </p>
            </div>

            {previewUrl && (
                <img
                    src={previewUrl}
                    alt=""
                    className="max-h-40 w-full rounded-md border border-edge bg-surface-sunken object-contain"
                />
            )}

            <dl className="flex flex-col gap-1.5">
                <DetailRow label={t("properties.asset.info.size")} value={formatByteSize(entry.bytes)} />
                <DetailRow
                    label={t("properties.asset.info.hash")}
                    value={asset.hash}
                    mono
                />
                <DetailRow
                    label={t("assets.overview.detail.path")}
                    value={asset.source === AssetSource.Remote
                        ? (asset as Asset<AssetType, AssetSource.Remote>).meta.url
                        : relativePath ?? "—"}
                    mono
                />
            </dl>

            <AssetReferencesSection assetId={asset.id} />
        </div>
    );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex items-baseline justify-between gap-2">
            <dt className="shrink-0 text-2xs text-fg-subtle">{label}</dt>
            <dd
                className={cn("min-w-0 truncate text-2xs text-fg-muted", mono && "font-mono")}
                title={value}
            >
                {value}
            </dd>
        </div>
    );
}
