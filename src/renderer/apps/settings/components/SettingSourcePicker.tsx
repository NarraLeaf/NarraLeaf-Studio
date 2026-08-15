import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/lib/components/elements/Button";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { matchedSourcePreset } from "@/lib/settings/sourceSelection";

/**
 * Download-source chooser for a `SettingValueType.Source` row: the sources Studio knows the address
 * of, then a field for one it does not.
 *
 * Its own control rather than a `Select` because the last row of the menu *is* the field. A plain
 * dropdown can only offer "custom" as a choice and reveal an input elsewhere, which asks the author
 * to answer a question ("what kind of address?") before they are allowed to give the answer they
 * came with. Here the two are the same gesture: open, and either take one of the named sources or
 * type over the address.
 *
 * The stored value is a plain string and stays that: an offered source stores its own URL, the
 * official one stores `""` (see `OFFICIAL_SOURCE_VALUE`), and a typed address stores itself.
 */

const PANEL_MIN_WIDTH_PX = 320;
const PANEL_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

interface SettingSourcePickerProps {
    value: string;
    /** Offered addresses, in the order they should read. `""` is the official source. */
    presets: readonly string[];
    /** Localized label per offered address; falls back to the address itself. */
    presetLabels?: Record<string, string>;
    onChange: (value: string) => void;
    disabled?: boolean;
    /** The settings row's title — the trigger's own text is the chosen source, not the question. */
    ariaLabel?: string;
}

