import { useEffect, useMemo, useRef, useState } from "react";
import { ListFilter, Terminal, Trash2 } from "lucide-react";
import { Button } from "@/lib/components/elements";
import { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import {
    CONSOLE_CHANNELS,
    ConsoleService,
    type ConsoleChannelId,
    type ConsoleEntry,
    type ConsoleLineSegment,
    type ConsoleLogLevel,
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

const LEVEL_META: Record<ConsoleLogLevel, {
    label: string;
    textClassName: string;
}> = {
    error: {
        label: "Error",
        textClassName: "text-rose-300/75",
    },
    warning: {
        label: "Warn",
        textClassName: "text-amber-300/75",
    },
    success: {
        label: "Success",
        textClassName: "text-emerald-300/75",
    },
    info: {
        label: "Info",
        textClassName: "text-cyan-300/75",
    },
    verbose: {
        label: "Verbose",
        textClassName: "text-gray-500/80",
    },
};

function isConsoleChannelId(value: unknown): value is ConsoleChannelId {
    return value === "blueprint" || value === "build";
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

function readServiceEntries(service: ConsoleService | null): Record<ConsoleChannelId, ConsoleEntry[]> {
    return {
        blueprint: service?.getEntries("blueprint") ?? [],
        build: service?.getEntries("build") ?? [],
    };
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

/**
 * Console panel component.
 * Shows structured build/package and blueprint output from ConsoleService.
 */
export function ConsolePanel({ panelId }: PanelComponentProps) {
    const { context } = useWorkspace();
    const consoleService = useMemo(
        () => context?.services.get<ConsoleService>(Services.Console) ?? null,
        [context],
    );
    const panelStateService = useMemo(
        () => context?.services.get<PanelStateService>(Services.PanelState) ?? null,
        [context],
    );

    const [activeChannel, setActiveChannel] = useState<ConsoleChannelId>("build");
    const [visibleLevels, setVisibleLevels] = useState<Set<ConsoleLogLevel>>(() => new Set(DEFAULT_VISIBLE_LEVELS));
    const [filterMenuOpen, setFilterMenuOpen] = useState(false);
    const [entriesByChannel, setEntriesByChannel] = useState<Record<ConsoleChannelId, ConsoleEntry[]>>(() =>
        readServiceEntries(null),
    );
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const filterMenuRef = useRef<HTMLDivElement | null>(null);
    const panelStateLoadedRef = useRef(false);

    useEffect(() => {
        if (!panelStateService) {
            return;
        }

        const stored = panelStateService.getPanelState<ConsolePanelState>(panelId);
        if (isConsoleChannelId(stored?.activeChannel)) {
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

        setEntriesByChannel(readServiceEntries(consoleService));
        return consoleService.onEntriesChanged(() => {
            setEntriesByChannel(readServiceEntries(consoleService));
        });
    }, [consoleService]);

    const channelEntries = entriesByChannel[activeChannel];
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

    return (
        <div className="flex h-full min-h-0 flex-col bg-[#0f1115] text-gray-300">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/10 bg-[#0b0d12]">
                <div className="flex h-full min-w-0 overflow-x-auto" role="tablist" aria-label="Console channels">
                    {CONSOLE_CHANNELS.map(channel => {
                        const active = activeChannel === channel.id;
                        const count = entriesByChannel[channel.id].length;
                        return (
                            <button
                                key={channel.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                title={channel.description}
                                className={`relative flex min-w-28 cursor-default items-center justify-center gap-2 px-4 text-xs transition-colors ${
                                    active
                                        ? "bg-[#12151c] text-white"
                                        : "text-gray-400 hover:bg-[#11141b] hover:text-gray-200"
                                }`}
                                onClick={() => setActiveChannel(channel.id)}
                            >
                                <span>{channel.label}</span>
                                <span
                                    className={`rounded border px-1.5 py-0.5 text-[10px] leading-none ${
                                        active
                                            ? "border-primary/40 bg-primary/10 text-primary"
                                            : "border-white/10 bg-white/[0.03] text-gray-500"
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
                    <div ref={filterMenuRef} className="relative">
                        <button
                            type="button"
                            className="flex h-7 w-7 cursor-default items-center justify-center rounded border border-white/10 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
                            title="Filter levels"
                            aria-label="Filter levels"
                            aria-haspopup="menu"
                            aria-expanded={filterMenuOpen}
                            onClick={() => setFilterMenuOpen(prev => !prev)}
                        >
                            <ListFilter className="h-3.5 w-3.5" />
                        </button>
                        {filterMenuOpen ? (
                            <div
                                role="menu"
                                className="absolute right-0 top-full z-20 mt-1 w-36 rounded border border-white/10 bg-[#11141b] p-1 shadow-xl"
                            >
                                {LOG_LEVELS.map(level => {
                                    const meta = LEVEL_META[level];
                                    return (
                                        <label
                                            key={level}
                                            className="flex cursor-default items-center gap-2 rounded px-1.5 py-1 text-[10px] text-gray-300 hover:bg-white/10"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={visibleLevels.has(level)}
                                                onChange={() => toggleLevel(level)}
                                                className="h-3 w-3 rounded border-white/20 bg-[#0b0d12]"
                                            />
                                            <span className={meta.textClassName}>{meta.label}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        ) : null}
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 border border-white/10 px-2 py-0 text-[10px]"
                        onClick={handleClear}
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                        Clear
                    </Button>
                </div>
            </div>

            <div
                ref={scrollRef}
                className={`${visibleEntries.length > 0 ? "nl-selectable-text cursor-text" : "cursor-default select-none"} min-h-0 flex-1 overflow-auto overscroll-contain py-1 font-mono text-[11px] leading-relaxed`}
            >
                {visibleEntries.length === 0 ? (
                    <ConsoleEmptyState channel={activeChannel} total={channelEntries.length} />
                ) : (
                    <ConsoleEntryGrid entries={visibleEntries} />
                )}
            </div>
        </div>
    );
}

function ConsoleEmptyState({ channel, total }: { channel: ConsoleChannelId; total: number }) {
    const label = channel === "blueprint" ? "Blueprint" : "Build";
    return (
        <div className="flex h-full min-h-24 items-center justify-center px-4 text-center text-gray-500">
            <div>
                <Terminal className="mx-auto mb-2 h-8 w-8 opacity-45" />
                <p className="text-xs text-gray-400">
                    {total > 0 ? "No lines match the current filters" : `No ${label} output yet`}
                </p>
            </div>
        </div>
    );
}

function ConsoleEntryGrid({ entries }: { entries: ConsoleEntry[] }) {
    return (
        <div
            className="grid min-w-full"
            style={{ gridTemplateColumns: "72px 78px minmax(28rem, 1fr)" }}
        >
            {entries.map((entry, index) => (
                <time
                    key={`${entry.id}:time`}
                    className="select-text border-r border-white/[0.04] px-3 py-0.5 text-gray-600 hover:bg-white/[0.035]"
                    style={{ gridColumn: 1, gridRow: index + 1 }}
                >
                    {formatTimestamp(entry.timestamp)}
                </time>
            ))}

            {entries.map((entry, index) => {
                const level = LEVEL_META[entry.level];
                return (
                    <span
                        key={`${entry.id}:level`}
                        className={`select-text border-r border-white/[0.04] px-3 py-0.5 hover:bg-white/[0.035] ${level.textClassName}`}
                        style={{ gridColumn: 2, gridRow: index + 1 }}
                    >
                        {level.label}
                    </span>
                );
            })}

            {entries.map((entry, index) => (
                <div
                    key={`${entry.id}:message`}
                    className="select-text whitespace-pre-wrap break-words px-3 py-0.5 text-gray-300 hover:bg-white/[0.035]"
                    style={{ gridColumn: 3, gridRow: index + 1 }}
                >
                    {entry.source ? <span className="text-gray-500">[{entry.source}] </span> : null}
                    <span
                        className={`${entry.bold ? "font-semibold" : ""} ${entry.italic ? "italic" : ""}`}
                        style={entry.color ? { color: entry.color } : undefined}
                    >
                        {entry.segments.map((segment, segmentIndex) => (
                            <ConsoleSegment key={`${entry.id}:${segmentIndex}`} segment={segment} fallbackColor={entry.color} />
                        ))}
                    </span>
                    {entryText(entry).length === 0 ? <span className="text-gray-600">(empty)</span> : null}
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
