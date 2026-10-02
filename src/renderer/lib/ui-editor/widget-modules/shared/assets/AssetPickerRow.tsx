import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { useAssetSetPickerSource } from "@/apps/workspace/modules/assets/state/useAssetSetPickerSource";
import { useAssetLibraryRevision } from "@/lib/workspace/hooks/useAssetLibraryRevision";
import { resolveAssetDisplayName } from "@/lib/workspace/assets/assetDisplayName";
import { useWorkspace } from "@/apps/workspace/context";
import type { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services } from "@/lib/workspace/services/services";
import { useTranslation } from "@/lib/i18n";
import { HintPopover } from "@/lib/components/elements";

export type AssetPickerRowProps = {
    label: string;
    /** What the slot does, revealed from an info icon beside the label (a field's `tip`). */
    tip?: string;
    emptyLabel: string;
    chooseLabel: string;
    /** What the row reads for an id the library has no record of. */
    missingLabel: string;
    icon: LucideIcon;
    assetType: AssetType;
    assetId: string | null;
    onChange: (next: string | null) => void;
    /** A frozen workspace: the row still names the asset, and offers neither the picker nor Clear. */
    readOnly?: boolean;
};

/**
 * One inspector row naming a library asset, with the picker behind it and a Clear beside it.
 *
 * Single-select only: `AssetSelector`'s multiple mode has never actually worked, and a picker that
 * silently keeps only the first pick is worse than one that never offers the choice. The slot may
 * hold an asset set as well as a file, and the picker offers both.
 */
export function AssetPickerRow({
    label,
    tip,
    emptyLabel,
    chooseLabel,
    missingLabel,
    icon: Icon,
    assetType,
    assetId,
    onChange,
    readOnly = false,
}: AssetPickerRowProps) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const assetsService = useMemo(
        () => (context ? context.services.get<AssetsService>(Services.Assets) : null),
        [context],
    );
    const [selectorOpen, setSelectorOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);

    // The library edits its records in place, so a rename or a delete moves nothing else this memo
    // keys on - without the revision the field keeps the name the file had when it was picked.
    const assetLibraryRevision = useAssetLibraryRevision();
    // Through the shared reader, not the pool table: this slot may hold an asset set, and a set has
    // no row in the library - looking only there would print "missing" for a reference the picker
    // itself just offered.
    const assetName = useMemo(() => {
        if (!assetId || !assetsService) {
            return null;
        }
        return resolveAssetDisplayName(context?.services, assetId);
    }, [assetId, assetLibraryRevision, assetsService, context]);
    const { virtualGroups, resolveAssetPreviewUrl } = useAssetSetPickerSource({
        context,
        isInitialized,
        assetType,
        enabled: true,
    });

    /**
     * An id with no library record is a broken reference, not an empty slot - saying "None" there
     * would hide the very thing the missing-asset check is reporting.
     */
    const valueLabel = assetId ? assetName ?? missingLabel : emptyLabel;

    const handleConfirm = useCallback((assets: Asset[]) => {
        const selected = assets[0];
        if (!selected) {
            return;
        }
        onChange(selected.id);
        setSelectorOpen(false);
    }, [onChange]);

    const handleClear = useCallback((event: MouseEvent<HTMLSpanElement>) => {
        event.stopPropagation();
        onChange(null);
    }, [onChange]);

    return (
        <>
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-fg-muted">{label}</span>
                    {tip ? <HintPopover text={tip} /> : null}
                </div>
                <button
                    type="button"
                    ref={triggerRef}
                    disabled={readOnly}
                    onClick={() => setSelectorOpen(true)}
                    data-tip={assetName ?? undefined}
                    className="flex w-full items-center gap-2 rounded-md border border-edge bg-surface px-2 py-1.5 text-left text-xs text-fg focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:cursor-default"
                >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                    <span className={assetId ? "min-w-0 flex-1 truncate" : "min-w-0 flex-1 truncate text-fg-subtle"}>
                        {valueLabel}
                    </span>
                    {readOnly ? null : assetId ? (
                        <span
                            role="button"
                            tabIndex={-1}
                            onClick={handleClear}
                            className="shrink-0 rounded-md px-1.5 py-0.5 text-2xs tracking-wider text-fg-subtle hover:bg-fill hover:text-fg-muted"
                        >
                            {t("common.clear")}
                        </span>
                    ) : (
                        <span className="shrink-0 text-2xs tracking-wider text-fg-subtle">{chooseLabel}</span>
                    )}
                </button>
            </div>

            <AssetSelector
                visible={selectorOpen}
                assetType={assetType}
                multiple={false}
                selectedIds={assetId ? [assetId] : []}
                anchorRef={triggerRef}
                title={chooseLabel}
                onClose={() => setSelectorOpen(false)}
                onConfirm={handleConfirm}
                {...(virtualGroups ? { virtualGroups, resolveAssetPreviewUrl } : {})}
            />
        </>
    );
}
