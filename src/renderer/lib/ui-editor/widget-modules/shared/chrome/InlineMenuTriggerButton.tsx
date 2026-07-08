import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { ContextMenu } from "@/lib/components/elements/ContextMenu";
import { controlButtonClass } from "./constants";

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
};

const ICON_GHOST_TRIGGER_BASE =
    "grid h-7 w-7 shrink-0 place-items-center rounded border-0 bg-transparent p-0 text-fg-subtle transition-colors hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

/**
 * Square trigger that opens a positioned ContextMenu (used in compact inspector rows).
 */
export function InlineMenuTriggerButton({
    menu,
    ariaLabel = "More options",
    className = "",
    icon,
    buttonStyle = "control",
    menuIconsEnabled = false,
}: InlineMenuTriggerButtonProps) {
    const [visible, setVisible] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const buttonRef = useRef<HTMLButtonElement | null>(null);

    const openMenu = useCallback(() => {
        if (!buttonRef.current) return;
        const rect = buttonRef.current.getBoundingClientRect();
        setPosition({ x: rect.left, y: rect.bottom + 4 });
        setVisible(true);
    }, []);

    const closeMenu = useCallback(() => {
        setVisible(false);
    }, []);

    useEffect(() => {
        if (!visible) return;
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (
                target &&
                (buttonRef.current?.contains(target) ||
                    (target as HTMLElement).closest?.('[data-context-menu="true"]'))
            ) {
                return;
            }
            closeMenu();
        };
        document.addEventListener("mousedown", handleClickOutside, true);
        return () => document.removeEventListener("mousedown", handleClickOutside, true);
    }, [visible, closeMenu]);

    useEffect(() => {
        if (!visible) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                closeMenu();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [visible, closeMenu]);

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                onClick={visible ? closeMenu : openMenu}
                aria-label={ariaLabel}
                className={
                    buttonStyle === "iconGhost"
                        ? `${ICON_GHOST_TRIGGER_BASE} ${className}`.trim()
                        : `${controlButtonClass()} ${className}`.trim()
                }
            >
                {icon ?? <MoreHorizontal className="w-4 h-4" />}
            </button>
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
