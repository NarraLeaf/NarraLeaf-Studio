import { useCallback, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";

/** One record per project for the UI rail's foldable sections, under `.nlstudio/services/`. */
const UI_RAIL_PANEL_STATE_ID = "ui.rail.sections";

/** The rail's foldable sections, below the interface list. */
export type UIRailSection = "componentLibrary" | "inputActions";

type UIRailSectionsState = Partial<Record<UIRailSection, boolean>>;

/**
 * Whether one of the UI rail's sections is open, remembered per project.
 *
 * Closed until the author opens it. The interface list is what the rail is for, and on a new project
 * the two libraries under it are empty tables that took the height the list needed - a fresh rail
 * should show the pages. Once opened, a section stays open for that project across sessions.
 *
 * `setOpen` writes through; a request from elsewhere to show a section (see `componentLibraryReveal`
 * and `inputActionPanelFocus`) opens it the same way, since the author asked to see it.
 */
export function useRailSectionOpen(section: UIRailSection): [boolean, (next: boolean | ((open: boolean) => boolean)) => void] {
    const { context } = useWorkspace();
    const panelState = useMemo(
        () => context?.services.get<PanelStateService>(Services.PanelState) ?? null,
        [context],
    );
    const [open, setOpenState] = useState(
        () => panelState?.getPanelState<UIRailSectionsState>(UI_RAIL_PANEL_STATE_ID)?.[section] === true,
    );
    const openRef = useRef(open);
    openRef.current = open;

    const setOpen = useCallback(
        (next: boolean | ((open: boolean) => boolean)) => {
            const value = typeof next === "function" ? next(openRef.current) : next;
            if (value === openRef.current) {
                return;
            }
            openRef.current = value;
            setOpenState(value);
            panelState?.setPanelState<UIRailSectionsState>(UI_RAIL_PANEL_STATE_ID, { [section]: value });
        },
        [panelState, section],
    );

    return [open, setOpen];
}
