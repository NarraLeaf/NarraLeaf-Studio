import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { Checkbox } from "@/lib/components/elements";
import { Input } from "@/lib/components/elements/Input";
import type { SmartSnapDetailSettings } from "@/lib/ui-editor/snapping/types";
import { parseUiEditorGridSpacing, type UIEditorGridStyle } from "@/lib/ui-editor/snapping/gridSnap";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { SurfaceEditorToolbarSegButton, SurfaceEditorToolbarSegSlot } from "./SurfaceEditorToolbarButtonGroup";
import {
    SurfaceToolbarPopoverPanel,
    SurfaceToolbarPopoverRow,
    SurfaceToolbarPopoverSection,
    useSurfaceToolbarPopover,
} from "./SurfaceEditorToolbarPopover";

type Props = {
    stateService: UIEditorStateService;
    detail: SmartSnapDetailSettings;
    /** The project's grid spacing in design pixels, shown and edited in the panel. */
    gridSpacing: number;
    /** Whether the canvas draws the grid as lines or dots. */
    gridStyle: UIEditorGridStyle;
};

/**
 * Dropdown trigger + panel for per-category smart snap toggles, and the grid's style and spacing.
 *
 * The spacing is a section of its own rather than part of the Grid row, and stays editable with Grid
 * unticked: the snap-to-grid key uses it whether or not grid snapping is on. The style sits with it
 * for the same reason - both describe the grid, not whether it is a snap target.
 */
export function SurfaceSnapSettingsTrigger({ stateService, detail, gridSpacing, gridStyle }: Props) {
    const { t } = useTranslation();
    const popover = useSurfaceToolbarPopover(detail);
    const [spacingDraft, setSpacingDraft] = useState(String(gridSpacing));

    // The box shows the project's spacing whenever the panel is opened, and follows it while open.
    useEffect(() => {
        if (popover.open) {
            setSpacingDraft(String(gridSpacing));
        }
    }, [gridSpacing, popover.open]);

    const patch = useCallback(
        (partial: Partial<SmartSnapDetailSettings>) => {
            stateService.patchSmartSnapDetailSettings(partial);
        },
        [stateService],
    );

    /** `close` only on Enter; blur applies without dismissing the panel. Anything unusable puts the spacing back. */
    const commitSpacing = useCallback(
        (close: boolean) => {
            const parsed = parseUiEditorGridSpacing(spacingDraft);
            if (parsed === null) {
                setSpacingDraft(String(gridSpacing));
            } else {
                stateService.setGridSpacing(parsed);
                setSpacingDraft(String(parsed));
            }
            if (close) {
                popover.close();
            }
        },
        [gridSpacing, popover, spacingDraft, stateService],
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
                    <Checkbox
                        className="px-3 py-1.5 text-fg hover:bg-fill-subtle"
                        checked={detail.snapCanvasLayout}
                        onCheckedChange={() => patch({ snapCanvasLayout: !stateService.getSmartSnapDetailSettings().snapCanvasLayout })}
                    >
                        {t("uiEditor.snap.canvasLayout")}
                    </Checkbox>
                    <Checkbox
                        className="px-3 py-1.5 text-fg hover:bg-fill-subtle"
                        checked={detail.snapElementBorder}
                        onCheckedChange={() => patch({ snapElementBorder: !stateService.getSmartSnapDetailSettings().snapElementBorder })}
                    >
                        {t("uiEditor.snap.elementBorders")}
                    </Checkbox>
                    <Checkbox
                        className="px-3 py-1.5 text-fg hover:bg-fill-subtle"
                        checked={detail.snapElementLayout}
                        onCheckedChange={() => patch({ snapElementLayout: !stateService.getSmartSnapDetailSettings().snapElementLayout })}
                    >
                        {t("uiEditor.snap.elementLayout")}
                    </Checkbox>
                    <Checkbox
                        className="px-3 py-1.5 text-fg hover:bg-fill-subtle"
                        checked={detail.snapGrid}
                        onCheckedChange={() => patch({ snapGrid: !stateService.getSmartSnapDetailSettings().snapGrid })}
                    >
                        {t("uiEditor.snap.grid")}
                    </Checkbox>
                </div>
                <SurfaceToolbarPopoverSection label={t("uiEditor.snap.gridStyle")}>
                    <SurfaceToolbarPopoverRow
                        label={t("uiEditor.snap.gridLines")}
                        selected={gridStyle === "lines"}
                        focusWhenSelected={false}
                        onClick={() => stateService.setGridStyle("lines")}
                    />
                    <SurfaceToolbarPopoverRow
                        label={t("uiEditor.snap.gridDots")}
                        selected={gridStyle === "dots"}
                        focusWhenSelected={false}
                        onClick={() => stateService.setGridStyle("dots")}
                    />
                </SurfaceToolbarPopoverSection>
                <SurfaceToolbarPopoverSection label={t("uiEditor.snap.gridSize")}>
                    <div className="flex items-center gap-1.5 px-3 pb-1 pt-0.5">
                        <div className="min-w-0 flex-1">
                            <Input
                                size="sm"
                                fullWidth
                                inputMode="numeric"
                                className="tabular-nums"
                                aria-label={t("uiEditor.snap.gridSize")}
                                value={spacingDraft}
                                onChange={event => setSpacingDraft(event.target.value)}
                                onKeyDown={event => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        commitSpacing(true);
                                    }
                                }}
                                onBlur={() => commitSpacing(false)}
                            />
                        </div>
                        <span className="shrink-0 text-xs text-fg-subtle">px</span>
                    </div>
                </SurfaceToolbarPopoverSection>
            </SurfaceToolbarPopoverPanel>
        </>
    );
}
