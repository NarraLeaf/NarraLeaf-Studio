import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Button } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { formatBytes } from "@shared/utils/formatBytes";
import type { CacheBucketId, CacheInventoryReport } from "@shared/types/cacheInventory";
import type { TranslationKey } from "@shared/i18n";

/**
 * The row text of every bucket, in the order the rows are shown.
 *
 * Keyed by every bucket there is, so a bucket main measures cannot be left out of the list: "Clear
 * all" clears whatever the report holds, and a bucket with no row was cleared without ever having
 * been shown.
 */
const BUCKET_TEXT: Record<CacheBucketId, { labelKey: TranslationKey; descriptionKey: TranslationKey }> = {
    electronBuilder: {
        labelKey: "settings.data.cache.buckets.electronBuilder.label",
        descriptionKey: "settings.data.cache.buckets.electronBuilder.description",
    },
    toolchains: {
        labelKey: "settings.data.cache.buckets.toolchains.label",
        descriptionKey: "settings.data.cache.buckets.toolchains.description",
    },
    buildDependencies: {
        labelKey: "settings.data.cache.buckets.buildDependencies.label",
        descriptionKey: "settings.data.cache.buckets.buildDependencies.description",
    },
    puppetRuntimes: {
        labelKey: "settings.data.cache.buckets.puppetRuntimes.label",
        descriptionKey: "settings.data.cache.buckets.puppetRuntimes.description",
    },
    optimizedImages: {
        labelKey: "settings.data.cache.buckets.optimizedImages.label",
        descriptionKey: "settings.data.cache.buckets.optimizedImages.description",
    },
    compressedMedia: {
        labelKey: "settings.data.cache.buckets.compressedMedia.label",
        descriptionKey: "settings.data.cache.buckets.compressedMedia.description",
    },
    browser: {
        labelKey: "settings.data.cache.buckets.browser.label",
        descriptionKey: "settings.data.cache.buckets.browser.description",
    },
    pluginIcons: {
        labelKey: "settings.data.cache.buckets.pluginIcons.label",
        descriptionKey: "settings.data.cache.buckets.pluginIcons.description",
    },
    uiTemplatePosters: {
        labelKey: "settings.data.cache.buckets.uiTemplatePosters.label",
        descriptionKey: "settings.data.cache.buckets.uiTemplatePosters.description",
    },
    spellcheckDictionaries: {
        labelKey: "settings.data.cache.buckets.spellcheckDictionaries.label",
        descriptionKey: "settings.data.cache.buckets.spellcheckDictionaries.description",
    },
    psdImports: {
        labelKey: "settings.data.cache.buckets.psdImports.label",
        descriptionKey: "settings.data.cache.buckets.psdImports.description",
    },
    payloadReaders: {
        labelKey: "settings.data.cache.buckets.payloadReaders.label",
        descriptionKey: "settings.data.cache.buckets.payloadReaders.description",
    },
    logs: {
        labelKey: "settings.data.cache.buckets.logs.label",
        descriptionKey: "settings.data.cache.buckets.logs.description",
    },
};

const BUCKET_LABELS = (Object.keys(BUCKET_TEXT) as CacheBucketId[]).map(id => ({ id, ...BUCKET_TEXT[id] }));

/**
 * What Studio has left on disk, per bucket, with a way to throw each away.
 *
 * A list with sizes rather than one Clear button, because the buckets are not comparable: the
 * plugin thumbnails refill in seconds and the Electron dists refill in gigabytes. Measuring is
 * a directory walk, so it happens when this panel opens and when the author asks again - never
 * on a timer.
 */
export function CacheInventoryPanel() {
    const { t } = useTranslation();
    const [report, setReport] = useState<CacheInventoryReport | null>(null);
    const [measuring, setMeasuring] = useState(true);
    const [busy, setBusy] = useState<CacheBucketId | "all" | null>(null);
    const [freed, setFreed] = useState<number | null>(null);

    const measure = useCallback(async () => {
        setMeasuring(true);
        const result = await getInterface().app.getCacheInventory().catch(() => null);
        setReport(result?.success ? result.data : null);
        setMeasuring(false);
    }, []);

    useEffect(() => {
        void measure();
    }, [measure]);

    const clear = useCallback(async (ids: CacheBucketId[], scope: CacheBucketId | "all") => {
        setBusy(scope);
        const result = await getInterface().app.clearCaches(ids).catch(() => null);
        if (result?.success) {
            setFreed(result.data.freedBytes);
        }
        setBusy(null);
        await measure();
    }, [measure]);

    const clearable = (report?.buckets ?? []).filter(bucket => !bucket.error && bucket.sizeBytes > 0);

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
                {BUCKET_LABELS.map(({ id, labelKey, descriptionKey }) => {
                    const bucket = report?.buckets.find(candidate => candidate.id === id);
                    const empty = !bucket || Boolean(bucket.error) || bucket.sizeBytes === 0;
                    return (
                        <div key={id} className="group flex h-9 items-center gap-3 rounded-md px-2 hover:bg-fill-subtle">
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm text-fg-muted" data-tip={bucket?.path ?? undefined}>
                                    {t(labelKey)}
                                </p>
                            </div>
                            <span className="shrink-0 text-xs text-fg-subtle" data-tip={t(descriptionKey)}>
                                {measuring
                                    ? t("settings.data.cache.measuring")
                                    : bucket?.error
                                        ? t("settings.data.cache.unavailable")
                                        : formatBytes(bucket?.sizeBytes ?? 0)}
                            </span>
                            <Button
                                size="sm"
                                variant="ghost"
                                className={cn("h-7 shrink-0", empty && "invisible")}
                                disabled={busy !== null}
                                onClick={() => void clear([id], id)}
                            >
                                {t("settings.data.cache.clear")}
                            </Button>
                        </div>
                    );
                })}
            </div>

            <div className="flex items-center gap-2">
                <Button
                    size="sm"
                    variant="secondary"
                    className="h-7"
                    disabled={busy !== null || measuring || clearable.length === 0}
                    onClick={() => void clear(clearable.map(bucket => bucket.id), "all")}
                >
                    {t("settings.data.cache.clearAll")}
                </Button>
                <Button size="sm" variant="ghost" className="h-7" disabled={measuring} onClick={() => void measure()}>
                    {t("settings.data.cache.refresh")}
                </Button>
                {freed !== null && !measuring && (
                    <span className="text-xs text-fg-subtle">
                        {t("settings.data.cache.freed", { size: formatBytes(freed) })}
                    </span>
                )}
            </div>
        </div>
    );
}
