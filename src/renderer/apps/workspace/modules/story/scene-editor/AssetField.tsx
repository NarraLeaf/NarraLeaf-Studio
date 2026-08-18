import { useCallback, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Music, Trash2, Video } from "lucide-react";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { useWorkspace } from "@/apps/workspace/context";
import { useTranslation } from "@/lib/i18n";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services } from "@/lib/workspace/services/services";
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
 */
export function AssetField(props: {
    label?: string;
    assetType: AssetType;
    assetId: string | undefined;
    onChange: (assetId: string | undefined) => void;
    /** Dense row height, for the channel list. */
    compact?: boolean;
}) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const assetsService = useMemo(
        () => context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null,
        [context, isInitialized],
    );
    const selectedAsset = props.assetId
        ? (assetsService?.getAssets()[props.assetType] as Record<string, Asset> | undefined)?.[props.assetId] ?? null
        : null;
    const [selectorOpen, setSelectorOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const Icon = props.assetType === AssetType.Audio ? Music : props.assetType === AssetType.Video ? Video : ImageIcon;
    const label = selectedAsset?.name ?? (props.assetId ? t("storyInspector.asset.missing") : t("storyInspector.asset.none"));

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
            <div className="flex gap-2">
                <button
                    ref={buttonRef}
                    type="button"
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-md border border-edge bg-surface-raised px-3 text-left text-fg-muted hover:border-primary/40 ${height}`}
                    onClick={() => setSelectorOpen(true)}
                >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                    <span className={["truncate", selectedAsset ? "" : "italic text-fg-subtle"].join(" ")}>{label}</span>
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
            />
        </div>
    );
}
