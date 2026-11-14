import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, Settings2 } from "lucide-react";

import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { nameInitials, nameMonogramColor } from "@/lib/components/monogram";
import { useTranslation } from "@/lib/i18n";
import { getProfile, listClients, readAvatar, useTeamCapability, useTeamConnection, useTeamTopics } from "@/lib/team";
import { cn } from "@/lib/utils/cn";
import { teamProjectClientsTopic, type TeamAccountProfile } from "@shared/types/team";

import { resolveOnByDefault, TEAM_AVATAR_VISIBLE_KEY } from "@/lib/settings/teamAvatarOptions";
import { useGlobalSetting } from "@/lib/settings/useGlobalSetting";
import { useTeamDocuments } from "./TeamHistoryRail";
import { useTeamProjectSurface } from "./TeamProjectContext";
import { isTeamHistoryReachable, openTeamHistory } from "./teamHistoryController";
import { isTeamPresenceReachable, openTeamPresence } from "./teamPresenceController";

/**
 * The signed-in Team account, in the title bar.
 *
 * **Only while this window has a session with a Team server.** A project on no server, or one whose
 * server is not answering, draws nothing: there is no account to show. Where there is one, the
 * author may still hide it (`ui.teamAvatar.visible`).
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
    const remoteOrigin = documents.target?.remoteOrigin ?? team.remoteOrigin;
    const connection = useTeamConnection(remoteOrigin);
    const ready = connection.state === "ready" && connection.account !== undefined;
    const inTeamProject = documents.view !== null && documents.target !== null;
    const visible = useGlobalSetting(TEAM_AVATAR_VISIBLE_KEY, resolveOnByDefault);

    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);

    // The account's own profile, read when the session becomes ready and again whenever the card is
    // opened - a profile has no topic, so opening the card is when a changed bio is picked up.
    const [profile, setProfile] = useState<TeamAccountProfile | null>(null);
    useEffect(() => {
        setProfile(null);
    }, [remoteOrigin, connection.account?.username]);
    useEffect(() => {
        if (!ready || remoteOrigin === null) return;
        let alive = true;
        void getProfile(remoteOrigin).then((answer) => {
            if (alive && answer.ok) setProfile(answer.value);
        });
        return () => {
            alive = false;
        };
    }, [ready, remoteOrigin, connection.since, open]);

    useEffect(() => {
        if (!open) return;
        const away = (event: MouseEvent) => {
            if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        window.addEventListener("mousedown", away);
        window.addEventListener("keydown", escape);
        return () => {
            window.removeEventListener("mousedown", away);
            window.removeEventListener("keydown", escape);
        };
    }, [open]);

    if (!ready || !visible || remoteOrigin === null || connection.account === undefined) {
        return null;
    }

    const account = connection.account;
    const username = profile?.username ?? account.username;
    const displayName = profile?.displayName ?? account.displayName ?? username;

    return (
        <div ref={root} className="relative ml-2">
            <button
                type="button"
                data-team-account={inTeamProject ? "team-project" : "connected"}
                aria-label={displayName}
                data-tip={displayName}
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                className="flex h-8 w-8 items-center justify-center rounded-md transition-colors cursor-default hover:bg-fill"
            >
                <TeamFace
                    remoteOrigin={remoteOrigin}
                    username={username}
                    avatarUrl={profile?.avatarUrl}
                    className={cn(
                        // The same visual weight as the 16px glyphs beside it, inside the same 32px
                        // square; the team project's ring stays inside that square too.
                        "h-5 w-5",
                        inTeamProject && "ring-2 ring-primary ring-offset-1 ring-offset-surface-sunken",
                    )}
                />
            </button>
            {open && (
                <div
                    data-team-account-card
                    className="absolute right-0 top-9 z-50 w-72 rounded-lg border border-edge bg-surface-overlay p-3 shadow-xl"
                >
                    <div className="flex items-center gap-3">
                        <TeamFace
                            remoteOrigin={remoteOrigin}
                            username={username}
                            avatarUrl={profile?.avatarUrl}
                            className="h-10 w-10 text-sm"
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate text-sm font-medium text-fg">{displayName}</span>
                            {profile?.bio !== undefined && (
                                <span className="line-clamp-2 break-words text-xs text-fg-muted">{profile.bio}</span>
                            )}
                        </div>
                    </div>

                    {inTeamProject && documents.target !== null && (
                        <TeamProjectOnline
                            remoteOrigin={remoteOrigin}
                            project={documents.target.project}
                        />
                    )}

                    {(inTeamProject && isTeamHistoryReachable()) || isTeamPresenceReachable() ? (
                        <div className="mt-3 flex flex-col gap-0.5 border-t border-edge pt-2">
                            {inTeamProject && isTeamHistoryReachable() && (
                                <MenuRow
                                    act="history"
                                    icon={<History className="h-4 w-4" />}
                                    onClick={() => {
                                        setOpen(false);
                                        openTeamHistory();
                                    }}
                                >
                                    {t("workspace.shell.team.account.history")}
                                </MenuRow>
                            )}
                            {isTeamPresenceReachable() && (
                                <MenuRow
                                    act="manage"
                                    icon={<Settings2 className="h-4 w-4" />}
                                    onClick={() => {
                                        setOpen(false);
                                        openTeamPresence();
                                    }}
                                >
                                    {t("workspace.shell.team.account.manage")}
                                </MenuRow>
                            )}
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}

/** One act in the account menu, drawn as a menu row rather than a button. */
function MenuRow({ act, icon, onClick, children }: {
    act: string;
    icon: React.ReactNode;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            data-team-account-act={act}
            onClick={onClick}
            className="flex min-h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-fg transition-colors cursor-default hover:bg-fill"
        >
            <span className="flex shrink-0 text-fg-muted">{icon}</span>
            <span className="min-w-0 truncate">{children}</span>
        </button>
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
                                <TeamFace
                                    remoteOrigin={remoteOrigin}
                                    username={username}
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

/**
 * An account's face: its avatar where it set one and it could be read, its monogram otherwise.
 *
 * The monogram is the same coloured initials the account wears everywhere else in Studio, keyed on
 * the username, so the fallback is never a stranger.
 */
function TeamFace({ remoteOrigin, username, avatarUrl, className }: {
    remoteOrigin: string;
    username: string;
    avatarUrl?: string;
    className?: string;
}) {
    const src = useAvatarImage(remoteOrigin, avatarUrl);
    return (
        <span
            className={cn(
                "flex shrink-0 items-center justify-center overflow-hidden rounded-full text-2xs font-medium text-white",
                className,
            )}
            style={src === null ? { backgroundColor: nameMonogramColor(username) } : undefined}
        >
            {src === null
                ? nameInitials(username)
                : <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />}
        </span>
    );
}

/* ------------------------------------------------------------------------- reads */

/**
 * Avatars and other accounts' profiles, remembered for as long as the window is open.
 *
 * An avatar's path is its content hash, so a remembered image can never be out of date. Other
 * accounts' profiles are remembered too because the online list redraws on every arrival and
 * departure; a changed name reaches it the next time the window opens.
 */
const avatarImages = new Map<string, Promise<string | null>>();
const otherProfiles = new Map<string, Promise<TeamAccountProfile | null>>();

function useAvatarImage(remoteOrigin: string, avatarUrl: string | undefined): string | null {
    const [src, setSrc] = useState<string | null>(null);
    useEffect(() => {
        setSrc(null);
        if (avatarUrl === undefined) return;
        const key = `${remoteOrigin}\n${avatarUrl}`;
        let reading = avatarImages.get(key);
        if (reading === undefined) {
            reading = readAvatar(remoteOrigin, avatarUrl).then((value) => {
                // A failed read is not remembered: the server may only have been away.
                if (value === null) avatarImages.delete(key);
                return value;
            });
            avatarImages.set(key, reading);
        }
        let alive = true;
        void reading.then((value) => {
            if (alive) setSrc(value);
        });
        return () => {
            alive = false;
        };
    }, [remoteOrigin, avatarUrl]);
    return src;
}

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
