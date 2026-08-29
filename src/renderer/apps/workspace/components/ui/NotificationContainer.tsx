import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Info, X, XCircle, type LucideIcon } from "lucide-react";
import { Notification, NotificationType } from "@/lib/workspace/services/ui/types";
import { useWorkspace } from "../../context";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/lib/components/elements";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { cn } from "@/lib/utils/cn";
import { visibleCardCount } from "./notificationStack";

/** One outline glyph per type, from the icon set the rest of the workspace uses. */
const TYPE_ICON: Record<NotificationType, LucideIcon> = {
    [NotificationType.Info]: Info,
    [NotificationType.Success]: CheckCircle2,
    [NotificationType.Warning]: AlertTriangle,
    [NotificationType.Error]: XCircle,
};

/** Info reuses `primary`; there is no separate info token (design-system §1). */
const TYPE_ACCENT: Record<NotificationType, string> = {
    [NotificationType.Info]: "border-l-primary text-primary",
    [NotificationType.Success]: "border-l-success text-success",
    [NotificationType.Warning]: "border-l-warning text-warning",
    [NotificationType.Error]: "border-l-danger text-danger",
};

/** Vertical space between cards, in px. Mirrors the `gap-2` on the stack. */
const CARD_GAP = 8;

/**
 * How tall a card's text may get before the rest is folded away, in px - a heading plus about five
 * lines of detail. A compiler error pasted into `detail` can be a paragraph, and a stack of those
 * would spend the whole window height on one event; folding keeps every card roughly the size of
 * the thing it is reporting, and the author unfolds the one they care about.
 *
 * The actions sit OUTSIDE the fold on purpose: reaching an action must never require unfolding the
 * card first. The fold hides reading matter, never the way out of it.
 */
const TEXT_FOLD_HEIGHT = 112;

/** Gap between the stack and the chrome it must not reach over, in px. */
const STACK_MARGIN = 16;

/**
 * Individual notification item.
 *
 * A notification is an overlay, so it sits on the opaque overlay surface rather than on a
 * translucent wash of its own accent colour behind a blur: a message that may carry a build path
 * or a compiler error is the last thing that can afford to be read against a blurred screenshot of
 * whatever is underneath it. The type is carried by the icon and a hairline down the leading edge
 * instead, neither of which touches the contrast of the words.
 */
function NotificationItem({
    notification,
    onClose,
    presented,
}: {
    notification: Notification;
    onClose: () => void;
    /** False while the card is still waiting its turn: it is mounted for measurement only. */
    presented: boolean;
}) {
    const { t } = useTranslation();
    const Icon = TYPE_ICON[notification.type];
    const accent = TYPE_ACCENT[notification.type];

    const textRef = useRef<HTMLDivElement>(null);
    const [folded, setFolded] = useState(true);
    const [foldable, setFoldable] = useState(false);
    const [hovered, setHovered] = useState(false);

    // Whether anything is under the fold at all, read from the element that carries the clamp and
    // after layout - so it answers for the text as it actually wrapped, not for a character count
    // guessing at it.
    useLayoutEffect(() => {
        const element = textRef.current;
        if (!element || !folded) {
            return;
        }
        const measure = () => setFoldable(element.scrollHeight > element.clientHeight + 1);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [folded, notification.message, notification.detail]);

    // The countdown belongs to the view, not to the service. A card still waiting in the queue has
    // not been read; one the pointer is resting on, or that the author has unfolded, is being read
    // right now. All three are the same rule: a notification only spends its time while it is
    // actually on screen and unattended.
    const dismissRef = useRef(onClose);
    dismissRef.current = onClose;
    const remainingRef = useRef(notification.timeout ?? 0);
    const counting = presented && !hovered && folded;

    useEffect(() => {
        if (!counting || remainingRef.current <= 0) {
            return;
        }
        const startedAt = Date.now();
        const timer = setTimeout(() => dismissRef.current(), remainingRef.current);
        return () => {
            clearTimeout(timer);
            remainingRef.current -= Date.now() - startedAt;
        };
    }, [counting]);

    // Unfolding is available whenever there is something under the fold, and folding back is
    // available whenever the card is open - a card that was unfolded and then had its overflow
    // measured away still has to be closable again.
    const foldToggleShown = foldable || !folded;
    const toggleFold = () => {
        if (foldToggleShown) {
            setFolded(current => !current);
        }
    };

    // Anywhere on the card unfolds it, except when the click ended a drag over the text: the whole
    // point of a build error in a toast is that it can be selected and copied, and a selection that
    // refolded the card as it was released would take the text away at the moment it was wanted.
    const handleCardClick = () => {
        if (window.getSelection()?.toString()) {
            return;
        }
        toggleFold();
    };

    return (
        <div
            role={notification.type === NotificationType.Error ? "alert" : "status"}
            onClick={handleCardClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className={cn(
                "flex w-96 items-start gap-3 rounded-lg p-3",
                // Per-side widths rather than `border` + `border-l-2`: the engine
                // (narraleaf-react) ships a compiled Tailwind v4 sheet that the
                // workspace window injects after its own, and its `.border` rule
                // lands last and resets all four widths to 1px.
                "border-y border-r border-l-2 border-edge bg-surface-overlay shadow-lg shadow-black/30",
                "animate-slide-in-right",
                accent,
            )}
        >
            <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />

            <div className="min-w-0 flex-1">
                <div
                    ref={textRef}
                    className="relative overflow-hidden"
                    style={folded ? { maxHeight: TEXT_FOLD_HEIGHT } : undefined}
                >
                    <p className="nl-selectable-text text-sm font-medium text-fg">{notification.message}</p>
                    {notification.detail && (
                        <p className="nl-selectable-text mt-1 text-xs text-fg-muted">{notification.detail}</p>
                    )}
                    {/* The last line fades out instead of being cut through the middle of itself, so a
                        folded card reads as "there is more" rather than as a rendering fault. */}
                    {folded && foldable && (
                        <div
                            aria-hidden
                            className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-surface-overlay"
                        />
                    )}
                </div>

                {foldToggleShown && (
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            toggleFold();
                        }}
                        aria-expanded={!folded}
                        className={cn(
                            "mt-1 flex items-center gap-1 cursor-default text-2xs text-fg-subtle",
                            "transition-colors hover:text-fg-muted",
                        )}
                    >
                        <ChevronDown className={cn("h-3 w-3 transition-transform", !folded && "rotate-180")} aria-hidden />
                        {folded ? t("common.expand") : t("common.collapse")}
                    </button>
                )}

                {notification.actions && notification.actions.length > 0 && (
                    <div className="mt-3 flex gap-2">
                        {notification.actions.map((action, index) => (
                            <Button
                                key={index}
                                size="sm"
                                variant={action.primary ? "primary" : "secondary"}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    action.onClick();
                                    onClose();
                                }}
                            >
                                {action.label}
                            </Button>
                        ))}
                    </div>
                )}
            </div>

            {notification.closable && (
                <ToolbarButton
                    size="xs"
                    onClick={(event) => {
                        event.stopPropagation();
                        onClose();
                    }}
                    className="-mr-1 -mt-1 flex-shrink-0"
                    aria-label={t("common.close")}
                >
                    <X className="h-3.5 w-3.5" />
                </ToolbarButton>
            )}
        </div>
    );
}

