import React from "react";
import { cn } from "../../utils/cn";

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size" | "onChange"> {
    checked: boolean;
    onCheckedChange?: (checked: boolean) => void;
    /** Classes for the row that holds box and label — type scale, padding, hover. */
    className?: string;
    /** Classes for the box itself. Rarely needed: size and colours come from `styles.css`. */
    boxClassName?: string;
    /** The label. Omit for a bare box — a table cell, a row that is labelled elsewhere. */
    children?: React.ReactNode;
}

/**
 * A box that says whether one thing is in a set.
 *
 * **Not the control for a setting** — an on/off preference or property is a {@link Switch}, which is
 * what the settings pages, the widget inspectors and the story action inspector use. A checkbox is
 * for picking members (which log levels to show, which models to import, which scenes a variant
 * declares) and for consent (a licence the author has to accept). The two read differently on
 * purpose: a switch is a thing you leave on, a checkbox is a thing you tick.
 *
 * The look is not defined here. `styles.css` styles `input[type="checkbox"]` globally — 16px,
 * `--nl-control-*` borders, the primary fill and the drawn tick, and the disabled dimming — so this
 * component owns only the pairing: box, gap, label, and the arrow cursor Studio uses everywhere
 * (Tailwind's preflight gives `<label>` nothing, but the copies this replaced kept reaching for
 * `cursor-pointer`, which is the one cursor this app never shows).
 */
export function Checkbox({
    checked,
    onCheckedChange,
    className,
    boxClassName,
    children,
    disabled,
    ...props
}: CheckboxProps) {
    const box = (
        <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={event => onCheckedChange?.(event.target.checked)}
            className={cn("shrink-0", boxClassName)}
            {...props}
        />
    );
    if (children === undefined) {
        return box;
    }
    return (
        <label
            className={cn(
                "flex items-center gap-2 text-xs text-fg-muted",
                disabled ? "cursor-not-allowed" : "cursor-default",
                className,
            )}
        >
            {box}
            {children}
        </label>
    );
}
