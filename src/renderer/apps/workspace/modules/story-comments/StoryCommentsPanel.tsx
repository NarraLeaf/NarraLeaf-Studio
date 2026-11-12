/**
 * Comments panel (right dock). Every review thread in the project, grouped by the scene its row is
 * in, filtered by state and by author, and a click away from the row.
 *
 * A thread is found by its row's block id, in whichever scene that row is now - a row moved to
 * another scene takes its thread with it. A thread whose row cannot be found anywhere is an orphan:
 * it is listed last, under its own heading, and opens in place rather than jumping to nothing, so it
 * can still be read, answered or deleted.
 *
 * Comments in English per project convention.
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ListTodo, MessageSquare, MessageSquareDot } from "lucide-react";
import { EmptyState, SearchInput, Select } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { useWorkspace } from "@/apps/workspace/context";
import { useRegistry } from "@/apps/workspace/registry";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Services } from "@/lib/workspace/services/services";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import { storyCommentsSpec } from "@shared/documents/specs";
import {
    storyCommentAuthorKey,
    storyCommentThreadAuthors,
    type StoryCommentThread,
} from "@shared/types/storyComments";
import { jumpToSearchTarget } from "../search/searchJump";
import type { PanelComponentProps } from "../types";
import { getSegmentSlot, segmentPlainText } from "../story/scene-editor/storyFindReplace";
import { openStoryCommentPopover, useStoryCommentsService, useStoryCommentThreads } from "./storyCommentsState";
import { authorLabel, StoryCommentThreadView } from "./StoryCommentThreadView";
import {
    filterStoryCommentThreads,
    groupStoryCommentThreads,
    type StoryCommentLocator,
    type StoryCommentStatusFilter,
} from "./storyCommentsPanelModel";

export function StoryCommentsPanel(_props: PanelComponentProps) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const service = useStoryCommentsService();
    const threads = useStoryCommentThreads();
    const freeze = useFreezeGuard(storyCommentsSpec.pathFor());
    const { openEditorTab, setPanelVisibility } = useRegistry();
    const storyService = useMemo<StoryService | null>(
        () => (context && isInitialized ? context.services.get<StoryService>(Services.Story) : null),
        [context, isInitialized],
    );

    const [status, setStatus] = useState<StoryCommentStatusFilter>("open");
    const [author, setAuthor] = useState<string>("");
    const [query, setQuery] = useState("");
    const [expanded, setExpanded] = useState<string | null>(null);
    /** Bumped whenever a story document moves, so row lookups are made against what is there now. */
    const [storyRevision, setStoryRevision] = useState(0);

    useEffect(() => {
        if (!storyService) return;
        // Threads are anywhere in the project, and stories load one per open editor; the panel needs
        // all of them to say where a row is - or that it is gone.
        void storyService.loadAllStories().then(() => setStoryRevision(value => value + 1));
        const offDocument = storyService.onDocumentChanged(() => setStoryRevision(value => value + 1));
        const offLibrary = storyService.onLibraryChanged(() => setStoryRevision(value => value + 1));
        return () => {
            offDocument();
            offLibrary();
        };
    }, [storyService]);

    const locate = useMemo<StoryCommentLocator>(() => {
        void storyRevision;
        const blockHome = new Map<string, { storyId: string; sceneId: string }>();
        const stories = storyService?.listStories() ?? [];
        for (const entry of stories) {
            const document = storyService?.getLoadedStoryDocument(entry.id);
            if (!document) continue;
            for (const scene of Object.values(document.scenes)) {
                for (const blockId of Object.keys(scene.blocks)) {
                    blockHome.set(blockId, { storyId: document.id, sceneId: scene.id });
                }
            }
        }
        return thread => {
            const home = blockHome.get(thread.blockId);
            const storyId = home?.storyId ?? thread.storyId;
            const sceneId = home?.sceneId ?? thread.sceneId;
            const document = storyService?.getLoadedStoryDocument(storyId);
            const scene = document?.scenes[sceneId];
            const block = home ? scene?.blocks[thread.blockId] : undefined;
            const slot = block ? getSegmentSlot(block) : null;
            return {
                found: Boolean(home),
                storyId,
                sceneId,
                storyName: storyService?.getStoryEntry(storyId)?.name ?? document?.name ?? "",
                sceneName: scene?.name ?? "",
                text: slot ? segmentPlainText(slot.segment) : thread.excerpt ?? "",
            };
        };
    }, [storyService, storyRevision]);

    const authors = useMemo(() => {
        const seen = new Map<string, string>();
        for (const thread of threads) {
            for (const each of storyCommentThreadAuthors(thread)) {
                const key = storyCommentAuthorKey(each);
                if (!seen.has(key)) seen.set(key, authorLabel(each, t("storyComments.unnamedAuthor")));
            }
        }
        return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    }, [threads, t]);

    const visible = useMemo(
        () => filterStoryCommentThreads(threads, { status, authorKey: author || null, query }, locate),
        [threads, status, author, query, locate],
    );
    const groups = useMemo(() => groupStoryCommentThreads(visible, locate), [visible, locate]);

    const jump = (thread: StoryCommentThread) => {
        const where = locate(thread);
        if (!where.found) {
            setExpanded(current => (current === thread.id ? null : thread.id));
            return;
        }
        const jumped = jumpToSearchTarget(
            {
                kind: "storyBlock",
                storyId: where.storyId,
                sceneId: where.sceneId,
                blockId: thread.blockId,
                storyName: where.storyName,
                sceneName: where.sceneName,
            },
            { openEditorTab, setPanelVisibility, context },
        );
        if (jumped) {
            openStoryCommentPopover({ storyId: where.storyId, sceneId: where.sceneId, blockId: thread.blockId, text: where.text });
        }
    };

    const statusOptions = [
        { value: "open", label: t("storyComments.filter.open") },
        { value: "todo", label: t("storyComments.filter.todo") },
        { value: "resolved", label: t("storyComments.filter.resolved") },
        { value: "all", label: t("storyComments.filter.all") },
    ];
    const authorOptions = [
        { value: "", label: t("storyComments.filter.allAuthors") },
        ...authors.map(([key, name]) => ({ value: key, label: name })),
    ];

    return (
        <div className="flex h-full flex-col" data-help-topic="storyComments">
            <div className="flex flex-col gap-1.5 px-2 py-2">
                <SearchInput
                    size="sm"
                    fullWidth
                    value={query}
                    placeholder={t("storyComments.search")}
                    onChange={event => setQuery(event.target.value)}
                    onKeyDown={event => event.stopPropagation()}
                />
                <div className="grid grid-cols-2 gap-1.5">
                    <Select
                        size="sm"
                        fullWidth
                        portalMenu
                        options={statusOptions}
                        value={status}
                        onChange={value => setStatus(value as StoryCommentStatusFilter)}
                    />
                    <Select
                        size="sm"
                        fullWidth
                        portalMenu
                        options={authorOptions}
                        value={author}
                        onChange={value => setAuthor(String(value))}
                    />
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                {groups.length === 0 ? (
                    <EmptyState
                        size="sm"
                        icon={<MessageSquare className="h-5 w-5" />}
                        title={threads.length === 0 ? t("storyComments.empty") : t("storyComments.noMatches")}
                    />
                ) : (
                    groups.map(group => (
                        <section key={group.key} data-story-comments-group={group.key}>
                            <div className="truncate px-2 pb-0.5 pt-2 text-2xs text-fg-subtle">
                                {group.orphan
                                    ? t("storyComments.orphanGroup")
                                    : `${group.storyName || t("storyComments.unknownStory")} / ${group.sceneName || t("storyComments.unknownScene")}`}
                            </div>
                            {group.threads.map(thread => {
                                const where = locate(thread);
                                const open = expanded === thread.id;
                                const first = thread.comments[0];
                                const Icon = thread.resolved ? MessageSquare : MessageSquareDot;
                                return (
                                    <div key={thread.id} data-story-comment-row={thread.id}>
                                        <button
                                            type="button"
                                            className={cn(
                                                "flex w-full cursor-default items-start gap-2 px-2 py-1.5 text-left transition-colors hover:bg-fill",
                                                open ? "bg-fill" : "",
                                            )}
                                            onClick={() => jump(thread)}
                                        >
                                            <Icon
                                                className={cn(
                                                    "mt-0.5 h-3.5 w-3.5 shrink-0",
                                                    thread.resolved ? "text-fg-subtle" : thread.todo ? "text-warning" : "text-primary",
                                                )}
                                            />
                                            <span className="min-w-0 flex-1">
                                                <span className={cn("block truncate text-xs", thread.resolved ? "text-fg-muted" : "text-fg")}>
                                                    {where.text || t("storyComments.orphan")}
                                                </span>
                                                <span className="line-clamp-2 text-xs text-fg-muted">{first.body}</span>
                                                <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-fg-subtle">
                                                    <span className="truncate">{authorLabel(first.author, t("storyComments.unnamedAuthor"))}</span>
                                                    {thread.comments.length > 1 ? <span className="shrink-0">· {thread.comments.length}</span> : null}
                                                    {thread.todo ? (
                                                        <span className="flex shrink-0 items-center gap-0.5 text-warning">
                                                            <ListTodo className="h-3 w-3" />
                                                            {t("storyComments.todo")}
                                                        </span>
                                                    ) : null}
                                                    {thread.resolved ? <span className="shrink-0">· {t("storyComments.resolved")}</span> : null}
                                                    {!where.found ? <span className="shrink-0 text-warning">· {t("storyComments.orphan")}</span> : null}
                                                </span>
                                            </span>
                                            {!where.found ? (
                                                open ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                                            ) : null}
                                        </button>
                                        {open && service ? (
                                            <div className="border-b border-edge-subtle px-2 pb-2 pt-1">
                                                <StoryCommentThreadView
                                                    service={service}
                                                    thread={thread}
                                                    readOnly={freeze.frozen}
                                                    readOnlyReason={freeze.reason}
                                                />
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </section>
                    ))
                )}
            </div>
        </div>
    );
}
