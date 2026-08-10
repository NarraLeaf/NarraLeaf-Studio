import { useCallback, useMemo } from "react";
import type {
    IconButtonGroupOption,
    IconButtonSelection,
    IconButtonGroupMode,
    IconButtonSegGroupDensity,
} from "../types";

const groupColors = {
    base: "bg-surface-raised",
    border: "border border-edge",
    active: "bg-fill text-fg",
    idle: "bg-transparent text-fg-muted hover:bg-fill",
};

export type IconButtonSegGroupProps = {
    options: IconButtonGroupOption[];
    mode: IconButtonGroupMode;
    value: IconButtonSelection;
    onChange: (next: IconButtonSelection) => void | Promise<void>;
    showLabels?: boolean;
    disabled?: boolean;
    className?: string;
    /**
     * When `mode` is `multipleExclusivePrimary`, this option id is mutually exclusive with all others
     * (e.g. "all" vs per-edge multi-select).
     */
    exclusivePrimaryId?: string;
    /** Tighter padding for dense inspector rows (icon-only toolbars). */
    density?: IconButtonSegGroupDensity;
};

export type { IconButtonSegGroupDensity };

function nextExclusivePrimarySelection(current: string[], clickedId: string, exclusiveId: string): string[] {
    if (clickedId === exclusiveId) {
        return [exclusiveId];
    }
    const edgesOnly = current.filter(id => id !== exclusiveId);
    const has = edgesOnly.includes(clickedId);
    const toggled = has ? edgesOnly.filter(id => id !== clickedId) : [...edgesOnly, clickedId];
    if (toggled.length === 0) {
        return [exclusiveId];
    }
    return toggled;
}

/**
 * Horizontal seamless segmented control (divide-x), same chrome as alignment `iconButtonGroup` fields.
 * Supports single, multiple toggle, and multiple with one "primary" id exclusive of the rest.
 */
export function IconButtonSegGroup({
    options,
    mode,
    value,
    onChange,
    showLabels = true,
    disabled = false,
    className = "",
    exclusivePrimaryId,
    density = "default",
}: IconButtonSegGroupProps) {
    const resolvedMode = mode;
    /*
     * Compact segments are `px-1`, not `px-2`, because `flex-1` makes the padding the icon's
     * allowance rather than its breathing room: the group divides its width evenly, and whatever
     * the padding does not take is what the 16px icon has to sit in. Five `px-2` segments need
     * 160px before the icons start eating into that allowance, and the page-animation direction
     * row gets ~150px in a properties panel at its default width. In the roomy cases (the border
     * side pickers) the segments still grow to fill, so nothing there moves.
     */
    const paddingClass = density === "compact" ? "px-1 py-1.5" : "px-3 py-2";

    const resolvedMultiSelection = useMemo((): string[] => {
        if (resolvedMode === "multipleExclusivePrimary") {
            return Array.isArray(value) ? value : [];
        }
        if (resolvedMode === "multiple") {
            return Array.isArray(value) ? value : [];
        }
        return [];
    }, [resolvedMode, value]);

    const resolvedSingle = useMemo(() => {
        if (resolvedMode === "single") {
            return typeof value === "string" ? value : null;
        }
        return null;
    }, [resolvedMode, value]);

    const handleOptionClick = useCallback(
        async (optionId: string, optionDisabled?: boolean) => {
            if (disabled || optionDisabled) {
                return;
            }
            let nextValue: IconButtonSelection = value;

            if (resolvedMode === "multipleExclusivePrimary") {
                const ex = exclusivePrimaryId;
                if (!ex) {
                    console.warn("IconButtonSegGroup: multipleExclusivePrimary requires exclusivePrimaryId");
                    return;
                }
                const current = Array.isArray(value) ? [...value] : [];
                nextValue = nextExclusivePrimarySelection(current, optionId, ex);
            } else if (resolvedMode === "multiple") {
                const current = Array.isArray(value) ? value : [];
                const hasValue = current.includes(optionId);
                nextValue = hasValue ? current.filter(v => v !== optionId) : [...current, optionId];
            } else if (resolvedMode === "single") {
                nextValue = optionId;
            } else {
                nextValue = optionId;
            }

            await onChange(nextValue);
        },
        [disabled, exclusivePrimaryId, onChange, resolvedMode, value]
    );

    return (
        <div
            className={`flex divide-x divide-edge rounded-md overflow-hidden ${groupColors.border} ${groupColors.base} ${className}`}
        >
            {options.map(option => {
                const isActive =
                    resolvedMode === "multiple" || resolvedMode === "multipleExclusivePrimary"
                        ? resolvedMultiSelection.includes(option.id)
                        : resolvedMode === "single"
                          ? resolvedSingle === option.id
                          : false;

                return (
                    <button
                        key={option.id}
                        type="button"
                        /*
                         * `min-w-0` so a segment can be narrower than its own padding + icon.
                         * Without it `flex-1` refuses to shrink past that intrinsic width, the
                         * group overflows the column it was given, and the group's own
                         * `overflow-hidden` cuts the last segment down the middle - one icon
                         * sliced in half while the other four look fine. Shrinking is the better
                         * failure: it crowds all five equally and every one stays recognisable.
                         */
                        className={`min-w-0 flex-1 ${paddingClass} transition ${isActive ? groupColors.active : groupColors.idle}`}
                        onClick={() => void handleOptionClick(option.id, option.disabled)}
                        disabled={disabled || option.disabled}
                        aria-pressed={isActive}
                        title={option.label}
                    >
                        <div
                            className={`flex items-center justify-center ${
                                showLabels && option.label ? "gap-2" : ""
                            }`}
                        >
                            <span className="text-base leading-none">{option.icon}</span>
                            {showLabels && option.label ? (
                                <span className="text-xs tracking-wide">{option.label}</span>
                            ) : null}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
