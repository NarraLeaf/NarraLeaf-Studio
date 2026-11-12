/**
 * The mark beside a row that carries a review thread, and the thread itself in a popover beside it.
 *
 * It sits in the row's always-visible trailing slot, next to the lint mark, rather than in the
 * gutter: the gutter is the "who is speaking" column and holds a face, a ring or a verb, nothing else
 * (see the gutter spec). A comment is about the row, not a voice in it.
 *
 * Absent on a row with no thread, unless the author has just asked to add one - then the mark mounts
 * only to anchor the empty composer. An open thread is drawn in the accent colour, a to-do in the
 * warning colour, and a resolved one stays as a quiet glyph so it can still be found.
 *
 * Comments in English per project convention.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, MessageSquareDot } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { useFloatingLayer, useHostDocument } from "@/lib/components/layout";
import { storySceneHistoryScope } from "@/lib/workspace/services/history/historyScopes";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { storyCommentsSpec } from "@shared/documents/specs";
import {
    closeStoryCommentPopover,
    openStoryCommentPopover,
    useStoryCommentPopoverFor,
    useStoryCommentsService,
    useStoryCommentThreadForBlock,
    type StoryCommentPopoverTarget,
} from "../../story-comments/storyCommentsState";
import { StoryCommentThreadView } from "../../story-comments/StoryCommentThreadView";
import type { StoryBlock } from "@shared/types/story";
import { getSegmentSlot, segmentPlainText } from "./storyFindReplace";
import { describeBlock } from "./storySceneBlockUtils";

/** What a thread opened on this row remembers of it: the words, or the row's own one-line description. */
export function storyRowCommentText(block: StoryBlock): string {
    const slot = getSegmentSlot(block);
    if (slot) {
        return segmentPlainText(slot.segment);
    }
    try {
        return describeBlock(block, []);
    } catch {
        return "";
    }
}

const POPOVER_WIDTH = 320;

export function StoryRowCommentMark(props: { storyId: string; sceneId: string; block: StoryBlock }) {
    const { t, tn } = useTranslation();
    const blockId = props.block.id;
    const thread = useStoryCommentThreadForBlock(blockId);
    const open = useStoryCommentPopoverFor(blockId);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    if (!thread && !open) {
        return null;
    }
    const label = thread
        ? thread.resolved
            ? `${t("storyComments.resolved")} · ${tn("storyComments.count", thread.comments.length)}`
            : tn("storyComments.count", thread.comments.length)
        : t("storyComments.add");
    const Icon = thread && !thread.resolved ? MessageSquareDot : MessageSquare;
    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                tabIndex={-1}
                className={cn(
                    "grid h-5 w-5 shrink-0 cursor-default place-items-center rounded-md hover:bg-fill",
                    !thread || thread.resolved ? "text-fg-subtle" : thread.todo ? "text-warning" : "text-primary",
                )}
                data-tip={label}
                aria-label={label}
                aria-expanded={Boolean(open)}
                data-help-topic="storyComments"
                data-story-row-comment={thread?.id ?? "new"}
                onMouseDown={event => event.stopPropagation()}
                onClick={event => {
                    event.stopPropagation();
                    if (open) {
                        closeStoryCommentPopover(blockId);
                    } else {
                        openStoryCommentPopover({ storyId: props.storyId, sceneId: props.sceneId, blockId, text: storyRowCommentText(props.block) });
                    }
                }}
            >
                <Icon className="h-3.5 w-3.5" />
            </button>
            {open ? <StoryRowCommentPopover target={open} anchorRef={buttonRef} /> : null}
        </>
    );
}

function StoryRowCommentPopover(props: { target: StoryCommentPopoverTarget; anchorRef: React.RefObject<HTMLButtonElement | null> }) {
    const service = useStoryCommentsService();
    const thread = useStoryCommentThreadForBlock(props.target.blockId);
    const freeze = useFreezeGuard(storyCommentsSpec.pathFor());
    const doc = useHostDocument();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
    const close = () => closeStoryCommentPopover(props.target.blockId);

    useFloatingLayer({
        open: true,
        onClose: close,
        panelRef,
        ownerRefs: [props.anchorRef],
        closeOnOutsideWheel: false,
    });

    // To the left of the mark and level with it: the mark is at the row's right edge, so the thread
    // opens over the row's own words rather than past the window.
    useLayoutEffect(() => {
        const anchor = props.anchorRef.current;
        const view = doc.defaultView ?? window;
        if (!anchor) return;
        const rect = anchor.getBoundingClientRect();
        const height = panelRef.current?.offsetHeight ?? 240;
        const left = Math.max(8, Math.min(rect.right - POPOVER_WIDTH, view.innerWidth - POPOVER_WIDTH - 8));
        const below = rect.bottom + 6;
        const top = below + height > view.innerHeight - 8 ? Math.max(8, rect.top - height - 6) : below;
        setPosition(current => (current && current.top === top && current.left === left ? current : { top, left }));
    });

    // Light dismiss, letting the press through to whatever was clicked.
    useLayoutEffect(() => {
        const onDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (panelRef.current?.contains(target) || props.anchorRef.current?.contains(target)) return;
            close();
        };
        doc.addEventListener("mousedown", onDown, true);
        return () => doc.removeEventListener("mousedown", onDown, true);
    });

    if (!service) {
        return null;
    }
    const scopeId = storySceneHistoryScope(props.target.storyId, props.target.sceneId);
    return createPortal(
        <div
            ref={panelRef}
            role="dialog"
            className="fixed z-[70] rounded-lg border border-edge bg-surface-raised p-2.5 shadow-2xl"
            style={{ width: POPOVER_WIDTH, top: position?.top ?? -9999, left: position?.left ?? -9999 }}
            data-help-topic="storyComments"
            onMouseDown={event => event.stopPropagation()}
            onClick={event => event.stopPropagation()}
            onKeyDown={event => {
                // Every key belongs to the popover; Escape is the floating layer's.
                if (event.key !== "Escape") event.stopPropagation();
            }}
        >
            <StoryCommentThreadView
                service={service}
                thread={thread}
                editOptions={{ scopeId }}
                autoFocus
                readOnly={freeze.frozen}
                readOnlyReason={freeze.reason}
                onCreate={(body, todo) => {
                    service.createThread({ ...props.target, body, todo }, { scopeId });
                }}
            />
        </div>,
        doc.body,
    );
}
