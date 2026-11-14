/**
 * One review thread: its comments oldest first, the three thread-wide switches (to-do, resolved,
 * delete), and a composer at the bottom. Drawn in the row's popover and, expanded, in the Comments
 * panel - one component so the two never disagree about what a thread offers.
 *
 * Keys typed in either text box stay in it: the scene editor listens on `window`, where Enter would
 * commit a row and Ctrl+Z would undo one. Mod+Enter sends.
 *
 * Comments in English per project convention.
 */

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, ListTodo, Pencil, RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/lib/components/elements";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { isImeKeyEvent } from "@/lib/utils/imeComposition";
import type { StoryComment, StoryCommentAuthor, StoryCommentThread } from "@shared/types/storyComments";
import type { StoryCommentEditOptions, StoryCommentsService } from "@/lib/workspace/services/storyComments/StoryCommentsService";
import { useStoryCommentAuthor } from "./storyCommentsState";

const TEXTAREA_CLASS = "block min-h-0 w-full resize-none rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-primary";

export function authorLabel(author: StoryCommentAuthor, unnamed: string): string {
    return author.name.trim() || unnamed;
}

/** "Today 14:05" style stamps are left to the platform: the author's own locale and clock. */
export function formatCommentTime(epochMs: number, locale: string): string {
    if (!epochMs) {
        return "";
    }
    try {
        return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(epochMs));
    } catch {
        return new Date(epochMs).toLocaleString();
    }
}

/** Keep every key in the box, and send on Mod+Enter. */
function composerKeys(event: ReactKeyboardEvent<HTMLTextAreaElement>, send: () => void, cancel?: () => void): void {
    event.stopPropagation();
    if (isImeKeyEvent(event)) {
        return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        send();
        return;
    }
    if (event.key === "Escape" && cancel) {
        event.preventDefault();
        cancel();
    }
}

function AutoTextarea(props: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    autoFocus?: boolean;
    disabled?: boolean;
    onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
}) {
    const ref = useRef<HTMLTextAreaElement | null>(null);
    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        element.style.height = "auto";
        element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
    }, [props.value]);
    return (
        <textarea
            ref={ref}
            rows={2}
            className={TEXTAREA_CLASS}
            value={props.value}
            placeholder={props.placeholder}
            aria-label={props.placeholder}
            autoFocus={props.autoFocus}
            disabled={props.disabled}
            onChange={event => props.onChange(event.target.value)}
            onKeyDown={props.onKeyDown}
        />
    );
}

