import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useRegistry } from "../../registry";
import { useWorkspace } from "../../context";
import { PanelPosition } from "../../registry/types";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusArea } from "@/lib/workspace/services/ui";
import { SidebarPanelStack } from "./SidebarPanelStack";
import { useTranslation } from "@/lib/i18n";

interface BottomPanelProps {
  panelId: string;
  onClose: () => void;
  height: number;
}

/**
 * Vertical space the dock cell spends on chrome above the panel body: the 1px
 * `ResizableHandle` divider, which is now the cell's only top chrome (the cell's own
 * top border is gone — the divider IS the line).
 * Kept in sync with the cell markup in WorkspaceLayout's bottom region.
 */
const BOTTOM_PANEL_CHROME_OFFSET = 1;

/**
 * Bottom panel container
 * Displays the selected panel content with payload support
 * Manages focus state and visual focus indicator
 */
export function BottomPanel({ panelId, onClose, height }: BottomPanelProps) {
  const { t } = useTranslation();
  const { panels } = useRegistry();
  const { context } = useWorkspace();
  const bottomPanels = panels.filter((p) => p.position === PanelPosition.Bottom);
  const panel = bottomPanels.find((p) => p.id === panelId);
  const [isFocused, setIsFocused] = useState(false);

  // Set focus when panel is displayed or clicked
  useEffect(() => {
    if (!context || !panelId) return;

    const uiService = context.services.get<UIService>(Services.UI);

    // Subscribe to focus changes to update visual indicator
    const unsubscribe = uiService.focus.onFocusChange((focusContext) => {
      setIsFocused(
        focusContext.area === FocusArea.BottomPanel && focusContext.targetId === panelId
      );
    });

    // Set focus when panel mounts (after subscribing)
    uiService.focus.setFocus(FocusArea.BottomPanel, panelId);

    return unsubscribe;
  }, [context, panelId]);

  if (!panel || !panelId) {
    return null;
  }

  const handleClick = () => {
    if (!context) return;
    const uiService = context.services.get<UIService>(Services.UI);
    uiService.focus.setFocus(FocusArea.BottomPanel, panelId);
  };

  return (
    <div
      // No border at the seam: the `.nl-dock-divider` above this panel is the one line
      // drawn there. The (transparent) border box stays for the focus ring alone.
      className={`bg-surface flex flex-col border transition-colors ${
        isFocused ? "nl-dock-focused border-primary" : "border-transparent"
      }`}
      // The dock cell (`height` px) also holds the 1px ResizableHandle divider above
      // this panel. Subtract it so the panel fits inside the cell instead of
      // overflowing — otherwise its bottom edge (and anything pinned there, e.g. the
      // console progress bar) is clipped by the viewport.
      style={{ height: `${height - BOTTOM_PANEL_CHROME_OFFSET}px` }}
      onClick={handleClick}
      tabIndex={0}
    >
      {/* Panel Header */}
      <div className="h-10 flex items-center justify-between px-4 bg-surface-sunken border-b border-edge">
        <div className="flex items-center gap-2">
          <span className="text-fg-muted">{panel.icon}</span>
          <h2 className="text-sm font-medium text-fg">
            {panel.titleKey ? t(panel.titleKey) : panel.title}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-md flex items-center justify-center text-fg-muted hover:bg-fill hover:text-fg transition-colors cursor-default"
          aria-label={t("workspace.shell.closePanel")}
          data-tip={t("workspace.shell.closePanel")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Panel Content: keep-alive stack (active shown, others mounted-but-hidden) */}
      <div className="flex-1 min-h-0">
        <SidebarPanelStack positionPanels={bottomPanels} activePanelId={panelId} />
      </div>
    </div>
  );
}
