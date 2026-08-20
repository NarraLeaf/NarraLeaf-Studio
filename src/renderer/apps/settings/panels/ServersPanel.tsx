import { useCallback, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Button } from "@/lib/components/elements";
import { ServerRow, useServers } from "@/lib/vcs/servers";
import { cn } from "@/lib/utils/cn";
import { SETTINGS_HIGHLIGHT_RING, useSettingsHighlight } from "../components/settingsHighlight";
import type { VcsServerSession } from "@shared/types/vcs";
import { ServerWizard } from "./ServerWizard";

/**
 * Every server this installation is signed in to, and the way to add one.
 *
 * **A server is added here and nowhere else.** It is signed in to once and then serves
 * every project pointed at it, so it belongs to the machine; a project chooses from this
 * list rather than carrying an account of its own. That is the whole reason this panel
 * exists, and why the version rail sends people here instead of asking for a token in a
 * side panel.
 *
 * Adding one is a sequence, in {@link ServerWizard}. The list stays visible above it, so
 * a server already added reads as the answer to whatever sent somebody here.
 */
export function ServersPanel() {
    const { t } = useTranslation();
    const { servers, loading, reload } = useServers();
    const [adding, setAdding] = useState(false);
    const [busy, setBusy] = useState(false);
    // Reading it also claims it, which is how the explorer knows to stop drawing a ring
    // around the whole block: the mark belongs on the control the rail sent somebody to.
    const highlighted = useSettingsHighlight();

    const added = useCallback(() => {
        setAdding(false);
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
            {!loading && servers.length === 0 && !adding && (
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

            {adding ? (
                <ServerWizard onAdded={added} onLeave={leave} />
            ) : (
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
            )}
        </div>
    );
}
