import React, { useState, useCallback, useEffect, forwardRef } from "react";
import { Search, X } from "lucide-react";

interface SearchBoxProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}

/**
 * Search box component for asset panel
 */
export const SearchBox = forwardRef<HTMLElement, SearchBoxProps>(
    ({ value, onChange, placeholder = "Search", className = "" }, ref) => {
        const [isFocused, setIsFocused] = useState(false);

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
        }, [handleClear]);

        return (
            <div ref={ref as React.Ref<HTMLDivElement>} className={`relative ${className}`}>
                <div className={`
                    flex items-center gap-2 px-3 py-2 rounded-md border transition-colors
                    ${isFocused
                        ? 'border-primary bg-primary/5'
                        : 'border-white/20 bg-white/5 hover:bg-white/10'
                    }
                `}>
                    <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <input
                        type="text"
                        value={value}
                        onChange={handleInputChange}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => setIsFocused(false)}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder}
                        className="flex-1 bg-transparent text-sm text-gray-300 placeholder-gray-500 outline-none"
                    />
                    {value && (
                        <button
                            onClick={handleClear}
                            className="p-0.5 rounded hover:bg-white/10 text-gray-400 hover:text-gray-300 transition-colors"
                            title="Clear search"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    )}
                </div>
            </div>
        );
    }
);
