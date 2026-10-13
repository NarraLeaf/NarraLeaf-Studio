import { useEffect, useState } from "react";
import type { PanelDefinition } from "../../registry/types";

/**
 * Tracks which sidebar panels stay mounted (kept alive) so switching the visible panel in a rail
 * does not unmount - and lose the state/scroll of - the previously shown one.
 *
 * Keeps every panel that has been shown at least once this session and is still registered; the
 * active panel is always kept. Panels never opened are not mounted, so the set stays bounded to what
 * the author has actually used. When a panel unregisters (e.g. its owning editor is no longer active)
 * it drops out and its component unmounts, which is the intended lifecycle.
 */
export function useKeepAlivePanelIds(activePanelId: string | null, positionPanels: PanelDefinition[]): Set<string> {
    // Stable signature so the effect only re-runs when the registered panel set actually changes,
    // not on every render (positionPanels is a fresh filtered array each time).
    const registeredSignature = positionPanels.map((p) => p.id).join("|");
    const [shown, setShown] = useState<Set<string>>(() => new Set(activePanelId ? [activePanelId] : []));

    useEffect(() => {
        const registeredIds = new Set(registeredSignature ? registeredSignature.split("|") : []);
        setShown((prev) => {
            const next = new Set<string>();
            for (const id of prev) {
                if (registeredIds.has(id)) {
                    next.add(id);
                }
            }
            if (activePanelId && registeredIds.has(activePanelId)) {
                next.add(activePanelId);
            }
            if (next.size === prev.size && [...next].every((id) => prev.has(id))) {
                return prev;
            }
            return next;
        });
    }, [activePanelId, registeredSignature]);

    // The active panel is mounted in the same render that makes it active. Waiting for the effect
    // above would leave one painted frame with nothing in the sidebar but its background.
    if (activePanelId && !shown.has(activePanelId) && positionPanels.some(panel => panel.id === activePanelId)) {
        return new Set([...shown, activePanelId]);
    }
    return shown;
}
