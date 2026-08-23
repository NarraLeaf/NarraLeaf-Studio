import { useState } from "react";
import { Cloud, CloudOff } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { cn } from "@/lib/utils/cn";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { Modal } from "@/lib/components/elements/Modal";
import { serverDisplayName, serverHost, signInWithPassword } from "@/lib/vcs/servers";
import { AddServerModal } from "@/apps/settings/panels";
import { parseVcsRemoteUrl } from "@shared/types/vcs";
import { SERVERS_PANEL_SETTING_KEY } from "@shared/constants/servers";
import type { VersionSurface } from "../../hooks/useVersionSurface";
import type { TeamProjectSurface } from "../../hooks/useTeamProject";
import { TeamCollaboration } from "./TeamCollaboration";
import { teamServerFace } from "./teamFace";
import { ServerPickerDialog } from "../../components/layout/VersionRail";
import { AuthorIdentity } from "../../components/layout/AuthorIdentity";

/**
 * One row of the panel's action list.
 *
 * A list of plain rows rather than a column of buttons: every one of them is a rare act, and a
 * stack of bordered controls would give them the weight of Send and Get - which are in the version
 * rail, are pressed daily, and must stay the heavier pair.
 */
function TeamAction({ label, onClick, disabled, tone }: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    /** A tailwind text-colour class for a row that undoes something. */
    tone?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            data-team-action
            className={cn(
                "flex min-h-9 w-full items-center rounded-md px-2 text-left text-sm transition-colors",
                "cursor-default hover:bg-fill disabled:opacity-50",
                tone ?? "text-fg-muted hover:text-fg",
            )}
        >
            {label}
        </button>
    );
}

/**
 * Where this project's versions go, and who this machine is when they get there.
 *
 * **The two questions are one dialog because they are one decision.** A server that signs nobody in
 * records whatever name is in settings; a server that does signs versions with the account it knows
 * - so "which server" silently decides "as whom", and answering them in two places (the version
 * rail, and Settings) is what left an author reading a name in one column that nothing would ever
 * record.
 *
 * **Nothing here is on the daily path.** Connecting, changing, checking, signing in and signing out
 * are between them performed a handful of times in a project's life. That is exactly why they left
 * the version rail: they were standing above Send and Get, which are pressed every working day, and
 * a dialog two clicks deep costs those rare acts nothing.
 *
 * **A dialog rather than a popover hanging off the cell**, and the reason is mechanical rather than
 * aesthetic. Two of the things reachable from here are themselves dialogs - the server picker and
 * the certificate-trust question - and dialogs are portalled into the window's overlay layer while
 * a body-level popover is parked outside the window root's `isolate` (see `windowOverlayHost`). A
 * popover would therefore paint OVER the dialog it had just opened, and the first click inside that
 * dialog would land outside the popover and unmount it, taking the dialog with it.
 *
 * **Nothing here contacts the server until the author asks.** What is drawn on open - the address,
 * the session, the author name - is read from disk. Checking costs up to two seconds against a host
 * that does not answer (measured), so it is a row somebody presses rather than something this
 * dialog does on the way to being seen.
 */
