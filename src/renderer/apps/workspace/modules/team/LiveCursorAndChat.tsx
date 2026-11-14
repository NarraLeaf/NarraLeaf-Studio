import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";

import { useTranslation } from "@/lib/i18n";
import { nameInitials, nameMonogramColor } from "@/lib/components/monogram";
import { EMPTY_LIVE_PRESENCE, type LivePeerCursor, type LivePresenceSnapshot } from "@/lib/live/livePresence";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { LiveSessionService } from "@/lib/workspace/services/live/LiveSessionService";
import type { LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { StoryBlockId, StoryId, StorySceneId } from "@shared/types/story";

import { useWorkspace } from "../../context";
import { useActiveEditorTab } from "../../hooks/useUIService";
import { editorSubjectOf } from "../lint/problemsScope";
import { revealAgentWrite } from "../agent/revealAgentWrite";
import { createStorySceneEditorTab } from "../story/scene-editor/openStorySceneEditorTab";
import { teamEditingDocument } from "./teamEditing";

function useLiveService(): LiveSessionService | null {
    const { context, isInitialized } = useWorkspace();
    return useMemo(() => {
        if (!context || !isInitialized) return null;
        try {
            return context.services.get<LiveSessionService>(Services.Live);
        } catch {
            return null;
        }
    }, [context, isInitialized]);
}

function useLiveView(service: LiveSessionService | null): LiveSessionView | null {
    const [view, setView] = useState<LiveSessionView | null>(() => service?.getView() ?? null);
    useEffect(() => {
        if (!service) return;
        setView(service.getView());
        return service.onChanged(setView);
    }, [service]);
    return view;
}

function useLivePresence(service: LiveSessionService | null): LivePresenceSnapshot {
    const [presence, setPresence] = useState<LivePresenceSnapshot>(() => service?.getPresence() ?? EMPTY_LIVE_PRESENCE);
    useEffect(() => {
        if (!service) return;
        setPresence(service.getPresence());
        return service.onPresenceChanged(setPresence);
    }, [service]);
    return presence;
}

/** The row a DOM node is inside, if it is inside a story row. */
function rowOf(target: EventTarget | null): string | null {
    const element = target instanceof Element ? target.closest<HTMLElement>("[data-story-row-block-id]") : null;
    return element?.dataset.storyRowBlockId ?? null;
}

/**
 * Tells the room where this window is: the story or blueprint in the active tab and, in a scene,
 * the row last clicked or focused. Sent only while in a session, and only when it changes.
 */
export function LiveCursorBroadcaster() {
    const service = useLiveService();
    const view = useLiveView(service);
    const { tab } = useActiveEditorTab();
    const document = teamEditingDocument(tab);
    const subject = tab === null ? null : editorSubjectOf(tab);
    const sceneId = subject?.kind === "storyScene" ? subject.sceneId : null;
    const [row, setRow] = useState<string | null>(null);
    const active = view?.phase === "active";

    useEffect(() => setRow(null), [tab?.id]);

    useEffect(() => {
        if (!active) return;
        const seen = (event: Event) => {
            const blockId = rowOf(event.target);
            if (blockId !== null) setRow(blockId);
        };
        window.addEventListener("focusin", seen, true);
        window.addEventListener("pointerdown", seen, true);
        return () => {
            window.removeEventListener("focusin", seen, true);
            window.removeEventListener("pointerdown", seen, true);
        };
    }, [active]);

    useEffect(() => {
        if (!service || !active) return;
        service.setCursor(document, sceneId !== null && row !== null ? `${sceneId}/${row}` : undefined);
    }, [service, active, document, sceneId, row]);

    return null;
}

/** Take this window to where somebody else is. */
export function goToCursor(context: WorkspaceContext, cursor: Pick<LivePeerCursor, "document" | "element">, token: number): void {
    if (cursor.document.startsWith("story:")) {
        const storyId = cursor.document.slice("story:".length) as StoryId;
        if (cursor.element === undefined) return;
        const slash = cursor.element.indexOf("/");
        if (slash <= 0) return;
        const sceneId = cursor.element.slice(0, slash) as StorySceneId;
        const blockId = cursor.element.slice(slash + 1) as StoryBlockId;
        let title: string = sceneId;
        try {
            title = context.services.get<StoryService>(Services.Story).getLoadedStoryDocument(storyId)?.scenes[sceneId]?.name ?? sceneId;
        } catch {
            // No story service: the id is a title that still says where.
        }
        context.services.get<UIService>(Services.UI).editor.open(
            createStorySceneEditorTab({ storyId, sceneId, activeBlockId: blockId, revealToken: token }, title),
        );
        return;
    }
    if (cursor.document.startsWith("ui:")) {
        const blueprintId = cursor.document.slice("ui:".length);
        revealAgentWrite(context, { kind: "blueprint", blueprintId, name: blueprintId });
    }
}

/**
 * The room's chat, and following somebody.
 *
 * Collapsed to a button while nobody is talking; the count on it is what arrived since it was last
 * open. Following a person takes this window wherever their cursor goes until it is switched off
 * or they leave.
 */
export function LiveSessionChat() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const service = useLiveService();
    const view = useLiveView(service);
    const presence = useLivePresence(service);
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState("");
    const [readUpTo, setReadUpTo] = useState(0);
    const [following, setFollowing] = useState<string | null>(null);
    const list = useRef<HTMLDivElement>(null);
    const token = useRef(0);
    const lastFollowed = useRef<string | null>(null);

    const active = view?.phase === "active";
    const self = view?.self ?? null;
    const others = (view?.session?.members ?? []).filter(member => member.instance !== self);
    const unread = presence.chat.filter(line => !line.mine).length - readUpTo;

    useEffect(() => {
        if (open) setReadUpTo(presence.chat.filter(line => !line.mine).length);
    }, [open, presence.chat]);

    useEffect(() => {
        if (open && list.current) list.current.scrollTop = list.current.scrollHeight;
    }, [open, presence.chat.length]);

    // Stop following somebody who has left, and everything when the session ends.
    useEffect(() => {
        if (!active) {
            setFollowing(null);
            setReadUpTo(0);
        } else if (following !== null && !others.some(member => member.instance === following)) {
            setFollowing(null);
        }
    }, [active, following, others]);

    useEffect(() => {
        if (following === null || !context) {
            lastFollowed.current = null;
            return;
        }
        const cursor = presence.cursors.find(candidate => candidate.instance === following);
        if (!cursor) return;
        const key = `${cursor.document}#${cursor.element ?? ""}`;
        if (key === lastFollowed.current) return;
        lastFollowed.current = key;
        token.current += 1;
        goToCursor(context, cursor, token.current);
    }, [following, presence.cursors, context]);

    if (!active || !service) return null;

    const send = () => {
        if (service.sendChat(draft)) setDraft("");
    };

    if (!open) {
        return (
            <button
                type="button"
                data-live-chat="closed"
                onClick={() => setOpen(true)}
                aria-label={t("workspace.shell.team.liveChat.open")}
                className="pointer-events-auto fixed bottom-10 left-4 z-40 flex items-center gap-1.5 rounded-full border border-edge bg-surface-overlay px-3 py-1.5 text-xs text-fg shadow-lg hover:bg-fill"
            >
                <MessageCircle className="h-3.5 w-3.5" />
                {t("workspace.shell.team.liveChat.title")}
                {unread > 0 && <span className="rounded-full bg-primary px-1.5 text-2xs text-on-primary">{unread}</span>}
                {following !== null && <span className="text-2xs text-fg-subtle">· {t("workspace.shell.team.liveChat.followingShort")}</span>}
            </button>
        );
    }

    return (
        <div
            data-live-chat="open"
            className="pointer-events-auto fixed bottom-10 left-4 z-40 flex h-[360px] w-[300px] flex-col rounded-lg border border-edge bg-surface-overlay text-xs text-fg shadow-lg"
        >
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
                <span className="font-medium">{t("workspace.shell.team.liveChat.title")}</span>
                <button type="button" aria-label={t("workspace.shell.team.liveChat.close")} onClick={() => setOpen(false)} className="rounded p-0.5 text-fg-muted hover:bg-fill">
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
            <ul className="flex flex-wrap gap-1 border-b border-edge px-3 py-2">
                {others.length === 0 && <li className="text-fg-subtle">{t("workspace.shell.team.liveChat.nobodyElse")}</li>}
                {others.map(member => {
                    const on = following === member.instance;
                    return (
                        <li key={member.instance}>
                            <button
                                type="button"
                                data-live-follow={member.account}
                                aria-pressed={on}
                                data-tip={t(on ? "workspace.shell.team.liveChat.stopFollowing" : "workspace.shell.team.liveChat.follow", { name: member.account })}
                                onClick={() => setFollowing(on ? null : member.instance)}
                                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${on ? "border-primary bg-primary/10" : "border-edge hover:bg-fill"}`}
                            >
                                <span
                                    aria-hidden
                                    className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-2xs text-white"
                                    style={{ backgroundColor: nameMonogramColor(member.account) }}
                                >
                                    {nameInitials(member.account).slice(0, 1)}
                                </span>
                                {member.account}
                                {on && <span className="text-2xs text-primary">{t("workspace.shell.team.liveChat.followingShort")}</span>}
                            </button>
                        </li>
                    );
                })}
            </ul>
            <div ref={list} className="flex-1 space-y-1.5 overflow-y-auto px-3 py-2">
                {presence.chat.length === 0 && <p className="text-fg-subtle">{t("workspace.shell.team.liveChat.empty")}</p>}
                {presence.chat.map(line => (
                    <p key={line.id} className={line.mine ? "text-right" : ""}>
                        {!line.mine && <span className="mr-1 font-medium" style={{ color: nameMonogramColor(line.account) }}>{line.account}</span>}
                        <span className="whitespace-pre-wrap break-words">{line.text}</span>
                    </p>
                ))}
            </div>
            <form
                className="flex gap-1 border-t border-edge p-2"
                onSubmit={event => {
                    event.preventDefault();
                    send();
                }}
            >
                <input
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                    placeholder={t("workspace.shell.team.liveChat.placeholder")}
                    aria-label={t("workspace.shell.team.liveChat.placeholder")}
                    maxLength={2000}
                    className="min-w-0 flex-1 rounded border border-edge bg-surface px-2 py-1 text-xs"
                />
                <button type="submit" disabled={draft.trim() === ""} className="rounded bg-primary px-2 text-on-primary disabled:opacity-50">
                    {t("workspace.shell.team.liveChat.send")}
                </button>
            </form>
        </div>
    );
}
