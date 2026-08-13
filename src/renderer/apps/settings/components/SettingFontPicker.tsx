import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/lib/components/elements/Button";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import {
    EDITOR_FONT_PRESET_STACKS,
    editorFontCssFamily,
    isEditorFontPreset,
    type EditorFontFamilyPreset,
} from "@/lib/settings/editorFontOptions";
import { loadSystemFontFamilies, type SystemFontFamily, type SystemFontsResult } from "@/lib/settings/systemFonts";

/**
 * Font chooser for a `SettingValueType.Font` row: the four presets, then every family installed on
 * this computer, with a search box over the lot.
 *
 * Its own control rather than a `Select` for two reasons the dropdown cannot meet. A machine has
 * hundreds of families (689 on the author's, which is unremarkable), so the list has to be
 * searchable and virtualized — an unfiltered menu of that length is unusable, and rendering every
 * row in its own face makes Chromium load hundreds of fonts to paint a menu. And the option list is
 * *discovered*, asynchronously and fallibly, where `Select` takes a fixed array.
 */

const PANEL_MIN_WIDTH_PX = 300;
const PANEL_MAX_HEIGHT_PX = 380;
/**
 * Below what the panel stops being worth opening downwards — the search row plus about five fonts.
 *
 * The flip is decided against this rather than against the full height, which is the difference
 * between "there is no room down there" and "down there is not the *most* room". A row in the
 * middle of the pane has a few hundred pixels under it and slightly more above; measured against
 * 380 that reads as too little and throws the panel up over the window's own title bar, for a list
 * that would have been perfectly readable in the space it was already pointing at.
 */
const PANEL_MIN_USEFUL_HEIGHT_PX = 220;
const PANEL_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;
const FONT_ROW_HEIGHT_PX = 34;
const HEADER_ROW_HEIGHT_PX = 26;

type PickerRow =
    | { kind: "header"; key: string; label: string }
    | { kind: "font"; key: string; value: string; label: string; css: string; missing?: boolean };

interface SettingFontPickerProps {
    value: string;
    /** Preset ids offered above the installed fonts, in the order they should read. */
    presets: readonly string[];
    /** Localized label per preset id; falls back to the id itself. */
    presetLabels?: Record<string, string>;
    onChange: (value: string) => void;
    disabled?: boolean;
    /** The settings row's title — the trigger's own text is the chosen font, not the question. */
    ariaLabel?: string;
}

type LoadState =
    | { status: "idle" }
    | { status: "loading" }
    | SystemFontsResult;

function matches(needle: string, family: SystemFontFamily): boolean {
    if (family.family.toLowerCase().includes(needle)) {
        return true;
    }
    return family.aliases.some(alias => alias.toLowerCase().includes(needle));
}

