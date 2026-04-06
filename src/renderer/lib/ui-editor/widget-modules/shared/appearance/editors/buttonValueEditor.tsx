import { Square } from "lucide-react";
import type { ColorValue } from "@/apps/workspace/modules/properties/framework/types";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { Select } from "@/lib/components/elements/Select";
import type { ButtonAppearancePropertyKey } from "@shared/types/ui-editor/appearance";

export type ButtonValueEditorProps = {
    fieldKey: ButtonAppearancePropertyKey;
    value: unknown;
    onChange: (next: unknown) => void;
    draftResetKey: string;
};

export function ButtonAppearanceValueEditor({ fieldKey, value, onChange, draftResetKey }: ButtonValueEditorProps) {
    switch (fieldKey) {
        case "backgroundColor": {
            const raw = typeof value === "string" ? value : String(value ?? "");
            const cv = parseColorValue(raw, { hex: "#374151", alpha: 1 });
            return (
                <ColorPickerTrigger
                    value={cv}
                    displayMode="icon"
                    allowOpacity
                    onChange={(next: ColorValue) => onChange(colorValueToCss(next))}
                />
            );
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
        default:
            return <span className="text-xs text-gray-500">{String(value ?? "")}</span>;
    }
}
