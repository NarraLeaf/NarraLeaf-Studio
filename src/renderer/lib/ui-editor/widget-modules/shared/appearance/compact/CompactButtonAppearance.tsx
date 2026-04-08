import { useEffect } from "react";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { ColorValue } from "@/apps/workspace/modules/properties/framework/types";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { Select } from "@/lib/components/elements/Select";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { buttonPropsToImageFillBaseline, getButtonProps } from "@/lib/ui-editor/widget-modules/builtin/button/helpers";
import type {
    AppearanceFieldTransition,
    AppearancePropertyKey,
    AppearanceVariant,
    ButtonAppearancePropertyKey,
} from "@shared/types/ui-editor/appearance";
import { Square } from "lucide-react";
import { readFiniteNumber } from "./appearanceCompactHelpers";
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
import { AppearanceFieldMotionButton, ModuleMotionMenuButton } from "./AppearanceMotionControls";

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
    const backgroundMotionVisible = buttonMotionVisibility.background;
    const borderMotionVisible = buttonMotionVisibility.border;
    const spacingMotionVisible = buttonMotionVisibility.spacing;

    const flat = getButtonProps(inspectorData.element);
    const imageFillBaseline = buttonPropsToImageFillBaseline(flat);

    useEffect(() => {
        (["background", "border", "spacing"] as const).forEach(mid => {
            const m = buttonModuleModes[mid];
            if (m !== "default" && !moduleFullyHasExclusiveState(variant, BUTTON_MODULE_KEYS[mid], m)) {
                setButtonModuleMode(mid, "default");
            }
        });
    }, [variant, buttonModuleModes, setButtonModuleMode]);

    const getBorder = (key: ButtonAppearancePropertyKey) => getRowValueForModuleEdit(variant, key, borderMode);
    const getSpacing = (key: ButtonAppearancePropertyKey) => getRowValueForModuleEdit(variant, key, spacingMode);

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
                    <div className="flex-1 min-w-[6rem]">
                        <div className="flex items-center gap-1 min-w-0">
                            <NumericDraftEnhancedInput
                                committedDisplay={String(readFiniteNumber(getBorder("borderWidth"), 0))}
                                draftResetKey={`${draftResetKey}-bw`}
                                onFiniteNumber={v => {
                                    if (v < 0) return;
                                    patchBorder("borderWidth", Math.min(64, v));
                                }}
                                inputMode="numeric"
                                type="number"
                                min={0}
                                max={64}
                                unit="px"
                                leftIcon={<Square className="w-4 h-4 text-gray-400" />}
                                className="w-full min-w-0"
                                selectAllOnFocus
                            />
                            {borderMotionVisible ? (
                                <AppearanceFieldMotionButton
                                    variant={variant}
                                    setFieldTransition={setFieldTransition}
                                    groupKey="borderWidth"
                                    draftResetKey={draftResetKey}
                                />
                            ) : null}
                        </div>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2 items-center min-w-0">
                    <div className="flex items-center gap-1 shrink-0">
                        <ColorPickerTrigger
                            value={parseColorValue(String(getBorder("borderColor") ?? ""), {
                                hex: "#000000",
                                alpha: 1,
                            })}
                            displayMode="icon"
                            allowOpacity={false}
                            onChange={(next: ColorValue) => patchBorder("borderColor", colorValueToCss(next))}
                        />
                        {borderMotionVisible ? (
                            <AppearanceFieldMotionButton
                                variant={variant}
                                setFieldTransition={setFieldTransition}
                                groupKey="borderColor"
                                draftResetKey={draftResetKey}
                            />
                        ) : null}
                    </div>
                    <div className="flex-1 min-w-0">
                        <Select
                            value={(() => {
                                const v = String(getBorder("borderStyle") ?? "none");
                                return v === "solid" || v === "dashed" || v === "none" ? v : "none";
                            })()}
                            options={[
                                { value: "none", label: "None" },
                                { value: "solid", label: "Solid" },
                                { value: "dashed", label: "Dashed" },
                            ]}
                            fullWidth
                            onChange={next => patchBorder("borderStyle", String(next))}
                        />
                    </div>
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
        </div>
    );
}
