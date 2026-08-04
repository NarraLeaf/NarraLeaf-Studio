import React, { useEffect, useState } from "react";
import type { WorkspaceCloseStage } from "@shared/types/ipcEvents";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { WorkspaceProgressCard, useSettledWait } from "./WorkspaceProgressOverlay";

const STAGE_MESSAGE: Record<WorkspaceCloseStage, TranslationKey> = {
    saving: "workspace.shell.closing.saving",
    checkpoint: "workspace.shell.closing.checkpoint",
    launcher: "workspace.shell.closing.launcher",
};

/**
 * What the workspace shows while the main process closes it.
 *
 * Closing a workspace is not instant: the renderer's pending auto-saves go out first, and then
 * Lore writes the closing checkpoint, which on a project of any size is seconds of a window that
 * looks exactly like a window that ignored the click. Main narrates the close over
 * `workspace.closeProgress` and this puts the current stage on screen.
 *
 * Mounted outside the workspace context on purpose, next to the provider rather than inside it:
 * the close can be asked for at any moment, including while the project is still loading and
 * including on the error screen, and all of those windows take just as long to close.
 *
 * The opening half of this pair is {@link WorkspaceOpeningOverlay}; both wear the same card.
 */
export function WorkspaceClosingOverlay() {
    const { t } = useTranslation();
    const [stage, setStage] = useState<WorkspaceCloseStage | null>(null);

    useEffect(() => {
        const token = getInterface().workspace.onCloseProgress(setStage);
        return () => token.cancel();
    }, []);

    const visible = useSettledWait(stage !== null);

    if (!stage || !visible) {
        return null;
    }

    return (
        <div className="nl-window-content-layer z-[60] flex items-center justify-center p-4">
            {/* Swallows clicks as well as covering the window: every edit from here on would land
                after the flush that was supposed to persist it. */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" />

            <WorkspaceProgressCard
                title={t("workspace.shell.closing.title")}
                message={t(STAGE_MESSAGE[stage])}
            />
        </div>
    );
}
