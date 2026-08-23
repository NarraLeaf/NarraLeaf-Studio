import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { Button, FieldLabel } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { ServerRow, signInWithPassword } from "@/lib/vcs/servers";
import { AddServerModal } from "@/apps/settings/panels";
import type { VcsServerSession } from "@shared/types/vcs";
import { useOnboardingServers } from "../onboardingServers";

/**
 * Connecting to a Team server, which is the one screen in setup that can be finished by doing
 * nothing.
 *
 * **A server is not required and the screen says so.** Studio's whole feature set works on a
 * machine that never reaches one; what a server adds is a shared history and the people in it. So
 * the empty state here is a statement rather than a prompt, and the flow's Skip button is on this
 * screen like every other.
 *
 * Adding one runs the ordinary {@link AddServerModal} - discovery, the certificate question, a
 * token or a password - rather than a shortened first-run version of it. Nothing about signing in
 * to a server is easier because it is happening on the first launch, and a second implementation
 * would be a second set of refusal messages to keep in step.
 */
export function TeamStep() {
    const { t } = useTranslation();
    const { servers, loading, reload } = useOnboardingServers();
    const [adding, setAdding] = useState(false);
    const [busy, setBusy] = useState(false);

    const leave = useCallback(() => {
        setAdding(false);
        // Read again rather than assume: a sign-in already in flight when the dialog is left still
        // finishes, and the list is what says whether it did.
        void reload();
    }, [reload]);

    const forget = useCallback(async (session: VcsServerSession) => {
        setBusy(true);
        const result = await getInterface().vcs.forgetServer(session.remoteOrigin).catch(() => null);
        setBusy(false);
        if (result?.success) {
            void reload();
        }
    }, [reload]);

    return (
        <div className="space-y-3">
            {!loading && servers.length === 0 && (
                <p className="text-sm text-fg-subtle">{t("onboarding.team.none")}</p>
            )}

            {servers.length > 0 && (
                <div>
                    <FieldLabel as="div">{t("onboarding.team.connected")}</FieldLabel>
                    <div className="flex flex-col gap-1">
                        {servers.map(session => (
                            <ServerRow
                                key={session.remoteOrigin}
                                session={session}
                                size="sm"
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
                </div>
            )}

            <Button variant="secondary" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" />
                {t("onboarding.team.connect")}
            </Button>

            {/* Mounted while it is meant to be on screen, so a second reading of the sequence starts
                at the first step rather than where the first one stopped. */}
            {adding && (
                <AddServerModal
                    onAdded={() => void reload()}
                    onClose={leave}
                    signInWithPassword={signInWithPassword}
                />
            )}
        </div>
    );
}
