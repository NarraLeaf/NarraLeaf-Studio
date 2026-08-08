import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { Button } from "./Button";
import { InspectOnlyButton } from "./InspectOnlyButton";
import { CONTROL_SIZE_CLASS, type ControlSize } from "./controlSize";
import { cn } from "../../utils/cn";

export interface SelectOption {
    value: string | number;
    /** Static label. Prefer `labelKey` for localized options; one of the two must be set. */
    label?: string;
    /** i18n key; when set it is resolved at render (falls back to `label`). */
    labelKey?: TranslationKey;
    secondaryLabel?: string;
    disabled?: boolean;
    icon?: React.ReactNode;
}

export type SelectMenuPlacement = "auto" | "above" | "below";

export interface SelectProps {
    options: SelectOption[];
    value?: string | number;
    onChange?: (value: string | number) => void;
    placeholder?: string;
    disabled?: boolean;
    size?: ControlSize;
    variant?: "default" | "error" | "success";
    fullWidth?: boolean;
    className?: string;
    multiple?: boolean;
    /** Render the menu in a document.body portal (avoids overflow clipping from ancestors). */
    portalMenu?: boolean;
    /** Where to open the menu; "auto" picks based on viewport space when not portaled, or when portaled. */
    menuPlacement?: SelectMenuPlacement;
    /** Extra class names applied to the dropdown menu panel. */
    menuClassName?: string;
    /** Extra data attributes applied to the dropdown menu panel. Useful when a portaled menu belongs to another surface. */
    menuDataAttributes?: Record<`data-${string}`, string | undefined>;
    /** Optional z-index override for the dropdown menu panel. */
    menuZIndex?: number;
    /**
     * Accessible name for the trigger.
     *
     * The trigger's own text is the *selected value*, not what the value means, so a select whose
     * visible label lives in a row header beside it reaches assistive tech announcing "Voice" with
     * no clue that the question was "routes into". Pass the row's title.
     */
    ariaLabel?: string;
    /**
     * Not a prop: the spelling that silently did nothing, declared so it fails to compile.
     *
     * This component destructures a fixed prop list and has no rest spread, so `aria-label` was
     * dropped at the boundary - and TypeScript could not say so, because JSX skips excess-property
     * checks on hyphenated attribute names. Five call sites reached assistive tech announcing only
     * their current value before anyone noticed. `never` turns the next one into a compile error
     * that names the right prop.
     */
    "aria-label"?: never;
    /**
     * This select changes what is SHOWN and writes nothing.
     *
     * The trigger and the option rows are then rendered through {@link InspectOnlyButton}, so an
     * ancestor read-only clamp - the `disabled` `<fieldset>` a frozen workspace puts around an
     * inspector field - does not reach them. Only for a select whose `onChange` is view state:
     * getting it wrong offers a write inside a frozen project.
     */
    inspectOnly?: boolean;
    /**
     * This select normally writes, but right now it may only be read.
     *
     * **Open, not shut.** `disabled` is the obvious treatment and it is the wrong one here: a
     * dropdown that cannot be opened hides its option list, and on a frozen project that list is
     * project data the author came to look at - which keys exist, which states this element has,
     * what the choices even were. So the trigger still opens (through {@link InspectOnlyButton}, so
     * an ancestor clamp cannot reach it either), the menu still renders with the current value
     * marked, and every row is inert.
     *
     * Different from {@link inspectOnly}, which is for a select whose `onChange` never writes at
     * all and whose rows therefore stay live.
     */
    readOnly?: boolean;
}

const sizeStyles = CONTROL_SIZE_CLASS;

const variantStyles = {
    default: "border-edge-strong hover:border-edge-strong focus:border-primary",
    error: "border-danger/50 hover:border-danger/70 focus:border-danger",
    success: "border-success/50 hover:border-success/70 focus:border-success",
};

const SELECT_MENU_GAP_PX = 4;
/** Tailwind max-h-60 */
const SELECT_MENU_MAX_HEIGHT_PX = 240;

/**
 * Horizontal bounds an open menu has to stay inside: the viewport, tightened by every ancestor
 * that would clip it.
 *
 * The viewport alone is not the answer for a menu that is not portaled. A settings row puts its
 * control hard against the right edge of a panel that scrolls (`overflow-y-auto`, which makes the
 * other axis `auto` too) inside a window shell that hides its overflow - so a menu growing
 * rightwards is cut off, or grows a horizontal scrollbar, long before it reaches the window edge.
 */
