import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";

const MODE_BTN = "h-7 px-2.5 text-xs transition-colors";

/**
 * Small config popover for an inline Pause, mirroring the NLR Pause interface: either
 * "click to proceed" (`new Pause()`) or "wait for" a fixed duration (`Pause.wait(ms)`).
 */
export function PausePopover(props: {
    anchor: { top: number; left: number; bottom: number };
    value: number | true;
    onChange: (pause: number | true) => void;
    onRemove: () => void;
    onClose: () => void;
}) {
    const isWait = props.value !== true;
    const ms = typeof props.value === "number" ? props.value : 300;
    const panelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                props.onClose();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [props]);

    // Light dismiss: close on any pointerdown outside the panel, but let the event fall through to
    // whatever was clicked (toolbar button, editor text) so leaving the popover keeps edit focus.
    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            if (panelRef.current?.contains(event.target as Node)) {
                return;
            }
            props.onClose();
        };
        globalThis.document.addEventListener("mousedown", onDown, true);
        return () => globalThis.document.removeEventListener("mousedown", onDown, true);
    }, [props]);

    const top = Math.min(props.anchor.bottom + 6, window.innerHeight - 140);
    const left = Math.min(props.anchor.left, window.innerWidth - 236);

    return createPortal(
        <div
            ref={panelRef}
            className="fixed z-[70] w-56 rounded-lg border border-edge bg-[#16191e] p-2 shadow-2xl"
            style={{ top, left: Math.max(8, left) }}
            onMouseDown={event => event.stopPropagation()}
        >
                <div className="mb-1.5 text-2xs font-medium tracking-wide text-fg-muted">Pause</div>
                <div className="mb-2 inline-flex overflow-hidden rounded-md border border-edge bg-[#101216]">
                    <button
                        type="button"
                        className={[MODE_BTN, !isWait ? "bg-primary/20 text-primary" : "text-fg-muted hover:bg-fill-subtle"].join(" ")}
                        onClick={() => props.onChange(true)}
                    >
                        Click to proceed
                    </button>
                    <button
                        type="button"
                        className={[MODE_BTN, "border-l border-edge", isWait ? "bg-primary/20 text-primary" : "text-fg-muted hover:bg-fill-subtle"].join(" ")}
                        onClick={() => props.onChange(ms)}
                    >
                        Wait for
                    </button>
                </div>
                {isWait ? (
                    <div className="flex items-center gap-1.5">
                        <input
                            type="number"
                            min={0}
                            value={ms}
                            autoFocus
                            className="h-8 w-24 rounded-md border border-edge bg-surface-raised px-2 text-sm text-fg outline-none focus:border-primary/50"
                            onChange={event => props.onChange(Math.max(0, Math.round(Number(event.target.value) || 0)))}
                        />
                        <span className="text-xs text-fg-muted">ms</span>
                    </div>
                ) : (
                    <div className="text-2xs text-fg-subtle">Waits until the player clicks to continue.</div>
                )}
                <button
                    type="button"
                    className="mt-2 flex items-center gap-1 text-xs text-fg-muted transition-colors hover:text-red-300"
                    onClick={props.onRemove}
                >
                    <Trash2 className="h-3 w-3" />
                    Remove pause
                </button>
        </div>,
        document.body,
    );
}
