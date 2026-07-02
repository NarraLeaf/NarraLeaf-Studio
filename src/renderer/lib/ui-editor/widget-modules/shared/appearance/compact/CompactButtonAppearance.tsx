import { useEffect } from "react";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { colorValueToCss } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { ColorValue } from "@/apps/workspace/modules/properties/framework/types";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { getSupportedEffectKindsForWidgetType } from "@shared/types/ui-editor/effects";
import { buttonPropsToImageFillBaseline, getButtonProps } from "@/lib/ui-editor/widget-modules/builtin/button/helpers";
import type {
    AppearanceFieldTransition,
    AppearancePropertyKey,
    AppearanceVariant,
    ButtonAppearancePropertyKey,
} from "@shared/types/ui-editor/appearance";
import type { RectangleLikeProps, StrokeJoin } from "@shared/types/ui-editor/rectangleLike";
import { STROKE_ALIGN_OPTIONS, STROKE_JOIN_OPTIONS } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { Droplets, Move } from "lucide-react";
import { formatPercentDisplay, readFiniteNumber } from "./appearanceCompactHelpers";
import {
    BUTTON_MODULE_KEYS,
    type ButtonAppearanceModuleId,
    getRowValueForModuleEdit,
    moduleFullyHasExclusiveState,
    type ModuleEditMode,
    updateRowValueForModuleEditOrEnsure,
} from "./appearanceModuleState";
import { CompactModuleCard } from "./CompactModuleCard";
import { CompactModuleStateHeader } from "./CompactModuleStateHeader";
import { CompactBackgroundAppearance } from "./CompactBackgroundAppearance";
import { BorderStrokeCompactRows } from "./BorderStrokeCompactRows";
import { AppearanceFieldMotionButton, ModuleMotionMenuButton } from "./AppearanceMotionControls";
import { CompactEffectsAppearance } from "./CompactEffectsAppearance";
import { ButtonCursorSelect } from "../editors/ButtonCursorSelect";

type Props = {
    variant: AppearanceVariant;
    commitVariant: (v: AppearanceVariant) => void;
    setFieldTransition: (groupKey: AppearancePropertyKey, transition: AppearanceFieldTransition | null) => void;
    draftResetKey: string;
    inspectorData: UIInspectorData;
    onSaving: (saving: boolean) => void;
    buttonModuleModes: Record<ButtonAppearanceModuleId, ModuleEditMode>;
    setButtonModuleMode: (module: ButtonAppearanceModuleId, mode: ModuleEditMode) => void;
    buttonMotionVisibility: Record<ButtonAppearanceModuleId, boolean>;
    setButtonMotionVisible: (module: ButtonAppearanceModuleId, visible: boolean) => void;
    motionFieldsConfigured: Record<ButtonAppearanceModuleId, boolean>;
};

