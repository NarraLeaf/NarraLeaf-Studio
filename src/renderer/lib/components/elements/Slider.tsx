import React from "react";
import { cn } from "../../utils/cn";

export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type"> {
    value: number;
    onValueChange?: (value: number) => void;
    /** Fires once the drag settles — use for anything expensive, e.g. persisting. */
    onValueCommit?: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
}

/**
 * Range slider.
 *
 * Built on a native `<input type="range">` so keyboard, pointer and a11y come for
 * free; the chrome is redrawn with `::-webkit-slider-*` rules in styles.css, since
 * Tailwind cannot reach those pseudo-elements.
 *
 * `onValueChange` fires continuously while dragging (keep it cheap — it drives the
 * live preview), `onValueCommit` fires when the drag ends.
 */
export function Slider({
    value,
    onValueChange,
    onValueCommit,
    min = 0,
    max = 100,
    step = 1,
    disabled = false,
    className = "",
    ...props
}: SliderProps) {
    const clamp = (next: number) => Math.min(max, Math.max(min, next));

    return (
        <input
            type="range"
            className={cn("nl-slider", disabled && "opacity-50 cursor-not-allowed", className)}
            min={min}
            max={max}
            step={step}
            value={clamp(value)}
            disabled={disabled}
            onChange={(event) => onValueChange?.(clamp(Number(event.target.value)))}
            // Pointer release and keyboard both land on change/keyUp; `input` already
            // covered the live updates, so these only mark the end of an interaction.
            onPointerUp={(event) => onValueCommit?.(clamp(Number((event.target as HTMLInputElement).value)))}
            onKeyUp={(event) => onValueCommit?.(clamp(Number((event.target as HTMLInputElement).value)))}
            {...props}
        />
    );
}
