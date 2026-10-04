import { useMemo } from "react";
import { ContextMenu, type ContextMenuProps } from "@/lib/components/elements/ContextMenu";
import { useShortcutLabels, withMenuShortcuts } from "../../hooks/useShortcutLabels";

export interface ShortcutContextMenuProps extends ContextMenuProps {
    /**
     * Row id → the id of the command the row runs: a keybinding catalog id (printed as bound now, a
     * rebinding included) or a fixed-input id for a key that cannot be rebound. A row with no entry
     * shows no chord.
     */
    shortcuts: Readonly<Record<string, string>>;
}

/**
 * A context menu whose rows print the chord that runs the same command, the way the title-bar menus
 * do. A component rather than a hook so a panel can swap it in where it renders its menu, without
 * threading the labels through whatever builds the rows.
 */
export function ShortcutContextMenu({ shortcuts, items, ...props }: ShortcutContextMenuProps) {
    const labels = useShortcutLabels();
    const decorated = useMemo(
        () => withMenuShortcuts(items, shortcuts, id => labels.forBinding(id) ?? labels.forFixed(id)),
        [items, shortcuts, labels],
    );
    return <ContextMenu {...props} items={decorated} />;
}
