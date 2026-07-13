import { useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { IconButtonSegGroup } from "@/apps/workspace/modules/properties/framework/fields/IconButtonSegGroup";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { ColorValue } from "@/apps/workspace/modules/properties/framework/types";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { Select } from "@/lib/components/elements/Select";
import type { AppearanceFieldTransition, AppearancePropertyKey, AppearanceVariant } from "@shared/types/ui-editor/appearance";
import { ChevronsDownUp, Droplets, Square } from "lucide-react";
import { BORDER_STYLE_OPTIONS, STROKE_SIDE_OPTIONS, controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { InlineMenuTriggerButton } from "@/lib/ui-editor/widget-modules/shared/chrome/InlineMenuTriggerButton";
import {
    strokeSideSelectedIds,
    strokeSideSpecFromSelectedIds,
} from "@/lib/ui-editor/widget-modules/shared/chrome/strokeSideSpec";
import { formatPercentDisplay, readFiniteNumber } from "./appearanceCompactHelpers";
import { AppearanceFieldMotionButton } from "./AppearanceMotionControls";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";

const BORDER_STYLE_SELECT_OPTIONS = BORDER_STYLE_OPTIONS.map(o => ({
    value: o.value,
    label: o.label,
}));

function coerceBorderStyleSelectValue(raw: string): string {
    const v = String(raw ?? "none").toLowerCase();
    return v === "solid" || v === "dashed" || v === "dotted" || v === "none" ? v : "none";
}

export type BorderStrokeCompactRowsProps = {
    /** Persisted expand state is keyed by element id (editing-area cache). */
    elementId: string;
    draftResetKey: string;
    variant: AppearanceVariant;
    setFieldTransition: (groupKey: AppearancePropertyKey, transition: AppearanceFieldTransition | null) => void;
    motionVisible: boolean;
    borderStyleValue: string;
    onBorderStyleChange: (next: string) => void;
    borderWidth: number;
    onBorderWidthChange: (width: number) => void;
    strokeSideRaw: string;
    onStrokeSideChange: (next: string) => void;
    borderColorCss: string;
    onBorderColorChange: (next: ColorValue) => void;
    strokeOpacity01: number;
    onStrokeOpacity01Change: (opacity01: number) => void;
    moreMenu: ContextMenuDef;
    moreMenuAriaLabel: string;
};

export function BorderStrokeCompactRows({
    elementId,
    draftResetKey,
    variant,
    setFieldTransition,
    motionVisible,
    borderStyleValue,
    onBorderStyleChange,
    borderWidth,
    onBorderWidthChange,
    strokeSideRaw,
    onStrokeSideChange,
    borderColorCss,
    onBorderColorChange,
    strokeOpacity01,
    onStrokeOpacity01Change,
    moreMenu,
    moreMenuAriaLabel,
}: BorderStrokeCompactRowsProps) {
    const { t } = useTranslation();
    const [sidesExpanded, setSidesExpanded] = useState(false);

    useEffect(() => {
        setSidesExpanded(UIEditorStateService.getInstance().getAppearanceBorderSidesExpanded(elementId));
    }, [elementId]);

    const toggleSidesExpanded = () => {
        const svc = UIEditorStateService.getInstance();
        const next = !svc.getAppearanceBorderSidesExpanded(elementId);
        svc.setAppearanceBorderSidesExpanded(elementId, next);
        setSidesExpanded(next);
    };

    const styleSelectValue = coerceBorderStyleSelectValue(borderStyleValue);
    const sideStr = String(strokeSideRaw ?? "all");

    return (
        <>
            <div className="flex gap-2 flex-nowrap items-stretch min-w-0">
                <div className="flex-1 min-w-0">
                    <Select
                        value={styleSelectValue}
                        options={BORDER_STYLE_SELECT_OPTIONS}
                        fullWidth
                        onChange={next => onBorderStyleChange(String(next))}
                    />
                </div>
                <div className="min-w-0 basis-28 shrink grow-0">
                    <div className="flex items-center gap-1 min-w-0">
                        <NumericDraftEnhancedInput
                            committedDisplay={String(Math.max(0, borderWidth))}
                            draftResetKey={`${draftResetKey}-bw`}
                            onFiniteNumber={width => {
                                if (width < 0) return;
                                onBorderWidthChange(width);
                            }}
                            inputMode="numeric"
                            type="number"
                            min={0}
                            unit="px"
                            leftIcon={<Square className="w-4 h-4 text-fg-muted" />}
                            className="w-full min-w-0"
                        />
                        {motionVisible ? (
                            <AppearanceFieldMotionButton
                                variant={variant}
                                setFieldTransition={setFieldTransition}
                                groupKey="borderWidth"
                                draftResetKey={draftResetKey}
                            />
                        ) : null}
                    </div>
                </div>
                <button
                    type="button"
                    title={t("widgetAppearance.border.sidesTitle")}
                    aria-label={t("widgetAppearance.border.sidesExpandAria")}
                    aria-pressed={sidesExpanded}
                    onClick={toggleSidesExpanded}
                    className={controlButtonClass(sidesExpanded)}
                >
                    <ChevronsDownUp className="w-4 h-4" />
                </button>
            </div>

            {sidesExpanded ? (
                <div className="mt-1 min-w-0">
                    <IconButtonSegGroup
                        options={STROKE_SIDE_OPTIONS}
                        mode="multipleExclusivePrimary"
                        exclusivePrimaryId="all"
                        value={strokeSideSelectedIds(sideStr)}
                        onChange={next => {
                            if (Array.isArray(next)) {
                                onStrokeSideChange(strokeSideSpecFromSelectedIds(next));
                            }
                        }}
                        showLabels={false}
                        density="compact"
                    />
                </div>
            ) : null}

            <div className="flex gap-2 flex-nowrap items-center min-w-0 pt-1">
                <div className="flex items-center gap-1 shrink-0">
                    <ColorPickerTrigger
                        value={parseColorValue(String(borderColorCss ?? ""), {
                            hex: "#000000",
                            alpha: 1,
                        })}
                        displayMode="icon"
                        allowOpacity={false}
                        onChange={onBorderColorChange}
                    />
                    {motionVisible ? (
                        <AppearanceFieldMotionButton
                            variant={variant}
                            setFieldTransition={setFieldTransition}
                            groupKey="borderColor"
                            draftResetKey={draftResetKey}
                        />
                    ) : null}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 min-w-0">
                        <NumericDraftEnhancedInput
                            committedDisplay={formatPercentDisplay(readFiniteNumber(strokeOpacity01, 1))}
                            draftResetKey={`${draftResetKey}-so`}
                            onFiniteNumber={value => {
                                const clamped = Math.min(100, Math.max(0, value));
                                onStrokeOpacity01Change(clamped / 100);
                            }}
                            inputMode="decimal"
                            unit="%"
                            min={0}
                            max={100}
                            precision={null}
                            leftIcon={<Droplets className="w-4 h-4 text-fg-muted" />}
                            className="w-full min-w-0"
                        />
                        {motionVisible ? (
                            <AppearanceFieldMotionButton
                                variant={variant}
                                setFieldTransition={setFieldTransition}
                                groupKey="strokeOpacity"
                                draftResetKey={draftResetKey}
                            />
                        ) : null}
                    </div>
                </div>
                <InlineMenuTriggerButton menu={moreMenu} ariaLabel={moreMenuAriaLabel} className="z-10 shrink-0" />
            </div>
        </>
    );
}
