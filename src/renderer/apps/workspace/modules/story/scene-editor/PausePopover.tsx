import { useEffect } from "react";
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

    const top = Math.min(props.anchor.bottom + 6, window.innerHeight - 140);
    const left = Math.min(props.anchor.left, window.innerWidth - 236);

    return createPortal(
        <>
            <div className="fixed inset-0 z-[60]" onMouseDown={props.onClose} />
            <div
                className="fixed z-[70] w-56 rounded-lg border border-white/15 bg-[#16191e] p-2 shadow-2xl"
                style={{ top, left: Math.max(8, left) }}
                onMouseDown={event => event.stopPropagation()}
            >
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">Pause</div>
                <div className="mb-2 inline-flex overflow-hidden rounded-md border border-white/10 bg-[#101216]">
                    <button
                        type="button"
                        className={[MODE_BTN, !isWait ? "bg-primary/20 text-primary" : "text-slate-400 hover:bg-white/[0.05]"].join(" ")}
                        onClick={() => props.onChange(true)}
                    >
                        Click to proceed
                    </button>
                    <button
                        type="button"
                        className={[MODE_BTN, "border-l border-white/10", isWait ? "bg-primary/20 text-primary" : "text-slate-400 hover:bg-white/[0.05]"].join(" ")}
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
                            className="h-8 w-24 rounded-md border border-white/10 bg-[#1e1f22] px-2 text-sm text-slate-100 outline-none focus:border-primary/50"
                            onChange={event => props.onChange(Math.max(0, Math.round(Number(event.target.value) || 0)))}
                        />
                        <span className="text-xs text-slate-400">ms</span>
                    </div>
                ) : (
                    <div className="text-[11px] text-slate-500">Waits until the player clicks to continue.</div>
                )}
                <button
                    type="button"
                    className="mt-2 flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-red-300"
                    onClick={props.onRemove}
                >
                    <Trash2 className="h-3 w-3" />
                    Remove pause
                </button>
            </div>
        </>,
        document.body,
    );
}