export function CompactButtonAppearance({
    variant,
    commitVariant,
    setFieldTransition,
    draftResetKey,
    inspectorData,
    onSaving,
    buttonModuleModes,
    setButtonModuleMode,
    buttonMotionVisibility,
    setButtonMotionVisible,
    motionFieldsConfigured,
}: Props) {
    const backgroundMode = buttonModuleModes.background;
    const borderMode = buttonModuleModes.border;
    const spacingMode = buttonModuleModes.spacing;
    const transformMode = buttonModuleModes.transform;
    const effectsMode = buttonModuleModes.effects;
    const backgroundMotionVisible = buttonMotionVisibility.background;
    const borderMotionVisible = buttonMotionVisibility.border;
    const spacingMotionVisible = buttonMotionVisibility.spacing;
    const transformMotionVisible = buttonMotionVisibility.transform;
    const effectsMotionVisible = buttonMotionVisibility.effects;

    const flat = getButtonProps(inspectorData.element);
    const imageFillBaseline = buttonPropsToImageFillBaseline(flat);

    useEffect(() => {
        (["background", "border", "spacing", "transform", "effects"] as const).forEach(mid => {
            const m = buttonModuleModes[mid];
            if (m !== "default" && !moduleFullyHasExclusiveState(variant, BUTTON_MODULE_KEYS[mid], m)) {
                setButtonModuleMode(mid, "default");
            }
        });
    }, [variant, buttonModuleModes, setButtonModuleMode]);

    const getBorder = (key: ButtonAppearancePropertyKey) => getRowValueForModuleEdit(variant, key, borderMode);
    const getSpacing = (key: ButtonAppearancePropertyKey) => getRowValueForModuleEdit(variant, key, spacingMode);
    const cursorValue = getRowValueForModuleEdit(variant, "cursor", "default");

    const patchBorder = (key: ButtonAppearancePropertyKey, value: unknown) => {
        commitVariant(
            updateRowValueForModuleEditOrEnsure(
                variant,
                BUTTON_MODULE_KEYS.border,
                key,
                borderMode,
                value as never
            )
        );
    };

    const patchSpacing = (key: ButtonAppearancePropertyKey, value: unknown) => {
        commitVariant(
            updateRowValueForModuleEditOrEnsure(
                variant,
                BUTTON_MODULE_KEYS.spacing,
                key,
                spacingMode,
                value as never
            )
        );
    };
    const patchCursor = (value: unknown) => {
        commitVariant(updateRowValueForModuleEditOrEnsure(variant, ["cursor"], "cursor", "default", value as never));
    };

    const getTransform = (key: ButtonAppearancePropertyKey) =>
        getRowValueForModuleEdit(variant, key, transformMode);
    const patchTransform = (key: ButtonAppearancePropertyKey, value: unknown) => {
        commitVariant(
            updateRowValueForModuleEditOrEnsure(
                variant,
                BUTTON_MODULE_KEYS.transform,
                key,
                transformMode,
                value as never
            )
        );
    };

    const buildBorderMoreMenu = (): ContextMenuDef => [
        {
            id: "border-align",
            label: "Border align",
            submenu: STROKE_ALIGN_OPTIONS.map(option => ({
                id: `border-align-${option.value}`,
                label: option.label,
                onClick: () => {
                    patchBorder("strokeAlign", String(option.value) as RectangleLikeProps["strokeAlign"]);
                },
            })),
        },
        { separator: true, id: "border-more-separator" },
        {
            id: "border-join",
            label: "Corner join",
            submenu: STROKE_JOIN_OPTIONS.map(option => ({
                id: `border-join-${option.value}`,
                label: option.label,
                onClick: () => {
                    patchBorder("borderJoin", option.value as StrokeJoin);
                },
            })),
        },
    ];

    return (
        <div className="space-y-3 min-w-0">
            <CompactBackgroundAppearance
                variant={variant}
                commitVariant={commitVariant}
                inspectorData={inspectorData}
                draftResetKey={draftResetKey}
                onSaving={onSaving}
                moduleKeys={BUTTON_MODULE_KEYS.background}
                editMode={backgroundMode}
                onModeChange={m => setButtonModuleMode("background", m)}
                imageFillBaseline={imageFillBaseline}
                imageFillFieldId="compact.button.imageFill"
                motionVisible={backgroundMotionVisible}
                onMotionVisibleChange={visible => setButtonMotionVisible("background", visible)}
                moduleMotionFieldsConfigured={motionFieldsConfigured.background}
                setFieldTransition={setFieldTransition}
            />

            <CompactModuleCard
                title="Border"
                headerHoverAction={
                    <ModuleMotionMenuButton
                        enabled={borderMotionVisible}
                        hasConfiguredFields={motionFieldsConfigured.border}
                        onEnabledChange={visible => setButtonMotionVisible("border", visible)}
                    />
                }
                headerRight={
                    <CompactModuleStateHeader
                        variant={variant}
                        commitVariant={commitVariant}
                        moduleKeys={BUTTON_MODULE_KEYS.border}
                        mode={borderMode}
                        onModeChange={m => setButtonModuleMode("border", m)}
                    />
                }
            >
                <div className="flex flex-wrap gap-2 min-w-0">
                    <div className="flex-1 min-w-[6rem]">
                        <div className="flex items-center gap-1 min-w-0">
                            <NumericDraftEnhancedInput
                                committedDisplay={String(readFiniteNumber(getBorder("borderRadius"), 0))}
                                draftResetKey={`${draftResetKey}-br`}
                                onFiniteNumber={v => {
                                    if (v < 0) return;
                                    patchBorder("borderRadius", Math.min(999, v));
                                }}
                                inputMode="numeric"
                                type="number"
                                min={0}
                                max={999}
                                unit="px"
                                className="w-full min-w-0"
                                selectAllOnFocus
                            />
                            {borderMotionVisible ? (
                                <AppearanceFieldMotionButton
                                    variant={variant}
                                    setFieldTransition={setFieldTransition}
                                    groupKey="borderRadius"
                                    draftResetKey={draftResetKey}
                                />
                            ) : null}
                        </div>
                    </div>
                </div>
                <div className="pt-2 space-y-1 min-w-0">
                    <BorderStrokeCompactRows
                        elementId={inspectorData.element.id}
                        draftResetKey={draftResetKey}
                        variant={variant}
                        setFieldTransition={setFieldTransition}
                        motionVisible={borderMotionVisible}
                        borderStyleValue={String(getBorder("borderStyle") ?? "none")}
                        onBorderStyleChange={next => patchBorder("borderStyle", next)}
                        borderWidth={readFiniteNumber(getBorder("borderWidth"), 0)}
                        onBorderWidthChange={width => patchBorder("borderWidth", Math.min(64, width))}
                        strokeSideRaw={String(getBorder("strokeSide") ?? "all")}
                        onStrokeSideChange={next => patchBorder("strokeSide", next)}
                        borderColorCss={String(getBorder("borderColor") ?? "")}
                        onBorderColorChange={(next: ColorValue) => patchBorder("borderColor", colorValueToCss(next))}
                        strokeOpacity01={readFiniteNumber(getBorder("strokeOpacity"), 1)}
                        onStrokeOpacity01Change={o => patchBorder("strokeOpacity", o)}
                        moreMenu={buildBorderMoreMenu()}
                        moreMenuAriaLabel="More border options"
                    />
                </div>
            </CompactModuleCard>

            <CompactModuleCard
                title="Spacing"
                headerHoverAction={
                    <ModuleMotionMenuButton
                        enabled={spacingMotionVisible}
                        hasConfiguredFields={motionFieldsConfigured.spacing}
                        onEnabledChange={visible => setButtonMotionVisible("spacing", visible)}
                    />
                }
                headerRight={
                    <CompactModuleStateHeader
                        variant={variant}
                        commitVariant={commitVariant}
                        moduleKeys={BUTTON_MODULE_KEYS.spacing}
                        mode={spacingMode}
                        onModeChange={m => setButtonModuleMode("spacing", m)}
                    />
                }
            >
                <div className="flex flex-wrap gap-2 min-w-0">
                    <div className="flex-1 min-w-[6rem]">
                        <div className="flex items-center gap-1 min-w-0">
                            <NumericDraftEnhancedInput
                                committedDisplay={String(readFiniteNumber(getSpacing("paddingX"), 0))}
                                draftResetKey={`${draftResetKey}-px`}
                                onFiniteNumber={v => {
                                    if (v < 0) return;
                                    patchSpacing("paddingX", Math.min(128, v));
                                }}
                                inputMode="numeric"
                                type="number"
                                min={0}
                                max={128}
                                unit="px"
                                className="w-full min-w-0"
                                selectAllOnFocus
                            />
                            {spacingMotionVisible ? (
                                <AppearanceFieldMotionButton
                                    variant={variant}
                                    setFieldTransition={setFieldTransition}
                                    groupKey="paddingX"
                                    draftResetKey={draftResetKey}
                                />
                            ) : null}
                        </div>
                    </div>
                    <div className="flex-1 min-w-[6rem]">
                        <div className="flex items-center gap-1 min-w-0">
                            <NumericDraftEnhancedInput
                                committedDisplay={String(readFiniteNumber(getSpacing("paddingY"), 0))}
                                draftResetKey={`${draftResetKey}-py`}
                                onFiniteNumber={v => {
                                    if (v < 0) return;
                                    patchSpacing("paddingY", Math.min(128, v));
                                }}
                                inputMode="numeric"
                                type="number"
                                min={0}
                                max={128}
                                unit="px"
                                className="w-full min-w-0"
                                selectAllOnFocus
                            />
                            {spacingMotionVisible ? (
                                <AppearanceFieldMotionButton
                                    variant={variant}
                                    setFieldTransition={setFieldTransition}
                                    groupKey="paddingY"
                                    draftResetKey={draftResetKey}
                                />
                            ) : null}
                        </div>
                    </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer pt-1">
                    <input
                        type="checkbox"
                        checked={Boolean(getSpacing("clipContent"))}
                        onChange={e => patchSpacing("clipContent", e.target.checked)}
                        className="rounded border-white/20"
                    />
                    Clip content
                </label>
            </CompactModuleCard>

            <CompactModuleCard title="Mouse">
                <ButtonCursorSelect value={cursorValue} onChange={patchCursor} />
            </CompactModuleCard>

            <CompactModuleCard
                title="Transform"
                headerHoverAction={
                    <ModuleMotionMenuButton
                        enabled={transformMotionVisible}
                        hasConfiguredFields={motionFieldsConfigured.transform}
                        onEnabledChange={visible => setButtonMotionVisible("transform", visible)}
                    />
                }
                headerRight={
                    <CompactModuleStateHeader
                        variant={variant}
                        commitVariant={commitVariant}
                        moduleKeys={BUTTON_MODULE_KEYS.transform}
                        mode={transformMode}
                        onModeChange={m => setButtonModuleMode("transform", m)}
                    />
                }
            >
                <div className="flex flex-wrap gap-2 min-w-0">
                    <div className="flex min-w-[6rem] flex-1 flex-col gap-1">
                        <span className="text-xs font-medium text-gray-400">X offset</span>
                        <div className="flex items-center gap-1 min-w-0">
                            <NumericDraftEnhancedInput
                                committedDisplay={String(readFiniteNumber(getTransform("transformOffsetX"), 0))}
                                draftResetKey={`${draftResetKey}-tox`}
                                onFiniteNumber={v => patchTransform("transformOffsetX", v)}
                                inputMode="numeric"
                                type="number"
                                unit="px"
                                leftIcon={<Move className="w-4 h-4 text-gray-400" />}
                                className="w-full min-w-0"
                                selectAllOnFocus
                            />
                            {transformMotionVisible ? (
                                <AppearanceFieldMotionButton
                                    variant={variant}
                                    setFieldTransition={setFieldTransition}
                                    groupKey="transformOffsetX"
                                    draftResetKey={draftResetKey}
                                />
                            ) : null}
                        </div>
                    </div>
                    <div className="flex min-w-[6rem] flex-1 flex-col gap-1">
                        <span className="text-xs font-medium text-gray-400">Y offset</span>
                        <div className="flex items-center gap-1 min-w-0">
                            <NumericDraftEnhancedInput
                                committedDisplay={String(readFiniteNumber(getTransform("transformOffsetY"), 0))}
                                draftResetKey={`${draftResetKey}-toy`}
                                onFiniteNumber={v => patchTransform("transformOffsetY", v)}
                                inputMode="numeric"
                                type="number"
                                unit="px"
                                leftIcon={<Move className="w-4 h-4 text-gray-400" />}
                                className="w-full min-w-0"
                                selectAllOnFocus
                            />
                            {transformMotionVisible ? (
                                <AppearanceFieldMotionButton
                                    variant={variant}
                                    setFieldTransition={setFieldTransition}
                                    groupKey="transformOffsetY"
                                    draftResetKey={draftResetKey}
                                />
                            ) : null}
                        </div>
                    </div>
                </div>

                <div className="mt-2 flex min-w-0 flex-col gap-1">
                    <span className="text-xs font-medium text-gray-400">Zoom</span>
                    <div className="flex items-center gap-1 min-w-0">
                        <NumericDraftEnhancedInput
                            committedDisplay={formatPercentDisplay(readFiniteNumber(getTransform("transformScale"), 1))}
                            draftResetKey={`${draftResetKey}-ts`}
                            onFiniteNumber={value => {
                                const clamped = Math.min(500, Math.max(1, value));
                                patchTransform("transformScale", clamped / 100);
                            }}
                            inputMode="decimal"
                            unit="%"
                            min={1}
                            max={500}
                            precision={null}
                            className="w-full min-w-0 flex-1"
                            selectAllOnFocus
                        />
                        {transformMotionVisible ? (
                            <AppearanceFieldMotionButton
                                variant={variant}
                                setFieldTransition={setFieldTransition}
                                groupKey="transformScale"
                                draftResetKey={draftResetKey}
                            />
                        ) : null}
                    </div>
                </div>

                <div className="mt-2 flex min-w-0 flex-col gap-1">
                    <span className="text-xs font-medium text-gray-400">Rotation</span>
                    <div className="flex items-center gap-1 min-w-0">
                        <NumericDraftEnhancedInput
                            committedDisplay={String(readFiniteNumber(getTransform("transformRotation"), 0))}
                            draftResetKey={`${draftResetKey}-tr`}
                            onFiniteNumber={v => patchTransform("transformRotation", v)}
                            inputMode="numeric"
                            type="number"
                            unit="°"
                            className="w-full min-w-0 flex-1"
                            selectAllOnFocus
                        />
                        {transformMotionVisible ? (
                            <AppearanceFieldMotionButton
                                variant={variant}
                                setFieldTransition={setFieldTransition}
                                groupKey="transformRotation"
                                draftResetKey={draftResetKey}
                            />
                        ) : null}
                    </div>
                </div>

                <div className="mt-2 flex min-w-0 flex-col gap-1">
                    <span className="text-xs font-medium text-gray-400">Opacity</span>
                    <div className="flex items-center gap-1 min-w-0">
                        <NumericDraftEnhancedInput
                            committedDisplay={formatPercentDisplay(
                                readFiniteNumber(getTransform("transformOpacity"), 1)
                            )}
                            draftResetKey={`${draftResetKey}-top`}
                            onFiniteNumber={value => {
                                const clamped = Math.min(100, Math.max(0, value));
                                patchTransform("transformOpacity", clamped / 100);
                            }}
                            inputMode="decimal"
                            unit="%"
                            min={0}
                            max={100}
                            precision={null}
                            leftIcon={<Droplets className="w-4 h-4 text-gray-400" />}
                            className="w-full min-w-0 flex-1"
                            selectAllOnFocus
                        />
                        {transformMotionVisible ? (
                            <AppearanceFieldMotionButton
                                variant={variant}
                                setFieldTransition={setFieldTransition}
                                groupKey="transformOpacity"
                                draftResetKey={draftResetKey}
                            />
                        ) : null}
                    </div>
                </div>
            </CompactModuleCard>

            <CompactEffectsAppearance
                variant={variant}
                commitVariant={commitVariant}
                setFieldTransition={setFieldTransition}
                draftResetKey={draftResetKey}
                moduleKeys={BUTTON_MODULE_KEYS.effects}
                editMode={effectsMode}
                onModeChange={m => setButtonModuleMode("effects", m)}
                motionVisible={effectsMotionVisible}
                onMotionVisibleChange={visible => setButtonMotionVisible("effects", visible)}
                moduleMotionFieldsConfigured={motionFieldsConfigured.effects}
                supportedKinds={getSupportedEffectKindsForWidgetType(inspectorData.element.type)}
            />
        </div>
    );
}
