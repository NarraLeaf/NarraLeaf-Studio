import { useCallback, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Button } from "@/lib/components/elements";
import { ServerRow, useServers } from "@/lib/vcs/servers";
import { cn } from "@/lib/utils/cn";
import { SETTINGS_HIGHLIGHT_RING, useSettingsHighlight } from "../components/settingsHighlight";
import type { VcsServerSession } from "@shared/types/vcs";
import { AddServerModal } from "./AddServerModal";

/**
 * Every server this installation is signed in to, and the way to add one.
 *
 * **This is the machine's record and nothing more.** Which servers it is signed in to,
 * as whom, and how to stop. A server is signed in to once and then serves every project
 * pointed at it, so it belongs to the machine; a project chooses from this list rather
 * than carrying an account of its own.
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
    const { t } = useTranslation();
    const { servers, loading, reload } = useServers();
    const [adding, setAdding] = useState(false);
    const [busy, setBusy] = useState(false);
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

    const forget = useCallback(async (session: VcsServerSession) => {
        setBusy(true);
        const result = await getInterface().vcs.forgetServer(session.remoteOrigin).catch(() => null);
        setBusy(false);
        if (result?.success) void reload();
    }, [reload]);

    return (
        <div className="flex flex-col gap-2">
            {!loading && servers.length === 0 && (
                <p className="text-xs text-fg-subtle">{t("settings.servers.empty")}</p>
            )}

            {servers.length > 0 && (
                <div className="flex flex-col gap-1">
                    {servers.map(session => (
                        <ServerRow
                            key={session.remoteOrigin}
                            session={session}
                            data-servers-row={session.remoteOrigin}
                            trailing={(
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="shrink-0"
                                    disabled={busy}
                                    onClick={() => void forget(session)}
                                >
                                    {t("settings.servers.signOut")}
                                </Button>
                            )}
                        />
                    ))}
                </div>
            )}

            <div className="flex items-center gap-2">
                <Button
                    size="sm"
                    variant="secondary"
                    className={cn("h-7", highlighted && SETTINGS_HIGHLIGHT_RING)}
                    data-settings-highlight={highlighted ? "on" : undefined}
                    onClick={() => setAdding(true)}
                >
                    {t("settings.servers.openAdd")}
                </Button>
            </div>

            {/* Mounted while it is meant to be on screen, so a second reading of the
                sequence starts at the first step rather than where the first one stopped. */}
            {adding && <AddServerModal onAdded={added} onClose={leave} />}
        </div>
    );
}
