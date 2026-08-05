import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { HelpContent } from "./HelpContent";
import { getHelpTopic, helpTitleKey, type HelpTopic, type HelpTopicId } from "./helpTopics";
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

export function HelpOverlay({ onOpenBrowser, resolveShortcut }: HelpOverlayProps) {
    const { t } = useTranslation();
    const [request, setRequest] = useState<HelpRequest | null>(null);
    const [style, setStyle] = useState<React.CSSProperties | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);

    const topic: HelpTopic | undefined = getHelpTopic(request?.topicId);

    useEffect(() => registerHelpOpener(setRequest), []);
    useEffect(() => startHelpPointerTracking(), []);

    const close = useCallback(() => setRequest(null), []);

    // Escape closes, at capture, so an editor that also listens for Escape does not eat it first.
    useEffect(() => {
        if (!request) {
            return;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
            }
        };
        document.addEventListener("keydown", onKeyDown, true);
        return () => document.removeEventListener("keydown", onKeyDown, true);
    }, [request, close]);

    // Any pointer press outside the panel dismisses. `mousedown` rather than `click` so the press
    // that starts an edit elsewhere is not also spent on closing this.
    useEffect(() => {
        if (!request) {
            return;
        }
        const onMouseDown = (event: MouseEvent) => {
            if (panelRef.current && event.target instanceof Node && !panelRef.current.contains(event.target)) {
                close();
            }
        };
        document.addEventListener("mousedown", onMouseDown, true);
        return () => document.removeEventListener("mousedown", onMouseDown, true);
    }, [request, close]);

    /**
     * Beside the anchor if it fits, below it otherwise, centred when there is no anchor. Measured
     * after the first paint because the panel's height depends on the topic; until then the panel is
     * rendered hidden rather than at a wrong position, which would show as a jump.
     */
    useLayoutEffect(() => {
        if (!request) {
            setStyle(null);
            return;
        }

        const place = () => {
            const height = panelRef.current?.getBoundingClientRect().height ?? 0;
            const anchor = request.anchor?.isConnected ? request.anchor.getBoundingClientRect() : null;

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
    }, [request]);

    const openRelated = useCallback((id: HelpTopicId) => {
        setRequest(current => (current ? { ...current, topicId: id } : { topicId: id, anchor: null }));
    }, []);

    if (!request || !topic) {
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
                        className="cursor-default text-2xs text-fg-muted transition-colors hover:text-fg"
                    >
                        {t("help.ui.allTopics")}
                    </button>
                </div>
            )}
        </div>,
        document.body,
    );
}
