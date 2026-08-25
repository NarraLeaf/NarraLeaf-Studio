import React, { useState } from "react";
import { cn } from "../../utils/cn";

export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type"> {
    value: number;
    onValueChange?: (value: number) => void;
    /** Fires once the drag settles — use for anything expensive, e.g. persisting. */
    onValueCommit?: (value: number) => void;
    min?: number;
    max?: number;
    /**
     * The increment the track moves on. `"any"` is the HTML keyword for a continuous track, and is
     * how a caller shows a value that does not sit on its own grid: with a numeric step the browser
     * rounds the thumb to the nearest allowed value, so a paired number box would read one figure
     * while the thumb stood at another.
     */
    step?: number | "any";
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

/**
 * The value a slider shows while it is being dragged, and the one write that follows.
 *
 * {@link Slider} deliberately has two callbacks - `onValueChange` on every pointer move, and
 * `onValueCommit` once the gesture ends - and wiring a document write to the first is the mistake
 * this hook exists to stop making. It has been made twice: the transform channel sliders and the
 * puppet parameter rows both put one history entry on the stack per pixel dragged, so a single
 * gesture buried the undo stack and `mod+z` afterwards walked back a few pixels at a time.
 *
 * So the shown value is local for the length of the drag and the write happens once, on release.
 * The draft clears at that moment rather than being kept, because a control that held its own number
 * after the gesture would stop tracking the value it is supposed to be editing - an edit from
 * anywhere else would leave it showing a stale figure.
 *
 * Return it spread across whichever controls display the value; a slider paired with a number box
 * must read `value` too, or the two disagree for the length of every drag.
 */
export function useSliderDraft(value: number, onCommit: (next: number) => void): {
    value: number;
    onValueChange: (next: number) => void;
    onValueCommit: (next: number) => void;
    clear: () => void;
} {
    const [draft, setDraft] = useState<number | null>(null);
    return {
        value: draft ?? value,
        onValueChange: setDraft,
        onValueCommit: (next: number) => {
            setDraft(null);
            onCommit(next);
        },
        /**
         * Drop the draft without writing anything.
         *
         * For the gesture that ends in no number at all - a box emptied to hand the value back to
         * its default. Without it the control would keep showing the figure that was abandoned.
         */
        clear: () => setDraft(null),
    };
}
