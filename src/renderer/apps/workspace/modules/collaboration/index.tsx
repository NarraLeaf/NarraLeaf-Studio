import { useEffect, useState } from "react";
import { Share2 } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelModule } from "../types";
import { PanelPosition } from "../../registry/types";
import { Services } from "@/lib/workspace/services/services";
import type { LiveSessionService } from "@/lib/workspace/services/live/LiveSessionService";
import { useWorkspace } from "../../context";
import { CollaborationPanel } from "./CollaborationPanel";

export const COLLABORATION_PANEL_ID = "narraleaf-studio:collaboration";

/**
 * Right-dock collaboration panel: the live session, kept on screen beside the scene being written.
 *
 * **Not registered until this window has been in a session**, and registered for good once it has -
 * see `useCollaborationPanelRegistered`. A rail icon for a feature the author has never used is one
 * more thing to work out on a rail that already carries seven; and taking it away the moment a
 * session ends would take the record of what happened in it away with the session.
 *
 * Closed by default even then. A session is entered from the title bar and read here, and a panel
 * that opened itself would take editor width from an author who wanted the room, not the panel.
 */
export const collaborationPanelModule: PanelModule = {
    metadata: {
        id: COLLABORATION_PANEL_ID,
        // Resolved lazily on read (module registration runs after i18n init).
        titleKey: "placeholders.moduleTitles.collaboration",
        get title() {
            return translate("placeholders.moduleTitles.collaboration");
        },
        icon: <Share2 className="w-4 h-4" />,
        position: PanelPosition.Right,
        defaultVisible: false,
        order: 25,
    },
    component: CollaborationPanel,
};

/**
 * Whether this window has been in a live session, so the panel above may be registered.
 *
 * **Latched, not derived.** A session ending clears almost everything it published, and a panel
 * that came and went with the room would take the room's own record - who was in it, what the host
 * refused - away at the moment the author most wants to read it back. So the answer only ever goes
 * from false to true, and stays true for the life of the window.
 *
 * `ended` counts as well as `phase`, because the window may have been in a session that has since
 * finished before this hook first ran - a panel registry that only watched the live phase would
 * miss it by one render.
 */
export function useCollaborationPanelRegistered(): boolean {
    const { context, isInitialized } = useWorkspace();
    const [seen, setSeen] = useState(false);

    useEffect(() => {
        if (!context || !isInitialized || seen) {
            return;
        }
        const service = context.services.get<LiveSessionService>(Services.Live);
        const read = () => {
            const view = service.getView();
            if (view.phase !== "idle" || view.ended !== null) {
                setSeen(true);
            }
        };
        read();
        return service.onChanged(read);
    }, [context, isInitialized, seen]);

    return seen;
}