export function SettingFontPicker({
    value,
    presets,
    presetLabels,
    onChange,
    disabled = false,
    ariaLabel,
}: SettingFontPickerProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [load, setLoad] = useState<LoadState>({ status: "idle" });
    const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
    /** Keyed rather than indexed: filtering reorders the list under the cursor. */
    const [activeKey, setActiveKey] = useState<string | null>(null);

    const triggerRef = useRef<HTMLDivElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const families = load.status === "ok" ? load.families : [];

    const presetLabel = useCallback(
        (preset: string) => presetLabels?.[preset] ?? preset,
        [presetLabels],
    );

    const rows = useMemo<PickerRow[]>(() => {
        const needle = query.trim().toLowerCase();
        const result: PickerRow[] = [];

        const matchedPresets = presets.filter(
            preset => !needle || preset.toLowerCase().includes(needle) || presetLabel(preset).toLowerCase().includes(needle),
        );
        if (matchedPresets.length > 0) {
            result.push({ kind: "header", key: "header:presets", label: t("settings.fontPicker.presets") });
            for (const preset of matchedPresets) {
                result.push({
                    kind: "font",
                    key: `preset:${preset}`,
                    value: preset,
                    label: presetLabel(preset),
                    css: EDITOR_FONT_PRESET_STACKS[preset as EditorFontFamilyPreset] ?? "inherit",
                });
            }
        }

        // A stored family this list does not contain still has to be shown, and still has to be the
        // selected row — dropping it would leave the trigger naming a font that nothing in the menu
        // claims is chosen, and the first arrow key would move "off" a selection that was never on.
        //
        // It is only *labelled* missing once the list is known to be complete: with the enumeration
        // refused or unsupported, an absent row means we did not look, not that the font is gone.
        const unlisted =
            !isEditorFontPreset(value) &&
            value.trim().length > 0 &&
            load.status !== "idle" &&
            load.status !== "loading" &&
            !families.some(family => family.family === value);
        if (unlisted && (!needle || value.toLowerCase().includes(needle))) {
            result.push({
                kind: "font",
                key: `unlisted:${value}`,
                value,
                label: value,
                css: editorFontCssFamily(value),
                missing: load.status === "ok",
            });
        }

        const matchedFamilies = needle ? families.filter(family => matches(needle, family)) : families;
        if (matchedFamilies.length > 0) {
            result.push({ kind: "header", key: "header:installed", label: t("settings.fontPicker.installed") });
            for (const family of matchedFamilies) {
                result.push({
                    kind: "font",
                    key: `font:${family.family}`,
                    value: family.family,
                    label: family.family,
                    css: editorFontCssFamily(family.family),
                });
            }
        }
        return result;
    }, [families, load.status, presetLabel, presets, query, t, value]);

    const selectableIndexes = useMemo(
        () => rows.reduce<number[]>((acc, row, index) => (row.kind === "font" ? [...acc, index] : acc), []),
        [rows],
    );

    const activeIndex = useMemo(() => {
        if (activeKey) {
            const found = rows.findIndex(row => row.key === activeKey);
            if (found >= 0) {
                return found;
            }
        }
        return selectableIndexes[0] ?? -1;
    }, [activeKey, rows, selectableIndexes]);

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => listRef.current,
        estimateSize: index => (rows[index]?.kind === "header" ? HEADER_ROW_HEIGHT_PX : FONT_ROW_HEIGHT_PX),
        overscan: 12,
        getItemKey: index => rows[index]?.key ?? index,
    });

    /**
     * Read the installed families.
     *
     * Called straight from the trigger's click handler and never from an effect: the API wants
     * transient user activation and a visible window, and an effect scheduled after a state update
     * can land outside both. See `systemFonts.ts`.
     */
    const beginLoad = useCallback(() => {
        if (load.status === "ok" || load.status === "loading") {
            return;
        }
        setLoad({ status: "loading" });
        void loadSystemFontFamilies().then(setLoad);
    }, [load.status]);

    const close = useCallback(() => {
        setOpen(false);
        setQuery("");
        setActiveKey(null);
    }, []);

    const commit = useCallback(
        (next: string) => {
            close();
            if (next !== value) {
                onChange(next);
            }
        },
        [close, onChange, value],
    );

    const toggle = useCallback(() => {
        if (disabled) {
            return;
        }
        if (open) {
            close();
            return;
        }
        beginLoad();
        setActiveKey(isEditorFontPreset(value) ? `preset:${value}` : `font:${value}`);
        setOpen(true);
    }, [beginLoad, close, disabled, open, value]);

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
    // a window that hides its overflow, so a 380px panel anchored in the flow is clipped long before
    // it has shown a useful number of fonts.
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
            const openAbove = spaceBelow < PANEL_MIN_USEFUL_HEIGHT_PX && spaceAbove > spaceBelow;
            const maxHeight = Math.max(120, Math.min(PANEL_MAX_HEIGHT_PX, openAbove ? spaceAbove : spaceBelow));
            setPanelStyle({
                position: "fixed",
                width,
                left,
                maxHeight,
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

    // Follow the keyboard cursor. Also runs when the list arrives, so a picker opened on a font far
    // down the alphabet shows it rather than opening at "A".
    useEffect(() => {
        if (!open || activeIndex < 0) {
            return;
        }
        virtualizer.scrollToIndex(activeIndex, { align: "auto" });
        // `virtualizer` is a new object every render; depending on it would re-scroll continuously.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, activeIndex, rows.length]);

    const moveActive = useCallback(
        (delta: number) => {
            if (selectableIndexes.length === 0) {
                return;
            }
            const current = selectableIndexes.indexOf(activeIndex);
            const nextPosition = current < 0
                ? (delta > 0 ? 0 : selectableIndexes.length - 1)
                : Math.min(selectableIndexes.length - 1, Math.max(0, current + delta));
            const nextRow = rows[selectableIndexes[nextPosition]];
            if (nextRow) {
                setActiveKey(nextRow.key);
            }
        },
        [activeIndex, rows, selectableIndexes],
    );

    const onKeyDown = useCallback(
        (event: React.KeyboardEvent) => {
            switch (event.key) {
                case "ArrowDown":
                    event.preventDefault();
                    moveActive(1);
                    return;
                case "ArrowUp":
                    event.preventDefault();
                    moveActive(-1);
                    return;
                case "PageDown":
                    event.preventDefault();
                    moveActive(8);
                    return;
                case "PageUp":
                    event.preventDefault();
                    moveActive(-8);
                    return;
                case "Enter": {
                    event.preventDefault();
                    const row = rows[activeIndex];
                    if (row?.kind === "font") {
                        commit(row.value);
                    }
                    return;
                }
                case "Escape":
                    // Stopped here rather than left to bubble: the query is this popover's state,
                    // and Escape closing the popover is the one thing the key means while it is open.
                    event.preventDefault();
                    event.stopPropagation();
                    close();
                    return;
                case "Tab":
                    close();
                    return;
                default:
            }
        },
        [activeIndex, close, commit, moveActive, rows],
    );

    const triggerLabel = isEditorFontPreset(value) ? presetLabel(value) : (value || presetLabel("Default"));

    const statusMessage = (() => {
        switch (load.status) {
            case "loading":
                return t("settings.fontPicker.loading");
            case "unsupported":
                return t("settings.fontPicker.unavailable");
            case "denied":
                return t("settings.fontPicker.denied");
            case "failed":
                return t("settings.fontPicker.failed", { message: load.message });
            default:
                return null;
        }
    })();

    const panel = open ? (
        <div
            ref={panelRef}
            className="flex flex-col overflow-hidden rounded-md border border-edge-strong bg-surface-raised shadow-lg"
            style={panelStyle}
        >
            <div className="flex shrink-0 items-center gap-2 border-b border-edge-subtle px-2.5 py-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={event => {
                        setQuery(event.target.value);
                        setActiveKey(null);
                    }}
                    onKeyDown={onKeyDown}
                    placeholder={t("settings.fontPicker.searchPlaceholder")}
                    aria-label={t("settings.fontPicker.searchPlaceholder")}
                    aria-controls="setting-font-picker-list"
                    aria-activedescendant={activeIndex >= 0 ? `setting-font-row-${rows[activeIndex]?.key}` : undefined}
                    className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
                />
                {query && (
                    <button
                        type="button"
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => {
                            setQuery("");
                            inputRef.current?.focus();
                        }}
                        className="rounded-md p-0.5 text-fg-subtle transition-colors hover:bg-fill hover:text-fg"
                        data-tip={t("common.clear")}
                        aria-label={t("common.clear")}
                    >
                        <X className="h-3 w-3" />
                    </button>
                )}
            </div>

            {statusMessage && (
                <p className="shrink-0 border-b border-edge-subtle px-3 py-2 text-xs text-fg-subtle">
                    {statusMessage}
                </p>
            )}

            {rows.length === 0 ? (
                load.status === "loading" ? null : (
                    <p className="px-3 py-3 text-xs text-fg-subtle">{t("settings.fontPicker.noMatches")}</p>
                )
            ) : (
                <div
                    ref={listRef}
                    id="setting-font-picker-list"
                    role="listbox"
                    aria-label={ariaLabel}
                    className="min-h-0 flex-1 overflow-y-auto py-1"
                >
                    {/* The sizer is scaffolding, not structure: without this the listbox would
                        announce one child holding every option. */}
                    <div role="presentation" className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                        {virtualizer.getVirtualItems().map(item => {
                            const row = rows[item.index];
                            if (!row) {
                                return null;
                            }
                            const common: CSSProperties = {
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: "100%",
                                height: item.size,
                                transform: `translateY(${item.start}px)`,
                            };
                            if (row.kind === "header") {
                                return (
                                    <div
                                        key={row.key}
                                        style={common}
                                        className="flex items-center px-3 text-xs font-semibold tracking-wider text-fg-muted"
                                    >
                                        {row.label}
                                    </div>
                                );
                            }
                            const selected = row.value === value;
                            const active = item.index === activeIndex;
                            return (
                                <div
                                    key={row.key}
                                    id={`setting-font-row-${row.key}`}
                                    role="option"
                                    aria-selected={selected}
                                    style={common}
                                    // Mouse-down rather than click: the search field owns focus and
                                    // the arrow keys, and a click would take it away first.
                                    onMouseDown={event => {
                                        event.preventDefault();
                                        commit(row.value);
                                    }}
                                    onMouseEnter={() => setActiveKey(row.key)}
                                    className={cn(
                                        "flex cursor-default items-center gap-2 px-3",
                                        active ? "bg-fill" : "hover:bg-fill-subtle",
                                    )}
                                >
                                    <Check
                                        className={cn("h-3.5 w-3.5 shrink-0", selected ? "text-primary" : "opacity-0")}
                                        aria-hidden
                                    />
                                    <span
                                        className="min-w-0 flex-1 truncate text-sm text-fg"
                                        style={{ fontFamily: row.css }}
                                    >
                                        {row.label}
                                    </span>
                                    {row.missing ? (
                                        <span className="shrink-0 text-2xs text-warning">
                                            {t("settings.fontPicker.notInstalled")}
                                        </span>
                                    ) : (
                                        <span
                                            className="shrink-0 text-xs text-fg-subtle"
                                            style={{ fontFamily: row.css }}
                                            aria-hidden
                                        >
                                            {t("settings.fontPicker.sample")}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
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
                <span
                    className="min-w-0 flex-1 truncate text-left text-fg"
                    style={{ fontFamily: editorFontCssFamily(value) }}
                >
                    {triggerLabel}
                </span>
                <ChevronDown
                    className={cn("h-4 w-4 shrink-0 text-fg-muted transition-transform duration-150", open && "rotate-180")}
                />
            </Button>
            {panel && createPortal(panel, document.body)}
        </div>
    );
}
