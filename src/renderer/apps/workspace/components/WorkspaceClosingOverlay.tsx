import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { WorkspaceCloseStage } from "@shared/types/ipcEvents";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";

/**
 * How long the close may run before the workspace says anything about it.
 *
 * A close that lands inside this is not one anybody was left wondering about, and putting a sheet
 * over the window for two frames on the way out would be its own kind of noise. Past it, the
 * window is going to sit there visibly doing nothing - which is the thing this exists to fix.
 */
const QUIET_CLOSE_MS = 250;

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
 * A spinner rather than a bar, and deliberately: in this app a bar means a real fraction (the
 * wizard's steps, the asset import queue, the localization and voice panels all fill one from a
 * count), and there is no fraction to show here - the checkpoint is a single call into the
 * version-control backend that answers when it answers. "Working, duration unknown" is a spinning
 * `Loader2` everywhere else in the Studio, so it is one here too. It also survives
 * `prefers-reduced-motion`, which `.animate-spin` is carved out of in styles.css: a stopped
 * indicator over a window that is not responding would read as the hang it exists to explain.
 */
export function WorkspaceClosingOverlay() {
    const { t } = useTranslation();
    const [stage, setStage] = useState<WorkspaceCloseStage | null>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const token = getInterface().workspace.onCloseProgress(setStage);
        return () => token.cancel();
    }, []);

    // Keyed on whether a close is running at all, never on which stage: what is being timed is how
    // long the author has been waiting, and a stage that advances is progress, not a reason to
    // start the clock over.
    const closing = stage !== null;
    useEffect(() => {
        if (!closing) {
            setVisible(false);
            return;
        }
        const timer = window.setTimeout(() => setVisible(true), QUIET_CLOSE_MS);
        return () => window.clearTimeout(timer);
    }, [closing]);

    if (!stage || !visible) {
        return null;
    }

    return (
        <div className="nl-window-content-layer z-[60] flex items-center justify-center p-4">
            {/* Swallows clicks as well as covering the window: every edit from here on would land
                after the flush that was supposed to persist it. */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" />

            <div
                role="status"
                aria-live="polite"
                className="relative w-[340px] max-w-full bg-surface-overlay border border-edge rounded-lg shadow-2xl px-5 py-4 animate-fade-in"
            >
                <p className="text-sm font-medium text-fg">{t("workspace.shell.closing.title")}</p>
                <div className="mt-2 flex items-start gap-3">
                    <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-primary" />
                    <p className="text-sm text-fg-muted">{t(STAGE_MESSAGE[stage])}</p>
                </div>
            </div>
        </div>
    );
}
