import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, Check } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { getInterface } from "@/lib/app/bridge";
import { useUpdateState } from "@/lib/app/useUpdateState";
import {
    registerUpdatePanel,
    updateCanCancel,
    updateDownloadActionKey,
    updateIsOnOffer,
    updateProgress,
    updateRetryTime,
    updateStatusKey,
} from "@/lib/app/updatePresentation";
import { Button } from "@/lib/components/elements";
import { AnchoredPanel } from "@/lib/components/elements/HintPopover";
import { ProgressCircle } from "@/lib/components/elements/Progress";
import { UpdateStepProgress } from "@/lib/components/elements/UpdateStepProgress";
import { useFloatingLayer, useHostDocument } from "@/lib/components/layout";
import { UPDATE_RELEASES_URL, type UpdateState } from "@shared/constants/update";

/** The panel's width. Wide enough for the byte counts and two buttons on one line. */
const PANEL_WIDTH_PX = 300;

/**
 * The software update, in the title bar: left of the dock toggles, and only while there is an update
 * to show.
 *
 * The button carries a ring that fills as the update comes down and is unpacked - one measure for
 * both steps (`updateProgress`) - and a check once it is ready. Pressing it opens a panel with the
 * version, what is happening and how far it has got, and the one or two things that can be done
 * about it: stop an update in progress, or restart to apply a ready one. The same restart is offered
 * by the notification raised when the update becomes ready (`useUpdateOffer`), which can also open
 * this panel.
 *
 * Every number comes from the main process (see `useUpdateState`); nothing here animates progress
 * that did not happen.
 */
export function UpdateIndicator() {
    const { t } = useTranslation();
    const state = useUpdateState();
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const doc = useHostDocument();
    const shown = updateIsOnOffer(state);

    const close = useCallback(() => setOpen(false), []);

    useEffect(() => registerUpdatePanel(() => setOpen(true)), []);

    useFloatingLayer({
        open: open && shown,
        onClose: close,
        panelRef,
        ownerRefs: [triggerRef],
    });

    // A press anywhere but the panel and its button puts it away. Heard in capture, as the other
    // anchored panels do, so a surface that stops its own presses from bubbling still closes it.
    useEffect(() => {
        if (!open) {
            return;
        }
        const onPointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) {
                return;
            }
            setOpen(false);
        };
        doc.addEventListener("mousedown", onPointerDown, true);
        return () => doc.removeEventListener("mousedown", onPointerDown, true);
    }, [doc, open]);

    if (!shown) {
        return null;
    }

    const version = state.availableVersion ?? "";
    const status = t(updateStatusKey(state), { version });
    const progress = updateProgress(state);
    const ready = state.status === "ready";
    const moving = state.status === "downloading" || state.status === "preparing";
    // "Something to look at" for an offer nobody has acted on: Studio downloads on its own unless
    // told not to, so a version that is merely available is one waiting for the author.
    const waiting = state.status === "available" || state.status === "manual";
    const failed = state.status === "error";

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                data-update-indicator={state.status}
                onClick={() => setOpen(value => !value)}
                data-tip={open ? undefined : status}
                aria-label={t("update.indicator.label")}
                aria-expanded={open}
                className={cn(
                    // A group of its own, like the presence control beside it: `mr-2` is the seam
                    // between it and the window's own control cluster.
                    "mr-2 flex h-8 w-8 items-center justify-center rounded-md transition-colors cursor-default",
                    open
                        ? "bg-fill-strong text-fg"
                        : ready
                            ? "text-primary hover:bg-fill"
                            : "text-fg-muted hover:bg-fill hover:text-fg",
                )}
            >
                <span className="relative flex h-5 w-5 items-center justify-center">
                    {(moving || ready) && (
                        <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
                            <ProgressCircle value={(progress ?? 0) * 100} size={20} strokeWidth={2} />
                        </span>
                    )}
                    {ready
                        ? <Check className="h-3 w-3" strokeWidth={2.5} />
                        : <ArrowDown className={moving ? "h-3 w-3" : "h-4 w-4"} strokeWidth={moving ? 2.5 : 2} />}
                    {(waiting || failed) && (
                        <span
                            aria-hidden
                            className={cn(
                                "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-surface-sunken",
                                failed ? "bg-danger" : "bg-primary",
                            )}
                        />
                    )}
                </span>
            </button>
            {open && (
                <AnchoredPanel
                    anchor={() => triggerRef.current?.getBoundingClientRect() ?? null}
                    width={PANEL_WIDTH_PX}
                    panelRef={panelRef}
                    role="dialog"
                    className="z-[110] rounded-lg border border-edge-strong bg-surface-overlay p-3 shadow-xl"
                >
                    <UpdatePanelBody state={state} status={status} onDone={close} />
                </AnchoredPanel>
            )}
        </>
    );
}

function UpdatePanelBody({ state, status, onDone }: { state: UpdateState; status: string; onDone: () => void }) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);

    const run = (action: () => Promise<unknown>) => {
        setBusy(true);
        void action().catch(() => null).finally(() => setBusy(false));
    };

    const releaseUrl = state.releaseUrl ?? UPDATE_RELEASES_URL;
    const retryTime = updateRetryTime(state);
    const openReleases = () => {
        void getInterface().app.openExternal(releaseUrl).catch(() => undefined);
        onDone();
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-fg">{status}</span>
                {/* Clamped: a failure that is not a dropped connection is shown by its first line, which
                    can still run long; the whole of it is in the tooltip and the log. */}
                <span
                    className="text-xs text-fg-subtle line-clamp-3 break-words"
                    data-tip={state.status === "error" && state.error ? state.error : undefined}
                >
                    {state.status === "error" && state.error
                        ? state.error
                        : t("update.versions", { current: state.currentVersion })}
                </span>
                {retryTime && (
                    <span className="text-xs text-fg-subtle">{t("update.retryAt", { time: retryTime })}</span>
                )}
            </div>

            <UpdateStepProgress state={state} />

            {state.status === "ready" && (
                <p className="text-xs text-fg-subtle">{t("update.readyHint")}</p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                {state.availableVersion && (
                    <Button size="sm" variant="ghost" onClick={openReleases}>
                        {t("update.actions.releaseNotes")}
                    </Button>
                )}
                {updateCanCancel(state) && (
                    <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => run(() => getInterface().app.update.cancel())}
                    >
                        {t("update.actions.cancel")}
                    </Button>
                )}
                {state.canInstall && (state.status === "available" || state.status === "error") && (
                    <Button
                        size="sm"
                        variant="primary"
                        disabled={busy}
                        onClick={() => run(() => getInterface().app.update.download())}
                    >
                        {t(updateDownloadActionKey(state))}
                    </Button>
                )}
                {state.status === "manual" && (
                    <Button size="sm" variant="primary" onClick={openReleases}>
                        {t("update.actions.openDownloadPage")}
                    </Button>
                )}
                {state.status === "ready" && (
                    <Button
                        size="sm"
                        variant="primary"
                        disabled={busy}
                        onClick={() => run(() => getInterface().app.update.install())}
                    >
                        {t(state.fastRestart ? "update.actions.restart" : "update.actions.install")}
                    </Button>
                )}
            </div>
        </div>
    );
}
