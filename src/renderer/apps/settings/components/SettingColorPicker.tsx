import { useCallback } from "react";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { normalizeHexColor } from "@shared/constants/accent";

/**
 * The "any color" half of a `SettingValueType.Color` row: a round chip that opens the same full
 * picker (saturation map, hue slider, hex/RGB/HSL fields) the property inspector uses for game
 * content. Reused rather than rebuilt — a second color picker would drift from the first, and the
 * Settings window already borrows workspace components elsewhere (see `SearchBox`).
 *
 * Opacity is off: an accent is a color, and a translucent one would wash out against every
 * surface it is painted on.
 */
export function SettingColorPicker(props: {
    /** The row's current color, whether it came from a preset or a custom hex. Seeds the picker. */
    hex: string;
    /** Whether the custom chip — rather than one of the presets — is the active selection. */
    selected: boolean;
    label: string;
    disabled?: boolean;
    /** Called continuously while the user drags, for a live preview that is not persisted. */
    onPreview?: (hex: string) => void;
    /** Called once, when the picker closes on a color that differs from `hex`. */
    onCommit: (hex: string) => void;
}) {
    const { hex, selected, label, disabled = false, onPreview, onCommit } = props;

    const handleChange = useCallback((value: { hex: string }) => {
        const next = normalizeHexColor(value.hex);
        if (next) {
            onPreview?.(next);
        }
    }, [onPreview]);

    // Opening the picker and closing it without touching anything must not rewrite the setting:
    // that would silently turn a preset selection into an identical custom hex.
    const handleCommit = useCallback((value: { hex: string }) => {
        const next = normalizeHexColor(value.hex);
        if (!next || next === normalizeHexColor(hex)) {
            // Unchanged — put the live preview back on the stored value and write nothing.
            onPreview?.(normalizeHexColor(hex) ?? hex);
            return;
        }
        onCommit(next);
    }, [hex, onCommit, onPreview]);

    return (
        <span
            className={`inline-flex h-5 w-5 items-center justify-center rounded-full transition duration-150 ${
                selected
                    ? "ring-2 ring-offset-2 ring-fg/60 ring-offset-surface"
                    : "ring-1 ring-inset ring-edge-strong hover:scale-110"
            } ${disabled ? "pointer-events-none opacity-50" : ""}`}
            // The hue wheel reads as "pick anything" without needing a label beside it; when a
            // custom color is active the chip shows that color instead, like the presets do.
            style={{
                background: selected
                    ? hex
                    : "conic-gradient(#da6958, #ccaa5c, #6db094, #40a8c4, #7e70c2, #c46e9c, #da6958)",
            }}
            title={label}
        >
            <ColorPickerTrigger
                value={{ hex, alpha: 1 }}
                displayMode="swatch"
                allowOpacity={false}
                disabled={disabled}
                onChange={handleChange}
                onCommit={handleCommit}
            />
        </span>
    );
}
