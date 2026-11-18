/**
 * The two views the Team tab carries once the home list has taken the projects over
 * (`team.projectsPlacement = "projects"`): this account's own open to-dos across every project on
 * the server, and the projects somebody is working on now.
 *
 * Both are about the server's people rather than its catalogue, which is why they stay on the
 * Team tab when the catalogue moves. Picking a row is the same act as picking the project on the
 * home list: open the copy on this disk, or be asked whether to clone one.
 *
 * Each is drawn only where the server advertised what it reads (`todos`, `clients`); a deployment
 * that offers less has fewer tabs rather than an error.
 */
import { useCallback, useMemo } from "react";
import { ChevronRight, ListTodo } from "lucide-react";

import { EmptyState } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { listClients, teamCall, useTeamTopics, type TeamOutcome } from "@/lib/team";
import { TeamAvatar } from "@/lib/team/TeamAvatar";
import { cn } from "@/lib/utils/cn";
import { TeamMethod, type TeamTodo } from "@shared/types/team";
import type { VcsLocalRepository, VcsServerProject, VcsServerSession } from "@shared/types/vcs";

import { localCopyOf } from "./localCopy";
import { lastVersionLine } from "./teamProjectShared";

/** Nothing to subscribe to: both lists are read when the session is ready and when shown. */
const NO_TOPICS: readonly string[] = [];

/** How far back a recorded version still makes a project "active" with nobody online. */
export const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The to-dos that are this account's to do: assigned to it, or written by it and assigned to
 * nobody - the reading the commit dialog's to-do list takes - and not finished yet.
 */
export function myOpenTodos(todos: readonly TeamTodo[], username: string): TeamTodo[] {
    return todos.filter(todo =>
        todo.status !== "done"
        && (todo.assignee === username || (todo.assignee === undefined && todo.owner === username)));
}

/** What the server answered `todos.list` with, or null for an answer that is not a list. */
function readTodos(value: unknown): TeamTodo[] | null {
    const list = (value as { todos?: unknown } | null)?.todos;
    return Array.isArray(list) ? (list as TeamTodo[]) : null;
}

export function ServerTodos({
    session,
    projects,
    repositories,
    onPick,
}: {
    session: VcsServerSession;
    projects: readonly VcsServerProject[] | null;
    repositories: readonly VcsLocalRepository[];
    onPick: (project: VcsServerProject) => void;
}) {
    const { t, formatDate } = useTranslation();
    const remoteOrigin = session.remoteOrigin;
    const username = session.account.username;
    const read = useCallback(async (): Promise<TeamOutcome<TeamTodo[]>> => {
        const answer = await teamCall(remoteOrigin, TeamMethod.todosList, {});
        if (!answer.ok) return answer;
        const todos = readTodos(answer.value);
        return todos === null
            ? { ok: false, problem: { kind: "offline", detail: "todos.list answered no list" } }
            : { ok: true, value: todos };
    }, [remoteOrigin]);
    const todos = useTeamTopics(remoteOrigin, NO_TOPICS, read);

    const byId = useMemo(() => new Map((projects ?? []).map(project => [project.id, project])), [projects]);
    // Doing before open, then the nearest due date, then the newest: what to pick up next first.
    const mine = useMemo(() => myOpenTodos(todos.value ?? [], username).sort((a, b) =>
        (a.status === "doing" ? 0 : 1) - (b.status === "doing" ? 0 : 1)
        || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)
        || b.updatedAt - a.updatedAt), [todos.value, username]);

    if (todos.value === null) {
        return (
            <p className="px-3 py-2 text-xs text-fg-subtle" data-server-todos={todos.problem ? "problem" : "loading"}>
                {t(todos.problem ? "launcher.servers.todos.problem" : "launcher.servers.todos.loading")}
            </p>
        );
    }
    if (mine.length === 0) {
        return (
            <div className="flex min-h-0 flex-1 flex-col" data-server-todos="empty">
                <EmptyState
                    className="flex-1"
                    icon={<ListTodo className="h-8 w-8" />}
                    title={t("launcher.servers.todos.empty")}
                />
            </div>
        );
    }

    return (
        <div className="min-h-0 flex-1 overflow-y-auto" data-server-todos="list">
            {mine.map(todo => {
                const project = todo.project === undefined ? undefined : byId.get(todo.project);
                const here = project === undefined ? null : localCopyOf(project, repositories);
                return (
                    <button
                        key={todo.id}
                        type="button"
                        disabled={project === undefined}
                        onClick={() => project !== undefined && onPick(project)}
                        data-server-todo={todo.id}
                        data-tip={project !== undefined
                            ? t(here !== null ? "launcher.projects.openNamed" : "launcher.servers.todos.cloneHint", { name: project.name })
                            : undefined}
                        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left cursor-default transition-colors duration-150 hover:bg-fill disabled:hover:bg-transparent"
                    >
                        <span
                            aria-hidden
                            className={cn(
                                "h-2 w-2 shrink-0 rounded-full",
                                todo.status === "doing" ? "bg-primary" : "border border-fg-subtle",
                            )}
                        />
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-fg">{todo.title}</span>
                            <span className="flex gap-2 text-xs text-fg-subtle">
                                <span className="min-w-0 truncate">
                                    {project?.name ?? t("launcher.servers.todos.noProject")}
                                </span>
                                <span className="shrink-0">{t(todo.status === "doing" ? "launcher.servers.todos.status.doing" : "launcher.servers.todos.status.open")}</span>
                                {todo.dueAt !== undefined && (
                                    <span className="shrink-0">
                                        {t("launcher.servers.todos.due", {
                                            date: formatDate(todo.dueAt, { month: "short", day: "numeric" }),
                                        })}
                                    </span>
                                )}
                            </span>
                        </span>
                        {project !== undefined && <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-fg-subtle" />}
                    </button>
                );
            })}
        </div>
    );
}

