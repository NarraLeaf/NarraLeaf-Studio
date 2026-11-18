import { useEffect, useRef, useState, type ReactNode } from "react";

import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { useServers } from "@/lib/vcs/servers";
import type { TeamAccountProfile } from "@shared/types/team";
import type { VcsServerSession } from "@shared/types/vcs";

import { TeamAvatar } from "./TeamAvatar";
import { getProfile } from "./teamCall";
import { useTeamConnection } from "./useTeam";

/** What the card's lower sections are told about the moment they are drawn in. */
export interface TeamAccountMenuState {
    /** Whether the server is answering; a section that needs it draws nothing otherwise. */
    ready: boolean;
    /** Close the card - a section's act usually takes the author somewhere else. */
    close: () => void;
}

/**
 * The signed-in Team account as a face that opens a card: the face, the name, the bio, and
 * whatever the caller puts under them.
 *
 * Shared by the workspace title bar and the launcher's sidebar, so that the account reads the
 * same wherever it is drawn. Each caller decides which server, where the card opens and what
 * sections it carries; this part decides how the account itself looks.
 *
 * **Draws nothing without a sign-in to `remoteOrigin`.** A server that is not answering still
 * shows the account, from what was recorded at sign-in: dimmed, with the card saying it is not
 * connected, and with its monogram unless its avatar was already read in this window.
 */
export function TeamAccountMenu({
    remoteOrigin,
    ringed = false,
    className,
    cardClassName,
    sections,
}: {
    remoteOrigin: string | null;
    /** Whether the face wears the accent ring - the workspace's mark for a team project. */
    ringed?: boolean;
    className?: string;
    /** Where the card opens relative to the face; the face's own corner differs by window. */
    cardClassName: string;
    /** What the card carries under the account. */
    sections?: (state: TeamAccountMenuState) => ReactNode;
}) {
    const { t } = useTranslation();
    const { servers } = useServers();
    const connection = useTeamConnection(remoteOrigin);
    const ready = connection.state === "ready" && connection.account !== undefined;
    // Who is signed in there, whether or not the server is answering: the live session's account
    // where there is one, and the one recorded at sign-in otherwise.
    const account = connection.account ?? servers.find((server) => server.remoteOrigin === remoteOrigin)?.account;

    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);

    // The account's own profile, read when the session becomes ready and again whenever the card is
    // opened - a profile has no topic, so opening the card is when a changed bio is picked up.
    const [profile, setProfile] = useState<TeamAccountProfile | null>(null);
    // Kept while the server is away, so a face already read stays up through a dropped connection.
    useEffect(() => {
        setProfile(null);
    }, [remoteOrigin, account?.username]);
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

    if (remoteOrigin === null || account === undefined) {
        return null;
    }

    const username = profile?.username ?? account.username;
    const displayName = profile?.displayName ?? account.displayName ?? username;

    return (
        <div ref={root} className={cn("relative", className)}>
            <button
                type="button"
                data-team-account={!ready ? "offline" : ringed ? "team-project" : "connected"}
                aria-label={displayName}
                data-tip={ready ? displayName : `${displayName} · ${t("workspace.shell.team.account.offline")}`}
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                className="flex h-8 w-8 items-center justify-center rounded-md transition-colors cursor-default hover:bg-fill"
            >
                <TeamAvatar
                    remoteOrigin={remoteOrigin}
                    name={username}
                    avatarUrl={profile?.avatarUrl}
                    className={cn(
                        // The same visual weight as the 16px glyphs beside it, inside the same 32px
                        // square; the team project's ring stays inside that square too.
                        "h-5 w-5",
                        !ready && "opacity-50",
                        ringed && "ring-2 ring-primary ring-offset-1 ring-offset-surface-sunken",
                    )}
                />
            </button>
            {open && (
                <div
                    data-team-account-card
                    className={cn(
                        "absolute z-50 w-72 rounded-lg border border-edge bg-surface-overlay p-3 shadow-xl",
                        cardClassName,
                    )}
                >
                    <div className="flex items-center gap-3">
                        <TeamAvatar
                            remoteOrigin={remoteOrigin}
                            name={username}
                            avatarUrl={profile?.avatarUrl}
                            className="h-10 w-10 text-sm"
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate text-sm font-medium text-fg">{displayName}</span>
                            {profile?.bio !== undefined && (
                                <span className="line-clamp-2 break-words text-xs text-fg-muted">{profile.bio}</span>
                            )}
                            {!ready && (
                                <span data-team-account-offline className="text-2xs text-fg-subtle">
                                    {t("workspace.shell.team.account.offline")}
                                </span>
                            )}
                        </div>
                    </div>
                    {sections?.({ ready, close: () => setOpen(false) })}
                </div>
            )}
        </div>
    );
}

/** The card's acts, under a rule. Draw it only when at least one row is in it. */
export function TeamAccountMenuActs({ children }: { children: ReactNode }) {
    return <div className="mt-3 flex flex-col gap-0.5 border-t border-edge pt-2">{children}</div>;
}

/** One act in the account menu, drawn as a menu row rather than a button. */
export function TeamAccountMenuRow({ act, icon, onClick, children }: {
    act: string;
    icon: ReactNode;
    onClick: () => void;
    children: ReactNode;
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

/** The server this installation signed in to most recently, for a window on no Team project. */
export function latestSignIn(servers: readonly VcsServerSession[]): string | null {
    let latest: VcsServerSession | null = null;
    for (const server of servers) {
        if (latest === null || server.signedInAt > latest.signedInAt) latest = server;
    }
    return latest?.remoteOrigin ?? null;
}
