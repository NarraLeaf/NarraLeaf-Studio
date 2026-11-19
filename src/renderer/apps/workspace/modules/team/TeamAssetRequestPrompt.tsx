import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import { teamCall, useTeamCapability, useTeamConnection } from "@/lib/team";
import { Services } from "@/lib/workspace/services/services";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { TeamMethod, type TeamTodo } from "@shared/types/team";

import { useWorkspace } from "../../context";
import { useTeamProjectSurface } from "./TeamProjectContext";

/** What was just imported, and the open asset requests it might answer. */
type Offer = { asset: { id: string; name: string }; requests: TeamTodo[] };

function readTodos(value: unknown): TeamTodo[] {
    const list = typeof value === "object" && value !== null ? (value as { todos?: unknown }).todos : undefined;
    if (!Array.isArray(list)) return [];
    return list.filter((entry): entry is TeamTodo => typeof entry === "object" && entry !== null
        && typeof (entry as TeamTodo).id === "string" && typeof (entry as TeamTodo).title === "string");
}

/** The open requests for an asset in this project - what an import might be the answer to. */
export function openAssetRequests(todos: readonly TeamTodo[]): TeamTodo[] {
    return todos.filter(todo => todo.kind === "asset" && todo.status !== "done" && todo.asset === undefined);
}

/**
 * Asks, after an import into a team project, whether the file answers one of the project's open
 * asset requests - and if it does, links it and closes the request.
 *
 * Only asks when there is something to ask about: a project with no open asset request never sees
 * it. Answering "no" or closing it leaves the request alone. The server lets anybody link an asset
 * and close a to-do (a status-only change), so this needs no role check of its own.
 */
export function TeamAssetRequestPrompt() {
    const { t } = useTranslation();
    const team = useTeamProjectSurface();
    const { context, isInitialized } = useWorkspace();
    const remoteOrigin = team.state.kind === "verified" ? team.remoteOrigin : null;
    const project = team.state.kind === "verified" ? team.state.project.id : null;
    const connection = useTeamConnection(remoteOrigin);
    const withTodos = useTeamCapability(connection, "todos");
    const [offer, setOffer] = useState<Offer | null>(null);
    const [busy, setBusy] = useState(false);

    const assets = useMemo(() => {
        if (!context || !isInitialized) return null;
        try {
            return context.services.get<AssetsService>(Services.Assets);
        } catch {
            return null;
        }
    }, [context, isInitialized]);

    useEffect(() => {
        if (!assets || !remoteOrigin || !project || !withTodos) return;
        return assets.getEvents().on("imported", imported => {
            const first = imported[0];
            if (!first) return;
            void teamCall(remoteOrigin, TeamMethod.todosList, { project }).then(answer => {
                if (!answer.ok) return;
                const requests = openAssetRequests(readTodos(answer.value));
                if (requests.length > 0) setOffer({ asset: { id: first.id, name: first.name }, requests });
            });
        });
    }, [assets, remoteOrigin, project, withTodos]);

    if (!offer || !remoteOrigin) return null;

    const answer = async (todo: TeamTodo) => {
        setBusy(true);
        try {
            await teamCall(remoteOrigin, TeamMethod.todosUpdate, { todo: todo.id, asset: offer.asset.id, status: "done" });
        } finally {
            setBusy(false);
            setOffer(null);
        }
    };

    return (
        <div
            data-team-asset-request
            className="pointer-events-auto fixed bottom-10 right-4 z-40 flex w-[320px] flex-col gap-2 rounded-lg border border-edge bg-surface-overlay p-3 text-xs text-fg shadow-lg"
        >
            <div className="font-medium">{t("workspace.shell.team.assetRequest.title", { name: offer.asset.name })}</div>
            <div className="text-fg-muted">{t("workspace.shell.team.assetRequest.detail")}</div>
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {offer.requests.map(todo => (
                    <button
                        key={todo.id}
                        type="button"
                        disabled={busy}
                        className="truncate rounded-md border border-edge px-2 py-1 text-left hover:bg-fill disabled:opacity-50"
                        onClick={() => void answer(todo)}
                    >
                        {todo.title}
                    </button>
                ))}
            </div>
            <button
                type="button"
                disabled={busy}
                className="self-end rounded-md px-2 py-0.5 text-fg-muted hover:bg-fill hover:text-fg"
                onClick={() => setOffer(null)}
            >
                {t("workspace.shell.team.assetRequest.none")}
            </button>
        </div>
    );
}
