import { useCallback, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { ContextMenu } from "@/lib/components/elements/ContextMenu";
import { MenuTriggerFieldDefinition } from "../types";
import { FieldLayout } from "./FieldLayout";

interface MenuTriggerFieldProps<TData> {
    field: MenuTriggerFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

export function MenuTriggerField<TData>({
    field,
    data: _data,
    onSaving: _onSaving,
}: MenuTriggerFieldProps<TData>) {
    const [visible, setVisible] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const buttonRef = useRef<HTMLButtonElement>(null);

    const openMenu = useCallback(() => {
        if (!buttonRef.current) return;
        const rect = buttonRef.current.getBoundingClientRect();
        setPosition({ x: rect.left, y: rect.bottom + 4 });
        setVisible(true);
    }, []);

    const closeMenu = useCallback(() => {
        setVisible(false);
    }, []);

    const handleToggle = useCallback(() => {
        if (visible) {
            closeMenu();
            return;
        }
        openMenu();
    }, [closeMenu, openMenu, visible]);

    return (
        <FieldLayout field={field}>
            <button
                ref={buttonRef}
                type="button"
                onClick={handleToggle}
                className="grid h-9 w-9 place-items-center rounded-lg border border-edge bg-transparent text-fg-muted transition hover:bg-fill-subtle focus:outline-none focus:ring-2 focus:ring-primary/50"
                aria-label={field.buttonAriaLabel ?? "Open menu"}
            >
                {field.icon ?? <MoreHorizontal className="w-4 h-4" />}
            </button>

            {visible && (
                <ContextMenu items={field.menu} position={position} onClose={closeMenu} />
            )}
        </FieldLayout>
    );
}
