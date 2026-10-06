/**
 * Project -> Settings -> Letterbox: what the game shows around its stage on a screen of another
 * shape.
 *
 * A colour and a picture, and nothing else. Their size is the player's screen minus the stage, which
 * no author can know, so there is nothing here that positions anything - only what fills the bars.
 *
 * The picture's frame is its own picker, the way a page's background picture is, and the fill mode
 * and the clear button appear only once there is a picture: neither means anything without one.
 */

import { useMemo, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { IconButton, Select, type SelectOption } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n/catalog";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import {
    DEFAULT_LETTERBOX_FILL_MODE,
    LETTERBOX_FILL_MODES,
    normalizeLetterboxConfiguration,
    type LetterboxConfiguration,
    type LetterboxFillMode,
} from "@/lib/workspace/project/configuration";
import { SettingShell, SettingStack } from "./settingRows";
import { useConfigSlice } from "./useConfigSlice";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

/**
 * The fill modes share their names with a widget's image fill and a page's background picture, so
 * they share that wording too: three behaviours an author already knows from one level down.
 */
const FILL_MODE_LABEL_KEYS: Record<LetterboxFillMode, TranslationKey> = {
    cover: "properties.imageFill.mode.cover",
    stretch: "properties.imageFill.mode.stretch",
    tile: "properties.imageFill.mode.tile",
};

export function ProjectLetterboxSection({
    projectService,
    uiService,
    config,
    onConfigChange,
}: ProjectSectionProps) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const frozen = freeze.writes();
    const stored = useMemo(() => normalizeLetterboxConfiguration(config.app?.letterbox), [config.app?.letterbox]);
    const { value: letterbox, commit } = useConfigSlice<LetterboxConfiguration>({
        stored,
        write: patch => projectService.updateLetterboxConfiguration(patch),
        onConfigChange,
        uiService,
        normalize: normalizeLetterboxConfiguration,
    });
    // The colour while the picker is open: dragging across the square is a preview, and only the
    // colour it settles on when the panel closes is written.
    const [draftColor, setDraftColor] = useState<string | null>(null);
    const [selectorOpen, setSelectorOpen] = useState(false);
    const anchorRef = useRef<HTMLButtonElement | null>(null);
    const image = letterbox.image;
    const { url } = useAssetObjectUrl(image?.assetId ?? null);

    const modeOptions: SelectOption[] = useMemo(
        () => LETTERBOX_FILL_MODES.map(mode => ({ value: mode, label: t(FILL_MODE_LABEL_KEYS[mode]) })),
        [t],
    );

    return (
        <SettingsGroup title={t("project.group.letterbox")} part="letterbox">
            <SettingShell
                title={t("project.settings.letterboxColorTitle")}
                description={t("project.settings.letterboxColorDescription")}
                tooltip={frozen["data-tip"]}
            >
                <ColorPickerTrigger
                    value={{ hex: draftColor ?? letterbox.color }}
                    displayMode="icon-hex"
                    allowOpacity={false}
                    disabled={frozen.disabled}
                    ariaLabel={t("project.settings.letterboxColorTitle")}
                    onChange={value => setDraftColor(value.hex)}
                    onCommit={value => {
                        setDraftColor(null);
                        const color = value.hex.toUpperCase();
                        if (color !== letterbox.color) {
                            void commit({ color });
                        }
                    }}
                />
            </SettingShell>
            <SettingStack
                title={t("project.settings.letterboxImageTitle")}
                description={t("project.settings.letterboxImageDescription")}
                tooltip={frozen["data-tip"]}
            >
                <div className="flex min-w-0 items-center gap-2">
                    <button
                        ref={anchorRef}
                        type="button"
                        aria-label={t("project.settings.letterboxImageTitle")}
                        disabled={frozen.disabled}
                        onClick={() => setSelectorOpen(true)}
                        className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-edge bg-surface text-fg-subtle transition-colors hover:bg-fill hover:text-fg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {url
                            ? <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                            : <span className="grid h-full w-full place-items-center"><ImagePlus className="h-5 w-5" /></span>}
                    </button>
                    {image ? (
                        <>
                            <Select
                                size="sm"
                                fullWidth
                                portalMenu
                                className="min-w-0 flex-1"
                                options={modeOptions}
                                value={image.fillMode}
                                disabled={frozen.disabled}
                                onChange={value => void commit({ image: { ...image, fillMode: value as LetterboxFillMode } })}
                                ariaLabel={t("properties.imageFill.modeLabel")}
                            />
                            <IconButton
                                size="sm"
                                aria-label={t("common.clear")}
                                data-tip={t("common.clear")}
                                disabled={frozen.disabled}
                                onClick={() => void commit({ image: null })}
                            >
                                <X className="h-3.5 w-3.5" />
                            </IconButton>
                        </>
                    ) : null}
                </div>
                <AssetSelector
                    visible={selectorOpen}
                    assetType={AssetType.Image}
                    selectedIds={image ? [image.assetId] : []}
                    onClose={() => setSelectorOpen(false)}
                    onConfirm={assets => {
                        setSelectorOpen(false);
                        const assetId = assets[0]?.id;
                        if (!assetId) {
                            return;
                        }
                        void commit({
                            image: { assetId, fillMode: image?.fillMode ?? DEFAULT_LETTERBOX_FILL_MODE },
                        });
                    }}
                    anchorRef={anchorRef}
                    title={t("project.settings.letterboxImageTitle")}
                    multiple={false}
                />
            </SettingStack>
        </SettingsGroup>
    );
}
