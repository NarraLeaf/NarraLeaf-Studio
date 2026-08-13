import { useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { SmartSnapDetailSettings } from "@/lib/ui-editor/snapping/types";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { SurfaceEditorToolbarSegButton, SurfaceEditorToolbarSegSlot } from "./SurfaceEditorToolbarButtonGroup";
import { SurfaceToolbarPopoverPanel, useSurfaceToolbarPopover } from "./SurfaceEditorToolbarPopover";

type Props = {
    stateService: UIEditorStateService;
    detail: SmartSnapDetailSettings;
};

/**
 * Dropdown trigger + panel for per-category smart snap toggles.
 */
export function SurfaceSnapSettingsTrigger({ stateService, detail }: Props) {
    const { t } = useTranslation();
    const popover = useSurfaceToolbarPopover(detail);

    const patch = useCallback(
        (partial: Partial<SmartSnapDetailSettings>) => {
            stateService.patchSmartSnapDetailSettings(partial);
        },
        [stateService],
    );

    return (
        <>
            <SurfaceEditorToolbarSegSlot>
                <SurfaceEditorToolbarSegButton
                    ref={popover.triggerRef}
                    type="button"
                    active={popover.open}
                    onClick={popover.toggle}
                    data-tip={t("uiEditor.snap.settings")}
                    aria-expanded={popover.open}
                    aria-haspopup="dialog"
                >
                    <ChevronDown className="h-4 w-4" />
                </SurfaceEditorToolbarSegButton>
            </SurfaceEditorToolbarSegSlot>
            <SurfaceToolbarPopoverPanel popover={popover} dataAttribute="snap-settings">
                <div className="border-b border-edge px-3 pb-2 text-2xs font-medium tracking-wide text-fg-subtle">
                    {t("uiEditor.snap.targets")}
                </div>
                <div className="pt-1">
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-fg hover:bg-fill-subtle">
                        <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded-sm border border-edge-strong bg-surface-sunken text-primary focus:ring-primary/40"
                            checked={detail.snapCanvasLayout}
                            onChange={() => patch({ snapCanvasLayout: !stateService.getSmartSnapDetailSettings().snapCanvasLayout })}
                        />
                        <span>{t("uiEditor.snap.canvasLayout")}</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-fg hover:bg-fill-subtle">
                        <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded-sm border border-edge-strong bg-surface-sunken text-primary focus:ring-primary/40"
                            checked={detail.snapElementBorder}
                            onChange={() => patch({ snapElementBorder: !stateService.getSmartSnapDetailSettings().snapElementBorder })}
                        />
                        <span>{t("uiEditor.snap.elementBorders")}</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-fg hover:bg-fill-subtle">
                        <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded-sm border border-edge-strong bg-surface-sunken text-primary focus:ring-primary/40"
                            checked={detail.snapElementLayout}
                            onChange={() => patch({ snapElementLayout: !stateService.getSmartSnapDetailSettings().snapElementLayout })}
                        />
                        <span>{t("uiEditor.snap.elementLayout")}</span>
                    </label>
                </div>
            </SurfaceToolbarPopoverPanel>
        </>
    );
}
