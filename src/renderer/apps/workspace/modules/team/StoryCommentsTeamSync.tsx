import { useEffect } from "react";

import { getInterface } from "@/lib/app/bridge";
import { teamCall, readThread, useTeamCapability, useTeamConnection } from "@/lib/team";
import { StoryCommentsTeamSync, type StoryCommentsTeamTransport } from "@/lib/workspace/services/storyComments/storyCommentsTeamSync";
import { TeamMethod, teamProjectThreadsTopic, type TeamComment } from "@shared/types/team";

import { useStoryCommentsService } from "../story-comments/storyCommentsState";
import { useTeamProjectSurface } from "./TeamProjectContext";

/** How long after a local change the push waits, so typing a reply is one write, not several. */
const PUSH_DELAY_MS = 800;

function record(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readComments(value: unknown): TeamComment[] {
    const list = record(value)?.["comments"];
    if (!Array.isArray(list)) return [];
    return list.flatMap(entry => {
        const comment = record(entry);
        return comment && typeof comment.id === "string" && typeof comment.body === "string"
            ? [comment as unknown as TeamComment]
            : [];
    });
}

/** The transport over this window's session to one server, for one project. */
function transportFor(remoteOrigin: string, project: string, withTodos: boolean): StoryCommentsTeamTransport {
    return {
        async listThreads(page) {
            const answer = await teamCall(remoteOrigin, TeamMethod.threadsList, { project, limit: 200, ...page });
            if (!answer.ok) return null;
            const list = record(answer.value)?.["threads"];
            const cursor = record(answer.value)?.["cursor"];
            return {
                threads: Array.isArray(list) ? list.flatMap(entry => {
                    const thread = readThread(entry);
                    return thread === null ? [] : [thread];
                }) : [],
                ...(typeof cursor === "string" ? { cursor } : {}),
            };
        },
        async getThread(thread) {
            const answer = await teamCall(remoteOrigin, TeamMethod.threadsGet, { thread, limit: 200 });
            if (!answer.ok) return null;
            const read = readThread(record(answer.value)?.["thread"]);
            return read === null ? null : { thread: read, comments: readComments(answer.value) };
        },
        async createThread(input) {
            const answer = await teamCall(remoteOrigin, TeamMethod.threadsCreate, { project, ...input });
            if (!answer.ok) return null;
            const thread = readThread(record(answer.value)?.["thread"]);
            const opening = record(record(answer.value)?.["comment"]);
            return thread === null
                ? null
                : { thread, ...(opening && typeof opening.id === "string" ? { opening: opening as unknown as TeamComment } : {}) };
        },
        async reply(input) {
            const answer = await teamCall(remoteOrigin, TeamMethod.threadsReply, input);
            if (!answer.ok) return null;
            const comment = record(record(answer.value)?.["comment"]);
            return comment && typeof comment.id === "string" ? (comment as unknown as TeamComment) : null;
        },
        async resolve(thread, resolved) {
            const answer = await teamCall(remoteOrigin, TeamMethod.threadsResolve, { thread, resolved });
            return answer.ok;
        },
        ...(withTodos ? {
            async createTodo(input: { title: string; anchor: { document?: string; element?: string }; clientId: string }) {
                const answer = await teamCall(remoteOrigin, TeamMethod.todosCreate, {
                    project,
                    title: input.title,
                    visibility: "project",
                    anchor: { document: input.anchor.document, element: input.anchor.element },
                });
                const todo = record(record(answer.ok ? answer.value : null)?.["todo"]);
                return typeof todo?.id === "string" ? todo.id : null;
            },
            async setTodoStatus(todo: string, status: "open" | "done") {
                const answer = await teamCall(remoteOrigin, TeamMethod.todosUpdate, { todo, status });
                return answer.ok;
            },
        } : {}),
    };
}

/**
 * Keeps this project's story-row comments in step with its Team server, while the window is open
 * and the project is verified there. Draws nothing. See `storyCommentsTeamSync` for the rules.
 */
export function StoryCommentsTeamSyncMount(): null {
    const team = useTeamProjectSurface();
    const service = useStoryCommentsService();
    const connection = useTeamConnection(team.remoteOrigin);
    const canComment = useTeamCapability(connection, "comments");
    const canTodo = useTeamCapability(connection, "todos");
    const projectId = team.state.kind === "verified" ? team.state.project.id : null;
    const remoteOrigin = team.remoteOrigin;
    const ready = connection.state === "ready";

    useEffect(() => {
        if (service === null || remoteOrigin === null || projectId === null || !ready || !canComment) return;
        const sync = new StoryCommentsTeamSync(service, transportFor(remoteOrigin, projectId, canTodo));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const schedulePush = () => {
            if (timer !== undefined) clearTimeout(timer);
            timer = setTimeout(() => void sync.push().catch(() => undefined), PUSH_DELAY_MS);
        };
        // Pull first, so a thread somebody else opened on a row is known before this window
        // decides a local thread on the same row is new.
        void sync.pullAll().then(() => sync.push()).catch(() => undefined);
        const offChanged = service.onChanged(schedulePush);

        const topic = teamProjectThreadsTopic(projectId);
        void getInterface().team.subscribe(remoteOrigin, topic).catch(() => undefined);
        const token = getInterface().team.onEvent(message => {
            if (message.remoteOrigin !== remoteOrigin || message.topic !== topic) return;
            const payload = record(message.payload);
            const thread = record(payload?.["thread"]);
            const id = typeof payload?.["thread"] === "string" ? payload["thread"] : (typeof thread?.id === "string" ? thread.id : null);
            if (id !== null) void sync.pullThread(id).catch(() => undefined);
        });
        return () => {
            sync.stop();
            offChanged();
            token.cancel();
            if (timer !== undefined) clearTimeout(timer);
            void getInterface().team.unsubscribe(remoteOrigin, topic).catch(() => undefined);
        };
    // `connection.since` re-runs this after a reconnect: whatever was missed is recovered by pulling.
    }, [service, remoteOrigin, projectId, ready, canComment, canTodo, connection.since]);

    return null;
}
