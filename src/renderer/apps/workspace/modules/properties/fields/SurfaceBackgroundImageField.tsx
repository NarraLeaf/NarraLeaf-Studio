import { useMemo, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { IconButton } from "@/lib/components/elements/Button";
import { Select } from "@/lib/components/elements/Select";
import { useTranslation } from "@/lib/i18n";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { getSurfaceBackgroundImage } from "@/lib/ui-editor/runtime/surfaceBackground";
import {
    DEFAULT_UI_SURFACE_BACKGROUND_FILL_MODE,
    UI_SURFACE_BACKGROUND_FILL_MODES,
    type UISurfaceBackgroundFillMode,
    type UISurfaceBackgroundImage,
} from "@shared/types/ui-editor/surfaceBackgroundImage";
import type { TranslationKey } from "@shared/i18n";
import type { CustomFieldProps } from "../framework/types";
import type { SceneEditorContext } from "../schemas/sceneSchema";

/**
 * The four fill modes share their names with a widget's image fill, so they share its wording too -
 * an author who has set a container's fill once should not have to learn a second vocabulary for the
 * same four behaviours one level up.
 */
const FILL_MODE_LABEL_KEYS: Record<UISurfaceBackgroundFillMode, TranslationKey> = {
    cover: "properties.imageFill.mode.cover",
    contain: "properties.imageFill.mode.contain",
    stretch: "properties.imageFill.mode.stretch",
    tile: "properties.imageFill.mode.tile",
};

/**
 * The page's background picture: pick one, and say how it fills the page.
 *
 * The frame is the picker, following the character avatar field - there is no second "select"
 * button and no line explaining what a background is. The mode select and the clear button appear
 * only once there is a picture, because neither means anything without one.
 */
export function SurfaceBackgroundImageField({ data }: CustomFieldProps<SceneEditorContext>) {
    const { t } = useTranslation();
    const [selectorOpen, setSelectorOpen] = useState(false);
    const anchorRef = useRef<HTMLButtonElement | null>(null);
    const background = getSurfaceBackgroundImage(data.surface);
    const { url } = useAssetObjectUrl(background?.assetId ?? null);

    const modeOptions = useMemo(
        () => UI_SURFACE_BACKGROUND_FILL_MODES.map(mode => ({
            value: mode,
            label: t(FILL_MODE_LABEL_KEYS[mode]),
        })),
        [t],
    );

    const commit = (next: UISurfaceBackgroundImage | null): void => {
        data.documentService.updateSurface(data.surface.id, surface => {
            const settings = { ...(surface.settings ?? {}) };
            if (next) {
                settings.backgroundImage = next;
            } else {
                // Cleared means gone, not "an entry with no picture": a half-filled record would
                // outlive the choice that made it and keep claiming the asset it no longer shows.
                delete settings.backgroundImage;
            }
            surface.settings = settings;
        }, { mergeKey: `surface:${data.surface.id}:backgroundImage` });
    };

    return (
        <div className="flex items-center gap-2">
            <button
                ref={anchorRef}
                type="button"
                aria-label={t("properties.scene.backgroundImage")}
                onClick={() => setSelectorOpen(true)}
                className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-edge bg-surface text-fg-subtle transition-colors hover:bg-fill hover:text-fg-muted"
            >
                {url
                    ? <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                    : <span className="grid h-full w-full place-items-center"><ImagePlus className="h-5 w-5" /></span>}
            </button>
            {background && (
                <>
                    <Select
                        options={modeOptions}
                        value={background.fillMode}
                        onChange={value => commit({ ...background, fillMode: value as UISurfaceBackgroundFillMode })}
                        size="md"
                        fullWidth
                        className="min-w-0 flex-1"
                        ariaLabel={t("properties.imageFill.modeLabel")}
                    />
                    <IconButton
                        size="md"
                        aria-label={t("common.clear")}
                        data-tip={t("common.clear")}
                        onClick={() => commit(null)}
                    >
                        <X className="h-4 w-4" />
                    </IconButton>
                </>
            )}
            <AssetSelector
                visible={selectorOpen}
                assetType={AssetType.Image}
                selectedIds={background ? [background.assetId] : []}
                onClose={() => setSelectorOpen(false)}
                onConfirm={assets => {
                    setSelectorOpen(false);
                    const assetId = assets[0]?.id;
                    if (!assetId) {
                        return;
                    }
                    commit({
                        assetId,
                        fillMode: background?.fillMode ?? DEFAULT_UI_SURFACE_BACKGROUND_FILL_MODE,
                    });
                }}
                anchorRef={anchorRef}
                title={t("properties.scene.backgroundImage")}
                multiple={false}
            />
        </div>
    );
}
