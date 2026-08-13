import { useCallback } from "react";
import { Frame } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { SAFE_AREA_PRESETS, SURFACE_PREVIEW_ASPECT_PRESETS } from "@/lib/ui-editor/preview/surfacePreviewFrames";
import type { SafeAreaDeviceFamily } from "@/lib/ui-editor/preview/surfacePreviewFrames";

/**
 * Family headings. Not translated: they are product names, and a localized "iPhone" would be wrong
 * in every language. Order is the order the groups appear in.
 */
export const SAFE_AREA_FAMILY_LABELS: ReadonlyArray<[SafeAreaDeviceFamily, string]> = [
    ["iphone", "iPhone"],
    ["ipad", "iPad"],
    ["android", "Android"],
];
import { SurfaceEditorToolbarButtonGroup, SurfaceEditorToolbarSegButton } from "./SurfaceEditorToolbarButtonGroup";
import {
    SurfaceToolbarPopoverPanel,
    SurfaceToolbarPopoverRow,
    SurfaceToolbarPopoverSection,
    useSurfaceToolbarPopover,
} from "./SurfaceEditorToolbarPopover";

type Props = {
    stateService: UIEditorStateService;
    aspectId: string | null;
    safeAreaId: string | null;
};

/**
 * Toolbar dropdown for the two canvas reference frames: the player's screen ratio and a device safe
 * area.
 *
 * Both are view state on {@link UIEditorStateService} and persist to Studio settings, never to the
 * project - switching a frame must not dirty the document or enter the undo stack. The two layers
 * are independent, so each section carries its own "off" row rather than sharing one switch.
 */
export function SurfacePreviewFramesTrigger({ stateService, aspectId, safeAreaId }: Props) {
    const { t } = useTranslation();
    const popover = useSurfaceToolbarPopover(`${aspectId ?? ""}|${safeAreaId ?? ""}`);

    const chooseAspect = useCallback(
        (id: string | null) => {
            stateService.setPreviewAspectId(id);
            popover.close();
        },
        [popover, stateService],
    );

    const chooseSafeArea = useCallback(
        (id: string | null) => {
            stateService.setPreviewSafeAreaId(id);
            popover.close();
        },
        [popover, stateService],
    );

    const anyActive = aspectId != null || safeAreaId != null;

    return (
        <>
            <SurfaceEditorToolbarButtonGroup aria-label={t("uiEditor.preview.label")}>
                <SurfaceEditorToolbarSegButton
                    ref={popover.triggerRef}
                    type="button"
                    active={popover.open || anyActive}
                    onClick={popover.toggle}
                    data-tip={t("uiEditor.preview.label")}
                    aria-expanded={popover.open}
                    aria-haspopup="dialog"
                >
                    <Frame className="h-4 w-4" />
                </SurfaceEditorToolbarSegButton>
            </SurfaceEditorToolbarButtonGroup>
            <SurfaceToolbarPopoverPanel popover={popover} dataAttribute="preview-frames">
                <SurfaceToolbarPopoverSection label={t("uiEditor.preview.aspect")} first>
                    <SurfaceToolbarPopoverRow
                        label={t("uiEditor.preview.off")}
                        selected={aspectId == null}
                        onClick={() => chooseAspect(null)}
                    />
                    {SURFACE_PREVIEW_ASPECT_PRESETS.map(preset => (
                        <SurfaceToolbarPopoverRow
                            key={preset.id}
                            label={preset.id}
                            selected={aspectId === preset.id}
                            onClick={() => chooseAspect(preset.id)}
                        />
                    ))}
                </SurfaceToolbarPopoverSection>
                <SurfaceToolbarPopoverSection label={t("uiEditor.preview.safeArea")}>
                    <SurfaceToolbarPopoverRow
                        label={t("uiEditor.preview.off")}
                        selected={safeAreaId == null}
                        onClick={() => chooseSafeArea(null)}
                    />
                    {SAFE_AREA_FAMILY_LABELS.map(([family, familyLabel]) => (
                        <div key={family}>
                            <div className="px-3 pb-0.5 pt-1.5 text-2xs text-fg-subtle">{familyLabel}</div>
                            {SAFE_AREA_PRESETS.filter(preset => preset.family === family).map(preset => (
                                <SurfaceToolbarPopoverRow
                                    key={preset.id}
                                    label={preset.reference}
                                    selected={safeAreaId === preset.id}
                                    onClick={() => chooseSafeArea(preset.id)}
                                />
                            ))}
                        </div>
                    ))}
                </SurfaceToolbarPopoverSection>
            </SurfaceToolbarPopoverPanel>
        </>
    );
}
