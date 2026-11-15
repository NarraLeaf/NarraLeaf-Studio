import { useEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import { teamCall, useTeamCapability, useTeamConnection } from "@/lib/team";
import { Services } from "@/lib/workspace/services/services";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import { TeamMethod } from "@shared/types/team";

import { useWorkspace } from "../../context";
import { useTeamProjectSurface } from "./TeamProjectContext";

/**
 * Asking things of other people on the project, from Studio: a review of a range of versions, a
 * language of a story to translate or voice, a file for one row. Each is one call to the Team
 * server; the web console is where they are worked through.
 */

type Member = { username: string; displayName: string };
type Revision = { id: string; message?: string };

const field = "w-full rounded-md border border-edge bg-surface px-2 py-1 text-xs text-fg";
const label = "flex flex-col gap-0.5 text-2xs text-fg-subtle";

function useProject() {
    const team = useTeamProjectSurface();
    const connection = useTeamConnection(team.remoteOrigin);
    const projectId = team.state.kind === "verified" ? team.state.project.id : null;
    const role = team.state.kind === "verified" ? team.state.project.role : undefined;
    return { team, connection, projectId, role, remoteOrigin: team.remoteOrigin, me: connection.account?.username };
}

function useMembers(remoteOrigin: string | null, projectId: string | null, ready: boolean): Member[] {
    const [members, setMembers] = useState<Member[]>([]);
    useEffect(() => {
        setMembers([]);
        if (remoteOrigin === null || projectId === null || !ready) return;
        let alive = true;
        void teamCall(remoteOrigin, TeamMethod.projectsMembersList, { project: projectId }).then(answer => {
            const list = answer.ok ? (answer.value as { members?: unknown }).members : undefined;
            if (alive && Array.isArray(list)) setMembers(list as Member[]);
        });
        return () => { alive = false; };
    }, [remoteOrigin, projectId, ready]);
    return members;
}

function useRevisions(remoteOrigin: string | null, projectId: string | null, ready: boolean): Revision[] {
    const [revisions, setRevisions] = useState<Revision[]>([]);
    useEffect(() => {
        setRevisions([]);
        if (remoteOrigin === null || projectId === null || !ready) return;
        let alive = true;
        void teamCall(remoteOrigin, TeamMethod.projectsHistory, { project: projectId, limit: 30 }).then(answer => {
            const list = answer.ok ? (answer.value as { revisions?: unknown }).revisions : undefined;
            if (alive && Array.isArray(list)) setRevisions(list as Revision[]);
        });
        return () => { alive = false; };
    }, [remoteOrigin, projectId, ready]);
    return revisions;
}

function usePendingRequest() {
    const [pending, setPending] = useState(false);
    const inFlight = useRef(false);
    const run = async (action: () => Promise<void>) => {
        if (inFlight.current) return;
        inFlight.current = true;
        setPending(true);
        try {
            await action();
        } finally {
            inFlight.current = false;
            setPending(false);
        }
    };
    return { pending, run };
}

function Sent({ text }: { text: string | null }) {
    return text === null ? null : <p className="text-2xs text-fg-subtle">{text}</p>;
}

/** Ask a member to review the versions up to one the server has. */
export function ReviewRequestForm() {
    const { t } = useTranslation();
    const { connection, projectId, remoteOrigin, me } = useProject();
    const ready = connection.state === "ready";
    const members = useMembers(remoteOrigin, projectId, ready).filter(member => member.username !== me);
    const revisions = useRevisions(remoteOrigin, projectId, ready);
    const [draft, setDraft] = useState({ title: "", reviewer: "", from: "", to: "" });
    const [said, setSaid] = useState<string | null>(null);
    const { pending, run } = usePendingRequest();
    const to = draft.to || revisions[0]?.id || "";
    const canSend = ready && remoteOrigin !== null && projectId !== null && draft.title.trim() !== ""
        && members.some(member => member.username === draft.reviewer)
        && revisions.some(revision => revision.id === to)
        && (draft.from === "" || revisions.some(revision => revision.id === draft.from));

    const send = async () => {
        if (!canSend) return;
        await run(async () => {
            const answer = await teamCall(remoteOrigin!, TeamMethod.reviewsCreate, {
                project: projectId,
                reviewer: draft.reviewer,
                title: draft.title.trim(),
                toRevision: to,
                ...(draft.from ? { fromRevision: draft.from } : {}),
            });
            setSaid(answer.ok ? t("workspace.shell.team.requests.sent") : t("workspace.shell.team.requests.failed"));
            if (answer.ok) setDraft({ title: "", reviewer: "", from: "", to: "" });
        });
    };

    const name = (revision: Revision) => `${revision.id.slice(0, 8)} ${revision.message?.split("\n")[0]?.slice(0, 40) ?? ""}`;
    return (
        <div data-team-request="review" className="flex flex-col gap-1.5 px-2 py-1.5">
            <input className={field} value={draft.title} disabled={pending} placeholder={t("workspace.shell.team.requests.reviewTitle")} onChange={event => setDraft({ ...draft, title: event.target.value })} />
            <label className={label}>
                {t("workspace.shell.team.requests.reviewer")}
                <select className={field} value={draft.reviewer} disabled={pending} onChange={event => setDraft({ ...draft, reviewer: event.target.value })}>
                    <option value="">—</option>
                    {members.map(member => <option key={member.username} value={member.username}>{member.displayName || member.username}</option>)}
                </select>
            </label>
            <div className="flex gap-1.5">
                <label className={`${label} flex-1`}>
                    {t("workspace.shell.team.requests.from")}
                    <select className={field} value={draft.from} disabled={pending} onChange={event => setDraft({ ...draft, from: event.target.value })}>
                        <option value="">{t("workspace.shell.team.requests.fromStart")}</option>
                        {revisions.map(revision => <option key={revision.id} value={revision.id}>{name(revision)}</option>)}
                    </select>
                </label>
                <label className={`${label} flex-1`}>
                    {t("workspace.shell.team.requests.to")}
                    <select className={field} value={to} disabled={pending} onChange={event => setDraft({ ...draft, to: event.target.value })}>
                        {revisions.map(revision => <option key={revision.id} value={revision.id}>{name(revision)}</option>)}
                    </select>
                </label>
            </div>
            <button type="button" disabled={!canSend || pending} onClick={() => void send()} className="self-end rounded-md bg-primary px-2 py-1 text-2xs text-on-primary disabled:opacity-50">
                {t("workspace.shell.team.requests.sendReview")}
            </button>
            <Sent text={said} />
        </div>
    );
}

/** Give one language of a story to somebody to translate or voice. */
export function LanguageAssignmentForm() {
    const { t } = useTranslation();
    const { connection, projectId, remoteOrigin } = useProject();
    const ready = connection.state === "ready";
    const members = useMembers(remoteOrigin, projectId, ready);
    const { context } = useWorkspace();
    const stories = useMemo(() => {
        try {
            return context?.services.get<StoryService>(Services.Story).listStories() ?? [];
        } catch {
            return [];
        }
    }, [context]);
    const [draft, setDraft] = useState({ kind: "translation" as "translation" | "voice", story: "", locale: "", assignee: "" });
    const [said, setSaid] = useState<string | null>(null);
    const { pending, run } = usePendingRequest();
    const story = draft.story || stories[0]?.id || "";
    const canSend = ready && remoteOrigin !== null && projectId !== null && draft.locale.trim() !== ""
        && stories.some(entry => entry.id === story)
        && (draft.assignee === "" || members.some(member => member.username === draft.assignee));

    const send = async () => {
        if (!canSend) return;
        await run(async () => {
            const storyName = stories.find(entry => entry.id === story)?.name ?? story;
            const locale = draft.locale.trim();
            const answer = await teamCall(remoteOrigin!, TeamMethod.todosCreate, {
                project: projectId,
                title: t(draft.kind === "translation" ? "workspace.shell.team.requests.translateTitle" : "workspace.shell.team.requests.voiceTitle", { story: storyName, locale }),
                kind: draft.kind,
                locale,
                visibility: "project",
                anchor: { document: `story:${story}`, element: "*" },
                ...(draft.assignee ? { assignee: draft.assignee } : {}),
            });
            setSaid(answer.ok ? t("workspace.shell.team.requests.sent") : t("workspace.shell.team.requests.failed"));
        });
    };

    return (
        <div data-team-request="language" className="flex flex-col gap-1.5 px-2 py-1.5">
            <div className="flex gap-1.5">
                <select className={field} value={draft.kind} disabled={pending} onChange={event => setDraft({ ...draft, kind: event.target.value as "translation" | "voice" })}>
                    <option value="translation">{t("workspace.shell.team.requests.kindTranslation")}</option>
                    <option value="voice">{t("workspace.shell.team.requests.kindVoice")}</option>
                </select>
                <input className={field} value={draft.locale} disabled={pending} placeholder={t("workspace.shell.team.requests.locale")} maxLength={35} onChange={event => setDraft({ ...draft, locale: event.target.value })} />
            </div>
            <select className={field} value={story} disabled={pending} onChange={event => setDraft({ ...draft, story: event.target.value })}>
                {stories.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
            <select className={field} value={draft.assignee} disabled={pending} onChange={event => setDraft({ ...draft, assignee: event.target.value })}>
                <option value="">{t("workspace.shell.team.requests.nobodyYet")}</option>
                {members.map(member => <option key={member.username} value={member.username}>{member.displayName || member.username}</option>)}
            </select>
            <button type="button" disabled={!canSend || pending} onClick={() => void send()} className="self-end rounded-md bg-primary px-2 py-1 text-2xs text-on-primary disabled:opacity-50">
                {t("workspace.shell.team.requests.assign")}
            </button>
            <Sent text={said} />
        </div>
    );
}

/** The two forms, each behind a row of the Team panel. Nothing while the project is not on a server that has them. */
export function TeamRequestsSection() {
    const { t } = useTranslation();
    const { connection, projectId, role } = useProject();
    const reviews = useTeamCapability(connection, "reviews");
    const todos = useTeamCapability(connection, "todos");
    const [open, setOpen] = useState<"review" | "language" | null>(null);
    if (projectId === null || role === "viewer" || (!reviews && !todos)) return null;
    const row = (key: "review" | "language", text: string) => (
        <button
            type="button"
            aria-expanded={open === key}
            onClick={() => setOpen(open === key ? null : key)}
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-fg hover:bg-fill"
        >
            {text}
            <span className="text-fg-subtle">{open === key ? "−" : "+"}</span>
        </button>
    );
    return (
        <div data-team-requests="" className="-mx-2 flex flex-col border-t border-edge pt-2">
            {reviews && row("review", t("workspace.shell.team.requests.askReview"))}
            {open === "review" && <ReviewRequestForm />}
            {todos && row("language", t("workspace.shell.team.requests.assignLanguage"))}
            {open === "language" && <LanguageAssignmentForm />}
        </div>
    );
}

/**
 * Ask for a file for one row - "a crying variant of Ada's sprite" - as an asset to-do anchored to
 * it, for whoever makes art to pick up from the board.
 */
export function RowAssetRequest(props: { storyId: string; sceneId: string; blockId: string; excerpt?: string }) {
    const { t } = useTranslation();
    const { connection, projectId, remoteOrigin, role } = useProject();
    const offered = useTeamCapability(connection, "todos");
    const [open, setOpen] = useState(false);
    const members = useMembers(remoteOrigin, open ? projectId : null, connection.state === "ready");
    const [title, setTitle] = useState("");
    const [assignee, setAssignee] = useState("");
    const [said, setSaid] = useState<string | null>(null);
    const { pending, run } = usePendingRequest();
    if (projectId === null || remoteOrigin === null || !offered || role === "viewer") return null;
    const canSend = connection.state === "ready" && title.trim() !== ""
        && (assignee === "" || members.some(member => member.username === assignee));

    const send = async () => {
        if (!canSend) return;
        await run(async () => {
            const answer = await teamCall(remoteOrigin, TeamMethod.todosCreate, {
                project: projectId,
                title: title.trim(),
                kind: "asset",
                visibility: "project",
                anchor: { document: `story:${props.storyId}`, element: `${props.sceneId}/${props.blockId}` },
                ...(assignee ? { assignee } : {}),
            });
            setSaid(answer.ok ? t("workspace.shell.team.requests.sent") : t("workspace.shell.team.requests.failed"));
            if (answer.ok) {
                setTitle("");
                setOpen(false);
            }
        });
    };

    if (!open) {
        return (
            <div className="mt-1.5 flex items-center justify-between">
                <button type="button" data-row-asset-request="" className="text-2xs text-fg-muted hover:text-fg" onClick={() => setOpen(true)}>
                    + {t("workspace.shell.team.requests.askAsset")}
                </button>
                <Sent text={said} />
            </div>
        );
    }
    return (
        <div className="mt-1.5 flex flex-col gap-1 border-t border-edge-subtle pt-1.5">
            <input
                className={field}
                autoFocus
                value={title}
                disabled={pending}
                placeholder={t("workspace.shell.team.requests.assetPlaceholder")}
                onChange={event => setTitle(event.target.value)}
            />
            <div className="flex gap-1">
                <select className={field} value={assignee} disabled={pending} onChange={event => setAssignee(event.target.value)}>
                    <option value="">{t("workspace.shell.team.requests.nobodyYet")}</option>
                    {members.map(member => <option key={member.username} value={member.username}>{member.displayName || member.username}</option>)}
                </select>
                <button type="button" disabled={!canSend || pending} onClick={() => void send()} className="shrink-0 rounded-md bg-primary px-2 text-2xs text-on-primary disabled:opacity-50">
                    {t("workspace.shell.team.requests.sendAsset")}
                </button>
            </div>
        </div>
    );
}
