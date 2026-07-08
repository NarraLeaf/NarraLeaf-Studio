import React from "react";
import type { PanelDefinition } from "../../registry/types";
import { WorkspacePanelErrorBoundary } from "../WorkspacePanelErrorBoundary";
import { useKeepAlivePanelIds } from "./useKeepAlivePanelIds";

interface SidebarPanelStackProps {
    /** All panels registered for this sidebar position. */
    positionPanels: PanelDefinition[];
    /** The panel currently shown; all other kept-alive panels are hidden with display:none. */
    activePanelId: string;
}

/**
 * Renders the sidebar's panels as a keep-alive stack: every panel the author has opened stays
 * mounted, and only the active one is visible. This preserves each panel's React state and scroll
 * position across rail switches, instead of unmounting the previous panel (which reset it).
 *
 * Each panel gets its own scroll container so scroll offsets stay independent and survive the
 * display:none toggle — the parent must NOT be a scroll container (it lays these out at full height).
 */
export function SidebarPanelStack({ positionPanels, activePanelId }: SidebarPanelStackProps) {
    const mountedIds = useKeepAlivePanelIds(activePanelId, positionPanels);

    return (
        <>
            {positionPanels.map((panel) => {
                if (!mountedIds.has(panel.id)) {
                    return null;
                }
                const isActive = panel.id === activePanelId;
                const PanelComponent = panel.component;
                return (
                    <div
                        key={panel.id}
                        className="h-full w-full overflow-auto"
                        style={{ display: isActive ? undefined : "none" }}
                        aria-hidden={isActive ? undefined : true}
                    >
                        <WorkspacePanelErrorBoundary regionLabel={panel.title} isolationKey={panel.id}>
                            <PanelComponent panelId={panel.id} payload={panel.payload} />
                        </WorkspacePanelErrorBoundary>
                    </div>
                );
            })}
        </>
    );
}