export function SettingSourcePicker({
    value,
    presets,
    presetLabels,
    onChange,
    disabled = false,
    ariaLabel,
}: SettingSourcePickerProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
    /**
     * What the field holds while the menu is open. Separate from `value` because a half-typed
     * address is not a setting: nothing is stored until it is committed.
     */
    const [draft, setDraft] = useState("");

    const triggerRef = useRef<HTMLDivElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    /** Read by the close path, which must not depend on a state update landing first. */
    const draftRef = useRef("");
    draftRef.current = draft;

    const selectedPreset = matchedSourcePreset(value, presets);
    const presetLabel = useCallback(
        (preset: string) => presetLabels?.[preset] ?? preset,
        [presetLabels],
    );

    const commit = useCallback(
        (next: string) => {
            if (next !== value) {
                onChange(next);
            }
        },
        [onChange, value],
    );

    /**
     * Close, keeping a typed address.
     *
     * Every other field in this window persists what was typed into it when it loses focus, and a
     * menu dismissed by clicking elsewhere is that same gesture: an author who typed an address and
     * clicked away meant the address, not the dismissal. Escape is the way to leave without it, and
     * it discards by not coming through here.
     */
    const close = useCallback(() => {
        const typed = draftRef.current.trim();
        setOpen(false);
        setDraft("");
        if (typed.length > 0) {
            commit(typed);
        }
    }, [commit]);

    const abandon = useCallback(() => {
        setOpen(false);
        setDraft("");
    }, []);

    const choosePreset = useCallback(
        (preset: string) => {
            // Chosen from the list, so whatever was half-typed is not what the author wants.
            setDraft("");
            setOpen(false);
            commit(preset);
        },
        [commit],
    );

    const toggle = useCallback(() => {
        if (disabled) {
            return;
        }
        if (open) {
            close();
            return;
        }
        // Seeded with the stored address when it is one the author typed, so the field opens on
        // what it is about to replace rather than making them retype an address to edit one word.
        setDraft(selectedPreset === null ? value : "");
        setOpen(true);
    }, [close, disabled, open, selectedPreset, value]);

    // Dismiss on a click anywhere that is neither the trigger nor the panel. Capture phase, like
    // every other menu in Studio, so a click on a control underneath does not act before we close.
    useEffect(() => {
        if (!open) {
            return;
        }
        const onPointerDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
                return;
            }
            close();
        };
        document.addEventListener("mousedown", onPointerDown, true);
        return () => document.removeEventListener("mousedown", onPointerDown, true);
    }, [close, open]);

    // Fixed-position portal rather than an absolute child: this row lives in a scrolling pane inside
    // a window that hides its overflow, so a panel anchored in the flow is clipped - and this one
    // has to be wider than the trigger, because an address is longer than a name.
    useLayoutEffect(() => {
        if (!open) {
            setPanelStyle({});
            return;
        }
        const place = () => {
            const trigger = triggerRef.current?.getBoundingClientRect();
            if (!trigger) {
                return;
            }
            const width = Math.min(
                Math.max(trigger.width, PANEL_MIN_WIDTH_PX),
                Math.max(PANEL_MIN_WIDTH_PX, window.innerWidth - VIEWPORT_MARGIN_PX * 2),
            );
            const left = Math.min(
                Math.max(VIEWPORT_MARGIN_PX, trigger.right - width),
                Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - width - VIEWPORT_MARGIN_PX),
            );
            const spaceBelow = window.innerHeight - trigger.bottom - PANEL_GAP_PX - VIEWPORT_MARGIN_PX;
            const spaceAbove = trigger.top - PANEL_GAP_PX - VIEWPORT_MARGIN_PX;
            const openAbove = spaceBelow < spaceAbove && spaceBelow < 160;
            setPanelStyle({
                position: "fixed",
                width,
                left,
                maxHeight: Math.max(120, openAbove ? spaceAbove : spaceBelow),
                ...(openAbove
                    ? { bottom: Math.max(VIEWPORT_MARGIN_PX, window.innerHeight - trigger.top + PANEL_GAP_PX) }
                    : { top: trigger.bottom + PANEL_GAP_PX }),
                zIndex: 100,
            });
        };
        place();
        window.addEventListener("resize", place);
        window.addEventListener("scroll", place, true);
        return () => {
            window.removeEventListener("resize", place);
            window.removeEventListener("scroll", place, true);
        };
    }, [open]);

    useEffect(() => {
        if (open) {
            inputRef.current?.focus();
        }
    }, [open]);

    const triggerLabel = selectedPreset !== null ? presetLabel(selectedPreset) : value;

    const panel = open ? (
        <div
            ref={panelRef}
            className="flex flex-col overflow-hidden rounded-md border border-edge-strong bg-surface-raised py-1 shadow-lg"
            style={panelStyle}
        >
            <div role="listbox" aria-label={ariaLabel} className="min-h-0 overflow-y-auto">
                {presets.map(preset => {
                    const selected = preset === selectedPreset;
                    return (
                        <div
                            key={preset || "official"}
                            role="option"
                            aria-selected={selected}
                            // Mouse-down rather than click: the field owns focus, and a click would
                            // take it away first - closing the panel before the row is chosen.
                            onMouseDown={event => {
                                event.preventDefault();
                                choosePreset(preset);
                            }}
                            className="flex cursor-default items-center gap-2 px-3 py-1.5 hover:bg-fill-subtle"
                        >
                            <Check
                                className={cn("h-3.5 w-3.5 shrink-0", selected ? "text-primary" : "opacity-0")}
                                aria-hidden
                            />
                            <span className="min-w-0 flex-1 truncate text-sm text-fg">{presetLabel(preset)}</span>
                        </div>
                    );
                })}
            </div>
            {/* The last row is the field itself. The tick beside it says the address in it is the
                one in use, which is the only thing the list above cannot show for a typed one. */}
            <div className="mt-1 flex items-center gap-2 border-t border-edge-subtle px-3 pb-0.5 pt-2">
                <Check
                    className={cn("h-3.5 w-3.5 shrink-0", selectedPreset === null ? "text-primary" : "opacity-0")}
                    aria-hidden
                />
                <input
                    ref={inputRef}
                    type="text"
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                    onKeyDown={event => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            close();
                            return;
                        }
                        if (event.key === "Escape") {
                            // Stopped here rather than left to bubble: the draft is this popover's
                            // state, and Escape dropping it is what the key means while it is open.
                            event.preventDefault();
                            event.stopPropagation();
                            abandon();
                        }
                    }}
                    placeholder="https://"
                    aria-label={ariaLabel}
                    className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
                />
            </div>
        </div>
    ) : null;

    return (
        <div ref={triggerRef} className="relative w-full min-w-0">
            <Button
                variant="ghost"
                size="sm"
                fullWidth
                disabled={disabled}
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={toggle}
                className={cn(
                    "min-w-0 justify-between border border-edge-strong bg-fill-subtle hover:bg-fill",
                    open && "border-primary ring-2 ring-primary/20",
                )}
            >
                <span className="min-w-0 flex-1 truncate text-left text-fg">{triggerLabel}</span>
                <ChevronDown
                    className={cn("h-4 w-4 shrink-0 text-fg-muted transition-transform duration-150", open && "rotate-180")}
                />
            </Button>
            {panel && createPortal(panel, document.body)}
        </div>
    );
}
