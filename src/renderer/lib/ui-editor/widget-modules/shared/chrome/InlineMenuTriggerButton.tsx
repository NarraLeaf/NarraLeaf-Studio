import { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { ContextMenu } from "@/lib/components/elements/ContextMenu";
import { controlButtonClass } from "./constants";

export type InlineMenuTriggerButtonProps = {
    menu: ContextMenuDef;
    ariaLabel?: string;
    className?: string;
};

/**
 * Square trigger that opens a positioned ContextMenu (used in compact inspector rows).
 */
export function InlineMenuTriggerButton({
    menu,
    ariaLabel = "More options",
    className = "",
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
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
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
                className={`${controlButtonClass()} ${className}`}
            >
                <MoreHorizontal className="w-4 h-4" />
            </button>
            {visible && <ContextMenu items={menu} position={position} onClose={closeMenu} />}
        </>
    );
}
