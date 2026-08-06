import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { HelpContent } from "./HelpContent";
import { getHelpTopic, helpTitleKey, type HelpTopic, type HelpTopicId } from "./helpTopics";
import { currentTopic, popTopic, previousTopic, pushTopic, startTrail, type HelpTrail } from "./helpTrail";
import { registerHelpOpener, startHelpPointerTracking, type HelpRequest } from "./helpController";

/**
 * The help popover: one per window, mounted once, invisible until something asks for a topic.
 *
 * Transient by design (docs/help-system.md §5). It is anchored to the surface it describes, it
 * closes on Escape or on a click anywhere else, and it reserves no space. There is no pinned mode
 * and no dock: reading the whole topic set is what the browser is for, and this offers the way
 * there rather than growing into it.
 */

const WIDTH_PX = 340;
const GAP_PX = 8;
const MARGIN_PX = 12;

export interface HelpOverlayProps {
    /** Shows the "All topics" footer when given; the workspace opens its help tab here. */
    onOpenBrowser?: () => void;
    /** Chord resolver handed to {@link HelpContent} - the workspace passes its keybinding service. */
    resolveShortcut?: (catalogId: string) => string | undefined;
}

/** One visit to the popover: where it points, and the trail followed since it opened. */
interface HelpSession {
    trail: HelpTrail;
    anchor: HTMLElement | null;
}

