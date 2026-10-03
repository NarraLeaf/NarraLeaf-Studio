import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { MoreHorizontal } from "lucide-react";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { ContextMenu } from "@/lib/components/elements/ContextMenu";
import { InspectOnlyButton } from "@/lib/components/elements/InspectOnlyButton";
import { controlButtonClass } from "./constants";
import { useTranslation } from "@/lib/i18n";

/** `control` = bordered square (default). `iconGhost` = borderless icon-only for compact rows. */
export type InlineMenuTriggerButtonStyle = "control" | "iconGhost";

export type InlineMenuTriggerButtonProps = {
    menu: ContextMenuDef;
    ariaLabel?: string;
    className?: string;
    icon?: ReactNode;
    /** Defaults to `control` (matches stroke/corners more-options triggers). */
    buttonStyle?: InlineMenuTriggerButtonStyle;
    /** When true, this menu surface reserves a leading icon column (see ContextMenu `iconsEnabled`). Submenus are controlled per item via `submenuIconsEnabled`, not this flag. */
    menuIconsEnabled?: boolean;
    /**
     * Every row of this menu only looks - it switches what the inspector SHOWS and writes nothing.
     *
     * The trigger is then rendered through {@link InspectOnlyButton}, so an ancestor read-only clamp
     * (the `<fieldset disabled>` a frozen workspace puts around an inspector field) does not reach
     * it. Never set this on a menu that has one writing row: the rows themselves are unaffected.
     */
    inspectOnly?: boolean;
};

const ICON_GHOST_TRIGGER_BASE =
    "grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-fg-subtle transition-colors hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

/**
 * Square trigger that opens a positioned ContextMenu (used in compact inspector rows).
 *
 * The menu does its own dismissing - Escape, a press outside it, focus moving on - so all this
 * adds is the toggle. Focus stays on the trigger while the menu is open, which is where the menu's
 * arrow keys are read from.
 */
export function InlineMenuTriggerButton({
    menu,
    ariaLabel,
    className = "",
    icon,
    buttonStyle = "control",
    menuIconsEnabled = false,
    inspectOnly = false,
}: InlineMenuTriggerButtonProps) {
    const { t } = useTranslation();
    const resolvedAriaLabel = ariaLabel ?? t("widgetChrome.chrome.moreOptions");
    const [visible, setVisible] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const buttonRef = useRef<HTMLElement | null>(null);
    /**
     * Whether the menu was open when the press on the trigger began. The menu closes itself on any
     * press outside it, the trigger included, and it does so before the trigger's click arrives - so
     * by then the trigger would read "closed" and open the menu straight back up. Noted on
     * `pointerdown`, which runs ahead of the menu's `mousedown`, and forgotten on a key, so a press
     * that never became a click cannot swallow the next keyboard activation.
     */
    const openAtPressRef = useRef(false);
    const visibleRef = useRef(visible);
    visibleRef.current = visible;

    const openMenu = useCallback(() => {
        if (!buttonRef.current) return;
        const rect = buttonRef.current.getBoundingClientRect();
        setPosition({ x: rect.left, y: rect.bottom + 4 });
        setVisible(true);
    }, []);

    const closeMenu = useCallback(() => {
        setVisible(false);
    }, []);

    // On the element rather than through React props: the trigger is either a `<button>` or an
    // `InspectOnlyButton`, which passes on no pointer handlers.
    useEffect(() => {
        const element = buttonRef.current;
        if (!element) return;
        const notePress = () => {
            openAtPressRef.current = visibleRef.current;
        };
        const forgetPress = () => {
            openAtPressRef.current = false;
        };
        element.addEventListener("pointerdown", notePress);
        element.addEventListener("keydown", forgetPress);
        return () => {
            element.removeEventListener("pointerdown", notePress);
            element.removeEventListener("keydown", forgetPress);
        };
    }, [inspectOnly]);

    const triggerClass =
        buttonStyle === "iconGhost"
            ? `${ICON_GHOST_TRIGGER_BASE} ${className}`.trim()
            : `${controlButtonClass()} ${className}`.trim();
    const toggle = useCallback(() => {
        const pressedWhileOpen = openAtPressRef.current;
        openAtPressRef.current = false;
        if (visible) {
            closeMenu();
        } else if (!pressedWhileOpen) {
            openMenu();
        }
    }, [closeMenu, openMenu, visible]);
    const triggerContent = icon ?? <MoreHorizontal className="w-4 h-4" />;

    return (
        <>
            {inspectOnly ? (
                <InspectOnlyButton
                    ref={buttonRef as Ref<HTMLSpanElement>}
                    onClick={toggle}
                    aria-label={resolvedAriaLabel}
                    aria-expanded={visible}
                    className={triggerClass}
                >
                    {triggerContent}
                </InspectOnlyButton>
            ) : (
                <button
                    ref={buttonRef as Ref<HTMLButtonElement>}
                    type="button"
                    onClick={toggle}
                    aria-label={resolvedAriaLabel}
                    className={triggerClass}
                >
                    {triggerContent}
                </button>
            )}
            {visible && (
                <ContextMenu
                    items={menu}
                    position={position}
                    onClose={closeMenu}
                    iconsEnabled={menuIconsEnabled}
                />
            )}
        </>
    );
}
