import type { MouseEvent as ReactMouseEvent } from "react";
import type { BlueprintOpenOptions } from "./useOpenBlueprintTarget";

/**
 * The gesture every blueprint entry shares: click opens the blueprint, right click opens it in a
 * window of its own.
 *
 * One helper rather than the same three lines on each entry, because the value of the gesture is
 * that it is the same everywhere - the interface's logic card, a widget's, a value binding's, a
 * story action's. `preventDefault` because the alternative is the platform menu appearing over the
 * window that just opened.
 */
export function blueprintEntryContextMenu(
    open: (options?: BlueprintOpenOptions) => void,
): (event: ReactMouseEvent) => void {
    return (event) => {
        event.preventDefault();
        event.stopPropagation();
        open({ inOwnWindow: true });
    };
}
