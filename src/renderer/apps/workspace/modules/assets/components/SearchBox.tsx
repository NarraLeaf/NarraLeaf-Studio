import React, { useState, useCallback, useEffect, forwardRef } from "react";
import { Search, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { CONTROL_HEIGHT_CLASS, type ControlSize } from "@/lib/components/elements/controlSize";
import { isImeKeyEvent } from "@/lib/utils/imeComposition";

interface SearchBoxProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
    variant?: "default" | "minimal";
    onBlur?: () => void;
    inputRef?: React.Ref<HTMLInputElement>;
    inputProps?: Omit<
        React.InputHTMLAttributes<HTMLInputElement>,
        "value" | "onChange" | "onFocus" | "onBlur" | "onKeyDown" | "placeholder" | "className"
    >;
    /**
     * Which step of the shared control scale the field sits on. `md` (36px) by default, as a field
     * in a dialog or a wide panel; `sm` (28px) for a dense panel header, where the field shares its
     * row with toolbar buttons and both have to be the same height.
     */
    size?: ControlSize;
}

/** What the box spends on its own chrome, per size: padding, the gap between its parts, its type. */
const BOX_CLASS: Record<ControlSize, string> = {
    sm: "gap-1.5 px-2 py-0.5",
    md: "gap-2 px-3 py-1",
    lg: "gap-2 px-4 py-1",
};

const ICON_CLASS: Record<ControlSize, string> = {
    sm: "w-3.5 h-3.5",
    md: "w-4 h-4",
    lg: "w-4 h-4",
};

const TEXT_CLASS: Record<ControlSize, string> = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
};

/**
 * The clear button's own square. It is the tallest thing in the box, so it decides whether the box
 * keeps its height floor: at `sm` a 24px button plus the padding would push the field two pixels
 * past the toolbar buttons beside it.
 */
const CLEAR_CLASS: Record<ControlSize, string> = {
    sm: "h-5 w-5",
    md: "h-6 w-6",
    lg: "h-6 w-6",
};

/**
 * The bordered query field Studio's panels and pickers share: a magnifier, the text, and a clear
 * button that appears once there is something to clear. `minimal` drops the box and draws the input
 * alone, for a host that brings its own frame.
 *
 * It is a flex row, so every part states whether it may shrink - the field is put in rows that are
 * narrower than an input's intrinsic width, and a part that refuses to shrink leaves the box.
 */
export const SearchBox = forwardRef<HTMLElement, SearchBoxProps>(
    ({ value, onChange, placeholder, className = "", variant = "default", onBlur, inputRef, inputProps, size = "md" }, ref) => {
        const { t } = useTranslation();
        const [isFocused, setIsFocused] = useState(false);
        const resolvedPlaceholder = placeholder ?? t("common.search");

        const handleClear = useCallback(() => {
            onChange("");
        }, [onChange]);

        const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
            onChange(e.target.value);
        }, [onChange]);

        const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
            if (isImeKeyEvent(e)) {
                return;
            }
            if (e.key === "Escape") {
                handleClear();
            }
            if (e.key === " ") {
                e.stopPropagation();
            }
        }, [handleClear]);

        const handleInputFocus = useCallback(() => {
            setIsFocused(true);
        }, []);

        const handleInputBlur = useCallback(() => {
            setIsFocused(false);
            onBlur?.();
        }, [onBlur]);

        if (variant === "minimal") {
            return (
                <input
                    {...inputProps}
                    ref={inputRef ?? ref as React.Ref<HTMLInputElement>}
                    type="text"
                    value={value}
                    onChange={handleInputChange}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    onKeyDown={handleKeyDown}
                    placeholder={resolvedPlaceholder}
                    autoFocus
                    className={`bg-transparent text-sm text-fg-muted placeholder-fg-subtle outline-none w-full ${className}`}
                />
            );
        }

        return (
            <div ref={ref as React.Ref<HTMLDivElement>} className={`relative ${className}`}>
                <div
                    className={cn(
                        "flex items-center rounded-md border transition-colors",
                        CONTROL_HEIGHT_CLASS[size],
                        BOX_CLASS[size],
                        isFocused ? "border-primary bg-primary/5" : "border-edge-strong bg-fill-subtle hover:bg-fill",
                    )}
                >
                    <Search className={cn("text-fg-muted flex-shrink-0", ICON_CLASS[size])} />
                    {/*
                     * `min-w-0`, or the field cannot hold its own contents: an input's intrinsic
                     * minimum is its `size` attribute in characters - around 157px - and without
                     * this it refuses to go below that, spilling out of the box and over whatever
                     * shares its row. The clear button rides along, so it lands among controls it
                     * does not belong to and takes their clicks.
                     */}
                    <input
                        {...inputProps}
                        ref={inputRef}
                        type="text"
                        value={value}
                        onChange={handleInputChange}
                        onFocus={handleInputFocus}
                        onBlur={handleInputBlur}
                        onKeyDown={handleKeyDown}
                        placeholder={resolvedPlaceholder}
                        className={cn(
                            "min-w-0 flex-1 bg-transparent text-fg-muted placeholder-fg-subtle outline-none",
                            TEXT_CLASS[size],
                        )}
                    />
                    {value && (
                        <button
                            type="button"
                            onClick={handleClear}
                            // A real square around a 12px glyph: the padded icon it replaced was
                            // 16px, which is below what a pointer finds without aiming.
                            className={cn(
                                "grid shrink-0 place-items-center rounded-md hover:bg-fill text-fg-muted hover:text-fg-muted transition-colors",
                                CLEAR_CLASS[size],
                            )}
                            data-tip={t("assets.clearSearch")}
                            aria-label={t("assets.clearSearch")}
                        >
                            <X className="w-3 h-3" />
                        </button>
                    )}
                </div>
            </div>
        );
    }
);
