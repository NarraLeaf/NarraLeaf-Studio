import { useCallback, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Layers, Music, Trash2, Video } from "lucide-react";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { useAssetSetPickerSource } from "@/apps/workspace/modules/assets/state/useAssetSetPickerSource";
import { useWorkspace } from "@/apps/workspace/context";
import { useTranslation } from "@/lib/i18n";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { useAssetLibraryRevision } from "@/lib/workspace/hooks/useAssetLibraryRevision";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services } from "@/lib/workspace/services/services";
import { useBadgeImageUrl, useStoryImageAsset } from "./storyBadgeImageCache";
import { FIELD_LABEL_CLASS } from "./inspectorFieldKit";

/**
 * A project asset, picked through the asset browser.
 *
 * Lives in its own file rather than in `StorySceneActionInspector` because two of that file's
 * consumers now need it - the expression popover and the transform channel list - and importing it
 * back out of the inspector would close a cycle around the module that renders them.
 *
 * `label` is optional: a channel row already names itself in its own left column, and repeating the
 * word above the control would be the same answer twice.
 *
 * ## Asset sets
 *
 * With `allowAssetSets`, the picker also offers the project's sets of this type, and the field
 * stores the set's id where an asset id would go. Only the caller knows whether that is legal:
 * assembly resolves a set named by a block's own `assetId` / `voiceAssetId`, and a set id written
 * anywhere else would reach the build as an id no library row answers. So this is off by default
 * and turned on per field rather than inferred here.
 *
 * ## The picture
 *
 * An image field shows the image. It used to show its name and a glyph, which answers "is something
 * picked" and not "which one" - and the name is often the only thing the author has to go on, so a
 * row reading `cg42` said nothing at all about what would be on screen. Images only: they are the one
 * asset kind that can be recognised at a glance, and a frame around an audio glyph would be a
 * thumbnail that never arrives. Compact rows keep the line alone - a channel list is a column of
 * one-line controls, and a picture in it would be taller than the row it belongs to.
 */
export function AssetField(props: {
    label?: string;
    assetType: AssetType;
    assetId: string | undefined;
    onChange: (assetId: string | undefined) => void;
    /** Dense row height, for the channel list. */
    compact?: boolean;
    /** Offer the project's asset sets alongside its files. See the note above. */
    allowAssetSets?: boolean;
}) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const assetsService = useMemo(
        () => context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null,
        [context, isInitialized],
    );
    // Read live, and re-read when the library moves: the lookup below is already current on every
    // render, but nothing would re-render this field for a rename made in the asset panel - the
    // records are edited in place, so the props it takes do not change.
    useAssetLibraryRevision();
    const selectedAsset = props.assetId
        ? (assetsService?.getAssets()[props.assetType] as Record<string, Asset> | undefined)?.[props.assetId] ?? null
        : null;

    const { virtualGroups, resolveAssetPreviewUrl, findSet } = useAssetSetPickerSource({
        context,
        isInitialized,
        assetType: props.assetType,
        enabled: Boolean(props.allowAssetSets),
    });

    const [selectorOpen, setSelectorOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const selectedSet = props.allowAssetSets && props.assetId && !selectedAsset ? findSet(props.assetId) : null;
    // A set has no bytes of its own: picture the member its fallback names, which is what the field
    // resolves to wherever no other axis value applies.
    const previewAssetId = selectedSet
        ? selectedSet.contents.cells.find(cell => cell.value === selectedSet.set.axis.fallback)?.assetId ?? null
        : props.assetId ?? null;
    const showsPicture = props.assetType === AssetType.Image && !props.compact;
    const previewAsset = useStoryImageAsset(showsPicture ? previewAssetId : null);
    const previewUrl = useBadgeImageUrl(previewAsset ? { kind: "project", asset: previewAsset } : null);
    const Icon = selectedSet
        ? Layers
        : props.assetType === AssetType.Audio ? Music : props.assetType === AssetType.Video ? Video : ImageIcon;
    const label = selectedAsset?.name
        ?? selectedSet?.set.name
        ?? (props.assetId ? t("storyInspector.asset.missing") : t("storyInspector.asset.none"));

    const handleSelect = useCallback((assets: Asset[]) => {
        const selected = assets[0];
        if (!selected) {
            return;
        }
        props.onChange(selected.id);
        setSelectorOpen(false);
    }, [props]);

    const height = props.compact ? "h-7 min-h-7 text-xs" : "h-9 text-sm";
    return (
        <div>
            {props.label ? <label className={FIELD_LABEL_CLASS}>{props.label}</label> : null}
            {previewUrl ? (
                <button
                    type="button"
                    className="group relative mb-2 block aspect-[16/9] w-full overflow-hidden rounded-md border border-edge bg-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/70"
                    onClick={() => setSelectorOpen(true)}
                    aria-label={t("storyInspector.asset.selectTitle", { label: props.label ?? "" })}
                >
                    {/* `contain` rather than `cover`: this is here to be recognised, and a cropped
                        centre of a wide CG is not the picture the author picked. */}
                    <img src={previewUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-2xs tracking-[0.22em] text-white opacity-0 transition-opacity group-hover:opacity-100">
                        {t("storyInspector.asset.change")}
                    </span>
                </button>
            ) : null}
            <div className="flex gap-2">
                <button
                    ref={buttonRef}
                    type="button"
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-md border border-edge bg-surface-raised px-3 text-left text-fg-muted hover:border-primary/40 ${height}`}
                    onClick={() => setSelectorOpen(true)}
                >
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${selectedSet ? "text-primary" : "text-fg-subtle"}`} />
                    <span className={["truncate", selectedAsset || selectedSet ? "" : "italic text-fg-subtle"].join(" ")}>{label}</span>
                </button>
                {props.compact ? null : (
                    <button
                        type="button"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-edge bg-fill-subtle text-fg-muted hover:border-danger/40 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={!props.assetId}
                        data-tip={t("storyInspector.asset.clear")} aria-label={t("storyInspector.asset.clear")}
                        onClick={() => props.onChange(undefined)}
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
            <AssetSelector
                visible={selectorOpen}
                assetType={props.assetType}
                onClose={() => setSelectorOpen(false)}
                onConfirm={handleSelect}
                selectedIds={props.assetId ? [props.assetId] : []}
                anchorRef={buttonRef}
                title={t("storyInspector.asset.selectTitle", { label: props.label ?? "" })}
                multiple={false}
                {...(virtualGroups ? { virtualGroups, resolveAssetPreviewUrl } : {})}
            />
        </div>
    );
}