export function TeamPanel({ surface, team, isOpen, onClose }: {
    surface: VersionSurface;
    /**
     * What the server itself says, as opposed to what is written on this disk.
     *
     * Held by the status cell rather than opened here, so that the session, the
     * subscriptions and this window's presence belong to the cell's lifetime rather than
     * to a dialog somebody happens to have open.
     */
    team: TeamProjectSurface;
    isOpen: boolean;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const [picking, setPicking] = useState(false);
    const [adding, setAdding] = useState(false);
    const { remote, serverSession, syncState, busy } = surface;
    const running = busy !== null;
    const verdict = teamServerFace(team.state, syncState);
    // The name the server answers to. `serverSession` is null for a server this machine has no
    // account on, and that is the single case with no name to read - its address is then all
    // there is to call it by.
    const name = remote === null
        ? null
        : serverSession ? serverDisplayName(serverSession) : serverHost(remote);
    // What this project is called on that server, which is what a collaborator clones by and
    // the one part of the address worth reading. Empty for an address that carries no name.
    const projectName = remote === null ? "" : parseVcsRemoteUrl(remote)?.name ?? "";

    const manageServers = () => {
        void getInterface().app.launchSettings({ highlight: SERVERS_PANEL_SETTING_KEY });
        onClose();
    };

    return (
        <>
            {/* Opened from here so that choosing a server is one press from the cell that owns the
                question. It is the same dialog the rail used to open, it covers this one, and this
                one is still underneath when it closes - which is where the new server is read. */}
            <ServerPickerDialog
                surface={surface}
                isOpen={picking}
                onClose={() => setPicking(false)}
            />

            {/* The same sequence Settings runs. Mounted here because the reader who needs it is
                looking at a project pointed somewhere this machine has no account on, and the
                remedy is an address their operator gave them - not a token pasted into a side
                panel, which is what this dialog used to offer and which cannot say what the
                server is called, what it can do, or where its data remote lives. */}
            {adding && (
                <AddServerModal
                    onAdded={() => undefined}
                    onClose={() => setAdding(false)}
                    signInWithPassword={signInWithPassword}
                />
            )}

            <Modal
                isOpen={isOpen}
                onClose={onClose}
                title={t("workspace.shell.team.title")}
                size="sm"
                helpTopic="versionServer"
            >
                <div data-team-panel className="flex flex-col gap-3">
                    {/* The destination, as a fact. A name a deployment can change on top, the
                        address that is actually keyed on underneath, and where the last check left
                        things at the end of the first line. */}
                    <div data-team-seam="destination">
                        <FieldLabel as="div">{t("workspace.shell.team.destination")}</FieldLabel>
                        {remote === null ? (
                            <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-subtle">
                                <CloudOff className="h-3.5 w-3.5 shrink-0" />
                                {t("workspace.shell.versionControl.server.none")}
                            </p>
                        ) : (
                            <>
                                <div className="mt-1 flex items-center gap-1.5">
                                    <Cloud className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                                    <span data-team-seam="server-name" className="min-w-0 truncate text-sm text-fg">
                                        {name}
                                    </span>
                                    {/* The sync state, except where the workspace's own check has
                                        something to say and the sync has not. "Not checked" beside
                                        the address was read as being about the server, and it
                                        stopped being true the moment the workspace began checking
                                        on its own. */}
                                    <span
                                        data-team-seam="server-state"
                                        data-tip={t(verdict.detail)}
                                        className={cn("ml-auto shrink-0 text-2xs", verdict.tone)}
                                    >
                                        {t(verdict.key)}
                                    </span>
                                </div>
                                {projectName !== "" && (
                                    <p data-team-seam="project-name" className="mt-0.5 truncate text-2xs text-fg-muted">
                                        {t("workspace.shell.team.projectOnServer", { name: projectName })}
                                    </p>
                                )}
                                <p className="mt-0.5 truncate text-2xs text-fg-subtle">{remote}</p>
                            </>
                        )}
                    </div>

                    {/* Who is on this project, what room is open, and what is attached to it -
                        every one of them read from the server rather than from this disk. Draws
                        nothing at all until the server has confirmed it holds this project. */}
                    <TeamCollaboration team={team} />

                    {/* Who the next version is recorded as. Two shapes for two mechanisms, and the
                        dialog never shows both: a session's account wins over anything in settings
                        (`VcsManager.resolveIdentity`), so a name field beside a signed-in account
                        would be a field nothing reads. */}
                    <div data-team-seam="account" className="border-t border-edge pt-3">
                        {/* Said on a project pointed at a server this machine has no account on -
                            a copy somebody sent, or a server that was signed out of - and where a
                            connect was refused for want of one. The remedy is the same in both
                            cases and it is the row underneath. */}
                        {(surface.remoteNeedsSignIn || (!serverSession && remote !== null)) && (
                            <p data-team-seam="needs-account" className="mb-2 text-2xs text-warning">
                                {t("workspace.shell.team.noAccountHere")}
                            </p>
                        )}
                        {serverSession ? (
                            <div className="flex items-baseline gap-2">
                                <span
                                    className="min-w-0 flex-1 truncate text-sm text-fg-muted"
                                    data-tip={serverSession.account.identity}
                                >
                                    {t("workspace.shell.versionControl.server.signIn.signedInAs", {
                                        name: serverSession.account.displayName,
                                    })}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => void surface.signOutOfServer()}
                                    disabled={running}
                                    data-team-seam="sign-out"
                                    className="shrink-0 text-2xs text-fg-subtle transition-colors cursor-default hover:text-fg disabled:opacity-50"
                                >
                                    {t("workspace.shell.versionControl.server.signIn.signOut")}
                                </button>
                            </div>
                        ) : (
                            // `always`, unlike the commit form's copy of this row: there the field
                            // is a prompt that goes once it is answered, and here it is the
                            // dialog's subject.
                            <AuthorIdentity surface={surface} always />
                        )}

                    </div>

                    <div className="-mx-2 flex flex-col border-t border-edge pt-2">
                        <TeamAction
                            label={t(remote === null
                                ? "workspace.shell.versionControl.server.connect"
                                : "workspace.shell.versionControl.server.change")}
                            onClick={() => setPicking(true)}
                            disabled={running}
                        />
                        {remote !== null && (
                            <TeamAction
                                label={t("workspace.shell.versionControl.server.check")}
                                onClick={surface.checkRemote}
                                disabled={running}
                            />
                        )}
                        {(surface.remoteNeedsSignIn || (!serverSession && remote !== null)) && (
                            <TeamAction
                                label={t("workspace.shell.versionControl.server.picker.add")}
                                onClick={() => setAdding(true)}
                                disabled={running}
                            />
                        )}
                        <TeamAction label={t("workspace.shell.team.manage")} onClick={manageServers} />
                        {remote !== null && (
                            <TeamAction
                                label={t("workspace.shell.versionControl.server.disconnect")}
                                onClick={() => {
                                    void surface.setRemote(null).then(saved => {
                                        if (saved) onClose();
                                    });
                                }}
                                disabled={running}
                                // At rest it reads like the rows above it; the colour
                                // arrives on hover. Drawn dimmer at rest it read as
                                // disabled, which is the one thing a live control must not.
                                tone="text-fg-muted hover:text-danger"
                            />
                        )}
                    </div>

                    {/* A refusal that belongs to something pressed in here. The picker draws its
                        own, over the top of this, so the two are never read at once. */}
                    {surface.failure !== null && (
                        <p data-team-seam="failure" className="break-words text-2xs text-danger">
                            {surface.failure.text}
                        </p>
                    )}
                </div>
            </Modal>
        </>
    );
}
