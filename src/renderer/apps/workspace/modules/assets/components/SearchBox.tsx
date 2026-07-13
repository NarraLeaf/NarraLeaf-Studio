import React, { useState, useCallback, useEffect, forwardRef } from "react";
import { Search, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

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
}

/**
 * Search box component for asset panel
 */
export const SearchBox = forwardRef<HTMLElement, SearchBoxProps>(
    ({ value, onChange, placeholder, className = "", variant = "default", onBlur, inputRef, inputProps }, ref) => {
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
                <div className={`
                    flex items-center gap-2 px-3 py-2 rounded-md border transition-colors
                    ${isFocused
                        ? 'border-primary bg-primary/5'
                        : 'border-edge-strong bg-fill-subtle hover:bg-fill'
                    }
                `}>
                    <Search className="w-4 h-4 text-fg-muted flex-shrink-0" />
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
                        className="flex-1 bg-transparent text-sm text-fg-muted placeholder-fg-subtle outline-none"
                    />
                    {value && (
                        <button
                            type="button"
                            onClick={handleClear}
                            className="p-0.5 rounded hover:bg-fill text-fg-muted hover:text-fg-muted transition-colors"
                            title={t("assets.clearSearch")}
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
