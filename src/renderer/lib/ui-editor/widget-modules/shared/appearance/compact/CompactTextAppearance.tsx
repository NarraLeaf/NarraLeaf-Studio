import { useEffect } from "react";
import {
    Baseline,
    Droplets,
    Italic,
    Move,
    Type,
} from "lucide-react";
import type {
    AppearanceFieldTransition,
    AppearancePropertyKey,
    AppearanceRowValue,
    AppearanceVariant,
    TextAppearancePropertyKey,
} from "@shared/types/ui-editor/appearance";
import { getSupportedEffectKindsForWidgetType } from "@shared/types/ui-editor/effects";
import type { FontAssetFieldDefinition } from "@/apps/workspace/modules/properties/framework/types";
import type { ColorValue } from "@/apps/workspace/modules/properties/framework/types";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { FontAssetField } from "@/apps/workspace/modules/properties/framework/fields/FontAssetField";
import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { Select } from "@/lib/components/elements/Select";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import type { TextWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/text/types";
import {
    getRowValueForModuleEdit,
    moduleFullyHasExclusiveState,
    type ModuleEditMode,
    TEXT_MODULE_KEYS,
    type TextAppearanceModuleId,
    updateRowValueForModuleEditOrEnsure,
} from "./appearanceModuleState";
import { formatPercentDisplay, readFiniteNumber } from "./appearanceCompactHelpers";
import { CompactModuleCard } from "./CompactModuleCard";
import { CompactModuleStateHeader } from "./CompactModuleStateHeader";
import { AppearanceFieldMotionButton, ModuleMotionMenuButton } from "./AppearanceMotionControls";
import { CompactEffectsAppearance } from "./CompactEffectsAppearance";

type Props = {
    variant: AppearanceVariant;
    commitVariant: (v: AppearanceVariant) => void;
    setFieldTransition: (groupKey: AppearancePropertyKey, transition: AppearanceFieldTransition | null) => void;
    draftResetKey: string;
    inspectorData: UIInspectorData;
    onSaving: (saving: boolean) => void;
    textModuleModes: Record<TextAppearanceModuleId, ModuleEditMode>;
    setTextModuleMode: (module: TextAppearanceModuleId, mode: ModuleEditMode) => void;
    textMotionVisibility: Record<TextAppearanceModuleId, boolean>;
    setTextMotionVisible: (module: TextAppearanceModuleId, visible: boolean) => void;
    motionFieldsConfigured: Record<TextAppearanceModuleId, boolean>;
};

function readString(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
}

function segButtonClass(active: boolean): string {
    return [
        "grid h-9 w-9 place-items-center rounded-md border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active
            ? "border-primary/50 bg-primary/20 text-white"
            : "border-edge bg-surface-raised text-fg-muted hover:bg-fill hover:text-white",
    ].join(" ");
}

export function CompactTextAppearance({
    variant,
    commitVariant,
    setFieldTransition,
    draftResetKey,
    inspectorData,
    onSaving,
    textModuleModes,
    setTextModuleMode,
    textMotionVisibility,
    setTextMotionVisible,
    motionFieldsConfigured,
}: Props) {
    const typographyMode = textModuleModes.typography;
    const transformMode = textModuleModes.transform;
    const effectsMode = textModuleModes.effects;
    const typographyMotionVisible = textMotionVisibility.typography;
    const transformMotionVisible = textMotionVisibility.transform;
    const effectsMotionVisible = textMotionVisibility.effects;

    useEffect(() => {
        (["typography", "transform", "effects"] as const).forEach(mid => {
            const m = textModuleModes[mid];
            if (m !== "default" && !moduleFullyHasExclusiveState(variant, TEXT_MODULE_KEYS[mid], m)) {
                setTextModuleMode(mid, "default");
            }
        });
    }, [variant, textModuleModes, setTextModuleMode]);

    const getTypography = (key: TextAppearancePropertyKey) =>
        getRowValueForModuleEdit(variant, key, typographyMode);
    const getTransform = (key: TextAppearancePropertyKey) =>
        getRowValueForModuleEdit(variant, key, transformMode);

    const patch = (
        moduleKeys: readonly TextAppearancePropertyKey[],
        key: TextAppearancePropertyKey,
        mode: ModuleEditMode,
        value: AppearanceRowValue
    ) => {
        commitVariant(updateRowValueForModuleEditOrEnsure(variant, moduleKeys, key, mode, value));
    };

    const patchTypography = (key: TextAppearancePropertyKey, value: AppearanceRowValue) =>
        patch(TEXT_MODULE_KEYS.typography, key, typographyMode, value);
    const patchTransform = (key: TextAppearancePropertyKey, value: AppearanceRowValue) =>
        patch(TEXT_MODULE_KEYS.transform, key, transformMode, value);

    const fontField: FontAssetFieldDefinition<UIInspectorData> = {
        id: "compact.text.fontAssetId",
        type: "fontAsset",
        label: "Font",
        getValue: () => {
            const value = getTypography("fontAssetId");
            return typeof value === "string" ? value : null;
        },
        setValue: (_data, value) => patchTypography("fontAssetId", value ?? null),
    };

    const fontStyle = readString(getTypography("fontStyle"), "normal") as TextWidgetProps["fontStyle"];
    const fontWeight = readString(getTypography("fontWeight"), "normal") as TextWidgetProps["fontWeight"];
    const colorRaw = readString(getTypography("color"), "#e5e7eb");
    const colorValue = parseColorValue(colorRaw, { hex: "#e5e7eb", alpha: 1 });

    return (
        <div className="space-y-3 min-w-0">
            <CompactModuleCard
                title="Typography"
                headerHoverAction={
                    <ModuleMotionMenuButton
                        enabled={typographyMotionVisible}
                        hasConfiguredFields={motionFieldsConfigured.typography}
                        onEnabledChange={visible => setTextMotionVisible("typography", visible)}
                    />
                }
                headerRight={
                    <CompactModuleStateHeader
                        variant={variant}
                        commitVariant={commitVariant}
                        moduleKeys={TEXT_MODULE_KEYS.typography}
                        mode={typographyMode}
                        onModeChange={m => setTextModuleMode("typography", m)}
                    />
                }
            >
                <FontAssetField field={fontField} data={inspectorData} onSaving={onSaving} />

                <div className="flex flex-wrap gap-2 min-w-0">
                    <div className="flex-1 min-w-[6rem]">
                        <div className="flex items-center gap-1 min-w-0">
                            <NumericDraftEnhancedInput
                                committedDisplay={String(readFiniteNumber(getTypography("fontSize"), 16))}
                                draftResetKey={`${draftResetKey}-fontSize`}
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
                                draftResetKey={`${draftResetKey}-lineHeight`}
                                onFiniteNumber={v => {
                                    if (v <= 0) return;
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
                    <button
                        type="button"
                        className={segButtonClass(fontStyle === "italic")}
                        aria-label={fontStyle === "italic" ? "Disable italic" : "Enable italic"}
                        aria-pressed={fontStyle === "italic"}
                        title="Italic"
                        onClick={() => patchTypography("fontStyle", fontStyle === "italic" ? "normal" : "italic")}
                    >
                        <Italic className="h-4 w-4" />
                    </button>
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-end min-w-0">
                    <div className="min-w-0">
                        <span className="mb-1 block text-xs font-medium text-fg-muted">Weight</span>
                        <Select
                            value={fontWeight}
                            options={[
                                { value: "normal", label: "Regular" },
                                { value: "600", label: "Semibold" },
                                { value: "bold", label: "Bold" },
                            ]}
                            fullWidth
                            onChange={next => patchTypography("fontWeight", String(next))}
                        />
                    </div>
                    <div className="flex items-center gap-1">
                        <ColorPickerTrigger
                            value={colorValue}
                            displayMode="icon"
                            allowOpacity={false}
                            onChange={(next: ColorValue) => patchTypography("color", colorValueToCss(next))}
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

            <CompactModuleCard
                title="Transform"
                headerHoverAction={
                    <ModuleMotionMenuButton
                        enabled={transformMotionVisible}
                        hasConfiguredFields={motionFieldsConfigured.transform}
                        onEnabledChange={visible => setTextMotionVisible("transform", visible)}
                    />
                }
                headerRight={
                    <CompactModuleStateHeader
                        variant={variant}
                        commitVariant={commitVariant}
                        moduleKeys={TEXT_MODULE_KEYS.transform}
                        mode={transformMode}
                        onModeChange={m => setTextModuleMode("transform", m)}
                    />
                }
            >
                <div className="flex flex-wrap gap-2 min-w-0">
                    <div className="flex min-w-[6rem] flex-1 flex-col gap-1">
                        <span className="text-xs font-medium text-fg-muted">X offset</span>
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
                        <span className="text-xs font-medium text-fg-muted">Y offset</span>
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

                <div className="mt-2 flex min-w-0 flex-col gap-1">
                    <span className="text-xs font-medium text-fg-muted">Zoom</span>
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
                    <span className="text-xs font-medium text-fg-muted">Rotation</span>
                    <div className="flex items-center gap-1 min-w-0">
                        <NumericDraftEnhancedInput
                            committedDisplay={String(readFiniteNumber(getTransform("transformRotation"), 0))}
                            draftResetKey={`${draftResetKey}-tr`}
                            onFiniteNumber={v => patchTransform("transformRotation", v)}
                            inputMode="numeric"
                            type="number"
                            unit="deg"
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
                    <span className="text-xs font-medium text-fg-muted">Opacity</span>
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
                moduleKeys={TEXT_MODULE_KEYS.effects}
                editMode={effectsMode}
                onModeChange={m => setTextModuleMode("effects", m)}
                motionVisible={effectsMotionVisible}
                onMotionVisibleChange={visible => setTextMotionVisible("effects", visible)}
                moduleMotionFieldsConfigured={motionFieldsConfigured.effects}
                supportedKinds={getSupportedEffectKindsForWidgetType(inspectorData.element.type)}
            />
        </div>
    );
}
