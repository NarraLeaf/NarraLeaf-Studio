import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { teamCall, useTeamCapability, useTeamConnection } from "@/lib/team";
import { cn } from "@/lib/utils/cn";
import { TeamMethod, teamAccountNotificationsTopic, type TeamNotification } from "@shared/types/team";

import { openStoryCommentPopover, useStoryCommentsService } from "../story-comments/storyCommentsState";
import { useTeamProjectSurface } from "./TeamProjectContext";

function readNotifications(value: unknown): { notifications: TeamNotification[]; unread: number } {
    const from = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    const list = Array.isArray(from.notifications) ? (from.notifications as TeamNotification[]) : [];
    return {
        notifications: list.filter(n => typeof n?.id === "number" && typeof n?.kind === "string"),
        unread: typeof from.unread === "number" ? from.unread : 0,
    };
}

/**
 * The bell: what the Team server is holding for this account - mentions, replies in threads it
 * is in, to-dos given to it - with the unread count on the glyph.
 *
 * Drawn only where the project is on a server that keeps notifications. A mention or reply on a
 * story row this project has opens that row's comment popover, which is the place to answer it.
 */
export function TeamNotificationsBell() {
    const { t } = useTranslation();
    const team = useTeamProjectSurface();
    const connection = useTeamConnection(team.remoteOrigin);
    const offered = useTeamCapability(connection, "notifications");
    const service = useStoryCommentsService();
    const accountId = connection.account?.id;
    const remoteOrigin = team.remoteOrigin;
    const [open, setOpen] = useState(false);
    const [state, setState] = useState<{ notifications: TeamNotification[]; unread: number }>({ notifications: [], unread: 0 });
    const root = useRef<HTMLDivElement>(null);

    const load = useCallback(() => {
        if (remoteOrigin === null) return;
        void teamCall(remoteOrigin, TeamMethod.notificationsList, { limit: 30 }).then(answer => {
            if (answer.ok) setState(readNotifications(answer.value));
        });
    }, [remoteOrigin]);

    useEffect(() => {
        if (remoteOrigin === null || accountId === undefined || !offered || connection.state !== "ready") return;
        load();
        const topic = teamAccountNotificationsTopic(accountId);
        void getInterface().team.subscribe(remoteOrigin, topic).catch(() => undefined);
        const token = getInterface().team.onEvent(message => {
            if (message.remoteOrigin === remoteOrigin && message.topic === topic) load();
        });
        return () => {
            token.cancel();
            void getInterface().team.unsubscribe(remoteOrigin, topic).catch(() => undefined);
        };
    }, [remoteOrigin, accountId, offered, connection.state, connection.since, load]);

    useEffect(() => {
        if (!open) return;
        const away = (event: MouseEvent) => {
            if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
        };
        window.addEventListener("mousedown", away);
        return () => window.removeEventListener("mousedown", away);
    }, [open]);

    if (remoteOrigin === null || !offered || accountId === undefined) return null;

    const follow = (notification: TeamNotification) => {
        void teamCall(remoteOrigin, TeamMethod.notificationsRead, { ids: [notification.id] });
        if ((notification.kind === "review-requested" || notification.kind === "review-answered") && notification.project) {
            // A review is read and answered in the web console, where the range and its threads are.
            void getInterface().app.openExternal(`${remoteOrigin}/console/p/${encodeURIComponent(notification.project)}/reviews`);
            setOpen(false);
            return;
        }
        const thread = notification.ref === undefined
            ? undefined
            : service?.listThreads().find(candidate => candidate.teamThreadId === notification.ref);
        if (thread) {
            openStoryCommentPopover({ storyId: thread.storyId, sceneId: thread.sceneId, blockId: thread.blockId });
            setOpen(false);
        }
    };

    return (
        <div ref={root} className="relative mr-1">
            <button
                type="button"
                data-team-notifications={state.unread > 0 ? "unread" : "read"}
                aria-label={t("workspace.shell.team.notifications.label")}
                data-tip={t("workspace.shell.team.notifications.label")}
                onClick={() => setOpen(value => !value)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors cursor-default hover:bg-fill hover:text-fg"
            >
                <span className="relative flex">
                    <Bell className="h-4 w-4" />
                    {state.unread > 0 && (
                        <span className="absolute -right-1.5 -top-1.5 min-w-[14px] rounded-full bg-danger px-1 text-center text-2xs leading-[14px] text-white ring-2 ring-surface-sunken">
                            {state.unread > 99 ? "99+" : state.unread}
                        </span>
                    )}
                </span>
            </button>
            {open && (
                <div className="absolute right-0 top-9 z-50 w-80 max-h-[60vh] overflow-auto rounded-lg border border-edge bg-surface-overlay p-2 shadow-xl">
                    <div className="flex items-center justify-between px-2 py-1">
                        <span className="text-xs font-semibold text-fg">{t("workspace.shell.team.notifications.label")}</span>
                        {state.unread > 0 && (
                            <button
                                type="button"
                                className="rounded-md px-1.5 py-0.5 text-2xs text-fg-muted hover:bg-fill hover:text-fg"
                                onClick={() => void teamCall(remoteOrigin, TeamMethod.notificationsRead, { all: true })}
                            >
                                {t("workspace.shell.team.notifications.markAllRead")}
                            </button>
                        )}
                    </div>
                    {state.notifications.length === 0 ? (
                        <p className="px-2 py-3 text-xs text-fg-subtle">{t("workspace.shell.team.notifications.empty")}</p>
                    ) : (
                        <ul className="flex flex-col">
                            {state.notifications.map(notification => (
                                <li key={notification.id}>
                                    <button
                                        type="button"
                                        onClick={() => follow(notification)}
                                        className={cn(
                                            "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-fill",
                                            notification.readAt === undefined && "border-l-2 border-primary",
                                        )}
                                    >
                                        <span className="text-xs text-fg">
                                            {t(`workspace.shell.team.notifications.${notification.kind}`, { who: notification.actor ?? "?" })}
                                        </span>
                                        {notification.summary && <span className="truncate text-2xs text-fg-muted">{notification.summary}</span>}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
