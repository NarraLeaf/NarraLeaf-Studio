import { LifeBuoy } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelModule } from "../types";
import { PanelPosition } from "../../registry/types";
import { RecoveryPanel } from "../../recovery/RecoveryPanel";
import type { RecoveryProbeId } from "@/lib/workspace/services/core/RecoveryService";

export const RECOVERY_PANEL_ID = "narraleaf-studio:recovery";

/**
 * The recovery panel, as an ordinary left-dock panel.
 *
 * Registered only in a recovery window (see `useModuleLoader`), and first in the rail, because in
 * that window it is the reason the window is open.
 */
export const recoveryPanelModule: PanelModule = {
    metadata: {
        id: RECOVERY_PANEL_ID,
        // Resolved lazily on read: module registration runs before i18n has necessarily settled.
        titleKey: "workspace.recovery.panelTitle",
        get title() {
            return translate("workspace.recovery.panelTitle");
        },
        icon: <LifeBuoy className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: true,
        order: -100,
    },
    component: RecoveryPanel,
};

/**
 * Which panels a passing load check makes usable.
 *
 * **This table is the whole of "browse what loaded".** A recovery window starts with almost nothing
 * registered, because a panel whose service never initialized is a panel that throws on its first
 * render; as each check goes green its panels appear, and the author gets the real editor for the
 * parts of the project that are intact.
 *
 * Panel ids rather than modules so this file does not import fourteen panel modules to name them -
 * `useModuleLoader` already has the registry and does the lookup.
 *
 * Absent on purpose: the dashboard, search and the reference index. All three read across *every*
 * subsystem, so none of them has a single check that could honestly enable it.
 */
export const PANELS_UNLOCKED_BY_PROBE: Readonly<Record<RecoveryProbeId, readonly string[]>> = {
    project: ["narraleaf-studio:project"],
    assets: ["narraleaf-studio:assets", "narraleaf-studio:assets-bottom"],
    story: ["narraleaf-studio:story", "narraleaf-studio:story-motion"],
    // Reading the scripts needs the outline, so this check unlocks nothing the outline has not.
    storyDocuments: [],
    interface: ["narraleaf-studio:ui-surfaces"],
    characters: ["narraleaf-studio:characters"],
    localization: ["narraleaf-studio:localization"],
    voice: ["narraleaf-studio:voice"],
    variables: [],
    audioTracks: [],
};
