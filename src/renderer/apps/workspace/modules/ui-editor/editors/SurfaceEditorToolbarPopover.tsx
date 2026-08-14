import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { useHostWindow } from "@/lib/components/layout";

const PANEL_VIEWPORT_PADDING = 8;
const PANEL_GAP = 4;

/**
 * Fixed popover position (viewport / client coordinates) for a trigger + measured panel.
 * Prefers below the trigger; flips above when needed. Aligns to trigger left edge, or right-aligns
 * when overflowing the window (typical for a top-right toolbar).
 *
 * `viewport` is passed rather than read off a global: a detached editor draws this same subtree in
 * a second window, where the opener's dimensions are the wrong ones to fit a panel into.
 */
export function computeToolbarPopoverClientPosition(
    trigger: DOMRect,
    panel: DOMRect,
    viewport: { width: number; height: number },
): { x: number; y: number } {
    const vw = viewport.width;
    const vh = viewport.height;
    const pw = panel.width;
    const ph = panel.height;
    const p = PANEL_VIEWPORT_PADDING;
    const g = PANEL_GAP;

    let x = trigger.left;
    if (x + pw > vw - p) {
        x = trigger.right - pw;
    }
    x = Math.min(x, vw - pw - p);
    x = Math.max(p, x);

    let y = trigger.bottom + g;
    if (y + ph > vh - p) {
        const yFlip = trigger.top - g - ph;
        if (yFlip >= p) {
            y = yFlip;
        } else {
            y = Math.max(p, vh - ph - p);
        }
    }
    y = Math.max(p, Math.min(y, vh - ph - p));

    return { x, y };
}

export type SurfaceToolbarPopover = {
    open: boolean;
    toggle: () => void;
    close: () => void;
    triggerRef: RefObject<HTMLButtonElement | null>;
    panelRef: RefObject<HTMLDivElement | null>;
    position: { x: number; y: number };
};

/**
 * Open/close state, outside-click and Escape dismissal, and flip-aware positioning for a canvas
 * toolbar dropdown. Shared by every dropdown in the surface editor toolbar so they dismiss and
 * position identically.
 *
 * `contentKey` re-measures the panel when the content changes size (a menu whose rows come and go
 * would otherwise keep the position it was first measured at).
 */
export function useSurfaceToolbarPopover(contentKey?: unknown): SurfaceToolbarPopover {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    // Every reach past this subtree - the window it is measured against, the document its dismissal
    // listens on - goes to the window the author is actually looking at. In a detached editor that
    // is not the renderer's own: a bare `document` there is the opener's, so the panel would be
    // sized to the wrong viewport and neither a click outside nor Escape in the detached window
    // would ever reach a listener.
    const hostWindow = useHostWindow();

    const close = useCallback(() => setOpen(false), []);
    const toggle = useCallback(() => setOpen(v => !v), []);

    useLayoutEffect(() => {
        if (!open) {
            return undefined;
        }

        const updatePosition = () => {
            const triggerEl = triggerRef.current;
            const panelEl = panelRef.current;
            if (!triggerEl || !panelEl) {
                return;
            }
            const next = computeToolbarPopoverClientPosition(
                triggerEl.getBoundingClientRect(),
                panelEl.getBoundingClientRect(),
                { width: hostWindow.innerWidth, height: hostWindow.innerHeight },
            );
            setPosition(prev => (prev.x === next.x && prev.y === next.y ? prev : next));
        };

        updatePosition();

        hostWindow.addEventListener("resize", updatePosition);
        hostWindow.addEventListener("scroll", updatePosition, true);
        return () => {
            hostWindow.removeEventListener("resize", updatePosition);
            hostWindow.removeEventListener("scroll", updatePosition, true);
        };
    }, [contentKey, hostWindow, open]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const handlePointerDown = (e: MouseEvent) => {
            const target = e.target as Node | null;
            if (!target) {
                return;
            }
            if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
                return;
            }
            close();
        };
        // Deferred so the click that opened the panel does not immediately close it.
        const timer = hostWindow.setTimeout(() => {
            hostWindow.document.addEventListener("mousedown", handlePointerDown, true);
        }, 0);
        return () => {
            hostWindow.clearTimeout(timer);
            hostWindow.document.removeEventListener("mousedown", handlePointerDown, true);
        };
    }, [close, hostWindow, open]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                close();
            }
        };
        hostWindow.document.addEventListener("keydown", onKey);
        return () => hostWindow.document.removeEventListener("keydown", onKey);
    }, [close, hostWindow, open]);

    return { open, toggle, close, triggerRef, panelRef, position };
}

