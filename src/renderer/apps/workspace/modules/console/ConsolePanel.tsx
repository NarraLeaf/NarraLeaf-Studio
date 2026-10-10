import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Download, ListFilter, Terminal, Trash2 } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { Checkbox } from "@/lib/components/elements";
import { Button } from "@/lib/components/elements";
import { useFloatingLayer, useHostWindow } from "@/lib/components/layout";
import { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import {
    ConsoleService,
    type ConsoleChannelDefinition,
    type ConsoleChannelId,
    type ConsoleEntry,
    type ConsoleLineSegment,
    type ConsoleLogLevel,
    type ConsoleProgress,
} from "@/lib/workspace/services/core/ConsoleService";
import { Services } from "@/lib/workspace/services/services";
import { useWorkspace } from "../../context";
import { tabStripOverflow, type StripOverflow } from "../../components/layout/tabStripOverflow";
import { tabStripRevealScrollLeft } from "../../components/layout/tabStripReveal";
import { PanelComponentProps } from "../types";
import { consoleChannelDescription, consoleChannelLabel, consoleSourceLabel } from "./consoleChannelText";
import { buildConsoleExportContent, consoleEntryText } from "./consoleExport";

type ConsolePanelState = {
    activeChannel?: ConsoleChannelId;
    visibleLevels?: ConsoleLogLevel[];
};

const LOG_LEVELS: readonly ConsoleLogLevel[] = ["error", "warning", "success", "info", "verbose"];
const DEFAULT_VISIBLE_LEVELS = new Set<ConsoleLogLevel>(["error", "warning", "success", "info"]);

/** Per-level text colour. Labels are translated via `console.level.<level>`. */
const LEVEL_TEXT_CLASS: Record<ConsoleLogLevel, string> = {
    error: "text-danger/75",
    warning: "text-warning/75",
    success: "text-success/75",
    info: "text-primary/75",
    verbose: "text-fg-subtle/80",
};

function isConsoleLogLevel(value: unknown): value is ConsoleLogLevel {
    return LOG_LEVELS.includes(value as ConsoleLogLevel);
}

function normalizeVisibleLevels(value: unknown): Set<ConsoleLogLevel> {
    if (!Array.isArray(value)) {
        return new Set(DEFAULT_VISIBLE_LEVELS);
    }
    const levels = value.filter(isConsoleLogLevel);
    return new Set<ConsoleLogLevel>(levels.length ? levels : [...LOG_LEVELS]);
}

/** Snapshot every registered channel's buffered entries, keyed by channel id. */
function readServiceEntries(service: ConsoleService | null): Record<ConsoleChannelId, ConsoleEntry[]> {
    const result: Record<ConsoleChannelId, ConsoleEntry[]> = {};
    for (const channel of service?.getChannels() ?? []) {
        result[channel.id] = service?.getEntries(channel.id) ?? [];
    }
    return result;
}

function formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

/** Suggested `console-<channel>-<timestamp>.log` filename for the export dialog. */
function buildExportFileName(channelId: ConsoleChannelId): string {
    const date = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    const safeChannel = channelId.replace(/[^a-zA-Z0-9._-]+/g, "-");
    return `console-${safeChannel}-${stamp}.log`;
}

/**
 * Console panel component.
 * Shows structured build/package and blueprint output from ConsoleService.
 */
export function ConsolePanel({ panelId }: PanelComponentProps) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const consoleService = useMemo(
        () => context?.services.get<ConsoleService>(Services.Console) ?? null,
        [context],
    );
    const panelStateService = useMemo(
        () => context?.services.get<PanelStateService>(Services.PanelState) ?? null,
        [context],
    );
    const uiService = useMemo(
        () => context?.services.get<UIService>(Services.UI) ?? null,
        [context],
    );

    const [channels, setChannels] = useState<readonly ConsoleChannelDefinition[]>(() => consoleService?.getChannels() ?? []);
    const [activeChannel, setActiveChannel] = useState<ConsoleChannelId>("build");
    const [visibleLevels, setVisibleLevels] = useState<Set<ConsoleLogLevel>>(() => new Set(DEFAULT_VISIBLE_LEVELS));
    const [filterMenuOpen, setFilterMenuOpen] = useState(false);
    const [entriesByChannel, setEntriesByChannel] = useState<Record<ConsoleChannelId, ConsoleEntry[]>>(() =>
        readServiceEntries(consoleService),
    );
    const [progressByChannel, setProgressByChannel] = useState<Record<ConsoleChannelId, ConsoleProgress | null>>({});
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const pageStripRef = useRef<HTMLDivElement | null>(null);
    const [pageStripOverflow, setPageStripOverflow] = useState<StripOverflow>({ left: false, right: false });
    const filterMenuRef = useRef<HTMLDivElement | null>(null);
    const filterMenuPanelRef = useRef<HTMLDivElement | null>(null);
    const hostWindow = useHostWindow();
    // The level filter is a popover: focus moves onto the first level when it opens, the arrows walk
    // the levels, Escape closes it and not the panel it sits in, Tab out of it closes it, and closing
    // gives focus back to the filter button.
    useFloatingLayer({
        open: filterMenuOpen,
        onClose: () => setFilterMenuOpen(false),
        panelRef: filterMenuPanelRef,
        ownerRefs: [filterMenuRef],
        itemSelector: "input[type=\"checkbox\"]",
    });
    const panelStateLoadedRef = useRef(false);

    useEffect(() => {
        if (!panelStateService) {
            return;
        }

        const stored = panelStateService.getPanelState<ConsolePanelState>(panelId);
        if (typeof stored?.activeChannel === "string" && stored.activeChannel.length > 0) {
            // Validated against the live channel list by the fallback effect below.
            setActiveChannel(stored.activeChannel);
        }
        setVisibleLevels(normalizeVisibleLevels(stored?.visibleLevels));
        panelStateLoadedRef.current = true;
    }, [panelId, panelStateService]);

    // A run that started before this panel mounted still gets its tab. Read after the stored state
    // above, so a standing request wins over the remembered tab - it is the more recent intent.
    // This runs on every mount, not just the first: `panels.show()` can remount the panel, and the
    // stored-state effect above would otherwise restore the tab the run was meant to replace.
    useEffect(() => {
        const pending = consoleService?.peekPendingFocusRequest();
        if (pending) {
            setActiveChannel(pending);
        }
    }, [consoleService]);

    useEffect(() => {
        if (!consoleService) {
            return;
        }
        return consoleService.onFocusRequested(({ channel }) => {
            setActiveChannel(channel);
        });
    }, [consoleService]);

    useEffect(() => {
        if (!panelStateService || !panelStateLoadedRef.current) {
            return;
        }
        panelStateService.setPanelState<ConsolePanelState>(panelId, {
            activeChannel,
            visibleLevels: [...visibleLevels],
        });
    }, [activeChannel, panelId, panelStateService, visibleLevels]);

    useEffect(() => {
        if (!consoleService) {
            return;
        }

        const sync = () => {
            setChannels(consoleService.getChannels());
            setEntriesByChannel(readServiceEntries(consoleService));
        };
        const syncProgress = () => {
            const next: Record<ConsoleChannelId, ConsoleProgress | null> = {};
            for (const channel of consoleService.getChannels()) {
                next[channel.id] = consoleService.getProgress(channel.id);
            }
            setProgressByChannel(next);
        };
        sync();
        syncProgress();
        const offEntries = consoleService.onEntriesChanged(sync);
        const offChannels = consoleService.onChannelsChanged(() => {
            sync();
            syncProgress();
        });
        const offProgress = consoleService.onProgressChanged(({ channel, progress }) => {
            setProgressByChannel(prev => ({ ...prev, [channel]: progress }));
        });
        return () => {
            offEntries();
            offChannels();
            offProgress();
        };
    }, [consoleService]);

    // Keep the active tab valid as channels come and go (e.g. the Story tab appears when a story
    // editor is open and is removed when the last one closes).
    useEffect(() => {
        if (channels.length === 0) {
            return;
        }
        if (!channels.some(channel => channel.id === activeChannel)) {
            setActiveChannel(channels[0].id);
        }
    }, [channels, activeChannel]);

    const activeChannelDef = channels.find(channel => channel.id === activeChannel) ?? null;
    const channelEntries = entriesByChannel[activeChannel] ?? [];
    const visibleLevelKey = useMemo(() => [...visibleLevels].sort().join("|"), [visibleLevels]);
    const visibleEntries = useMemo(
        () => channelEntries.filter(entry => visibleLevels.has(entry.level)),
        [channelEntries, visibleLevelKey, visibleLevels],
    );

    useEffect(() => {
        const el = scrollRef.current;
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
    }, [activeChannel, visibleEntries]);

    // The fades follow the page strip: its scroll, and anything that changes how much of it fits -
    // the dock being resized, a page registering or leaving.
    useEffect(() => {
        const strip = pageStripRef.current;
        if (!strip) {
            return;
        }
        const sync = () => {
            const next = tabStripOverflow(strip);
            setPageStripOverflow(prev => (prev.left === next.left && prev.right === next.right ? prev : next));
        };
        sync();
        strip.addEventListener("scroll", sync, { passive: true });
        const observer = new ResizeObserver(sync);
        observer.observe(strip);
        // The pages too: a count gaining a digit widens a page that has shrunk to its contents.
        for (const page of Array.from(strip.children)) {
            observer.observe(page);
        }
        return () => {
            strip.removeEventListener("scroll", sync);
            observer.disconnect();
        };
    }, [channels.length]);

    // The page being read stays in view when the strip scrolls: picked from the strip, or brought
    // forward by a run that asks for its own page.
    useLayoutEffect(() => {
        const strip = pageStripRef.current;
        const tab = strip?.querySelector<HTMLElement>(`[data-console-channel="${CSS.escape(activeChannel)}"]`);
        if (!strip || !tab) {
            return;
        }
        const stripRect = strip.getBoundingClientRect();
        const tabRect = tab.getBoundingClientRect();
        const next = tabStripRevealScrollLeft(
            { scrollLeft: strip.scrollLeft, clientWidth: strip.clientWidth, scrollWidth: strip.scrollWidth },
            { offsetLeft: tabRect.left - stripRect.left + strip.scrollLeft, width: tabRect.width },
            24,
        );
        if (next !== null) {
            strip.scrollLeft = next;
        }
    }, [activeChannel, channels.length]);

    useEffect(() => {
        if (!filterMenuOpen) {
            return;
        }
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (target && filterMenuRef.current?.contains(target)) {
                return;
            }
            setFilterMenuOpen(false);
        };
        hostWindow.addEventListener("pointerdown", handlePointerDown);
        return () => hostWindow.removeEventListener("pointerdown", handlePointerDown);
    }, [filterMenuOpen, hostWindow]);

    const toggleLevel = (level: ConsoleLogLevel) => {
        setVisibleLevels(prev => {
            const next = new Set(prev);
            if (next.has(level)) {
                next.delete(level);
            } else {
                next.add(level);
            }
            return next;
        });
    };

    const handleClear = () => {
        consoleService?.clear(activeChannel);
    };

    // Export every buffered entry of the active channel, ignoring the level filter. Cleared entries
    // are already absent from the buffer, so they are naturally excluded.
    const handleExport = () => {
        const entries = channelEntries;
        const label = activeChannelDef ? consoleChannelLabel(t, activeChannelDef) : t("console.outputFallback");
        if (entries.length === 0) {
            uiService?.showNotification(t("console.exportEmpty", { label }), "info");
            return;
        }
        void (async () => {
            const content = buildConsoleExportContent(entries, label);
            const defaultFileName = buildExportFileName(activeChannel);
            uiService?.showNotification(t("console.exportChoosingFolder", { label }), "info");

            const result = await getInterface().workspace.exportConsoleLogs(defaultFileName, content);
            if (!result.success) {
                uiService?.showNotification(t("console.exportFailed", { error: result.error ?? "" }), "error");
                return;
            }
            if (result.data.canceled) {
                return;
            }
            uiService?.showNotification(
                t("console.exportSuccess", { label, path: result.data.filePath ?? "" }),
                "success",
            );
        })();
    };

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface text-fg-muted">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-edge bg-surface-sunken">
                {/* The pages shrink to their own width before the strip scrolls, and when it still has
                    to scroll it draws no scrollbar: an 8px gutter under 36px of tabs cost them their
                    height and left the last one cut off under the toolbar. A fade at a clipped edge
                    says there is more, as on the editor's tab strip, and the wheel scrolls it. */}
                <div
                    ref={pageStripRef}
                    className="nl-no-scrollbar nl-edge-fade flex h-full min-w-0 overflow-x-auto"
                    data-fade-start={pageStripOverflow.left ? "" : undefined}
                    data-fade-end={pageStripOverflow.right ? "" : undefined}
                    onWheel={event => {
                        event.currentTarget.scrollLeft += event.deltaY;
                    }}
                    role="tablist"
                    aria-label={t("console.channelsAria")}
                >
                    {channels.map(channel => {
                        const active = activeChannel === channel.id;
                        // The lines the page would show under the level filter, not every line it
                        // buffers: Verbose is hidden by default, and a count that included it read as
                        // fifteen lines over the two the page actually lists.
                        const count = (entriesByChannel[channel.id] ?? []).reduce(
                            (total, entry) => total + (visibleLevels.has(entry.level) ? 1 : 0),
                            0,
                        );
                        return (
                            <button
                                key={channel.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                data-console-channel={channel.id}
                                data-tip={consoleChannelDescription(t, channel)} aria-label={consoleChannelDescription(t, channel)}
                                className={`relative flex w-28 min-w-max cursor-default items-center justify-center gap-2 px-3 text-xs transition-colors ${
                                    active
                                        ? "bg-surface text-fg"
                                        : "text-fg-muted hover:bg-fill-subtle hover:text-fg"
                                }`}
                                onClick={() => {
                                    // Picking a tab by hand outranks any run's standing request,
                                    // which would otherwise re-apply itself on the next remount.
                                    consoleService?.clearPendingFocusRequest();
                                    setActiveChannel(channel.id);
                                }}
                            >
                                <span>{consoleChannelLabel(t, channel)}</span>
                                <span
                                    className={`rounded-md border px-1.5 py-0.5 text-2xs leading-none ${
                                        active
                                            ? "border-primary/40 bg-primary/10 text-primary"
                                            : "border-edge bg-fill-subtle text-fg-subtle"
                                    }`}
                                >
                                    {count}
                                </span>
                                {active ? (
                                    <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-primary/70" aria-hidden />
                                ) : null}
                            </button>
                        );
                    })}
                </div>

                <div className="flex h-full shrink-0 items-center gap-2 px-2">
                    <button
                        type="button"
                        className="flex h-7 w-7 cursor-default items-center justify-center rounded-md border border-edge text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                        data-tip={t("console.export")}
                        aria-label={t("console.export")}
                        onClick={handleExport}
                    >
                        <Download className="h-3.5 w-3.5" />
                    </button>
                    <div ref={filterMenuRef} className="relative">
                        <button
                            type="button"
                            className="flex h-7 w-7 cursor-default items-center justify-center rounded-md border border-edge text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                            data-tip={t("console.filterLevels")}
                            aria-label={t("console.filterLevels")}
                            aria-haspopup="menu"
                            aria-expanded={filterMenuOpen}
                            onClick={() => setFilterMenuOpen(prev => !prev)}
                        >
                            <ListFilter className="h-3.5 w-3.5" />
                        </button>
                        {filterMenuOpen ? (
                            <div
                                ref={filterMenuPanelRef}
                                role="menu"
                                className="absolute right-0 top-full z-20 mt-1 w-36 rounded-lg border border-edge bg-surface-overlay p-1 shadow-xl"
                            >
                                {LOG_LEVELS.map(level => (
                                    <Checkbox
                                        key={level}
                                        className="rounded-md px-1.5 py-1 text-2xs hover:bg-fill"
                                        checked={visibleLevels.has(level)}
                                        onCheckedChange={() => toggleLevel(level)}
                                    >
                                        <span className={LEVEL_TEXT_CLASS[level]}>{t(`console.level.${level}`)}</span>
                                    </Checkbox>
                                ))}
                            </div>
                        ) : null}
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="border border-edge text-2xs"
                        onClick={handleClear}
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t("common.clear")}
                    </Button>
                </div>
            </div>

            <div
                ref={scrollRef}
                className={`${visibleEntries.length > 0 ? "nl-selectable-text cursor-text" : "cursor-default select-none"} min-h-0 flex-1 overflow-auto overscroll-contain py-1 font-mono text-2xs leading-relaxed`}
            >
                {visibleEntries.length === 0 ? (
                    <ConsoleEmptyState total={channelEntries.length} />
                ) : (
                    <ConsoleEntryGrid entries={visibleEntries} />
                )}
            </div>

            <ConsoleProgressBar progress={progressByChannel[activeChannel] ?? null} />
        </div>
    );
}

