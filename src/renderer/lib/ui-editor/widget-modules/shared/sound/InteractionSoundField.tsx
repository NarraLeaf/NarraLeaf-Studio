import { Music } from "lucide-react";
import {
    readUIInteractionSoundAssetId,
    uiInteractionSoundPatch,
    type UIInteractionSoundKind,
} from "@shared/types/ui-editor/interactionSounds";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { useTranslation } from "@/lib/i18n";
import { AssetPickerRow } from "../assets/AssetPickerRow";

/**
 * The sounds an element plays when the player points at it and when they click it.
 *
 * One row per gesture, each naming an audio asset or an asset set. What plays and where is the
 * runtime's (`runtime/interactionSounds.ts`); this only reads and writes the two props.
 */
export function InteractionSoundField({ data, readOnly }: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    // Through the live document: a schema closure can outlive the props it captured.
    const element = data.documentService.getDocument().elements[data.element.id] ?? data.element;

    const update = (kind: UIInteractionSoundKind, assetId: string | null) => {
        data.documentService.updateElementProps(element.id, uiInteractionSoundPatch(kind, assetId));
    };

    return (
        <div className="flex flex-col gap-2">
            <AssetPickerRow
                label={t("properties.interactionSound.hover")}
                tip={t("properties.interactionSound.hoverTip")}
                emptyLabel={t("properties.interactionSound.none")}
                chooseLabel={t("properties.interactionSound.chooseHover")}
                missingLabel={t("properties.interactionSound.missing")}
                icon={Music}
                assetType={AssetType.Audio}
                assetId={readUIInteractionSoundAssetId(element, "hover")}
                onChange={next => update("hover", next)}
                readOnly={readOnly}
            />
            <AssetPickerRow
                label={t("properties.interactionSound.click")}
                tip={t("properties.interactionSound.clickTip")}
                emptyLabel={t("properties.interactionSound.none")}
                chooseLabel={t("properties.interactionSound.chooseClick")}
                missingLabel={t("properties.interactionSound.missing")}
                icon={Music}
                assetType={AssetType.Audio}
                assetId={readUIInteractionSoundAssetId(element, "click")}
                onChange={next => update("click", next)}
                readOnly={readOnly}
            />
        </div>
    );
}
