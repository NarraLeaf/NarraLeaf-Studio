import React from "react";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { CARD_REVEAL_STYLE, WorkspaceProgressCard } from "./WorkspaceProgressOverlay";

/**
 * Which part of the open is running, in the order they run.
 *
 * Renderer-side only, unlike its closing counterpart: opening a workspace is work this window does
 * to itself, so nothing has to cross IPC to describe it.
 *
 * - `preparing` - creating the workspace context and checking the folder really is a project.
 * - `services`  - initializing and activating every workspace service. The long one on a large
 *                 project, and the reason this exists.
 * - `interface` - services are up and the editor is mounting. Reported one painted frame before the
 *                 first render so the message on screen matches what the window is actually stuck
 *                 on; see `WorkspaceProvider`.
 */
export type WorkspaceStartupStage = "preparing" | "services" | "interface";

const STAGE_MESSAGE: Record<WorkspaceStartupStage, TranslationKey> = {
  preparing: "workspace.shell.opening.preparing",
  services: "workspace.shell.opening.services",
  interface: "workspace.shell.opening.interface"
};

/**
 * What the workspace shows while it is starting up.
 *
 * The mirror of {@link WorkspaceClosingOverlay}, for the same reason and wearing the same card: a
 * project of any size spends seconds booting its services and mounting the editor, and until this
 * existed the window sat there blank for all of it - indistinguishable from one that had hung.
 *
 * Blank is still what the first {@link QUIET_WAIT_MS} look like, deliberately: a project that opens
 * that fast should not flash a card on the way in. What is *not* blank is the backdrop, which paints
 * immediately - it is the window's own surface colour, so there is nothing to flash.
 *
 * That delay is CSS, not a timer, and the difference is the whole point. Startup blocks this thread
 * for a second at a time on a real project - measured, not assumed - which starves a `setTimeout`
 * exactly as thoroughly as it starves everything else: the card would arrive when the wait ended,
 * having explained nothing. The compositor is not blocked, so the reveal is left to it.
 *
 * No scrim, unlike the closing overlay: there is no workspace underneath to dim or to protect from
 * clicks, and dimming an empty window would only make the wait look worse than it is.
 */
export function WorkspaceOpeningOverlay({ stage }: { stage: WorkspaceStartupStage }) {
  const { t } = useTranslation();

  return (
    <div
      data-workspace-startup-stage={stage}
      className="fixed inset-0 bg-surface flex items-center justify-center p-4"
    >
      {/* The real title bar mounts with the editor, so until then this window cannot be moved
                at all. A strip of drag region where the title bar is about to be keeps a slow open
                from also being a pinned window. */}
      <div className="titlebar-drag absolute inset-x-0 top-0 h-[var(--nl-window-titlebar-height)]" />

      <WorkspaceProgressCard
        title={t("workspace.shell.opening.title")}
        message={t(STAGE_MESSAGE[stage])}
        style={CARD_REVEAL_STYLE}
      />
    </div>
  );
}
