import { useCallback, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { useUpdateState } from "@/lib/app/useUpdateState";
import { Button } from "@/lib/components/elements";
import { Progress, ProgressIndeterminate } from "@/lib/components/elements/Progress";
import { formatBytes } from "@shared/utils/formatBytes";
import { UPDATE_RELEASES_URL, type UpdateState } from "@shared/constants/update";
import type { TranslationKey } from "@shared/i18n";

const STATUS_KEYS: Record<UpdateState["status"], TranslationKey> = {
    idle: "update.status.idle",
    checking: "update.status.checking",
    available: "update.status.available",
    downloading: "update.status.downloading",
    ready: "update.status.ready",
    error: "update.status.error",
    manual: "update.status.manual",
};

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
 * What Studio knows about newer versions of itself, and the two presses that act on it.
 *
 * The order is deliberate and is the whole interaction the notification hands over to: an update
 * is *announced* elsewhere, and *started* here. Pressing Download is the point at which someone
 * commits a few hundred megabytes, so it happens on a surface they navigated to, with the version
 * numbers and the progress in front of them - not on a toast that was about to disappear.
 *
 * Every number on screen comes from the downloader over IPC (see `useUpdateState`). There is no
 * simulated progress: a bar that moves means bytes arrived.
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

    const openReleases = useCallback((url: string) => {
        void getInterface().app.openExternal(url).catch(() => undefined);
    }, []);

    if (!state) {
        return null;
    }

    const version = state.availableVersion ?? "";
    const percent = state.totalBytes && state.totalBytes > 0
        ? ((state.transferredBytes ?? 0) / state.totalBytes) * 100
        : null;

    return (
        <div className="flex flex-col gap-2">
            {/* Laid out as a settings row - state on the left, the presses on the right - because
                that is what every other row in this pane does, and a panel that reads top-to-bottom
                while its neighbours read left-to-right looks like a different kind of thing. The
                status line takes the label's weight: it is what this row is about. */}
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex flex-col gap-1 min-w-0 grow basis-64">
                    <span className="text-sm font-medium text-fg">{t(STATUS_KEYS[state.status], { version })}</span>
                    <span className="text-xs text-fg-subtle">
                        {state.status === "error" && state.error
                            ? state.error
                            : t("update.versions", { current: state.currentVersion })}
                    </span>
                    {state.status === "manual" && (
                        <span className="text-xs text-fg-subtle">{t(unsupportedKey())}</span>
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
                        disabled={busy || state.status === "checking" || state.status === "downloading"}
                        onClick={() => void check()}
                    >
                        {t("update.actions.check")}
                    </Button>

                    {state.canInstall && state.status === "available" && (
                        <Button size="sm" variant="primary" className="h-7" disabled={busy} onClick={() => void download()}>
                            {t("update.actions.download")}
                        </Button>
                    )}

                    {state.status === "ready" && (
                        <Button size="sm" variant="primary" className="h-7" onClick={() => void install()}>
                            {t("update.actions.install")}
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
                measurement of the download, and a short one reads as a smaller job. */}
            {state.status === "downloading" && (
                <div className="flex flex-col gap-1">
                    {percent === null
                        ? <ProgressIndeterminate size="sm" />
                        : <Progress size="sm" value={percent} animated={false} />}
                    <p className="text-xs text-fg-subtle">
                        {formatBytes(state.transferredBytes ?? 0)}
                        {state.totalBytes ? ` / ${formatBytes(state.totalBytes)}` : ""}
                        {state.bytesPerSecond ? ` · ${formatBytes(state.bytesPerSecond)}/s` : ""}
                    </p>
                </div>
            )}
        </div>
    );
}
