import { useCallback, useEffect, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import { teamCall, useTeamCapability, useTeamConnection } from "@/lib/team";
import { TeamMethod, type TeamTodo } from "@shared/types/team";

import { useTeamProjectSurface } from "./TeamProjectContext";

/**
 * The to-dos a commit can finish: open ones in this project that are the author's to do - given to
 * them, or theirs and given to nobody.
 *
 * Ticked ones are marked done once the commit is recorded, with the revision that did it
 * (`doneRevision`), so the board and the timeline say which version finished each. The commit
 * comes first and does not wait on this: a to-do that could not be updated is said once, and the
 * version stands either way.
 */
export interface CommitTodos {
    /** What may be ticked; empty where the project is on no server that keeps to-dos. */
    todos: readonly TeamTodo[];
    picked: ReadonlySet<string>;
    toggle(id: string): void;
    /** Mark the ticked ones done by `revision`; answers how many could not be. */
    finish(revision: string): Promise<number>;
}

export function useCommitTodos(): CommitTodos {
    const team = useTeamProjectSurface();
    const connection = useTeamConnection(team.remoteOrigin);
    const offered = useTeamCapability(connection, "todos");
    const remoteOrigin = team.remoteOrigin;
    const projectId = team.state.kind === "verified" ? team.state.project.id : null;
    const username = connection.account?.username;
    const [todos, setTodos] = useState<readonly TeamTodo[]>([]);
    const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

    const load = useCallback(() => {
        if (remoteOrigin === null || projectId === null || username === undefined || !offered) {
            setTodos([]);
            return;
        }
        void teamCall(remoteOrigin, TeamMethod.todosList, { project: projectId }).then(answer => {
            if (!answer.ok) return;
            const list = (answer.value as { todos?: unknown }).todos;
            const mine = (Array.isArray(list) ? (list as TeamTodo[]) : []).filter(todo =>
                todo.status !== "done"
                && (todo.assignee === username || (todo.assignee === undefined && todo.owner === username)));
            setTodos(mine);
            setPicked(current => new Set([...current].filter(id => mine.some(todo => todo.id === id))));
        });
    }, [remoteOrigin, projectId, username, offered]);

    useEffect(() => {
        if (connection.state === "ready") load();
    }, [load, connection.state, connection.since]);

    const toggle = useCallback((id: string) => {
        setPicked(current => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const finish = useCallback(async (revision: string): Promise<number> => {
        if (remoteOrigin === null || picked.size === 0) return 0;
        let failed = 0;
        for (const id of picked) {
            const answer = await teamCall(remoteOrigin, TeamMethod.todosUpdate, { todo: id, status: "done", doneRevision: revision });
            if (!answer.ok) failed += 1;
        }
        setPicked(new Set());
        load();
        return failed;
    }, [remoteOrigin, picked, load]);

    return { todos, picked, toggle, finish };
}

/** The ticks, drawn above the commit button. Nothing at all while there is nothing to tick. */
export function CommitTodoPicker({ controller, disabled }: { controller: CommitTodos; disabled: boolean }) {
    const { t } = useTranslation();
    if (controller.todos.length === 0) return null;
    return (
        <fieldset data-commit-todos="" className="mt-2" title={t("workspace.shell.team.commitTodos.hint")}>
            <legend className="mb-1 text-2xs text-fg-subtle">{t("workspace.shell.team.commitTodos.title")}</legend>
            <ul className="max-h-28 space-y-0.5 overflow-y-auto">
                {controller.todos.map(todo => (
                    <li key={todo.id}>
                        <label className="flex cursor-default items-start gap-1.5 text-2xs text-fg">
                            <input
                                type="checkbox"
                                className="mt-0.5"
                                disabled={disabled}
                                checked={controller.picked.has(todo.id)}
                                onChange={() => controller.toggle(todo.id)}
                            />
                            <span className="line-clamp-2">{todo.title}</span>
                        </label>
                    </li>
                ))}
            </ul>
        </fieldset>
    );
}
