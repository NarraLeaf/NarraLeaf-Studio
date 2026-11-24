import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Button } from "@/lib/components/elements";
import { ServerRow, useServers } from "@/lib/vcs/servers";
import { cn } from "@/lib/utils/cn";
import { SETTINGS_HIGHLIGHT_RING, useSettingsHighlight } from "../components/settingsHighlight";
import type { VcsServerSession } from "@shared/types/vcs";
import { signInWithBrowser, signInWithPassword } from "@/lib/vcs/servers";
import { AddServerModal } from "./AddServerModal";

/**
 * Every server this installation is signed in to, and the way to add one.
 *
 * **This is the machine's record and nothing more.** Which servers it is signed in to,
 * as whom, which projects use each sign-in, and how to stop. A sign-in belongs to the
 * machine, and a project uses one only once the author has said it does - so each row
 * names the projects that did, which are the projects "Sign out" here signs out.
 *
 * **What a server holds is not this panel's business.** No project counts, no members,
 * nothing that would have to be read from the network to be right: the launcher's
 * Servers tab answers that, and a second copy of it here would be a copy that goes
 * stale the moment somebody else pushes.
 *
 * Adding one is a sequence, in {@link AddServerModal}, which is a dialog rather than a
 * block in this column - the sequence needs the room, and every other surface that wants
 * to offer it can mount the same one.
 */
export function ServersPanel() {
    const { t, formatList } = useTranslation();
    const { servers, loading, reload } = useServers();
    const [adding, setAdding] = useState(false);
    const [busy, setBusy] = useState(false);
    // Signing out is asked twice: the first press says what it ends, the second does it. It
    // takes the sign-in away from every project that uses it, which is not undone by a press.
    const [confirming, setConfirming] = useState<string | null>(null);
    // The server whose sign-out did not go through, until the next attempt.
    const [failed, setFailed] = useState<string | null>(null);
    // Reading it also claims it, which is how the explorer knows to stop drawing a ring
    // around the whole block: the mark belongs on the control the rail sent somebody to.
    const highlighted = useSettingsHighlight();

    // The dialog stays open on its closing step after this, so the list behind it is
    // already right by the time it is uncovered.
    const added = useCallback(() => {
        void reload();
    }, [reload]);

    const leave = useCallback(() => {
        setAdding(false);
        // Read again rather than assume: leaving is answered at once, at every step, and a
        // sign-in already in flight when it happens still finishes.
        void reload();
    }, [reload]);

    // Which projects are open is a fact about other windows, so it is read again whenever this one
    // comes back to the front - the moment somebody who just closed a project returns to sign out.
    useEffect(() => {
        const onFocus = () => void reload();
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    }, [reload]);

    const forget = useCallback(async (session: VcsServerSession) => {
        setBusy(true);
        setConfirming(null);
        setFailed(null);
        const result = await getInterface().vcs.forgetServer(session.remoteOrigin).catch(() => null);
        setBusy(false);
        // A refusal is usually a project using it that was opened since the list was read: the
        // list is read again and the row says which one. Anything else is said on the row.
        if (!result?.success) setFailed(session.remoteOrigin);
        void reload();
    }, [reload]);

    return (
        <div className="flex flex-col gap-2">
            {/* Laid out as a settings row: what there is on the left, the way to add one on the right,
                where every row in the pane keeps its control. */}
            <div className="flex items-center justify-between gap-4">
                <p className="min-w-0 text-xs text-fg-subtle">
                    {!loading && servers.length === 0 ? t("settings.servers.empty") : null}
                </p>
                <Button
                    size="sm"
                    variant="secondary"
                    className={cn("h-7 shrink-0", highlighted && SETTINGS_HIGHLIGHT_RING)}
                    data-settings-highlight={highlighted ? "on" : undefined}
                    onClick={() => setAdding(true)}
                >
                    {t("settings.servers.openAdd")}
                </Button>
            </div>

            {servers.length > 0 && (
                <div className="flex flex-col gap-1">
                    {servers.map(session => {
                        // A server is not signed out of while a project that works with it is
                        // open: its settings change between projects, never inside one.
                        const openIn = session.openIn ?? [];
                        const locked = openIn.length > 0;
                        const usedBy = session.usedBy ?? [];
                        const asking = confirming === session.remoteOrigin && !locked;
                        const warning = asking || (failed === session.remoteOrigin && !locked);
                        return (
                        <div key={session.remoteOrigin} className="flex flex-col">
                            <ServerRow
                                session={session}
                                data-servers-row={session.remoteOrigin}
                                trailing={asking ? (
                                    <div className="flex shrink-0 items-center gap-1">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            data-servers-sign-out-cancel={session.remoteOrigin}
                                            onClick={() => setConfirming(null)}
                                        >
                                            {t("settings.servers.cancel")}
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="danger"
                                            disabled={busy}
                                            data-servers-sign-out="confirm"
                                            onClick={() => void forget(session)}
                                        >
                                            {t("settings.servers.signOutConfirm")}
                                        </Button>
                                    </div>
                                ) : (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="shrink-0"
                                        disabled={busy || locked}
                                        data-servers-sign-out={locked ? "locked" : "open"}
                                        onClick={() => {
                                            setFailed(null);
                                            setConfirming(session.remoteOrigin);
                                        }}
                                    >
                                        {t("settings.servers.signOut")}
                                    </Button>
                                )}
                            />
                            {/* Under the row rather than in it: the row is one control height, and
                                this list is as long as the author made it. The full paths are on
                                hover, the names are what the launcher calls them. */}
                            <p
                                className={cn(
                                    "px-3 pb-1 text-2xs",
                                    // A warning is read in full; a list of projects is on hover.
                                    warning ? "break-words text-danger" : "truncate text-fg-subtle",
                                )}
                                data-servers-used-by={session.remoteOrigin}
                                data-tip={usedBy.map(project => project.path).join("\n") || undefined}
                            >
                                {locked
                                    ? t("settings.servers.signOutBlocked", {
                                        projects: formatList(openIn.map(project => project.name)),
                                    })
                                    : asking
                                    ? usedBy.length > 0
                                        ? t("settings.servers.signOutWarning", {
                                            projects: formatList(usedBy.map(project => project.name)),
                                        })
                                        : t("settings.servers.signOutWarningUnused")
                                    : failed === session.remoteOrigin
                                    ? t("settings.servers.signOutFailed")
                                    : usedBy.length > 0
                                    ? t("settings.servers.usedBy", {
                                        projects: formatList(usedBy.map(project => project.name)),
                                    })
                                    : t("settings.servers.unused")}
                            </p>
                        </div>
                        );
                    })}
                </div>
            )}

            {/* Mounted while it is meant to be on screen, so a second reading of the
                sequence starts at the first step rather than where the first one stopped. */}
            {adding && (
                <AddServerModal
                    onAdded={added}
                    onClose={leave}
                    signInWithPassword={signInWithPassword}
                    signInWithBrowser={signInWithBrowser}
                />
            )}
        </div>
    );
}
