import {
    useState,
    useCallback,
    useMemo,
    useEffect,
    useLayoutEffect,
    useRef,
    type ChangeEvent,
    type FocusEvent,
    type MouseEvent,
    type InputHTMLAttributes,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface EnhancedInputProps
    extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
    value: string;
    onChange: (value: string) => void;
    unit?: string;
    leftIcon?: ReactNode;
    className?: string;
    inputClassName?: string;
    precision?: number | null;
    selectAllOnFocus?: boolean;
    popoverWhenNarrow?: boolean;
    popoverThreshold?: number;
}

/**
 * Enhanced input that can show a unit suffix, a leading icon, and hides the unit while focused.
 */
export function EnhancedInput({
    value,
    onChange,
    unit,
    leftIcon,
    className = "",
    inputClassName = "",
    onFocus,
    onBlur,
    precision,
    selectAllOnFocus = false,
    popoverWhenNarrow = false,
    popoverThreshold = 112,
    ...rest
}: EnhancedInputProps) {
    const [hasFocus, setHasFocus] = useState(false);
    const [isPopoverOpen, setIsPopoverOpen] = useState(false);
    const [containerWidth, setContainerWidth] = useState<number | null>(null);
    const [popoverPosition, setPopoverPosition] = useState({ left: 0, top: 0, width: 220 });
    const containerRef = useRef<HTMLButtonElement | HTMLDivElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const popoverInputRef = useRef<HTMLInputElement | null>(null);
    const roundingPrecision = precision ?? null;
    const displayValue = useMemo(() => {
        if (hasFocus) {
            return value;
        }
        if (roundingPrecision !== null && typeof roundingPrecision === "number") {
            const parsed = Number.parseFloat(value);
            if (Number.isFinite(parsed)) {
                return parsed.toFixed(roundingPrecision);
            }
        }
        return value;
    }, [hasFocus, roundingPrecision, value]);
    const shouldUsePopover =
        popoverWhenNarrow &&
        !hasFocus &&
        containerWidth !== null &&
        containerWidth < popoverThreshold;

    const handleChange = useCallback(
        (event: ChangeEvent<HTMLInputElement>) => {
            onChange(event.target.value);
        },
        [onChange]
    );

    const handleFocus = useCallback(
        (event: FocusEvent<HTMLInputElement>) => {
            setHasFocus(true);
            if (selectAllOnFocus) {
                setTimeout(() => event.target.select(), 0);
            }
            onFocus?.(event);
        },
        [onFocus, selectAllOnFocus]
    );

    const handleMouseUp = useCallback(
        (event: MouseEvent<HTMLInputElement>) => {
            if (selectAllOnFocus) {
                event.preventDefault();
                event.currentTarget.select();
            }
        },
        [selectAllOnFocus]
    );

    const handleBlur = useCallback(
        (event: FocusEvent<HTMLInputElement>) => {
            setHasFocus(false);
            onBlur?.(event);
        },
        [onBlur]
    );
    const setContainerElement = useCallback((node: HTMLButtonElement | HTMLDivElement | null) => {
        containerRef.current = node;
        if (node) {
            setContainerWidth(node.getBoundingClientRect().width);
        }
    }, []);

    const closePopover = useCallback(() => {
        setIsPopoverOpen(false);
    }, []);

    const openPopover = useCallback(() => {
        if (rest.disabled || rest.readOnly) {
            return;
        }
        setIsPopoverOpen(true);
    }, [rest.disabled, rest.readOnly]);

    useEffect(() => {
        const node = containerRef.current;
        if (!node || typeof ResizeObserver === "undefined") {
            return;
        }

        const updateWidth = () => {
            setContainerWidth(node.getBoundingClientRect().width);
        };

        updateWidth();
        const observer = new ResizeObserver(() => updateWidth());
        observer.observe(node);
        return () => observer.disconnect();
    }, [shouldUsePopover]);

    useEffect(() => {
        if (!shouldUsePopover) {
            setIsPopoverOpen(false);
        }
    }, [shouldUsePopover]);

    useLayoutEffect(() => {
        if (!isPopoverOpen || !containerRef.current) {
            return;
        }

        const updatePosition = () => {
            if (!containerRef.current) {
                return;
            }
            const rect = containerRef.current.getBoundingClientRect();
            const panelHeight = panelRef.current?.getBoundingClientRect().height ?? 64;
            const viewportPadding = 8;
            const desiredWidth = Math.max(rect.width, 220);
            const width = Math.min(desiredWidth, window.innerWidth - viewportPadding * 2);
            let left = rect.left;
            let top = rect.bottom + 6;

            if (left + width > window.innerWidth - viewportPadding) {
                left = window.innerWidth - width - viewportPadding;
            }
            if (left < viewportPadding) {
                left = viewportPadding;
            }
            if (top + panelHeight > window.innerHeight - viewportPadding) {
                top = rect.top - panelHeight - 6;
            }
            if (top < viewportPadding) {
                top = viewportPadding;
            }

            setPopoverPosition({ left, top, width });
        };

        updatePosition();
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);
        return () => {
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [isPopoverOpen]);

    useEffect(() => {
        if (!isPopoverOpen) {
            return;
        }

        const focusTimer = setTimeout(() => {
            popoverInputRef.current?.focus();
        }, 0);

        const handleClickOutside = (event: globalThis.MouseEvent) => {
            const target = event.target as Node | null;
            if (!target) {
                return;
            }
            if (containerRef.current?.contains(target) || panelRef.current?.contains(target)) {
                return;
            }
            closePopover();
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                closePopover();
            }
        };

        const listenerTimer = setTimeout(() => {
            document.addEventListener("mousedown", handleClickOutside);
        }, 0);
        document.addEventListener("keydown", handleKeyDown);

        return () => {
            clearTimeout(focusTimer);
            clearTimeout(listenerTimer);
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [closePopover, isPopoverOpen]);

    const paddingLeftClass = leftIcon ? "pl-10" : "pl-3";
    const paddingRightClass = unit ? "pr-10" : "pr-3";
    const numberNoSpinnerClass =
        rest.type === "number"
            ? "[appearance:textfield] [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            : "";
    const rootClassName = `
        relative flex min-w-0 max-w-full items-center bg-[#1e1f22] border border-white/10 rounded-md text-sm h-9 min-h-[34px] overflow-hidden
        focus-within:border-primary/70 transition focus-within:ring-1 focus-within:ring-primary/30
        ${className}
    `;
    const inputElementClassName = `
        min-w-0 flex-1 h-full bg-transparent border-none placeholder:text-gray-500 text-gray-100 focus:outline-none leading-none overflow-x-auto whitespace-nowrap
        ${numberNoSpinnerClass}
        ${paddingLeftClass} ${paddingRightClass} ${inputClassName}
    `;
    const hasDisplayText = displayValue.length > 0;

    if (shouldUsePopover) {
        const popoverContent =
            isPopoverOpen && typeof document !== "undefined"
                ? createPortal(
                      <div
                          ref={panelRef}
                          className="fixed z-[70] rounded-xl border border-white/10 bg-[#17181c] p-2 shadow-2xl"
                          style={{
                              left: popoverPosition.left,
                              top: popoverPosition.top,
                              width: popoverPosition.width,
                              maxWidth: "calc(100vw - 16px)",
                          }}
                          onMouseDown={(event) => event.stopPropagation()}
                      >
                          <div className={rootClassName}>
                              {leftIcon && (
                                  <span className="absolute left-2 text-gray-400 pointer-events-none flex items-center">
                                      {leftIcon}
                                  </span>
                              )}
                              <input
                                  ref={popoverInputRef}
                                  value={displayValue}
                                  onChange={handleChange}
                                  onFocus={handleFocus}
                                  onBlur={handleBlur}
                                  onMouseUp={handleMouseUp}
                                  className={inputElementClassName}
                                  {...rest}
                              />

                              {unit && !hasFocus && (
                                  <span className="absolute right-2 text-xs text-gray-500 pointer-events-none select-none">
                                      {unit}
                                  </span>
                              )}
                          </div>
                      </div>,
                      document.body
                  )
                : null;

        return (
            <>
                <button
                    ref={setContainerElement}
                    type="button"
                    onClick={isPopoverOpen ? closePopover : openPopover}
                    disabled={rest.disabled || rest.readOnly}
                    className={rootClassName}
                    title={hasDisplayText ? displayValue : rest.placeholder}
                >
                    {leftIcon && (
                        <span className="absolute left-2 text-gray-400 pointer-events-none flex items-center">
                            {leftIcon}
                        </span>
                    )}
                    <span
                        className={`
                            min-w-0 flex-1 truncate text-left leading-none
                            ${hasDisplayText ? "text-gray-100" : "text-gray-500"}
                            ${paddingLeftClass} ${paddingRightClass}
                        `}
                    >
                        {hasDisplayText ? displayValue : rest.placeholder ?? "Edit value"}
                    </span>
                    {unit && hasDisplayText && (
                        <span className="absolute right-2 text-xs text-gray-500 pointer-events-none select-none">
                            {unit}
                        </span>
                    )}
                </button>
                {popoverContent}
            </>
        );
    }

    return (
        <div
            ref={setContainerElement}
            className={rootClassName}
        >
            {leftIcon && (
                <span className="absolute left-2 text-gray-400 pointer-events-none flex items-center">
                    {leftIcon}
                </span>
            )}

            <input
                value={displayValue}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onMouseUp={handleMouseUp}
                className={inputElementClassName}
                {...rest}
            />

            {unit && !hasFocus && (
                <span className="absolute right-2 text-xs text-gray-500 pointer-events-none select-none">
                    {unit}
                </span>
            )}
        </div>
    );
}