function clippingBounds(node: HTMLElement): { left: number; right: number } {
    let left = 0;
    let right = window.innerWidth;
    let parent = node.parentElement;
    while (parent) {
        const style = window.getComputedStyle(parent);
        if (style.overflowX !== "visible" || style.overflowY !== "visible") {
            const rect = parent.getBoundingClientRect();
            left = Math.max(left, rect.left);
            right = Math.min(right, rect.right);
        }
        parent = parent.parentElement;
    }
    return { left, right };
}

/**
 * How wide the menu wants to be, measured with any clamp lifted.
 *
 * Reading the clamped box back would be self-referential: the width we already imposed would look
 * like the width the content asked for, and the side the menu is pinned to would flip back and
 * forth on every scroll event.
 */
function measureNaturalWidth(node: HTMLElement): number {
    const previous = node.style.maxWidth;
    const previousWidth = node.style.width;
    node.style.maxWidth = "none";
    node.style.width = "max-content";
    const width = node.getBoundingClientRect().width;
    node.style.maxWidth = previous;
    node.style.width = previousWidth;
    return width;
}

/**
 * Select dropdown component with VS Code-like styling
 */
export function Select({
    options,
    value,
    onChange,
    placeholder,
    disabled = false,
    size = "md",
    variant = "default",
    fullWidth = false,
    className = "",
    multiple = false,
    portalMenu = false,
    menuPlacement = "auto",
    menuClassName = "",
    menuDataAttributes,
    menuZIndex,
    inspectOnly = false,
    readOnly = false,
    ariaLabel,
}: SelectProps) {
    // Both modes render the trigger as a span so an ancestor read-only clamp cannot reach it; only
    // `inspectOnly` leaves the rows live.
    const spanTrigger = inspectOnly || readOnly;
    const { t } = useTranslation();
    const resolvedPlaceholder = placeholder ?? t("dialogs.select.placeholder");
    const optionLabel = (o: SelectOption) => (o.labelKey ? t(o.labelKey) : o.label ?? "");
    const [isOpen, setIsOpen] = useState(false);
    const selectRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement | null>(null);
    const [dropdownDirection, setDropdownDirection] = useState<"down" | "up">("down");
    const [portalMenuStyle, setPortalMenuStyle] = useState<React.CSSProperties>({});
    /**
     * Which trigger edge the menu hangs from. The menu is allowed to be wider than the trigger, so
     * it pins to the right edge and grows leftwards where growing rightwards would be clipped.
     */
    const [menuAlign, setMenuAlign] = useState<"left" | "right">("left");
    /** Room the chosen side actually has; a list too wide even for that still truncates. */
    const [menuMaxWidth, setMenuMaxWidth] = useState<number | undefined>(undefined);
    const naturalMenuWidthRef = useRef<number | null>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (selectRef.current?.contains(target)) {
                return;
            }
            // Portaled menu is outside the trigger subtree
            if (dropdownRef.current?.contains(target)) {
                return;
            }
            setIsOpen(false);
        };

        document.addEventListener("mousedown", handleClickOutside, true);
        return () => document.removeEventListener("mousedown", handleClickOutside, true);
    }, []);

    useEffect(() => {
        if (!isOpen) {
            setDropdownDirection("down");
            setPortalMenuStyle({});
            setMenuAlign("left");
            setMenuMaxWidth(undefined);
            naturalMenuWidthRef.current = null;
        }
    }, [isOpen]);

    useLayoutEffect(() => {
        if (!isOpen || portalMenu) {
            return;
        }
        naturalMenuWidthRef.current = null;

        const updatePlacement = () => {
            if (!selectRef.current || !dropdownRef.current) return;
            const triggerRect = selectRef.current.getBoundingClientRect();
            const dropdownRect = dropdownRef.current.getBoundingClientRect();

            if (menuPlacement === "auto") {
                const spaceBelow = window.innerHeight - triggerRect.bottom;
                const spaceAbove = triggerRect.top;
                const shouldOpenUp =
                    dropdownRect.height > spaceBelow && spaceAbove >= dropdownRect.height;
                setDropdownDirection(shouldOpenUp ? "up" : "down");
            }

            // The trigger is only as wide as the option that happens to be selected, so a menu
            // locked to that width cuts every longer option down to an ellipsis - which is the one
            // thing an option list may not do, since reading the options is why it is open.
            if (naturalMenuWidthRef.current === null) {
                naturalMenuWidthRef.current = measureNaturalWidth(dropdownRef.current);
            }
            const clip = clippingBounds(dropdownRef.current);
            const roomRight = clip.right - triggerRect.left - SELECT_MENU_GAP_PX;
            const roomLeft = triggerRect.right - clip.left - SELECT_MENU_GAP_PX;
            const alignLeft = naturalMenuWidthRef.current <= roomRight || roomRight >= roomLeft;
            const room = alignLeft ? roomRight : roomLeft;
            setMenuAlign(alignLeft ? "left" : "right");
            // A non-positive room means nothing has been laid out (jsdom, a hidden ancestor);
            // clamping to that would collapse the menu instead of leaving it alone.
            setMenuMaxWidth(room > 0 ? Math.max(triggerRect.width, room) : undefined);
        };

        updatePlacement();
        window.addEventListener("resize", updatePlacement);
        window.addEventListener("scroll", updatePlacement, true);
        return () => {
            window.removeEventListener("resize", updatePlacement);
            window.removeEventListener("scroll", updatePlacement, true);
        };
    }, [isOpen, portalMenu, menuPlacement, options.length, value]);

    useLayoutEffect(() => {
        if (!isOpen || !portalMenu) {
            return;
        }
        naturalMenuWidthRef.current = null;

        const positionPortalMenu = () => {
            const trigger = selectRef.current?.getBoundingClientRect();
            const menuEl = dropdownRef.current;
            if (!trigger || !menuEl) {
                return;
            }

            const menuHeight = menuEl.getBoundingClientRect().height;
            const spaceBelow = window.innerHeight - trigger.bottom - SELECT_MENU_GAP_PX;
            const spaceAbove = trigger.top - SELECT_MENU_GAP_PX;

            let openAbove: boolean;
            if (menuPlacement === "above") {
                openAbove = true;
            } else if (menuPlacement === "below") {
                openAbove = false;
            } else {
                openAbove =
                    menuHeight > spaceBelow && spaceAbove >= Math.min(menuHeight, spaceAbove);
            }

            const available = openAbove ? spaceAbove : spaceBelow;
            const maxHeight = Math.min(
                SELECT_MENU_MAX_HEIGHT_PX,
                Math.max(SELECT_MENU_GAP_PX * 2, available - SELECT_MENU_GAP_PX)
            );

            let top: number;
            if (openAbove) {
                const usedHeight = Math.min(menuHeight || maxHeight, maxHeight);
                top = trigger.top - usedHeight - SELECT_MENU_GAP_PX;
                top = Math.max(SELECT_MENU_GAP_PX, top);
            } else {
                top = trigger.bottom + SELECT_MENU_GAP_PX;
                const bottom = top + Math.min(menuHeight || maxHeight, maxHeight);
                if (bottom > window.innerHeight - SELECT_MENU_GAP_PX) {
                    top = Math.max(
                        SELECT_MENU_GAP_PX,
                        window.innerHeight - SELECT_MENU_GAP_PX - Math.min(menuHeight, maxHeight)
                    );
                }
            }

            // Same rule as the non-portal menu: at least the trigger's width, wider when an option
            // needs it. A portaled menu is clipped by nothing but the viewport, so that is the only
            // bound here, and it slides along the edge rather than shrinking when it runs out.
            if (naturalMenuWidthRef.current === null) {
                naturalMenuWidthRef.current = measureNaturalWidth(menuEl);
            }
            const roomRight = window.innerWidth - trigger.left - SELECT_MENU_GAP_PX;
            const roomLeft = trigger.right - SELECT_MENU_GAP_PX;
            const alignLeft = naturalMenuWidthRef.current <= roomRight || roomRight >= roomLeft;
            const width = Math.max(
                trigger.width,
                Math.min(naturalMenuWidthRef.current, alignLeft ? roomRight : roomLeft),
            );
            const left = alignLeft
                ? trigger.left
                : Math.max(SELECT_MENU_GAP_PX, trigger.right - width);

            setPortalMenuStyle({
                position: "fixed",
                left,
                width,
                top,
                maxHeight,
                zIndex: menuZIndex ?? 100,
            });
        };

        positionPortalMenu();
        let raf2 = 0;
        const raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(positionPortalMenu);
        });
        window.addEventListener("resize", positionPortalMenu);
        window.addEventListener("scroll", positionPortalMenu, true);
        return () => {
            cancelAnimationFrame(raf1);
            cancelAnimationFrame(raf2);
            window.removeEventListener("resize", positionPortalMenu);
            window.removeEventListener("scroll", positionPortalMenu, true);
        };
    }, [isOpen, portalMenu, menuPlacement, menuZIndex, options.length, value]);

    const selectedOption = options.find(option => option.value === value);

    const handleOptionClick = (option: SelectOption) => {
        if (option.disabled) return;
        if (readOnly) {
            // The menu is open so the list can be READ; picking is what read-only withholds. Closed
            // rather than left standing, so the click still has the one effect it is allowed.
            setIsOpen(false);
            return;
        }

        if (multiple) {
            // Multiple selection logic would go here
            // For now, treating as single select
        }

        onChange?.(option.value);
        setIsOpen(false);
    };

    const openMenuDown =
        menuPlacement === "below"
            ? true
            : menuPlacement === "above"
              ? false
              : dropdownDirection === "down";
    const dropdownPanelStyle: React.CSSProperties | undefined = portalMenu
        ? portalMenuStyle
        : {
            maxWidth: menuMaxWidth,
            ...(menuZIndex !== undefined ? { zIndex: menuZIndex } : {}),
        };

    const dropdownPanel = isOpen ? (
        <div
            ref={dropdownRef}
            className={cn(
                "bg-surface-raised border border-edge-strong rounded-md shadow-lg overflow-y-auto",
                // `w-max` rather than `w-full`: an absolutely positioned box with `width: auto`
                // shrinks to fit its containing block - the trigger - which is the width the list
                // must be free to exceed. `min-w-full` keeps it from ever being narrower.
                !portalMenu && "absolute z-50 w-max min-w-full max-h-60",
                !portalMenu && (menuAlign === "right" ? "right-0" : "left-0"),
                !portalMenu && (openMenuDown ? "top-full mt-1" : "bottom-full mb-1"),
                menuClassName,
            )}
            style={dropdownPanelStyle}
            {...menuDataAttributes}
        >
            {options.map((option) => {
                const optionClass = cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-left text-sm",
                    "transition-colors duration-150",
                    option.disabled
                        ? "text-fg-subtle cursor-not-allowed"
                        : readOnly
                            // Readable, and visibly not pickable: no hover response, and the muted
                            // tone the rest of Studio uses for text that is there to be read.
                            ? "text-fg-muted cursor-default"
                            : "text-fg hover:bg-fill cursor-default",
                    option.value === value && "bg-fill text-fg",
                );
                const optionBody = (
                    <>
                        {multiple && (
                            <div className="w-4 h-4 border border-edge-strong rounded-md flex items-center justify-center">
                                {option.value === value && <Check className="w-3 h-3 text-primary" />}
                            </div>
                        )}
                        {option.icon && (
                            <div className="flex-shrink-0 text-fg-muted">{option.icon}</div>
                        )}
                        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                            <span className="truncate">{optionLabel(option)}</span>
                            {option.secondaryLabel ? (
                                <span className="shrink-0 text-xs text-fg-subtle">{option.secondaryLabel}</span>
                            ) : null}
                        </span>
                    </>
                );
                return spanTrigger ? (
                    <InspectOnlyButton
                        key={option.value}
                        className={optionClass}
                        onClick={() => handleOptionClick(option)}
                        disabled={option.disabled}
                        aria-current={option.value === value ? "true" : undefined}
                    >
                        {optionBody}
                    </InspectOnlyButton>
                ) : (
                    <button
                        key={option.value}
                        className={optionClass}
                        // `preventDefault` is load-bearing, and not about this button.
                        //
                        // A `Select` nested inside a `<label>` re-opened the instant you picked
                        // something. The label's activation behavior forwards a click to its labeled
                        // control - which is this select's own trigger, the first labelable
                        // descendant - and the guard that should stop it (HTML: do nothing for
                        // clicks on interactive content inside the label) walks up from the click
                        // target looking for the label. By the time that walk runs, the row just
                        // picked has closed the menu and React has unmounted it, so the walk starts
                        // on a detached node, never reaches the label, and the forward happens
                        // anyway - toggling a menu the trigger believes is closed back open.
                        //
                        // Cancelling the event skips activation behavior outright, so no ancestor
                        // can turn a pick into a re-open. A `<button>` outside a form has no other
                        // default action to lose. The `InspectOnlyButton` arm above needs none of
                        // this: it renders a `<span>`, and a select whose rows are spans has a span
                        // trigger too, so there is no labelable control to forward to.
                        onClick={event => {
                            event.preventDefault();
                            handleOptionClick(option);
                        }}
                        disabled={option.disabled}
                    >
                        {optionBody}
                    </button>
                );
            })}
        </div>
    ) : null;

    const triggerClass = cn(
        // `border` is load-bearing and was missing: `variantStyles` only ever set a border
        // *colour*, and preflight zeroes every border width, so the trigger drew no border at
        // all - leaving it a flat fill 2px shorter than the `Input` it sits beside, with no
        // outline to read as a field. Every `border-*` line below has been dead until now.
        "min-w-0 justify-between border bg-fill-subtle hover:bg-fill",
        variantStyles[variant],
        sizeStyles[size],
        isOpen && "border-primary ring-2 ring-primary/20",
    );
    const triggerBody = (
        <>
            <span
                className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 text-left",
                    selectedOption ? "text-fg" : "text-fg-muted",
                )}
            >
                {selectedOption?.icon ? (
                    <span className="shrink-0 text-fg-muted">{selectedOption.icon}</span>
                ) : null}
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                    <span className="truncate">{selectedOption ? optionLabel(selectedOption) : resolvedPlaceholder}</span>
                    {selectedOption?.secondaryLabel ? (
                        <span className="shrink-0 text-2xs text-fg-subtle">
                            {selectedOption.secondaryLabel}
                        </span>
                    ) : null}
                </span>
            </span>
            <ChevronDown
                className={cn(
                    "h-4 w-4 shrink-0 text-fg-muted transition-transform duration-150",
                    isOpen && "rotate-180",
                )}
            />
        </>
    );

    return (
        <div ref={selectRef} className={cn("relative", fullWidth && "w-full min-w-0", className)}>
            {spanTrigger ? (
                // `Button`'s own classes, spelled out: `Button` renders a `<button>`, and the whole
                // point of the span trigger is to not be one. Kept in the order it applies them so
                // the two triggers are indistinguishable; the dimming is computed rather than left
                // to `disabled:`, which a span never matches.
                <InspectOnlyButton
                    disabled={disabled}
                    aria-expanded={isOpen}
                    aria-label={ariaLabel}
                    className={cn(
                        "inline-flex items-center justify-center gap-2 rounded-md font-medium",
                        "transition-all duration-150 ease-out focus:outline-none cursor-default",
                        disabled && "opacity-50",
                        "text-fg-muted hover:bg-fill hover:text-fg",
                        fullWidth && "w-full",
                        triggerClass,
                    )}
                    onClick={() => !disabled && setIsOpen(!isOpen)}
                >
                    {triggerBody}
                </InspectOnlyButton>
            ) : (
                <Button
                    variant="ghost"
                    size={size}
                    fullWidth={fullWidth}
                    disabled={disabled}
                    aria-label={ariaLabel}
                    aria-expanded={isOpen}
                    className={triggerClass}
                    onClick={() => !disabled && setIsOpen(!isOpen)}
                >
                    {triggerBody}
                </Button>
            )}

            {dropdownPanel &&
                (portalMenu ? createPortal(dropdownPanel, document.body) : dropdownPanel)}
        </div>
    );
}

