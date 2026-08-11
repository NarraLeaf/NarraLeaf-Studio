import { useMemo, useState } from "react";
import { ChevronDown, Copy } from "lucide-react";
import { AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSource, type Asset } from "@/lib/workspace/services/assets/types";
import { Button } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { DashboardSection, StatTile } from "../dashboard/DashboardPrimitives";
import { AssetReferencesSection } from "../properties/components/AssetReferencesSection";
import { AssetThumbnail } from "../assets/components/AssetThumbnail";
import { useBadgeImageUrl } from "../story/scene-editor/storyBadgeImageCache";
import {
    byteShare,
    formatByteSize,
    type AssetOverviewEntry,
    type AssetOverviewSummary,
} from "./assetOverviewModel";
import { assetContentRelativePath } from "./assetOverviewSnapshot";

/**
 * The asset overview: what is in this library and what uses it.
 *
 * Read-only by construction — everything is derived from `AssetsService` and `ReferenceService`, and
 * nothing is written back, least of all to the build.
 *
 * It used to be a full-page editor tab, opened from a sidebar button and a palette command. That
 * made the library two places: a sidebar you drag out of and a page you read, neither of which
 * showed what the other did. It is now a third view of the assets panel, sitting beside List and
 * Icon under the same toggle — which also means it has to read in a 350px column, so the layout is
 * width-agnostic throughout (no `sm:` breakpoints: those measure the *window*, and a narrow panel in
 * a wide window would take the wide layout).
 */
export function AssetOverviewView({
    snapshot,
    failed,
    refresh,
}: {
    snapshot: AssetOverviewSummary | null;
    failed: boolean;
    refresh: () => void;
}) {
    const { t, tn, formatNumber } = useTranslation();
    const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

    const unreferenced = useMemo(
        () =>
            (snapshot?.entries ?? [])
                .filter(entry => !entry.referenced)
                .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0) || a.asset.name.localeCompare(b.asset.name)),
        [snapshot],
    );

    if (!snapshot) {
        return (
            <div className="px-3 py-3">
                {failed ? (
                    <div className="flex items-center justify-between gap-3 rounded-md border border-edge bg-fill-subtle px-3 py-2">
                        <span className="text-xs text-fg-muted">{t("assets.overview.failed")}</span>
                        <Button size="sm" variant="secondary" onClick={refresh}>
                            {t("assets.overview.retry")}
                        </Button>
                    </div>
                ) : (
                    <p className="text-xs text-fg-subtle">{t("assets.overview.loading")}</p>
                )}
            </div>
        );
    }

    if (snapshot.total.count === 0) {
        return null;
    }

    const toggle = (assetId: string) => setSelectedAssetId(prev => (prev === assetId ? null : assetId));

    return (
        <div className="flex flex-col gap-5 px-3 py-3">
            <DashboardSection title={t("assets.overview.section.library")}>
                {/* Three numbers, one row, at any width. The library total is printed here and
                    nowhere else — it used to appear again in the tab header, where two copies of one
                    figure read as two different figures. */}
                <div className="grid grid-cols-3 gap-2">
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

            <DashboardSection title={t("assets.overview.section.byCategory")}>
                <ul className="flex flex-col gap-2.5">
                    {snapshot.byCategory.map(bucket => (
                        <li key={bucket.category} className="flex flex-col gap-1">
                            <div className="flex items-baseline justify-between gap-3">
                                <span className="min-w-0 truncate text-xs text-fg-muted">
                                    {t(`assets.categories.${bucket.category}` as `assets.categories.${AssetCategory}`)}
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
                            onToggle={toggle}
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
                                onToggle={toggle}
                            />
                        ))}
                    </ul>
                </DashboardSection>
            )}
        </div>
    );
}

/**
 * One row of a list, opening in place.
 *
 * The lists used to be plain text: an asset page naming the biggest images in the project without
 * showing one of them. Each row now leads with the asset itself, and the detail unfolds under the
 * row it belongs to rather than in a side pane a 350px column has no space for.
 */
function AssetRow({
    entry,
    selected,
    onToggle,
}: {
    entry: AssetOverviewEntry;
    selected: boolean;
    onToggle: (assetId: string) => void;
}) {
    return (
        <li>
            <button
                type="button"
                onClick={() => onToggle(entry.asset.id)}
                className={cn(
                    "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors",
                    selected ? "bg-fill" : "hover:bg-surface-raised",
                )}
            >
                <AssetThumbnail
                    asset={entry.asset}
                    className="h-7 w-7 shrink-0 overflow-hidden rounded-md bg-surface-sunken"
                />
                <span className="min-w-0 flex-1 truncate text-xs text-fg-muted" title={entry.asset.name}>
                    {entry.asset.name}
                </span>
                <span className="shrink-0 text-2xs tabular-nums text-fg-subtle">{formatByteSize(entry.bytes)}</span>
            </button>
            {selected && <AssetDetail entry={entry} />}
        </li>
    );
}

