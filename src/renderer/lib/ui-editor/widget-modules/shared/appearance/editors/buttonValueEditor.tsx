import { Droplets, Eye, EyeOff, Square } from "lucide-react";
import type { ColorValue, ImageFillFieldDefinition } from "@/apps/workspace/modules/properties/framework/types";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { ImageFillField } from "@/apps/workspace/modules/properties/framework/fields/ImageFillField";
import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { Select } from "@/lib/components/elements/Select";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { buttonPropsToImageFillBaseline, getButtonProps } from "@/lib/ui-editor/widget-modules/builtin/button/helpers";
import { FILL_TYPE_OPTIONS, controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { normalizeImageFill } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import type { ButtonAppearancePropertyKey } from "@shared/types/ui-editor/appearance";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import { ButtonCursorSelect } from "./ButtonCursorSelect";

export type ButtonValueEditorProps = {
    fieldKey: ButtonAppearancePropertyKey;
    value: unknown;
    onChange: (next: unknown) => void;
    draftResetKey: string;
    inspectorData?: UIInspectorData;
    onSaving?: (saving: boolean) => void;
};

const formatPercentDisplay = (v: number) => String(Math.round(v * 10000) / 100);

export function ButtonAppearanceValueEditor({
    fieldKey,
    value,
    onChange,
    draftResetKey,
    inspectorData,
    onSaving,
}: ButtonValueEditorProps) {
    switch (fieldKey) {
        case "backgroundColor": {
            const raw = typeof value === "string" ? value : String(value ?? "");
            const cv = parseColorValue(raw, { hex: "#374151", alpha: 1 });
            return (
                <ColorPickerTrigger
                    value={cv}
                    displayMode="icon"
                    allowOpacity={false}
                    onChange={(next: ColorValue) => onChange(colorValueToCss(next))}
                />
            );
        }
        case "fillType": {
            const v = String(value ?? "color");
            return (
                <Select
                    value={v === "image" ? "image" : "color"}
                    options={FILL_TYPE_OPTIONS}
                    fullWidth
                    onChange={next => onChange(String(next))}
                />
            );
        }
        case "fillVisible": {
            const visible = Boolean(value);
            return (
                <button
                    type="button"
                    onClick={() => onChange(!visible)}
                    aria-pressed={visible}
                    aria-label="Toggle background visibility"
                    className={controlButtonClass(visible)}
                >
                    {visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
            );
        }
        case "fillOpacity": {
            const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 1;
            const percent = formatPercentDisplay(n);
            return (
                <NumericDraftEnhancedInput
                    committedDisplay={percent}
                    draftResetKey={`${draftResetKey}-fo`}
                    onFiniteNumber={v => {
                        const clamped = Math.min(100, Math.max(0, v));
                        onChange(clamped / 100);
                    }}
                    inputMode="decimal"
                    unit="%"
                    min={0}
                    max={100}
                    precision={null}
                    leftIcon={<Droplets className="w-4 h-4 text-gray-400" />}
                    className="w-full min-w-0"
                />
            );
        }
        case "backgroundImage": {
            const v = typeof value === "string" ? value : String(value ?? "");
            return (
                <input
                    type="text"
                    className="w-full min-w-0 rounded-lg border border-white/10 bg-transparent px-2 py-1.5 text-xs text-gray-200"
                    value={v}
                    onChange={e => onChange(e.target.value)}
                    placeholder="URL or asset ref (legacy)"
                />
            );
        }
        case "backgroundFit": {
            const v = String(value ?? "cover");
            return (
                <Select
                    value={v}
                    options={[
                        { value: "cover", label: "Cover" },
                        { value: "contain", label: "Contain" },
                        { value: "stretch", label: "Stretch" },
                        { value: "tile", label: "Tile" },
                    ]}
                    fullWidth
                    onChange={next => onChange(String(next))}
                />
            );
        }
        case "imageFill": {
            if (!inspectorData || !onSaving) {
                return <span className="text-xs text-gray-500">Image fill requires inspector context</span>;
            }
            const baseline = buttonPropsToImageFillBaseline(getButtonProps(inspectorData.element));
            const fillField: ImageFillFieldDefinition<UIInspectorData> = {
                type: "imageFill",
                id: "appearance.button.imageFill",
                label: "Image fill",
                getValue: () => {
                    if (value && typeof value === "object" && "mode" in (value as object)) {
                        return value as ImageFill;
                    }
                    return normalizeImageFill(baseline);
                },
                setValue: (_d, v) => onChange(v),
            };
            return <ImageFillField field={fillField} data={inspectorData} onSaving={onSaving} />;
        }
        case "borderColor": {
            const raw = typeof value === "string" ? value : String(value ?? "");
            const cv = parseColorValue(raw, { hex: "#000000", alpha: 1 });
            return (
                <ColorPickerTrigger
                    value={cv}
                    displayMode="icon"
                    allowOpacity={false}
                    onChange={(next: ColorValue) => onChange(colorValueToCss(next))}
                />
            );
        }
        case "borderRadius":
        case "borderWidth":
        case "paddingX":
        case "paddingY": {
            const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
            const max = fieldKey === "borderRadius" ? 999 : fieldKey === "borderWidth" ? 64 : 128;
            return (
                <NumericDraftEnhancedInput
                    committedDisplay={String(n)}
                    draftResetKey={`${draftResetKey}-${fieldKey}`}
                    onFiniteNumber={v => {
                        if (v < 0) return;
                        onChange(Math.min(max, v));
                    }}
                    inputMode="numeric"
                    type="number"
                    min={0}
                    max={max}
                    unit="px"
                    leftIcon={fieldKey === "borderWidth" ? <Square className="w-4 h-4 text-gray-400" /> : undefined}
                    className="w-full min-w-0"
                />
            );
        }
        case "borderStyle": {
            const v = String(value ?? "none");
            return (
                <Select
                    value={v === "solid" || v === "dashed" || v === "none" ? v : "none"}
                    options={[
                        { value: "none", label: "None" },
                        { value: "solid", label: "Solid" },
                        { value: "dashed", label: "Dashed" },
                    ]}
                    fullWidth
                    onChange={next => onChange(String(next))}
                />
            );
        }
        case "clipContent": {
            const b = Boolean(value);
            return (
                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={b}
                        onChange={e => onChange(e.target.checked)}
                        className="rounded border-white/20"
                    />
                    Clip
                </label>
            );
        }
        case "cursor":
            return <ButtonCursorSelect value={value} onChange={onChange} />;
        default:
            return <span className="text-xs text-gray-500">{String(value ?? "")}</span>;
    }
}
