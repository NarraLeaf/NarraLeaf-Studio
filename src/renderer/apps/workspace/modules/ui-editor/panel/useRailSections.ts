import { useCallback, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import type { SectionStackSizes } from "@/apps/workspace/components/ui/SectionStack";
import {
    cleanUIRailSizes,
    readUIRailSections,
    UI_RAIL_PANEL_STATE_ID,
    type UIRailSection,
    type UIRailSectionsRecord,
    type UIRailSectionsState,
} from "./railSections";

export type UIRailSectionsHandle = UIRailSectionsState & {
    /** Open or close one section, and remember it for the project. Stable across renders. */
    setOpen: (section: UIRailSection, open: boolean) => void;
    /** Remember the body heights the author left the sections at. Stable across renders. */
    setSizes: (sizes: SectionStackSizes) => void;
};

/**
 * The UI rail's open sections and their heights, remembered per project (see `railSections.ts`).
 *
 * One instance, held by the panel: the stack lays every section out from the same answer, and a
 * request from elsewhere to show a library (`componentLibraryReveal`, `inputActionPanelFocus`)
 * opens it through `setOpen` and is remembered like a click, since the author asked to see it.
 */
export function useRailSections(): UIRailSectionsHandle {
    const { context } = useWorkspace();
    const panelState = useMemo(
        () => context?.services.get<PanelStateService>(Services.PanelState) ?? null,
        [context],
    );
    const [state, setState] = useState<UIRailSectionsState>(
        () => readUIRailSections(panelState?.getPanelState<UIRailSectionsRecord>(UI_RAIL_PANEL_STATE_ID)),
    );
    const stateRef = useRef(state);
    stateRef.current = state;

    const setOpen = useCallback((section: UIRailSection, open: boolean) => {
        const current = stateRef.current;
        if (current.open[section] === open) {
            return;
        }
        const next = { ...current, open: { ...current.open, [section]: open } };
        stateRef.current = next;
        setState(next);
        panelState?.setPanelState<UIRailSectionsRecord>(UI_RAIL_PANEL_STATE_ID, { [section]: open });
    }, [panelState]);

    const setSizes = useCallback((sizes: SectionStackSizes) => {
        const clean = cleanUIRailSizes(sizes);
        const next = { ...stateRef.current, sizes: clean };
        stateRef.current = next;
        setState(next);
        panelState?.setPanelState<UIRailSectionsRecord>(UI_RAIL_PANEL_STATE_ID, { sizes: clean });
    }, [panelState]);

    return { ...state, setOpen, setSizes };
}