/**
 * Thin progress bar pinned to the bottom of the console panel. Renders nothing when
 * the active channel has no running progress. Determinate progress fills left→right;
 * indeterminate work animates two sweeping bars (the familiar "busy" pattern). Both
 * switch to the warning colour once `error` is set.
 */
function ConsoleProgressBar({ progress }: { progress: ConsoleProgress | null }) {
    if (!progress) {
        return null;
    }
    const barColor = progress.error ? "bg-warning" : "bg-primary";
    const pct = Math.round(progress.value * 100);
    return (
        <div
            className="relative h-0.5 w-full shrink-0 overflow-hidden bg-fill-subtle"
            role="progressbar"
            aria-label={progress.label}
            aria-valuemin={progress.indeterminate ? undefined : 0}
            aria-valuemax={progress.indeterminate ? undefined : 100}
            aria-valuenow={progress.indeterminate ? undefined : pct}
            data-tip={progress.label}
        >
            {progress.indeterminate ? (
                // `nl-motion-keep`: the sweep is the only thing saying the work is alive — it is
                // what a producer shows for a stretch it cannot measure. Under the reduced-motion
                // preference (styles.css) a stopped bar would read as a hang instead.
                <>
                    <div className={`nl-motion-keep absolute inset-y-0 animate-progress-indeterminate-1 rounded-full ${barColor}`} />
                    <div className={`nl-motion-keep absolute inset-y-0 animate-progress-indeterminate-2 rounded-full ${barColor}`} />
                </>
            ) : (
                <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-300 ease-out ${barColor}`}
                    style={{ width: `${pct}%` }}
                />
            )}
        </div>
    );
}

/**
 * A channel that has produced nothing prints nothing — the blank pane already says it, the way a
 * terminal does. Only the *filtered* case still speaks, because there the entries exist and the
 * level filter beside this pane is hiding them: that is a state the author set and can undo.
 */
function ConsoleEmptyState({ total }: { total: number }) {
    const { t } = useTranslation();
    if (total === 0) {
        return null;
    }
    return (
        <div className="flex h-full min-h-24 items-center justify-center px-4 text-center text-fg-subtle">
            <div>
                <Terminal className="mx-auto mb-2 h-8 w-8 opacity-45" />
                <p className="text-xs text-fg-muted">{t("console.emptyFiltered")}</p>
            </div>
        </div>
    );
}

function ConsoleEntryGrid({ entries }: { entries: ConsoleEntry[] }) {
    const { t } = useTranslation();
    return (
        <div
            className="grid min-w-full"
            style={{ gridTemplateColumns: "72px 78px minmax(28rem, 1fr)" }}
        >
            {entries.map((entry, index) => (
                <time
                    key={`${entry.id}:time`}
                    className="select-text border-r border-edge-subtle px-3 py-0.5 text-fg-subtle hover:bg-fill-subtle"
                    style={{ gridColumn: 1, gridRow: index + 1 }}
                >
                    {formatTimestamp(entry.timestamp)}
                </time>
            ))}

            {entries.map((entry, index) => (
                <span
                    key={`${entry.id}:level`}
                    className={`select-text border-r border-edge-subtle px-3 py-0.5 hover:bg-fill-subtle ${LEVEL_TEXT_CLASS[entry.level]}`}
                    style={{ gridColumn: 2, gridRow: index + 1 }}
                >
                    {t(`console.level.${entry.level}`)}
                </span>
            ))}

            {entries.map((entry, index) => (
                <div
                    key={`${entry.id}:message`}
                    className="select-text whitespace-pre-wrap break-words px-3 py-0.5 text-fg-muted hover:bg-fill-subtle"
                    style={{ gridColumn: 3, gridRow: index + 1 }}
                >
                    {entry.source ? <span className="text-fg-subtle">[{consoleSourceLabel(t, entry.source)}] </span> : null}
                    <span
                        className={`${entry.bold ? "font-semibold" : ""} ${entry.italic ? "italic" : ""}`}
                        style={entry.color ? { color: entry.color } : undefined}
                    >
                        {entry.segments.map((segment, segmentIndex) => (
                            <ConsoleSegment key={`${entry.id}:${segmentIndex}`} segment={segment} fallbackColor={entry.color} />
                        ))}
                    </span>
                    {consoleEntryText(entry).length === 0 ? <span className="text-fg-subtle">{t("console.entryEmpty")}</span> : null}
                </div>
            ))}
        </div>
    );
}

function ConsoleSegment({ segment, fallbackColor }: { segment: ConsoleLineSegment; fallbackColor?: string }) {
    return (
        <span
            className={`${segment.bold ? "font-semibold" : ""} ${segment.italic ? "italic" : ""} whitespace-pre-wrap`}
            style={segment.color || fallbackColor ? { color: segment.color ?? fallbackColor } : undefined}
        >
            {segment.text}
        </span>
    );
}
