import { Monitor, Paperclip } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { overlayIsStale } from "@/lib/team";
import type { TeamProjectSurface } from "../../hooks/useTeamProject";

/**
 * Who else has this project open, and what is attached to it that is not in it.
 *
 * **Two facts and no acts.** Both are read from the server continuously - that is what makes it a
 * source rather than an address - and both are drawn as values with no labels around them, one line
 * each. Nothing here is performed on purpose; they are true because a window is open.
 *
 * **The live session is not here.** It used to be: one row in this dialog, with the only deliberate
 * act in the panel drawn smaller than the address above it. A session is a mode the whole window is
 * in and it outlasts every tab, so it belongs to the title bar and to a surface of its own - see
 * `LiveSessionPresence`. What is left here is what this dialog is actually about: the server.
 *
 * **Silent where there is nothing to report.** A project nobody else has open and with nothing
 * attached draws nothing at all. A strip that says "1 machine, 0 attached" every working day is a
 * strip nobody reads.
 *
 * The counts are the server's. Nothing here holds a copy to keep honest: an event says a collection
 * moved and `useTeamProject` reads it again.
 */
export function TeamCollaboration({ team }: {
    team: TeamProjectSurface;
}) {
    const { t } = useTranslation();
    const project = team.state.kind === "verified" ? team.state.project : null;
    const origin = team.remoteOrigin;

    if (project === null || origin === null) {
        return null;
    }

    const attached = team.overlay;
    // Counted against the head the server last read, and only where it read one: an absent head is
    // a repository this server has not reached, and treating that as "everything is out of date"
    // would say so for a minute after every restart.
    const outdated = attached === null
        ? 0
        : attached.records.filter((record) => overlayIsStale(record, attached.head)).length;
    const others = team.canSeeClients && team.clients.length > 1;
    const holds = team.canOverlay && attached !== null && attached.total > 0 ? attached : null;

    if (!others && holds === null) {
        return null;
    }

    return (
        <div data-team-seam="collaboration" className="border-t border-edge pt-3">
            <FieldLabel as="div">{t("workspace.shell.team.presence")}</FieldLabel>

            {others && (
                <Row icon={<Monitor className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />} seam="clients">
                    <span className="min-w-0 truncate">
                        {t("workspace.shell.team.hereMany", { count: String(team.clients.length) })}
                    </span>
                </Row>
            )}

            {holds !== null && (
                <Row icon={<Paperclip className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />} seam="attached">
                    <span className="min-w-0 truncate">
                        {t("workspace.shell.team.attached", { count: String(holds.total) })}
                    </span>
                    {outdated > 0 && (
                        <span data-team-seam="attached-outdated" className="shrink-0 text-2xs text-warning">
                            {t("workspace.shell.team.attachedOutdated", { count: String(outdated) })}
                        </span>
                    )}
                </Row>
            )}
        </div>
    );
}

/** One line of values. Spacing between rows and no rules, as every panel here is. */
function Row({ icon, seam, children }: {
    icon: React.ReactNode;
    seam: string;
    children: React.ReactNode;
}) {
    return (
        <div
            data-team-seam={seam}
            className="mt-1 flex min-h-5 items-center gap-1.5 text-sm text-fg-muted"
        >
            {icon}
            {children}
        </div>
    );
}
