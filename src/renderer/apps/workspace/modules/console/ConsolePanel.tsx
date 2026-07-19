import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ListFilter, Terminal, Trash2 } from "lucide-react";
import type { TranslationKey } from "@shared/i18n";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/lib/components/elements";
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
import { PanelComponentProps } from "../types";

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

/** Translation keys for known console channels; unknown feature channels fall back to their own label. */
const BUILTIN_CHANNEL_LABEL_KEYS: Partial<Record<ConsoleChannelId, TranslationKey>> = {
    blueprint: "console.channels.blueprint",
    build: "console.channels.build",
    story: "console.channels.story",
};
const BUILTIN_CHANNEL_DESCRIPTION_KEYS: Partial<Record<ConsoleChannelId, TranslationKey>> = {
    blueprint: "console.channels.blueprintDescription",
    build: "console.channels.buildDescription",
    story: "console.channels.storyDescription",
};

function channelLabel(t: (key: TranslationKey) => string, channel: ConsoleChannelDefinition): string {
    const key = BUILTIN_CHANNEL_LABEL_KEYS[channel.id];
    return key ? t(key) : channel.label;
}

function channelDescription(t: (key: TranslationKey) => string, channel: ConsoleChannelDefinition): string | undefined {
    const key = BUILTIN_CHANNEL_DESCRIPTION_KEYS[channel.id];
    return key ? t(key) : channel.description;
}

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

function entryText(entry: ConsoleEntry): string {
    return entry.segments.map(segment => segment.text).join("");
}

/** `YYYY-MM-DD HH:MM:SS`, used inside the exported log body. */
function formatExportTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Serialize a channel's buffered entries to plain text for export. Every entry is included
 * regardless of the panel's level filter; cleared entries are already gone from the buffer.
 */
function buildExportContent(entries: ConsoleEntry[], label: string): string {
    const header = [
        `NarraLeaf Studio ${label} console log`,
        `Exported: ${formatExportTimestamp(Date.now())}`,
        `Entries: ${entries.length}`,
        "",
    ];
    const lines = entries.map(entry => {
        const time = formatExportTimestamp(entry.timestamp);
        const level = entry.level.toUpperCase().padEnd(7);
        const source = entry.source ? `[${entry.source}] ` : "";
        return `[${time}] ${level} ${source}${entryText(entry)}`;
    });
    return [...header, ...lines].join("\n") + "\n";
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
    const filterMenuRef = useRef<HTMLDivElement | null>(null);
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
        window.addEventListener("pointerdown", handlePointerDown);
        return () => window.removeEventListener("pointerdown", handlePointerDown);
    }, [filterMenuOpen]);

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
        const label = activeChannelDef ? channelLabel(t, activeChannelDef) : t("console.outputFallback");
        if (entries.length === 0) {
            uiService?.showNotification(t("console.exportEmpty", { label }), "info");
            return;
        }
        void (async () => {
            const content = buildExportContent(entries, label);
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
                <div className="flex h-full min-w-0 overflow-x-auto" role="tablist" aria-label={t("console.channelsAria")}>
                    {channels.map(channel => {
                        const active = activeChannel === channel.id;
                        const count = entriesByChannel[channel.id]?.length ?? 0;
                        return (
                            <button
                                key={channel.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                title={channelDescription(t, channel)}
                                className={`relative flex min-w-28 cursor-default items-center justify-center gap-2 px-4 text-xs transition-colors ${
                                    active
                                        ? "bg-surface text-fg"
                                        : "text-fg-muted hover:bg-fill-subtle hover:text-fg"
                                }`}
                                onClick={() => setActiveChannel(channel.id)}
                            >
                                <span>{channelLabel(t, channel)}</span>
                                <span
                                    className={`rounded border px-1.5 py-0.5 text-2xs leading-none ${
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
                        className="flex h-7 w-7 cursor-default items-center justify-center rounded border border-edge text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                        title={t("console.export")}
                        aria-label={t("console.export")}
                        onClick={handleExport}
                    >
                        <Download className="h-3.5 w-3.5" />
                    </button>
                    <div ref={filterMenuRef} className="relative">
                        <button
                            type="button"
                            className="flex h-7 w-7 cursor-default items-center justify-center rounded border border-edge text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                            title={t("console.filterLevels")}
                            aria-label={t("console.filterLevels")}
                            aria-haspopup="menu"
                            aria-expanded={filterMenuOpen}
                            onClick={() => setFilterMenuOpen(prev => !prev)}
                        >
                            <ListFilter className="h-3.5 w-3.5" />
                        </button>
                        {filterMenuOpen ? (
                            <div
                                role="menu"
                                className="absolute right-0 top-full z-20 mt-1 w-36 rounded border border-edge bg-surface-overlay p-1 shadow-xl"
                            >
                                {LOG_LEVELS.map(level => (
                                    <label
                                        key={level}
                                        className="flex cursor-default items-center gap-2 rounded px-1.5 py-1 text-2xs text-fg-muted hover:bg-fill"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={visibleLevels.has(level)}
                                            onChange={() => toggleLevel(level)}
                                            className="h-3 w-3 rounded border-edge-strong bg-surface-sunken"
                                        />
                                        <span className={LEVEL_TEXT_CLASS[level]}>{t(`console.level.${level}`)}</span>
                                    </label>
                                ))}
                            </div>
                        ) : null}
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 border border-edge px-2 py-0 text-2xs"
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
                    <ConsoleEmptyState
                        label={activeChannelDef ? channelLabel(t, activeChannelDef) : t("console.outputFallback")}
                        total={channelEntries.length}
                    />
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
            title={progress.label}
        >
            {progress.indeterminate ? (
                <>
                    <div className={`absolute inset-y-0 animate-progress-indeterminate-1 rounded-full ${barColor}`} />
                    <div className={`absolute inset-y-0 animate-progress-indeterminate-2 rounded-full ${barColor}`} />
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

function ConsoleEmptyState({ label, total }: { label: string; total: number }) {
    const { t } = useTranslation();
    return (
        <div className="flex h-full min-h-24 items-center justify-center px-4 text-center text-fg-subtle">
            <div>
                <Terminal className="mx-auto mb-2 h-8 w-8 opacity-45" />
                <p className="text-xs text-fg-muted">
                    {total > 0 ? t("console.emptyFiltered") : t("console.emptyChannel", { label })}
                </p>
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
                    {entry.source ? <span className="text-fg-subtle">[{entry.source}] </span> : null}
                    <span
                        className={`${entry.bold ? "font-semibold" : ""} ${entry.italic ? "italic" : ""}`}
                        style={entry.color ? { color: entry.color } : undefined}
                    >
                        {entry.segments.map((segment, segmentIndex) => (
                            <ConsoleSegment key={`${entry.id}:${segmentIndex}`} segment={segment} fallbackColor={entry.color} />
                        ))}
                    </span>
                    {entryText(entry).length === 0 ? <span className="text-fg-subtle">{t("console.entryEmpty")}</span> : null}
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