/**
 * One asset, in full: what it looks like, what it weighs, and every place that points at it.
 *
 * The shard path (`content/35/f4/5bbaf…`) and the content hash are addresses this editor invented
 * for its own storage, and they used to be two of the four lines here, printed at every reader
 * whether or not they had asked. Nobody writing a story needs to know where a file was filed; the
 * one time either is worth having is when it is being pasted somewhere else. So they fold away, and
 * unfold with a copy button — no sentence explaining what a shard is, because the fix for jargon is
 * not to caption it.
 */
function AssetDetail({ entry }: { entry: AssetOverviewEntry }) {
    const { t, tn } = useTranslation();
    const [showStorage, setShowStorage] = useState(false);
    const asset = entry.asset;
    const relativePath = assetContentRelativePath(asset);
    const previewUrl = useBadgeImageUrl(
        asset.type === AssetType.Image ? { kind: "project", asset: asset as Asset<AssetType.Image> } : null,
    );
    // A remote asset has both: a shard holding the snapshot, like every other asset, and the address
    // that snapshot came from. The URL used to *replace* the path here, which read as though remote
    // assets were stored somewhere else; they are not, and their bytes count towards the very sizes
    // this view exists to show.
    const sourceUrl = asset.source === AssetSource.Remote
        ? (asset as Asset<AssetType, AssetSource.Remote>).meta.url
        : null;

    return (
        <div className="mb-2 ml-2 flex flex-col gap-2.5 border-l border-edge pl-3 pt-2">
            {previewUrl && (
                <img
                    src={previewUrl}
                    alt=""
                    className="max-h-40 w-full rounded-md border border-edge bg-surface-sunken object-contain"
                />
            )}

            <dl className="flex flex-col gap-1.5">
                <DetailRow label={t("properties.asset.info.size")} value={formatByteSize(entry.bytes)} />
                <DetailRow label={t("assets.overview.stat.referenced")} value={tn("assets.overview.uses", entry.referenceCount)} />
            </dl>

            <div>
                <button
                    type="button"
                    onClick={() => setShowStorage(prev => !prev)}
                    aria-expanded={showStorage}
                    className="flex items-center gap-1 rounded-md text-2xs text-fg-subtle hover:text-fg-muted"
                >
                    <ChevronDown className={cn("h-3 w-3 transition-transform", !showStorage && "-rotate-90")} />
                    {t("assets.overview.detail.storage")}
                </button>
                {showStorage && (
                    <dl className="mt-1.5 flex flex-col gap-1.5">
                        <CopyRow label={t("properties.asset.info.hash")} value={asset.hash} />
                        {relativePath && (
                            <CopyRow label={t("assets.overview.detail.path")} value={relativePath} />
                        )}
                        {sourceUrl && (
                            <CopyRow label={t("properties.asset.remote.url")} value={sourceUrl} />
                        )}
                    </dl>
                )}
            </div>

            <AssetReferencesSection assetId={asset.id} assetType={asset.type} />
        </div>
    );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex items-baseline justify-between gap-2">
            <dt className="shrink-0 text-2xs text-fg-subtle">{label}</dt>
            <dd className={cn("min-w-0 truncate text-2xs text-fg-muted", mono && "font-mono")} title={value}>
                {value}
            </dd>
        </div>
    );
}

/** A storage address: shown on request, and only ever useful somewhere else — so it copies. */
function CopyRow({ label, value }: { label: string; value: string }) {
    const { t } = useTranslation();
    return (
        <div className="flex items-baseline gap-2">
            <dt className="shrink-0 text-2xs text-fg-subtle">{label}</dt>
            <dd className="min-w-0 flex-1 truncate font-mono text-2xs text-fg-muted" title={value}>
                {value}
            </dd>
            <button
                type="button"
                title={t("common.copy")}
                onClick={() => void navigator.clipboard?.writeText(value)}
                className="shrink-0 rounded-md p-0.5 text-fg-subtle hover:bg-fill hover:text-fg-muted"
            >
                <Copy className="h-3 w-3" />
            </button>
        </div>
    );
}