export interface NotificationContainerProps {
    /**
     * Width of the column the stack keeps clear on the right, in px - the right selector rail.
     * That rail is a permanent column of controls, and a toast parked over it takes them away for
     * as long as it is up.
     */
    rightInset?: number;
    /** Height reserved at the bottom, in px - the status bar, when it is shown. */
    bottomInset?: number;
}

/**
 * Notification container
 *
 * Shows the active notifications in the top-right corner, inside the box left over by the title
 * bar, the status bar and the right selector rail. Cards beyond what that box holds wait their
 * turn instead of being drawn over the window chrome - see ./notificationStack.
 */
export function NotificationContainer({ rightInset = 0, bottomInset = 0 }: NotificationContainerProps = {}) {
    const { context } = useWorkspace();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [available, setAvailable] = useState(0);
    const [heights, setHeights] = useState<Record<string, number>>({});
    const containerRef = useRef<HTMLDivElement>(null);
    const cardRefs = useRef(new Map<string, HTMLElement>());

    useEffect(() => {
        if (!context) return;

        const uiService = context.services.get<UIService>(Services.UI);
        const store = uiService.getStore();

        // Initial state
        setNotifications(store.getNotifications());

        // Subscribe to changes
        const events = uiService.getEvents();
        const unsubscribe = events.on("stateChanged", (changes) => {
            if (changes.notifications) {
                setNotifications([...changes.notifications]);
            }
        });

        return unsubscribe;
    }, [context]);

    // The box the stack has to live in. Watched rather than measured once: the window resizes, and
    // the status bar comes and goes.
    useLayoutEffect(() => {
        const element = containerRef.current;
        if (!element) {
            return;
        }
        const update = () => setAvailable(element.clientHeight);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, [notifications.length === 0]);

    // Every card is mounted, queued ones included: a card's height is what decides whether it fits,
    // and there is no way to ask for that without laying it out. The queued ones are taken out of
    // the flow and left unpainted, so they measure without showing.
    useLayoutEffect(() => {
        setHeights(previous => {
            const next: Record<string, number> = {};
            for (const notification of notifications) {
                const element = cardRefs.current.get(notification.id);
                next[notification.id] = element ? element.offsetHeight : 0;
            }
            const ids = Object.keys(next);
            if (ids.length === Object.keys(previous).length && ids.every(id => previous[id] === next[id])) {
                return previous;
            }
            return next;
        });
    });

    const registerCard = useCallback((id: string) => (element: HTMLElement | null) => {
        if (element) {
            cardRefs.current.set(id, element);
        } else {
            cardRefs.current.delete(id);
        }
    }, []);

    if (notifications.length === 0 || !context) {
        return null;
    }

    const shown = visibleCardCount(notifications.map(n => heights[n.id] ?? 0), CARD_GAP, available);

    return (
        <div
            ref={containerRef}
            aria-live="polite"
            style={{ right: rightInset + STACK_MARGIN, bottom: bottomInset + STACK_MARGIN }}
            className={cn(
                "fixed top-[calc(var(--nl-window-titlebar-height)+1rem)] z-50",
                "flex flex-col items-end gap-2 overflow-hidden pointer-events-none",
            )}
        >
            {notifications.map((notification, index) => {
                const queued = index >= shown;
                return (
                    <div
                        key={notification.id}
                        ref={registerCard(notification.id)}
                        aria-hidden={queued || undefined}
                        className={cn("pointer-events-auto", queued && "absolute invisible pointer-events-none")}
                    >
                        <NotificationItem
                            notification={notification}
                            presented={!queued}
                            onClose={() => {
                                const uiService = context.services.get<UIService>(Services.UI);
                                uiService.notifications.close(notification.id);
                            }}
                        />
                    </div>
                );
            })}
        </div>
    );
}