function CommentItem(props: {
    comment: StoryComment;
    locale: string;
    disabled?: boolean;
    onEdit: (body: string) => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(props.comment.body);
    const { comment } = props;
    const save = () => {
        props.onEdit(draft);
        setEditing(false);
    };
    return (
        <li className="group/comment py-1.5" data-story-comment-id={comment.id}>
            <div className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-xs font-medium text-fg">{authorLabel(comment.author, t("storyComments.unnamedAuthor"))}</span>
                <span className="shrink-0 text-2xs text-fg-subtle">
                    {formatCommentTime(comment.createdAt, props.locale)}
                    {comment.editedAt ? ` · ${t("storyComments.edited")}` : ""}
                </span>
                {!editing && !props.disabled ? (
                    <span className="ml-auto flex shrink-0 items-center opacity-0 transition-opacity group-hover/comment:opacity-100 focus-within:opacity-100">
                        <ToolbarButton
                            size="xs"
                            aria-label={t("storyComments.edit")}
                            data-tip={t("storyComments.edit")}
                            onClick={() => {
                                setDraft(comment.body);
                                setEditing(true);
                            }}
                        >
                            <Pencil className="h-3 w-3" />
                        </ToolbarButton>
                        <ToolbarButton
                            size="xs"
                            aria-label={t("storyComments.deleteComment")}
                            data-tip={t("storyComments.deleteComment")}
                            onClick={props.onDelete}
                        >
                            <Trash2 className="h-3 w-3" />
                        </ToolbarButton>
                    </span>
                ) : null}
            </div>
            {editing ? (
                <div className="mt-1 flex flex-col gap-1.5">
                    <AutoTextarea
                        value={draft}
                        onChange={setDraft}
                        placeholder={t("storyComments.placeholder.new")}
                        autoFocus
                        onKeyDown={event => composerKeys(event, save, () => setEditing(false))}
                    />
                    <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{t("storyComments.cancel")}</Button>
                        <Button size="sm" variant="primary" disabled={!draft.trim()} onClick={save}>{t("storyComments.save")}</Button>
                    </div>
                </div>
            ) : (
                <p className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-fg-muted">{comment.body}</p>
            )}
        </li>
    );
}

/**
 * A thread, or - when `thread` is null - the composer that opens one.
 *
 * `onCreate` is how the empty state becomes a thread; the caller knows which row it is for.
 */
export function StoryCommentThreadView(props: {
    service: StoryCommentsService;
    thread: StoryCommentThread | null;
    onCreate?: (body: string, todo: boolean, suggestion?: string) => void;
    /** The row's text now, offered as the start of a suggested edit. */
    rowText?: string;
    /**
     * Take the thread's suggestion: write it into the row. Absent where nothing can be written
     * (no story to edit, or a row with no line of text), and the button says so.
     */
    onApplySuggestion?: (suggestion: string) => boolean;
    /** Where edits are recorded for undo. */
    editOptions?: StoryCommentEditOptions;
    autoFocus?: boolean;
    /** The workspace refuses writes; everything is shown and nothing can be changed. */
    readOnly?: boolean;
    readOnlyReason?: string;
    className?: string;
}) {
    const { t, tn, locale } = useTranslation();
    const author = useStoryCommentAuthor();
    const [draft, setDraft] = useState("");
    const [newTodo, setNewTodo] = useState(false);
    const [suggesting, setSuggesting] = useState(false);
    const [suggestion, setSuggestion] = useState("");
    const { service, thread, editOptions } = props;

    const send = () => {
        const body = draft.trim();
        if (!body || props.readOnly) return;
        const offered = suggesting && suggestion.trim() !== "" && suggestion !== props.rowText ? suggestion : undefined;
        if (thread && offered === undefined) {
            service.reply(thread.id, body, editOptions);
        } else {
            props.onCreate?.(body, newTodo, offered);
        }
        setDraft("");
        setSuggesting(false);
    };

    const todo = thread ? thread.todo : newTodo;
    const signed = author?.name.trim();

    return (
        <div className={cn("flex min-w-0 flex-col", props.className)} data-story-comment-thread={thread?.id ?? ""}>
            <div className="flex items-center gap-1 border-b border-edge-subtle pb-1.5">
                <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                    {thread?.resolved
                        ? thread.resolvedBy?.name
                            ? t("storyComments.resolvedBy", { name: thread.resolvedBy.name })
                            : t("storyComments.resolved")
                        : thread
                            ? tn("storyComments.count", thread.comments.length)
                            : t("storyComments.add")}
                </span>
                <ToolbarButton
                    size="xs"
                    active={todo}
                    disabled={props.readOnly}
                    aria-pressed={todo}
                    aria-label={todo ? t("storyComments.clearTodo") : t("storyComments.markTodo")}
                    data-tip={props.readOnly ? props.readOnlyReason : todo ? t("storyComments.clearTodo") : t("storyComments.markTodo")}
                    className={todo ? "text-warning" : undefined}
                    onClick={() => (thread ? service.setTodo(thread.id, !thread.todo, editOptions) : setNewTodo(value => !value))}
                >
                    <ListTodo className="h-3.5 w-3.5" />
                </ToolbarButton>
                {thread ? (
                    <>
                        <ToolbarButton
                            size="xs"
                            disabled={props.readOnly}
                            aria-label={thread.resolved ? t("storyComments.reopen") : t("storyComments.resolve")}
                            data-tip={props.readOnly ? props.readOnlyReason : thread.resolved ? t("storyComments.reopen") : t("storyComments.resolve")}
                            className={thread.resolved ? undefined : "hover:text-success"}
                            onClick={() => service.setResolved(thread.id, !thread.resolved, editOptions)}
                        >
                            {thread.resolved ? <RotateCw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                        </ToolbarButton>
                        <ToolbarButton
                            size="xs"
                            disabled={props.readOnly}
                            aria-label={t("storyComments.deleteThread")}
                            data-tip={props.readOnly ? props.readOnlyReason : t("storyComments.deleteThread")}
                            className="hover:text-danger"
                            onClick={() => service.deleteThread(thread.id, editOptions)}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </ToolbarButton>
                    </>
                ) : null}
            </div>
            {thread ? (
                <ul className="max-h-72 min-h-0 overflow-y-auto">
                    {thread.comments.map(comment => (
                        <CommentItem
                            key={comment.id}
                            comment={comment}
                            locale={locale}
                            disabled={props.readOnly}
                            onEdit={body => service.editComment(thread.id, comment.id, body, editOptions)}
                            onDelete={() => service.deleteComment(thread.id, comment.id, editOptions)}
                        />
                    ))}
                </ul>
            ) : null}
            {thread?.suggestion !== undefined ? (
                <div className="mt-1.5 rounded-md border border-edge-subtle bg-fill/40 p-1.5" data-story-comment-suggestion="">
                    <div className="mb-0.5 text-2xs text-fg-subtle">{t("storyComments.suggestedText")}</div>
                    <div className="whitespace-pre-wrap break-words text-xs text-fg">{thread.suggestion}</div>
                    <div className="mt-1 flex justify-end">
                        {thread.suggestionAppliedAt !== undefined ? (
                            <span className="text-2xs text-success">{t("storyComments.suggestionApplied")}</span>
                        ) : (
                            <Button
                                size="sm"
                                variant="secondary"
                                disabled={props.readOnly || props.onApplySuggestion === undefined}
                                data-tip={props.readOnly ? props.readOnlyReason : props.onApplySuggestion === undefined ? t("storyComments.suggestionUnavailable") : undefined}
                                onClick={() => {
                                    if (props.onApplySuggestion?.(thread.suggestion!)) service.markSuggestionApplied(thread.id, editOptions);
                                }}
                            >
                                {t("storyComments.applySuggestion")}
                            </Button>
                        )}
                    </div>
                </div>
            ) : null}
            {props.readOnly ? null : (
                <div className="mt-1.5 flex flex-col gap-1.5">
                    {suggesting ? (
                        <AutoTextarea
                            value={suggestion}
                            onChange={setSuggestion}
                            placeholder={t("storyComments.suggestPlaceholder")}
                            onKeyDown={event => composerKeys(event, send)}
                        />
                    ) : null}
                    <AutoTextarea
                        value={draft}
                        onChange={setDraft}
                        placeholder={thread ? t("storyComments.placeholder.reply") : t("storyComments.placeholder.new")}
                        autoFocus={props.autoFocus}
                        onKeyDown={event => composerKeys(event, send)}
                    />
                    <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle" data-tip={signed ? undefined : t("storyComments.authorHint")}>
                            {signed ? t("storyComments.signedAs", { name: signed }) : t("storyComments.authorHint")}
                        </span>
                        {props.rowText !== undefined ? (
                            <Button
                                size="sm"
                                variant="ghost"
                                aria-pressed={suggesting}
                                onClick={() => {
                                    if (!suggesting && suggestion === "") setSuggestion(props.rowText ?? "");
                                    setSuggesting(value => !value);
                                }}
                            >
                                {suggesting ? t("storyComments.suggestClear") : t("storyComments.suggest")}
                            </Button>
                        ) : null}
                        <Button size="sm" variant="primary" disabled={!draft.trim()} onClick={send}>
                            {thread ? t("storyComments.reply") : t("storyComments.submit")}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