export type SurfaceToolbarPopoverPanelProps = {
    popover: SurfaceToolbarPopover;
    children: ReactNode;
    /** Marker attribute for tests and acceptance probes. */
    dataAttribute?: string;
    className?: string;
};

/** Portalled panel body for {@link useSurfaceToolbarPopover}. Renders nothing while closed. */
export function SurfaceToolbarPopoverPanel({
    popover,
    children,
    dataAttribute,
    className = "",
}: SurfaceToolbarPopoverPanelProps) {
    // The window this subtree is drawn in, not the one its React tree was created in. A detached
    // editor portals part of the workspace's tree into a second window; `document.body` there is
    // the opener's body, so the panel opens in the window the author is not looking at - which
    // from the detached window is indistinguishable from a menu that refuses to open.
    const hostWindow = useHostWindow();
    if (!popover.open || !hostWindow?.document) {
        return null;
    }
    return createPortal(
        <div
            ref={popover.panelRef}
            data-surface-toolbar-popover={dataAttribute ?? "true"}
            // Capped and scrollable: the device list is a dozen rows and the panel is positioned, not
            // laid out, so an over-tall one would run off the bottom of the window instead of fitting.
            className={`fixed z-50 max-h-[min(70vh,34rem)] min-w-[220px] overflow-y-auto rounded-md border border-edge bg-surface-raised py-2 shadow-lg ${className}`.trim()}
            style={{ left: popover.position.x, top: popover.position.y }}
            onMouseDown={e => e.stopPropagation()}
        >
            {children}
        </div>,
        hostWindow.document.body,
    );
}

export type SurfaceToolbarPopoverSectionProps = {
    label: string;
    children: ReactNode;
    /** First section sits flush against the panel's own padding. */
    first?: boolean;
};

/** Titled group of rows inside a toolbar popover. */
export function SurfaceToolbarPopoverSection({ label, children, first = false }: SurfaceToolbarPopoverSectionProps) {
    return (
        <div className={first ? "" : "mt-1 border-t border-edge pt-2"}>
            <div className="px-3 pb-1 text-2xs font-medium text-fg-subtle">{label}</div>
            {children}
        </div>
    );
}

export type SurfaceToolbarPopoverRowProps = {
    icon?: ReactNode;
    label: string;
    /** Rendered right-aligned; already formatted for the platform. */
    shortcut?: string;
    /** Draws a check in the leading slot. For rows that pick one of a set. */
    selected?: boolean;
    disabled?: boolean;
    onClick: () => void;
};

/**
 * One clickable row in a toolbar popover.
 *
 * Native `<button>`, so `focus:ring-*` would be silently dropped by the global `outline`/`box-shadow`
 * reset - the visible affordance here is the hover fill.
 */
export function SurfaceToolbarPopoverRow({
    icon,
    label,
    shortcut,
    selected = false,
    disabled = false,
    onClick,
}: SurfaceToolbarPopoverRowProps) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            aria-pressed={selected}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-fg transition-colors hover:bg-fill-subtle disabled:cursor-not-allowed disabled:opacity-50"
        >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-fg-muted">
                {selected ? <Check className="h-3.5 w-3.5 text-primary" /> : icon}
            </span>
            <span className="truncate">{label}</span>
            {shortcut ? <span className="ml-auto pl-4 tabular-nums text-2xs text-fg-subtle">{shortcut}</span> : null}
        </button>
    );
}