/**
 * Combobox component with search functionality
 */
export function Combobox({
    options,
    value,
    onChange,
    placeholder,
    disabled = false,
    size = "md",
    variant = "default",
    fullWidth = false,
    className = "",
    filterOptions = true,
}: SelectProps & {
    filterOptions?: boolean;
}) {
    const { t } = useTranslation();
    const resolvedPlaceholder = placeholder ?? t("dialogs.select.searchPlaceholder");
    const optionLabel = (o: SelectOption) => (o.labelKey ? t(o.labelKey) : o.label ?? "");
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [filteredOptions, setFilteredOptions] = useState(options);
    const selectRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement | null>(null);
    const [dropdownDirection, setDropdownDirection] = useState<"down" | "up">("down");

    useEffect(() => {
        if (filterOptions) {
            setFilteredOptions(
                options.filter(option =>
                    optionLabel(option).toLowerCase().includes(searchTerm.toLowerCase())
                )
            );
        } else {
            setFilteredOptions(options);
        }
    }, [options, searchTerm, filterOptions]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside, true);
        return () => document.removeEventListener("mousedown", handleClickOutside, true);
    }, []);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            setDropdownDirection("down");
        }
    }, [isOpen]);

    useLayoutEffect(() => {
        if (!isOpen) return;

        const updateDirection = () => {
            if (!selectRef.current || !dropdownRef.current) return;
            const triggerRect = selectRef.current.getBoundingClientRect();
            const dropdownRect = dropdownRef.current.getBoundingClientRect();
            const spaceBelow = window.innerHeight - triggerRect.bottom;
            const spaceAbove = triggerRect.top;
            const shouldOpenUp =
                dropdownRect.height > spaceBelow && spaceAbove >= dropdownRect.height;
            setDropdownDirection(shouldOpenUp ? "up" : "down");
        };

        updateDirection();
        window.addEventListener("resize", updateDirection);
        window.addEventListener("scroll", updateDirection, true);
        return () => {
            window.removeEventListener("resize", updateDirection);
            window.removeEventListener("scroll", updateDirection, true);
        };
    }, [isOpen, filteredOptions.length, searchTerm, value]);

    const selectedOption = options.find(option => option.value === value);
    const displayValue = selectedOption ? optionLabel(selectedOption) : "";

    const handleOptionClick = (option: SelectOption) => {
        if (option.disabled) return;
        onChange?.(option.value);
        setIsOpen(false);
        setSearchTerm("");
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
        if (!isOpen) setIsOpen(true);
    };

    return (
        <div ref={selectRef} className={cn("relative", fullWidth && "w-full min-w-0", className)}>
            <div className={cn(
                // The box owns the size; the input inside owns none of it. Applying the size
                // classes to both stacked their paddings, so a `md` combobox stood 54px tall
                // against a 36px select - the widest miss of the whole scale.
                "relative flex items-center bg-fill-subtle border rounded-md",
                variantStyles[variant],
                sizeStyles[size],
                // Room for the chevron parked in the right inset.
                "pr-8",
                isOpen && "border-primary ring-1 ring-primary/30 shadow-lg shadow-primary/10",
            )}>
                <input
                    ref={inputRef}
                    type="text"
                    value={isOpen ? searchTerm : displayValue}
                    onChange={handleInputChange}
                    onFocus={() => !disabled && setIsOpen(true)}
                    placeholder={resolvedPlaceholder}
                    disabled={disabled}
                    className={cn(
                        "w-full min-w-0 bg-transparent p-0 text-inherit placeholder-fg-subtle",
                        "focus:outline-none",
                        displayValue ? "text-fg" : "text-fg-muted",
                    )}
                />
                <div className="pointer-events-none absolute inset-y-0 right-0 pr-3 flex items-center">
                    <ChevronDown
                        className={cn(
                            "w-4 h-4 text-fg-muted transition-transform duration-150",
                            isOpen && "rotate-180",
                        )}
                    />
                </div>
            </div>

            {isOpen && filteredOptions.length > 0 && (
                <div
                    ref={dropdownRef}
                    className={cn(
                        "absolute z-50 w-full left-0 bg-surface-raised border border-edge-strong rounded-md shadow-lg max-h-60 overflow-y-auto",
                        dropdownDirection === "down" ? "top-full mt-1" : "bottom-full mb-1",
                    )}
                >
                    {filteredOptions.map((option) => (
                        <button
                            key={option.value}
                            className={cn(
                                "w-full flex items-center gap-2 px-3 py-2 text-left text-sm",
                                "transition-colors duration-150",
                                option.disabled
                                    ? "text-fg-subtle cursor-not-allowed"
                                    : "text-fg hover:bg-fill cursor-default",
                                option.value === value && "bg-fill text-fg",
                            )}
                            onClick={() => handleOptionClick(option)}
                            disabled={option.disabled}
                        >
                            {option.icon && (
                                <div className="flex-shrink-0 text-fg-muted">
                                    {option.icon}
                                </div>
                            )}
                            <span className="truncate">{optionLabel(option)}</span>
                        </button>
                    ))}
                </div>
            )}

            {isOpen && filteredOptions.length === 0 && (
                <div
                    ref={dropdownRef}
                    className={cn(
                        "absolute z-50 w-full left-0 bg-surface-raised border border-edge-strong rounded-md shadow-lg p-3",
                        dropdownDirection === "down" ? "top-full mt-1" : "bottom-full mb-1",
                    )}
                >
                    <p className="text-sm text-fg-muted">{t("common.noMatchesFound")}</p>
                </div>
            )}
        </div>
    );
}

/**
 * Option group for select components
 */
export function SelectGroup({
    label,
    children,
    className = "",
}: {
    label: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={className}>
            <div className="px-3 py-1 text-xs font-semibold text-fg-muted tracking-wider">
                {label}
            </div>
            <div className="mb-1">
                {children}
            </div>
        </div>
    );
}