export function HelpOverlay({ onOpenBrowser, resolveShortcut }: HelpOverlayProps) {
    const { t } = useTranslation();
    const [session, setSession] = useState<HelpSession | null>(null);
    const [style, setStyle] = useState<React.CSSProperties | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);

    const previousId = session ? previousTopic(session.trail) : undefined;
    const topic: HelpTopic | undefined = getHelpTopic(session ? currentTopic(session.trail) : undefined);

    useEffect(
        () =>
            // A request from outside starts a fresh trail: `F1` somewhere else is a new question,
            // not a continuation of the one on screen.
            registerHelpOpener((request: HelpRequest) =>
                setSession({ trail: startTrail(request.topicId), anchor: request.anchor }),
            ),
        [],
    );
    useEffect(() => startHelpPointerTracking(), []);

    const close = useCallback(() => setSession(null), []);

    const back = useCallback(() => {
        setSession(current => (current ? { ...current, trail: popTopic(current.trail) } : current));
    }, []);

    // Escape closes and Alt+Left steps back, both at capture so an editor that listens for the same
    // keys does not take them first. Alt+Left is only claimed when there is somewhere to go, so it
    // still reaches whatever else wants it when this is the first topic of a visit.
    useEffect(() => {
        if (!session) {
            return;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
                return;
            }
            if (event.key === "ArrowLeft" && event.altKey && previousTopic(session.trail)) {
                event.preventDefault();
                event.stopPropagation();
                back();
            }
        };
        document.addEventListener("keydown", onKeyDown, true);
        return () => document.removeEventListener("keydown", onKeyDown, true);
    }, [session, close, back]);

    // Any pointer press outside the panel dismisses. `mousedown` rather than `click` so the press
    // that starts an edit elsewhere is not also spent on closing this.
    useEffect(() => {
        if (!session) {
            return;
        }
        const onMouseDown = (event: MouseEvent) => {
            if (panelRef.current && event.target instanceof Node && !panelRef.current.contains(event.target)) {
                close();
            }
        };
        document.addEventListener("mousedown", onMouseDown, true);
        return () => document.removeEventListener("mousedown", onMouseDown, true);
    }, [session, close]);

    /**
     * Beside the anchor if it fits, below it otherwise, centred when there is no anchor. Measured
     * after the first paint because the panel's height depends on the topic; until then the panel is
     * rendered hidden rather than at a wrong position, which would show as a jump.
     */
    useLayoutEffect(() => {
        if (!session) {
            setStyle(null);
            return;
        }

        const place = () => {
            const height = panelRef.current?.getBoundingClientRect().height ?? 0;
            const anchor = session.anchor?.isConnected ? session.anchor.getBoundingClientRect() : null;

            if (!anchor) {
                setStyle({
                    position: "fixed",
                    left: Math.max(MARGIN_PX, (window.innerWidth - WIDTH_PX) / 2),
                    top: Math.max(MARGIN_PX, (window.innerHeight - height) / 2),
                    width: WIDTH_PX,
                });
                return;
            }

            const roomRight = window.innerWidth - anchor.right - GAP_PX - MARGIN_PX;
            const roomLeft = anchor.left - GAP_PX - MARGIN_PX;
            const left = roomRight >= WIDTH_PX
                ? anchor.right + GAP_PX
                : roomLeft >= WIDTH_PX
                    ? anchor.left - GAP_PX - WIDTH_PX
                    : Math.max(MARGIN_PX, Math.min(anchor.left, window.innerWidth - MARGIN_PX - WIDTH_PX));

            const top = Math.max(
                MARGIN_PX,
                Math.min(anchor.top, window.innerHeight - MARGIN_PX - height),
            );

            setStyle({ position: "fixed", left, top, width: WIDTH_PX });
        };

        place();
        const raf = requestAnimationFrame(place);
        window.addEventListener("resize", place);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", place);
        };
        // Re-measured on every step of the trail, not just when the popover opens: topics differ in
        // height, and near the bottom of the window a taller one has to be clamped upward or it
        // would run off the edge.
    }, [session]);

    const openRelated = useCallback((id: HelpTopicId) => {
        setSession(current =>
            current
                ? { ...current, trail: pushTopic(current.trail, id) }
                : { trail: startTrail(id), anchor: null },
        );
    }, []);

    if (!session || !topic) {
        return null;
    }

    return createPortal(
        <div
            ref={panelRef}
            role="dialog"
            aria-label={t(helpTitleKey(topic.id))}
            style={style ?? { position: "fixed", top: 0, left: 0, width: WIDTH_PX, visibility: "hidden" }}
            className={cn(
                "z-[120] max-h-[min(60vh,520px)] overflow-y-auto rounded-lg border border-edge",
                "bg-surface-overlay shadow-2xl",
            )}
        >
            <div className="flex items-start gap-2 px-3 pt-3">
                {/* Absent on the first topic of a visit, rather than present and disabled: a greyed
                    arrow beside a title is a control asking to be read, and there is nothing to say
                    about it. The gap it leaves is reclaimed by the title, which is what the row is
                    for. Named after where it goes, so it answers "back to what" before the click. */}
                {previousId && (
                    <button
                        type="button"
                        onClick={back}
                        aria-label={t("help.ui.backTo", { title: t(helpTitleKey(previousId)) })}
                        className="-ml-1 -mt-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-fill hover:text-fg"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                )}
                <span className="min-w-0 flex-1 text-sm font-medium text-fg">{t(helpTitleKey(topic.id))}</span>
                <button
                    type="button"
                    onClick={close}
                    aria-label={t("help.ui.close")}
                    className="-mr-1 -mt-0.5 flex h-6 w-6 shrink-0 cursor-default items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-fill hover:text-fg"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            <HelpContent
                topic={topic}
                resolveShortcut={resolveShortcut}
                onOpenTopic={openRelated}
                className="px-3 pb-3 pt-2"
            />

            {onOpenBrowser && (
                <div className="border-t border-edge-subtle px-3 py-2">
                    <button
                        type="button"
                        onClick={() => {
                            close();
                            onOpenBrowser();
                        }}
                        // Same hover behaviour as the links inside the body: it navigates, so it
                        // takes the pointer and the underline. It keeps the muted colour because it
                        // is the footer's secondary way out, not a peer of the "See also" links.
                        className="cursor-pointer text-2xs text-fg-muted underline-offset-2 transition-colors hover:text-fg hover:underline"
                    >
                        {t("help.ui.allTopics")}
                    </button>
                </div>
            )}
        </div>,
        document.body,
    );
}
