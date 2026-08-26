import { useEffect } from "react";
import { useTranslation } from "@/lib/i18n";
import { Switch } from "@/lib/components/elements";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { serializeColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { ColorValue } from "@/apps/workspace/modules/properties/framework/types";
import type { FontAssetFieldDefinition } from "@/apps/workspace/modules/properties/framework/types";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { FontAssetField } from "@/apps/workspace/modules/properties/framework/fields/FontAssetField";
import { parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { Select } from "@/lib/components/elements/Select";
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
import { Baseline, Droplets, Move, Type } from "lucide-react";
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
import { useAppearancePositionInLayout } from "../appearancePositionOwner";

/** Appearance rows hold authored data, so a value that is not a string is not one to render. */
function readString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.length > 0 ? value : fallback;
}

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
    const { t } = useTranslation();
    const positionInLayout = useAppearancePositionInLayout();
    const typographyMode = buttonModuleModes.typography;
    const backgroundMode = buttonModuleModes.background;
    const borderMode = buttonModuleModes.border;
    const spacingMode = buttonModuleModes.spacing;
    const transformMode = buttonModuleModes.transform;
    const effectsMode = buttonModuleModes.effects;
    const typographyMotionVisible = buttonMotionVisibility.typography;
    const backgroundMotionVisible = buttonMotionVisibility.background;
    const borderMotionVisible = buttonMotionVisibility.border;
    const spacingMotionVisible = buttonMotionVisibility.spacing;
    const transformMotionVisible = buttonMotionVisibility.transform;
    const effectsMotionVisible = buttonMotionVisibility.effects;

    const flat = getButtonProps(inspectorData.element);
    const imageFillBaseline = buttonPropsToImageFillBaseline(flat);

    useEffect(() => {
        (["typography", "background", "border", "spacing", "transform", "effects"] as const).forEach(mid => {
            const m = buttonModuleModes[mid];
            if (m !== "default" && !moduleFullyHasExclusiveState(variant, BUTTON_MODULE_KEYS[mid], m)) {
                setButtonModuleMode(mid, "default");
            }
        });
    }, [variant, buttonModuleModes, setButtonModuleMode]);

    const getTypography = (key: ButtonAppearancePropertyKey) =>
        getRowValueForModuleEdit(variant, key, typographyMode);
    const patchTypography = (key: ButtonAppearancePropertyKey, value: unknown) => {
        commitVariant(
            updateRowValueForModuleEditOrEnsure(
                variant,
                BUTTON_MODULE_KEYS.typography,
                key,
                typographyMode,
                value as never
            )
        );
    };

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
            label: t("widgetAppearance.border.align"),
            submenu: STROKE_ALIGN_OPTIONS.map(option => ({
                id: `border-align-${option.value}`,
                label: t(option.labelKey),
                onClick: () => {
                    patchBorder("strokeAlign", String(option.value) as RectangleLikeProps["strokeAlign"]);
                },
            })),
        },
        { separator: true, id: "border-more-separator" },
        {
            id: "border-join",
            label: t("widgetAppearance.border.cornerJoin"),
            submenu: STROKE_JOIN_OPTIONS.map(option => ({
                id: `border-join-${option.value}`,
                label: t(option.labelKey),
                onClick: () => {
                    patchBorder("borderJoin", option.value as StrokeJoin);
                },
            })),
        },
    ];

    const fontField: FontAssetFieldDefinition<UIInspectorData> = {
        id: "compact.button.fontAssetId",
        type: "fontAsset",
        label: t("widgetAppearance.typography.font"),
        getValue: () => {
            const value = getTypography("fontAssetId");
            return typeof value === "string" ? value : null;
        },
        setValue: (_data, value) => patchTypography("fontAssetId", value ?? null),
    };
    const labelWeight = readString(getTypography("fontWeight"), "normal");
    const labelColor = parseColorValue(readString(getTypography("color"), "#e5e7eb"), { hex: "#e5e7eb", alpha: 1 });

    return (
        <div className="space-y-3 min-w-0">
            <CompactModuleCard
                title={t("widgetAppearance.typography.title")}
                headerHoverAction={
                    <ModuleMotionMenuButton
                        enabled={typographyMotionVisible}
                        hasConfiguredFields={motionFieldsConfigured.typography}
                        onEnabledChange={visible => setButtonMotionVisible("typography", visible)}
                    />
                }
                headerRight={
                    <CompactModuleStateHeader
                        variant={variant}
                        commitVariant={commitVariant}
                        moduleKeys={BUTTON_MODULE_KEYS.typography}
                        mode={typographyMode}
                        onModeChange={m => setButtonModuleMode("typography", m)}
                    />
                }
            >
                <FontAssetField field={fontField} data={inspectorData} onSaving={onSaving} />

                <div className="flex flex-wrap gap-2 min-w-0">
                    <div className="flex-1 min-w-[6rem]">
                        <div className="flex items-center gap-1 min-w-0">
                            <NumericDraftEnhancedInput
                                committedDisplay={String(readFiniteNumber(getTypography("fontSize"), 16))}
                                draftResetKey={`${draftResetKey}-buttonFontSize`}
                                onFiniteNumber={v => patchTypography("fontSize", Math.min(256, Math.max(8, v)))}
                                inputMode="numeric"
                                type="number"
                                min={8}
                                max={256}
                                unit="px"
                                leftIcon={<Type className="w-4 h-4 text-fg-muted" />}
                                className="w-full min-w-0"
                                selectAllOnFocus
                            />
                            {typographyMotionVisible ? (
                                <AppearanceFieldMotionButton
                                    variant={variant}
                                    setFieldTransition={setFieldTransition}
                                    groupKey="fontSize"
                                    draftResetKey={draftResetKey}
                                />
                            ) : null}
                        </div>
                    </div>
                    <div className="flex-1 min-w-[6rem]">
                        <div className="flex items-center gap-1 min-w-0">
                            <NumericDraftEnhancedInput
                                committedDisplay={String(readFiniteNumber(getTypography("lineHeight"), 1.4))}
                                draftResetKey={`${draftResetKey}-buttonLineHeight`}
                                onFiniteNumber={v => {
                                    if (v <= 0) {
                                        return;
                                    }
                                    patchTypography("lineHeight", Math.min(4, Math.max(0.8, v)));
                                }}
                                inputMode="decimal"
                                type="number"
                                min={0.8}
                                max={4}
                                step={0.05}
                                leftIcon={<Baseline className="w-4 h-4 text-fg-muted" />}
                                className="w-full min-w-0"
                                selectAllOnFocus
                            />
                            {typographyMotionVisible ? (
                                <AppearanceFieldMotionButton
                                    variant={variant}
                                    setFieldTransition={setFieldTransition}
                                    groupKey="lineHeight"
                                    draftResetKey={draftResetKey}
                                />
                            ) : null}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-end min-w-0">
                    <div className="min-w-0">
                        <span className="mb-1 block text-xs font-medium text-fg-muted">
                            {t("widgetAppearance.typography.weight")}
                        </span>
                        <Select
                            value={labelWeight}
                            options={[
                                { value: "normal", label: t("widgetAppearance.typography.weightRegular") },
                                { value: "600", label: t("widgetAppearance.typography.weightSemibold") },
                                { value: "bold", label: t("widgetAppearance.typography.weightBold") },
                            ]}
                            fullWidth
                            onChange={next => patchTypography("fontWeight", String(next))}
                        />
                    </div>
                    <div className="flex items-center gap-1">
                        <ColorPickerTrigger
                            value={labelColor}
                            displayMode="icon"
                            brandPalette
                            allowOpacity={false}
                            onChange={(next: ColorValue) => patchTypography("color", serializeColorValue(next))}
                        />
                        {typographyMotionVisible ? (
                            <AppearanceFieldMotionButton
                                variant={variant}
                                setFieldTransition={setFieldTransition}
                                groupKey="color"
                                draftResetKey={draftResetKey}
                            />
                        ) : null}
                    </div>
                </div>
            </CompactModuleCard>

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
                title={t("widgetAppearance.border.title")}
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
                        onBorderColorChange={(next: ColorValue) => patchBorder("borderColor", serializeColorValue(next))}
                        strokeOpacity01={readFiniteNumber(getBorder("strokeOpacity"), 1)}
                        onStrokeOpacity01Change={o => patchBorder("strokeOpacity", o)}
                        moreMenu={buildBorderMoreMenu()}
                        moreMenuAriaLabel={t("widgetAppearance.border.moreOptionsAria")}
                    />
                </div>
            </CompactModuleCard>

            <CompactModuleCard
                title={t("widgetAppearance.spacing.title")}
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
                <div className="flex items-center gap-2 pt-1 text-xs text-fg-muted">
                    <Switch
                        size="sm"
                        checked={Boolean(getSpacing("clipContent"))}
                        onCheckedChange={next => patchSpacing("clipContent", next)}
                        aria-label={t("widgetAppearance.spacing.clipContent")}
                    />
                    {t("widgetAppearance.spacing.clipContent")}
                </div>
            </CompactModuleCard>

            <CompactModuleCard title={t("widgetAppearance.mouse.title")}>
                <ButtonCursorSelect value={cursorValue} onChange={patchCursor} />
            </CompactModuleCard>

            <CompactModuleCard
                title={t("widgetAppearance.transform.title")}
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
                {positionInLayout ? null : (
                    <div className="flex flex-wrap gap-2 min-w-0">
                        <div className="flex min-w-[6rem] flex-1 flex-col gap-1">
                            <span className="text-xs font-medium text-fg-muted">{t("widgetAppearance.transform.xOffset")}</span>
                            <div className="flex items-center gap-1 min-w-0">
                                <NumericDraftEnhancedInput
                                    committedDisplay={String(readFiniteNumber(getTransform("transformOffsetX"), 0))}
                                    draftResetKey={`${draftResetKey}-tox`}
                                    onFiniteNumber={v => patchTransform("transformOffsetX", v)}
                                    inputMode="numeric"
                                    type="number"
                                    unit="px"
                                    leftIcon={<Move className="w-4 h-4 text-fg-muted" />}
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
                            <span className="text-xs font-medium text-fg-muted">{t("widgetAppearance.transform.yOffset")}</span>
                            <div className="flex items-center gap-1 min-w-0">
                                <NumericDraftEnhancedInput
                                    committedDisplay={String(readFiniteNumber(getTransform("transformOffsetY"), 0))}
                                    draftResetKey={`${draftResetKey}-toy`}
                                    onFiniteNumber={v => patchTransform("transformOffsetY", v)}
                                    inputMode="numeric"
                                    type="number"
                                    unit="px"
                                    leftIcon={<Move className="w-4 h-4 text-fg-muted" />}
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
                )}

                <div className="mt-2 flex min-w-0 flex-col gap-1">
                    <span className="text-xs font-medium text-fg-muted">{t("widgetAppearance.transform.zoom")}</span>
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
                    <span className="text-xs font-medium text-fg-muted">{t("widgetAppearance.transform.rotation")}</span>
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
                    <span className="text-xs font-medium text-fg-muted">{t("widgetAppearance.transform.opacity")}</span>
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
                            leftIcon={<Droplets className="w-4 h-4 text-fg-muted" />}
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