/** One project somebody is working on, and who. */
export interface ActiveProject {
    project: VcsServerProject;
    /** Accounts with it open now, one entry per account, in the server's order. */
    online: string[];
}

/**
 * The projects in use: open somewhere now, or with a version recorded within
 * {@link ACTIVE_WINDOW_MS}. Open ones first (most people first), then the most recent version.
 */
export function activeProjects(
    projects: readonly VcsServerProject[],
    clients: readonly { account: string; project?: string }[],
    now: number,
): ActiveProject[] {
    const online = new Map<string, string[]>();
    for (const client of clients) {
        if (client.project === undefined) continue;
        const accounts = online.get(client.project) ?? [];
        if (!accounts.includes(client.account)) accounts.push(client.account);
        online.set(client.project, accounts);
    }
    const lastAt = (project: VcsServerProject) => project.history?.lastAt ?? 0;
    return projects
        .map(project => ({ project, online: online.get(project.id) ?? [] }))
        .filter(entry => entry.online.length > 0 || now - lastAt(entry.project) <= ACTIVE_WINDOW_MS)
        .sort((a, b) => b.online.length - a.online.length || lastAt(b.project) - lastAt(a.project));
}

export function ServerActiveProjects({
    session,
    projects,
    reading,
    repositories,
    canSeeClients,
    onPick,
}: {
    session: VcsServerSession;
    projects: readonly VcsServerProject[] | null;
    reading: boolean;
    repositories: readonly VcsLocalRepository[];
    /** Whether the server answers who has what open; without it only recent versions count. */
    canSeeClients: boolean;
    onPick: (project: VcsServerProject) => void;
}) {
    const { t, formatDate, locale } = useTranslation();
    const remoteOrigin = session.remoteOrigin;
    const read = useCallback(() => listClients(remoteOrigin), [remoteOrigin]);
    const names = useMemo(() => new Intl.ListFormat(locale, { type: "conjunction" }), [locale]);
    const clients = useTeamTopics(canSeeClients ? remoteOrigin : null, NO_TOPICS, read);

    const active = useMemo(
        () => activeProjects(projects ?? [], clients.value ?? [], Date.now()),
        [projects, clients.value],
    );

    if (projects === null) {
        return reading
            ? <p className="px-3 py-2 text-xs text-fg-subtle">{t("launcher.servers.loading")}</p>
            : null;
    }
    if (active.length === 0) {
        return (
            <p className="px-3 py-2 text-xs text-fg-subtle" data-server-active="empty">
                {t("launcher.servers.active.empty")}
            </p>
        );
    }

    return (
        <div className="min-h-0 flex-1 overflow-y-auto" data-server-active="list">
            {active.map(({ project, online }) => {
                const here = localCopyOf(project, repositories);
                const version = lastVersionLine(project, session.account, t, formatDate);
                return (
                    <button
                        key={project.id}
                        type="button"
                        onClick={() => onPick(project)}
                        data-server-active-project={project.id}
                        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left cursor-default transition-colors duration-150 hover:bg-fill"
                    >
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-fg">{project.name}</span>
                            <span className="flex gap-2 text-xs text-fg-subtle">
                                {online.length > 0 ? (
                                    <span className="min-w-0 truncate">
                                        {t("launcher.servers.active.online", { names: names.format(online) })}
                                    </span>
                                ) : version !== null && (
                                    <span className="min-w-0 truncate">{version}</span>
                                )}
                                <span className="shrink-0">
                                    {t(here !== null ? "launcher.servers.here" : "launcher.servers.active.notHere")}
                                </span>
                            </span>
                        </span>
                        {online.length > 0 && (
                            <span className="flex shrink-0 -space-x-1.5">
                                {online.slice(0, 3).map(account => (
                                    <TeamAvatar
                                        key={account}
                                        remoteOrigin={remoteOrigin}
                                        name={account}
                                        className="h-5 w-5 ring-2 ring-surface"
                                    />
                                ))}
                            </span>
                        )}
                        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-fg-subtle" />
                    </button>
                );
            })}
        </div>
    );
}
