import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { PanelRight, PictureInPicture2 } from "lucide-react";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { useTranslation } from "@/lib/i18n";

/**
 * What the debug drawer's own title bar needs from whoever owns the drawer's layout.
 *
 * The dock/float mode is a property of the Dev Mode window, not of a panel or of a game session, so
 * it is owned by `DevModeContent` (same reason `activePanel` is: a timeline jump replaces the whole
 * GameApp session and any state below it). The panels only render the control and forward the press
 * that starts a drag.
 */
export type DevModePanelChrome = {
    /** True while the drawer floats over the stage; false while it is docked beside it. */
    floating: boolean;
    /** Flip the mode. */
    onToggleFloating: () => void;
    /**
     * Press on the title bar. Only meaningful while floating - the owner turns it into a drag of the
     * whole panel. Real pointer input, not HTML5 drag-and-drop (`draggable` needs a `.nl-drag-source`
     * opt-in in this repo, and nothing can drive it from a synthesized DragEvent).
     */
    onTitleBarPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
};

/**
 * The dock/float toggle that sits at the right end of a debug panel's title bar.
 *
 * The accessible name is the ACTION, never the state: `Float panel` while docked, `Dock panel` while
 * floating - the same contract the debug FAB already uses for `Open/Close preview debug tools menu`.
 * It is the only thing that says which mode the drawer is in without measuring the layout.
 */
export function DevModePanelModeToggle(props: { chrome?: DevModePanelChrome }): ReactNode {
    const { chrome } = props;
    const { t } = useTranslation();
    if (!chrome) {
        return null;
    }
    const label = chrome.floating ? t("devMode.panel.dock") : t("devMode.panel.float");
    return (
        <ToolbarButton
            size="xs"
            aria-label={label}
            data-tip={label}
            // Deliberately no `aria-pressed`: the name already changes with the mode, and a control
            // that announces both a changing name and a pressed state contradicts itself.
            className="shrink-0"
            onClick={chrome.onToggleFloating}
        >
            {chrome.floating
                ? <PanelRight className="h-3.5 w-3.5" aria-hidden />
                : <PictureInPicture2 className="h-3.5 w-3.5" aria-hidden />}
        </ToolbarButton>
    );
}
