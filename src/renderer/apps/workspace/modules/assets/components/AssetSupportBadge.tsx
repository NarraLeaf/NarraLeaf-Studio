import React, { useCallback } from "react";
import { Badge } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { cn } from "@/lib/utils/cn";
import type { MediaAssetSupportRecord } from "@/lib/workspace/services/media/mediaAssetSupport";

/**
 * The mark on an asset that will not play, and the shortest way to fix it.
 *
 * Both views draw this, so it exists once: a mark that appeared on the list rows and not on the
 * grid tiles would be a mark an author learns not to trust.
 *
 * Two states, two tones, and they are not interchangeable. `convertible` is a warning because there
 * is something to do about it; `unplayable` is a danger because there is not, and offering the same
 * next step for both would send an author to a dialog with nothing in it. The `convertible` mark is
 * a button for exactly that reason - it is the shortest path to the state it names - while the
 * `unplayable` one is a plain badge, because a control has to lead somewhere.
 *
 * The expectation rides on `title` rather than the shared `Tooltip`, which is documented as unsafe
 * inside an `overflow-hidden` container; both asset views are scroll containers, and the rows
 * already use `title` for the same reason.
 */
export function AssetSupportBadge({
    record,
    onConvert,
    className,
}: {
    record: MediaAssetSupportRecord;
    /** Opens the conversion. Absent for an asset whose bytes Studio may not replace. */
    onConvert?: () => void;
    className?: string;
}) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();

    const handleClick = useCallback((event: React.MouseEvent) => {
        // The row underneath selects on click, and a mark that selected the row *and* opened a
        // dialog would read as two things happening to one press.
        event.stopPropagation();
        onConvert?.();
    }, [onConvert]);

    if (record.state === "playable") {
        return null;
    }

    if (record.state === "unplayable") {
        return (
            <Badge tone="danger" className={className} data-tip={t("assets.support.notPlayableHint")}>
                {t("assets.support.notPlayable")}
            </Badge>
        );
    }

    const label = t("assets.support.needsConverting");
    if (!onConvert) {
        // The mark without its button, which today means one thing: an asset kept as a link to a
        // URL, whose bytes Studio may not rewrite. That is worth its own sentence rather than the
        // instruction above — "convert it and it will play" is advice this author cannot follow,
        // and a mark that names a fix leading nowhere is worse than no mark.
        return (
            <Badge
                tone="warning"
                className={className}
                data-tip={t("assets.support.needsConvertingRemoteHint")}
            >
                {label}
            </Badge>
        );
    }

    return (
        <button
            type="button"
            onClick={handleClick}
            className={cn("shrink-0 disabled:cursor-not-allowed disabled:opacity-50", className)}
            {...freeze.writes(false, t("assets.support.needsConvertingHint"))}
        >
            <Badge tone="warning">{label}</Badge>
        </button>
    );
}
