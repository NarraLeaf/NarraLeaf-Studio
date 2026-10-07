import { useCallback, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { useUpdateState } from "@/lib/app/useUpdateState";
import { updateCanCancel, updateDownloadActionKey, updateRetryTime, updateStatusKey } from "@/lib/app/updatePresentation";
import { Button } from "@/lib/components/elements";
import { UpdateStepProgress } from "@/lib/components/elements/UpdateStepProgress";
import { UPDATE_RELEASES_URL } from "@shared/constants/update";
import type { TranslationKey } from "@shared/i18n";

/**
 * Why this build cannot install its own updates, in the terms the reader is in.
 *
 * A sentence rather than a disabled Download button: a control that cannot work is a question the
 * user has no way to answer. macOS is named specifically because the reason is specific and
 * temporary (Studio is not code-signed yet), and a generic "unsupported" would read as "never".
 */
function unsupportedKey(): TranslationKey {
    if (navigator.platform.toLowerCase().includes("mac")) {
        return "update.unsupported.macos";
    }
    return "update.unsupported.platform";
}

/**
 * What Studio knows about newer versions of itself, and what can be done about it from here.
 *
 * The same state and the same actions as the title bar's update panel (`UpdateIndicator`): check,
 * download when automatic downloads are off, stop an update in progress, restart to apply a ready
 * one. Every number on screen comes from the main process over IPC (see `useUpdateState`). There is
 * no simulated progress: a bar that moves means bytes arrived or files were unpacked.
 */
export function SoftwareUpdatePanel() {
    const { t } = useTranslation();
    const state = useUpdateState();
    const [busy, setBusy] = useState(false);

    const check = useCallback(async () => {
        setBusy(true);
        await getInterface().app.update.check().catch(() => null);
        setBusy(false);
    }, []);

    const download = useCallback(async () => {
        // Not awaited into a spinner: the download reports itself through the pushed state, and
        // holding `busy` for its whole duration would disable the very buttons that describe it.
        setBusy(true);
        await getInterface().app.update.download().catch(() => null);
        setBusy(false);
    }, []);

    const install = useCallback(async () => {
        await getInterface().app.update.install().catch(() => null);
    }, []);

    const cancel = useCallback(async () => {
        setBusy(true);
        await getInterface().app.update.cancel().catch(() => null);
        setBusy(false);
    }, []);

    const openReleases = useCallback((url: string) => {
        void getInterface().app.openExternal(url).catch(() => undefined);
    }, []);

    if (!state) {
        return null;
    }

    const version = state.availableVersion ?? "";
    // Nothing to check while an update is under way or waiting to be applied.
    const checkBlocked = state.status === "checking" || state.status === "downloading"
        || state.status === "preparing" || state.status === "ready";

    return (
        <div className="flex flex-col gap-2">
            {/* Laid out as a settings row - state on the left, the presses on the right - because
                that is what every other row in this pane does, and a panel that reads top-to-bottom
                while its neighbours read left-to-right looks like a different kind of thing. The
                status line takes the label's weight: it is what this row is about. */}
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex flex-col gap-1 min-w-0 grow basis-64">
                    <span className="text-sm font-medium text-fg">{t(updateStatusKey(state), { version })}</span>
                    <span className="text-xs text-fg-subtle break-words">
                        {state.status === "error" && state.error
                            ? state.error
                            : t("update.versions", { current: state.currentVersion })}
                    </span>
                    {updateRetryTime(state) && (
                        <span className="text-xs text-fg-subtle">{t("update.retryAt", { time: updateRetryTime(state) ?? "" })}</span>
                    )}
                    {state.status === "manual" && (
                        <span className="text-xs text-fg-subtle">{t(unsupportedKey())}</span>
                    )}
                    {state.status === "ready" && (
                        <span className="text-xs text-fg-subtle">{t("update.readyHint")}</span>
                    )}
                </div>

                {/* `max-w-full` rather than `shrink-0`, for the same reason the ordinary rows carry
                    it: once these buttons have wrapped onto their own line they must stay inside
                    the pane instead of running off its right edge. */}
                <div className="flex flex-wrap items-center justify-end gap-2 ml-auto min-w-0 max-w-full">
                    {version && (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            onClick={() => openReleases(state.releaseUrl ?? UPDATE_RELEASES_URL)}
                        >
                            {t("update.actions.releaseNotes")}
                        </Button>
                    )}

                    <Button
                        size="sm"
                        variant="secondary"
                        className="h-7"
                        disabled={busy || checkBlocked}
                        onClick={() => void check()}
                    >
                        {t("update.actions.check")}
                    </Button>

                    {updateCanCancel(state) && (
                        <Button size="sm" variant="secondary" className="h-7" disabled={busy} onClick={() => void cancel()}>
                            {t("update.actions.cancel")}
                        </Button>
                    )}

                    {state.canInstall && (state.status === "available" || (state.status === "error" && version)) && (
                        <Button size="sm" variant="primary" className="h-7" disabled={busy} onClick={() => void download()}>
                            {t(updateDownloadActionKey(state))}
                        </Button>
                    )}

                    {state.status === "ready" && (
                        <Button size="sm" variant="primary" className="h-7" onClick={() => void install()}>
                            {t(state.fastRestart ? "update.actions.restart" : "update.actions.install")}
                        </Button>
                    )}

                    {state.status === "manual" && (
                        <Button
                            size="sm"
                            variant="primary"
                            className="h-7"
                            onClick={() => openReleases(state.releaseUrl ?? UPDATE_RELEASES_URL)}
                        >
                            {t("update.actions.openDownloadPage")}
                        </Button>
                    )}
                </div>
            </div>

            {/* Full width under the row, not squeezed into the control column: the bar is a
                measurement of the step under way, and a short one reads as a smaller job. */}
            <UpdateStepProgress state={state} />
        </div>
    );
}
