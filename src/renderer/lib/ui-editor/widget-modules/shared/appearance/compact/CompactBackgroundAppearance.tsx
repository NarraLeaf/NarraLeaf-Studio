import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { ImageFillField } from "@/apps/workspace/modules/properties/framework/fields/ImageFillField";
import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { ColorValue, ImageFillFieldDefinition } from "@/apps/workspace/modules/properties/framework/types";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { Select } from "@/lib/components/elements/Select";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import type { AppearanceRowValue, AppearanceVariant } from "@shared/types/ui-editor/appearance";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import { Droplets, Eye, EyeOff } from "lucide-react";
import { FILL_TYPE_OPTIONS, controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { normalizeImageFill } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import { formatPercentDisplay, readFiniteNumber } from "./appearanceCompactHelpers";
import {
    getRowValueForModuleEdit,
    type ModuleEditMode,
    updateRowValueForModuleEditOrEnsure,
} from "./appearanceModuleState";
import { CompactModuleCard } from "./CompactModuleCard";
import { CompactModuleStateHeader } from "./CompactModuleStateHeader";

export type CompactBackgroundAppearanceProps = {
    variant: AppearanceVariant;
    commitVariant: (v: AppearanceVariant) => void;
    inspectorData: UIInspectorData;
    draftResetKey: string;
    onSaving: (saving: boolean) => void;
    /** Keys owned by this module (used for conditional state rows). */
    moduleKeys: readonly string[];
    editMode: ModuleEditMode;
    onModeChange: (mode: ModuleEditMode) => void;
    /** Baseline for `normalizeImageFill` when `imageFill` row is empty (container: element props; button: synthesized). */
    imageFillBaseline: RectangleLikeProps;
    /** Stable id for the nested ImageFillField definition. */
    imageFillFieldId: string;
};

/** Solid RGB for the picker; layer transparency uses `fillOpacity` / `fillVisible`, not color alpha. */
function backgroundColorPickerValue(raw: AppearanceRowValue | undefined): ColorValue {
    const s = String(raw ?? "").trim();
    if (!s || s.toLowerCase() === "transparent") {
        return { hex: "#ffffff", alpha: 1 };
    }
    const parsed = parseColorValue(s, { hex: "#ffffff", alpha: 1 });
    return { hex: parsed.hex, alpha: 1 };
}

function patchManyBackground(
    variant: AppearanceVariant,
    moduleKeys: readonly string[],
    editMode: ModuleEditMode,
    updates: { key: string; value: AppearanceRowValue }[]
): AppearanceVariant {
    let v = variant;
    for (const u of updates) {
        v = updateRowValueForModuleEditOrEnsure(v, moduleKeys, u.key, editMode, u.value);
    }
    return v;
}

export function CompactBackgroundAppearance({
    variant,
    commitVariant,
    inspectorData,
    draftResetKey,
    onSaving,
    moduleKeys,
    editMode,
    onModeChange,
    imageFillBaseline,
    imageFillFieldId,
}: CompactBackgroundAppearanceProps) {
    const getBg = (key: string) => getRowValueForModuleEdit(variant, key, editMode);

    const patchBg = (key: string, value: AppearanceRowValue) => {
        commitVariant(updateRowValueForModuleEditOrEnsure(variant, moduleKeys, key, editMode, value));
    };

    const fillTypeRaw = String(getBg("fillType") ?? "color");
    const fillType: RectangleLikeProps["fillType"] = fillTypeRaw === "image" ? "image" : "color";

    const imageFillFieldDef: ImageFillFieldDefinition<UIInspectorData> = {
        type: "imageFill",
        id: imageFillFieldId,
        label: "Image fill",
        getValue: () => {
            const raw = getBg("imageFill");
            if (raw && typeof raw === "object" && "mode" in (raw as object)) {
                return raw as ImageFill;
            }
            return normalizeImageFill(imageFillBaseline);
        },
        setValue: (_d, imgVal) => {
            commitVariant(
                patchManyBackground(variant, moduleKeys, editMode, [
                    { key: "fillType", value: "image" },
                    { key: "imageFill", value: imgVal },
                ])
            );
        },
    };

    return (
        <CompactModuleCard
            title="Background"
            headerRight={
                <CompactModuleStateHeader
                    variant={variant}
                    commitVariant={commitVariant}
                    moduleKeys={moduleKeys}
                    mode={editMode}
                    onModeChange={onModeChange}
                />
            }
        >
            <Select
                value={fillType}
                options={FILL_TYPE_OPTIONS}
                fullWidth
                onChange={next => {
                    const s = String(next) as RectangleLikeProps["fillType"];
                    patchBg("fillType", s);
                }}
            />

            {fillType === "color" && (
                <div className="flex flex-wrap gap-2 items-center min-w-0 mt-2">
                    <ColorPickerTrigger
                        value={backgroundColorPickerValue(getBg("backgroundColor"))}
                        displayMode="icon"
                        allowOpacity={false}
                        onChange={(next: ColorValue) =>
                            patchBg("backgroundColor", colorValueToCss({ hex: next.hex, alpha: 1 }))
                        }
                    />
                    <div className="flex-1 min-w-[6rem]">
                        <NumericDraftEnhancedInput
                            committedDisplay={formatPercentDisplay(readFiniteNumber(getBg("fillOpacity"), 1))}
                            draftResetKey={`${draftResetKey}-bg-fill-op`}
                            onFiniteNumber={value => {
                                const clamped = Math.min(100, Math.max(0, value));
                                patchBg("fillOpacity", clamped / 100);
                            }}
                            inputMode="decimal"
                            unit="%"
                            min={0}
                            max={100}
                            precision={null}
                            leftIcon={<Droplets className="w-4 h-4 text-gray-400" />}
                            className="w-full min-w-0"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => patchBg("fillVisible", !Boolean(getBg("fillVisible") ?? true))}
                        aria-pressed={Boolean(getBg("fillVisible") ?? true)}
                        aria-label="Toggle background visibility"
                        className={controlButtonClass(Boolean(getBg("fillVisible") ?? true))}
                    >
                        {Boolean(getBg("fillVisible") ?? true) ? (
                            <Eye className="w-4 h-4" />
                        ) : (
                            <EyeOff className="w-4 h-4" />
                        )}
                    </button>
                </div>
            )}

            {fillType === "image" && (
                <div className="space-y-2 min-w-0 mt-2">
                    <ImageFillField field={imageFillFieldDef} data={inspectorData} onSaving={onSaving} />
                    <div className="flex flex-wrap gap-2 items-center min-w-0">
                        <div className="flex-1 min-w-0">
                            <NumericDraftEnhancedInput
                                committedDisplay={formatPercentDisplay(readFiniteNumber(getBg("fillOpacity"), 1))}
                                draftResetKey={`${draftResetKey}-bg-img-op`}
                                onFiniteNumber={value => {
                                    const clamped = Math.min(100, Math.max(0, value));
                                    patchBg("fillOpacity", clamped / 100);
                                }}
                                inputMode="decimal"
                                unit="%"
                                min={0}
                                max={100}
                                precision={null}
                                leftIcon={<Droplets className="w-4 h-4 text-gray-400" />}
                                className="w-full min-w-0"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => patchBg("fillVisible", !Boolean(getBg("fillVisible") ?? true))}
                            aria-pressed={Boolean(getBg("fillVisible") ?? true)}
                            aria-label="Toggle background visibility"
                            className={controlButtonClass(Boolean(getBg("fillVisible") ?? true))}
                        >
                            {Boolean(getBg("fillVisible") ?? true) ? (
                                <Eye className="w-4 h-4" />
                            ) : (
                                <EyeOff className="w-4 h-4" />
                            )}
                        </button>
                    </div>
                </div>
            )}
        </CompactModuleCard>
    );
}
