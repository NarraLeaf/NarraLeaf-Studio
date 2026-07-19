import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { formatStorySecondsValue, storySecondsToMs } from "@shared/utils/storyTime";

const MODE_BTN = "h-7 px-2.5 text-xs transition-colors";

/**
 * Small config popover for an inline Pause, mirroring the NLR Pause interface: either
 * "click to proceed" (`new Pause()`) or "wait for" a fixed duration (`Pause.wait(ms)`).
 * `value` stays in milliseconds to match the stored run; the author reads and types seconds.
 */
export function PausePopover(props: {
    anchor: { top: number; left: number; bottom: number };
    value: number | true;
    onChange: (pause: number | true) => void;
    onRemove: () => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
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
            className="fixed z-[70] w-56 rounded-lg border border-edge bg-surface-raised p-2 shadow-2xl"
            style={{ top, left: Math.max(8, left) }}
            onMouseDown={event => event.stopPropagation()}
        >
                <div className="mb-1.5 text-2xs font-medium tracking-wide text-fg-muted">{t("story.pause.title")}</div>
                <div className="mb-2 inline-flex overflow-hidden rounded-md border border-edge bg-surface">
                    <button
                        type="button"
                        className={[MODE_BTN, !isWait ? "bg-primary/20 text-primary" : "text-fg-muted hover:bg-fill-subtle"].join(" ")}
                        onClick={() => props.onChange(true)}
                    >
                        {t("story.pause.clickToProceed")}
                    </button>
                    <button
                        type="button"
                        className={[MODE_BTN, "border-l border-edge", isWait ? "bg-primary/20 text-primary" : "text-fg-muted hover:bg-fill-subtle"].join(" ")}
                        onClick={() => props.onChange(ms)}
                    >
                        {t("story.pause.waitFor")}
                    </button>
                </div>
                {isWait ? (
                    <div className="flex items-center gap-1.5">
                        <NumericDraftEnhancedInput
                            committedDisplay={formatStorySecondsValue(ms)}
                            onFiniteNumber={seconds => props.onChange(Math.max(0, storySecondsToMs(seconds)))}
                            onEmpty={() => props.onChange(0)}
                            type="text"
                            inputMode="decimal"
                            autoFocus
                            popoverWhenNarrow={false}
                            className="w-24"
                            inputClassName="h-8 rounded-md border border-edge bg-surface-raised px-2 text-sm text-fg outline-none focus:border-primary/50"
                        />
                        <span className="text-xs text-fg-muted">{t("story.pause.seconds")}</span>
                    </div>
                ) : (
                    <div className="text-2xs text-fg-subtle">{t("story.pause.clickHint")}</div>
                )}
                <button
                    type="button"
                    className="mt-2 flex items-center gap-1 text-xs text-fg-muted transition-colors hover:text-danger"
                    onClick={props.onRemove}
                >
                    <Trash2 className="h-3 w-3" />
                    {t("story.pause.remove")}
                </button>
        </div>,
        document.body,
    );
}
