import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Settings2 } from "lucide-react";

import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { useTranslation } from "@/lib/i18n";
import { getProfile, listClients, useTeamCapability, useTeamConnection, useTeamTopics } from "@/lib/team";
import { TeamAvatar } from "@/lib/team/TeamAvatar";
import { TeamAccountMenu, TeamAccountMenuActs, TeamAccountMenuRow, useActiveSignIn } from "@/lib/team/TeamAccountMenu";
import { useServers } from "@/lib/vcs/servers";
import { teamProjectClientsTopic, type TeamAccountProfile } from "@shared/types/team";

import { resolveOnByDefault, TEAM_AVATAR_VISIBLE_KEY } from "@/lib/settings/teamAvatarOptions";
import { useGlobalSetting } from "@/lib/settings/useGlobalSetting";
import { useTeamDocuments } from "./TeamHistoryRail";
import { useTeamProjectSurface } from "./TeamProjectContext";
import { isTeamHistoryReachable, openTeamHistory } from "./teamHistoryController";
import { isTeamPresenceReachable, openTeamPresence } from "./teamPresenceController";

/**
 * The signed-in Team account, in the title bar. The face and the card are `TeamAccountMenu`,
 * which the launcher's sidebar draws too; what is particular to the workspace is chosen here.
 *
 * **Wherever this installation is signed in to a Team server.** The project's own server where it is
 * on one; otherwise the server signed in to last, so a local project still shows who the author is
 * on Team. With no sign-in at all it draws nothing. **A server that is not answering still shows
 * the account**, from what was recorded at sign-in: dimmed, with the card saying it is not
 * connected and no online list, and with its monogram unless its avatar was already read in this
 * window. Where there is an account, the author may still hide it (`ui.teamAvatar.visible`).
 *
 * **A ring for a team project.** The project followed through its server (`TeamDocumentsService`)
 * is the one place the account is *in* something with other people, so the face in the title bar
 * wears the accent ring there and nowhere else. The face inside the card never does.
 *
 * Pressed, it shows the account's name and bio and the way into the same Team panel the status
 * bar's corner cell opens. In a team project it also lists who is online and opens the project's
 * version history, which no longer keeps a strip of its own at the window's left edge.
 */
export function TeamAccountAvatar() {
    const { t } = useTranslation();
    const team = useTeamProjectSurface();
    const documents = useTeamDocuments();
    const { servers } = useServers();
    // Outside a team project, the account the launcher's menu shows - so a switch made there
    // reads the same here.
    const fallback = useActiveSignIn(servers).active;
    const remoteOrigin = documents.target?.remoteOrigin ?? team.remoteOrigin ?? fallback;
    const inTeamProject = documents.view !== null && documents.target !== null;
    const visible = useGlobalSetting(TEAM_AVATAR_VISIBLE_KEY, resolveOnByDefault);

    if (!visible) {
        return null;
    }

    return (
        <TeamAccountMenu
            remoteOrigin={remoteOrigin}
            ringed={inTeamProject}
            className="ml-2"
            cardClassName="right-0 top-9"
            sections={({ ready, close }) => (
                <>
                    {ready && inTeamProject && remoteOrigin !== null && documents.target !== null && (
                        <TeamProjectOnline
                            remoteOrigin={remoteOrigin}
                            project={documents.target.project}
                        />
                    )}

                    {(inTeamProject && isTeamHistoryReachable()) || isTeamPresenceReachable() ? (
                        <TeamAccountMenuActs>
                            {inTeamProject && isTeamHistoryReachable() && (
                                <TeamAccountMenuRow
                                    act="history"
                                    icon={<History className="h-4 w-4" />}
                                    onClick={() => {
                                        close();
                                        openTeamHistory();
                                    }}
                                >
                                    {t("workspace.shell.team.account.history")}
                                </TeamAccountMenuRow>
                            )}
                            {isTeamPresenceReachable() && (
                                <TeamAccountMenuRow
                                    act="manage"
                                    icon={<Settings2 className="h-4 w-4" />}
                                    onClick={() => {
                                        close();
                                        openTeamPresence();
                                    }}
                                >
                                    {t("workspace.shell.team.account.manage")}
                                </TeamAccountMenuRow>
                            )}
                        </TeamAccountMenuActs>
                    ) : null}
                </>
            )}
        />
    );
}

/** Who has the team project open right now, one row per account. */
function TeamProjectOnline({ remoteOrigin, project }: { remoteOrigin: string; project: string }) {
    const { t } = useTranslation();
    const connection = useTeamConnection(remoteOrigin);
    const canSee = useTeamCapability(connection, "clients");
    const topics = useMemo(() => [teamProjectClientsTopic(project)], [project]);
    const read = useCallback(() => listClients(remoteOrigin, project), [remoteOrigin, project]);
    const clients = useTeamTopics(canSee ? remoteOrigin : null, topics, read);

    // One row per account however many windows it has the project open in, in the server's order.
    const accounts = useMemo(() => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const client of clients.value ?? []) {
            if (!seen.has(client.account)) {
                seen.add(client.account);
                out.push(client.account);
            }
        }
        return out;
    }, [clients.value]);
    const profiles = useTeamProfiles(remoteOrigin, accounts);

    if (!canSee) return null;

    return (
        <div data-team-account-online className="mt-3 border-t border-edge pt-3">
            <FieldLabel as="div">
                {t("workspace.shell.team.account.online", { count: String(accounts.length) })}
            </FieldLabel>
            {accounts.length === 0 ? (
                <p className="mt-1 text-xs text-fg-subtle">{t("workspace.shell.team.account.onlineEmpty")}</p>
            ) : (
                <ul className="mt-1 flex max-h-48 flex-col gap-0.5 overflow-auto">
                    {accounts.map((username) => {
                        const known = profiles[username];
                        return (
                            <li
                                key={username}
                                data-team-online={username}
                                className="flex min-h-7 items-center gap-2 text-sm text-fg"
                            >
                                <TeamAvatar
                                    remoteOrigin={remoteOrigin}
                                    name={username}
                                    avatarUrl={known?.avatarUrl}
                                    className="h-5 w-5"
                                />
                                <span className="min-w-0 truncate">{known?.displayName ?? username}</span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------------- reads */

/**
 * Other accounts' profiles, remembered for as long as the window is open, because the online list
 * redraws on every arrival and departure; a changed name reaches it the next time the window
 * opens. Avatars are remembered by `TeamAvatar` itself.
 */
const otherProfiles = new Map<string, Promise<TeamAccountProfile | null>>();

function useTeamProfiles(remoteOrigin: string, usernames: readonly string[]): Record<string, TeamAccountProfile> {
    const [profiles, setProfiles] = useState<Record<string, TeamAccountProfile>>({});
    const wanted = usernames.join("\n");
    useEffect(() => {
        let alive = true;
        for (const username of usernames) {
            const key = `${remoteOrigin}\n${username}`;
            let reading = otherProfiles.get(key);
            if (reading === undefined) {
                reading = getProfile(remoteOrigin, username).then((answer) => {
                    if (!answer.ok) {
                        otherProfiles.delete(key);
                        return null;
                    }
                    return answer.value;
                });
                otherProfiles.set(key, reading);
            }
            void reading.then((profile) => {
                if (alive && profile !== null) {
                    setProfiles((held) => (held[username] === profile ? held : { ...held, [username]: profile }));
                }
            });
        }
        return () => {
            alive = false;
        };
        // `wanted` stands for the list: a new array with the same names is not a new question.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [remoteOrigin, wanted]);
    return profiles;
}
