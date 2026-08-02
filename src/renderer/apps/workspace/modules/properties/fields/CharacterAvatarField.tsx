import { useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { useTranslation } from "@/lib/i18n";
import type { CustomFieldProps } from "../framework/types";
import type { CharacterEditorContext } from "../schemas/characterSchema";

/**
 * The character's fallback dialog avatar — what a dialog shows when no differential resolves one,
 * which is the speaker talking from off-stage.
 *
 * A project asset, unlike the thumbnail above it: the thumbnail is an editor asset cropped for the
 * browser, this one ships. That is why it does not reuse the `thumbnail` field, whose picker crops
 * into the private editor store.
 *
 * The frame is the picker. There is no second button and no line explaining what a dialog avatar is
 * — the same reasoning the thumbnail's empty frame follows.
 */
export function CharacterAvatarField({ data }: CustomFieldProps<CharacterEditorContext>) {
    const { t } = useTranslation();
    const profile = data.character.profile;
    const [assetId, setAssetId] = useState<string | null>(profile.getDefaultAvatarAssetId());
    const [open, setOpen] = useState(false);
    const anchorRef = useRef<HTMLButtonElement | null>(null);
    const { url } = useAssetObjectUrl(assetId);

    const commit = (next: string | null): void => {
        setAssetId(next);
        profile.setDefaultAvatarAssetId(next);
    };

    return (
        <div className="flex items-center gap-2">
            <button
                ref={anchorRef}
                type="button"
                aria-label={t("characters.properties.defaultAvatar")}
                onClick={() => setOpen(true)}
                className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-edge bg-surface text-fg-subtle transition-colors hover:bg-fill-subtle hover:text-fg-muted"
            >
                {url
                    ? <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                    : <span className="grid h-full w-full place-items-center"><ImagePlus className="h-5 w-5" /></span>}
            </button>
            {assetId && (
                <button className="text-xs text-danger hover:text-danger/80" onClick={() => commit(null)}>
                    {t("common.clear")}
                </button>
            )}
            <AssetSelector
                visible={open}
                assetType={AssetType.Image}
                selectedIds={assetId ? [assetId] : []}
                onClose={() => setOpen(false)}
                onConfirm={assets => {
                    setOpen(false);
                    commit(assets[0]?.id ?? null);
                }}
                anchorRef={anchorRef}
                title={t("characters.properties.defaultAvatar")}
                multiple={false}
            />
        </div>
    );
}
