import { useMemo } from "react";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import type { ColorValue } from "@/apps/workspace/modules/properties/framework/types";
import {
    blueprintRGBAColorToHex,
    blueprintRGBAColorToRgbaHex,
    normalizeBlueprintRGBAColor,
    type BlueprintRGBAColor,
} from "@shared/types/blueprint/valueTypes";

type Props = {
    value: unknown;
    onChange: (next: BlueprintRGBAColor) => void;
};

function stopFlowNodePointerBubble(e: { stopPropagation: () => void }) {
    e.stopPropagation();
}

export function BlueprintColorValueControl({ value, onChange }: Props) {
    const color = useMemo(() => normalizeBlueprintRGBAColor(value), [value]);
    const pickerHex = blueprintRGBAColorToHex(color);
    const alpha = color.a;
    const displayValue = blueprintRGBAColorToRgbaHex(color);
    const pickerValue: ColorValue = useMemo(
        () => ({
            hex: pickerHex,
            alpha,
        }),
        [pickerHex, alpha],
    );

    return (
        <div
            className="nodrag nowheel flex min-w-0 items-center gap-2"
            onMouseDown={stopFlowNodePointerBubble}
            onMouseDownCapture={stopFlowNodePointerBubble}
            onPointerDown={stopFlowNodePointerBubble}
            onPointerDownCapture={stopFlowNodePointerBubble}
        >
            <ColorPickerTrigger
                value={pickerValue}
                displayMode="icon"
                allowOpacity
                onChange={next => onChange(normalizeBlueprintRGBAColor(next))}
            />
            <span className="min-w-0 truncate font-mono text-2xs text-fg-muted" title={displayValue}>
                {displayValue}
            </span>
        </div>
    );
}
