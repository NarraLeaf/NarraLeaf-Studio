import { useMemo } from "react";
import { useRegistry } from "../registry";
import type { ActionGroup } from "../registry/types";
import { foldActionGroupsByMenuSlot } from "../components/ui/actionMenuFold";

/**
 * The action groups the title bar draws, folded (see {@link foldActionGroupsByMenuSlot}).
 *
 * One hook rather than the fold at each call site, because the two arrangements of the title bar
 * have to be looking at the same menus: the bar draws them side by side and the hamburger draws them
 * as rows, and a fold applied to one and not the other would be two Edit menus in one arrangement
 * and one in the other.
 *
 * Memoised on the registry's list, which is a new array whenever anything registers - the history
 * menu re-registers on every undo - so the identity here is exactly as stable as what it is built
 * from, and no more.
 */
export function useTitleBarActionGroups(): ActionGroup[] {
    const { actionGroups } = useRegistry();
    return useMemo(() => foldActionGroupsByMenuSlot(actionGroups), [actionGroups]);
}
