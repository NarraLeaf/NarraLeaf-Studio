import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Bot, ChevronRight, Download, Trash2 } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { Button, EmptyState, Select, type SelectOption } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { Services } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import type { AgentBridgeService } from "@/lib/workspace/services/agent/AgentBridgeService";
import type { AgentFollowService } from "@/lib/workspace/services/agent/AgentFollowService";
import {
    AGENT_ACTIVITY_FILTERS,
    agentActivityToJsonl,
    filterAgentActivity,
    type AgentActivityEntry,
    type AgentActivityFilter,
    type AgentActivityLog,
} from "@/lib/workspace/services/agent/AgentActivityLog";
import type { AgentErrorCode } from "@shared/agent/protocol";
import { AGENT_TOOLS_BY_NAME } from "@shared/agent/tools";
import type { Translator, TranslationKey } from "@shared/i18n";
import { useWorkspace } from "../../context";
import type { PanelComponentProps } from "../types";
import { revealAgentWrite } from "./revealAgentWrite";

/**
 * The Agent log: every call an agent connected over MCP made in this workspace, newest at the
 * bottom, the way the Console lists its lines.
 *
 * One row per call - when, which client, what it did (the tool's title), what it was about, how it
 * ended and how long it took. A row that wrote something opens what it wrote and outlines the change;
 * a refused row opens to the refusal's message and the next step the agent was given. Nothing here is
 * the call's arguments: the log holds what the author could have watched happen.
 *
 * Comments in English per project convention.
 */

type AgentLogPanelState = { filter?: AgentActivityFilter };

const FILTER_KEYS: Record<AgentActivityFilter, TranslationKey> = {
    all: "workspace.agent.log.filter.all",
    writes: "workspace.agent.log.filter.writes",
    failures: "workspace.agent.log.filter.failures",
};

const FILTER_OPTIONS: SelectOption[] = AGENT_ACTIVITY_FILTERS.map(filter => ({ value: filter, labelKey: FILTER_KEYS[filter] }));

const CODE_KEYS: Record<AgentErrorCode, TranslationKey> = {
    invalid_args: "workspace.agent.log.code.invalid_args",
    unknown_tool: "workspace.agent.log.code.unknown_tool",
    no_workspace: "workspace.agent.log.code.no_workspace",
    writes_disabled: "workspace.agent.log.code.writes_disabled",
    paused: "workspace.agent.log.code.paused",
    frozen: "workspace.agent.log.code.frozen",
    live_session: "workspace.agent.log.code.live_session",
    stale_revision: "workspace.agent.log.code.stale_revision",
    check_failed: "workspace.agent.log.code.check_failed",
    not_found: "workspace.agent.log.code.not_found",
    path_not_allowed: "workspace.agent.log.code.path_not_allowed",
    untrusted: "workspace.agent.log.code.untrusted",
    unavailable: "workspace.agent.log.code.unavailable",
    internal: "workspace.agent.log.code.internal",
};

/** The setting row Settings opens at for agent access (`appSettings.ts`). */
const AGENT_ACCESS_SETTING_KEY = "agent.access";

function isFilter(value: unknown): value is AgentActivityFilter {
    return AGENT_ACTIVITY_FILTERS.includes(value as AgentActivityFilter);
}

/** The tool's title in the interface language; the English title from the tool table when a catalog lacks it. */
export function agentToolTitle(translator: Pick<Translator, "t" | "has">, tool: string): string {
    const key = `workspace.agent.tool.${tool}`;
    return translator.has(key) ? translator.t(key as TranslationKey) : AGENT_TOOLS_BY_NAME.get(tool)?.title ?? tool;
}

function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function exportFileName(): string {
    const date = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    return `agent-log-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.jsonl`;
}

const NO_ENTRIES: readonly AgentActivityEntry[] = [];
const NO_SUBSCRIPTION = () => () => {};

export function AgentLogPanel({ panelId }: PanelComponentProps) {
    const translator = useTranslation();
    const { t } = translator;
    const { context } = useWorkspace();

    const services = useMemo(() => {
        if (!context) {
            return null;
        }
        try {
            return {
                log: context.services.get<AgentBridgeService>(Services.AgentBridge).getActivityLog() as AgentActivityLog,
                follow: context.services.get<AgentFollowService>(Services.AgentFollow),
                ui: context.services.get<UIService>(Services.UI),
                panelState: context.services.get<PanelStateService>(Services.PanelState),
            };
        } catch {
            return null;
        }
    }, [context]);

    const entries = useSyncExternalStore(
        services?.log.subscribe ?? NO_SUBSCRIPTION,
        services?.log.getEntries ?? (() => NO_ENTRIES),
    );

    const [filter, setFilter] = useState<AgentActivityFilter>(() => {
        const stored = services?.panelState.getPanelState<AgentLogPanelState>(panelId)?.filter;
        return isFilter(stored) ? stored : "all";
    });
    const changeFilter = useCallback((value: AgentActivityFilter) => {
        setFilter(value);
        services?.panelState.setPanelState<AgentLogPanelState>(panelId, { filter: value });
    }, [panelId, services]);

    const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
    const toggleExpanded = useCallback((id: number) => {
        setExpanded(previous => {
            const next = new Set(previous);
            if (!next.delete(id)) {
                next.add(id);
            }
            return next;
        });
    }, []);

    const visible = useMemo(() => filterAgentActivity(entries, filter), [entries, filter]);

    // Follow the newest call while the list is scrolled to its end; leave it alone once the author
    // has scrolled up to read something.
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const pinnedRef = useRef(true);
    const onScroll = useCallback(() => {
        const el = scrollRef.current;
        if (el) {
            pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }
    }, []);
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (el && pinnedRef.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [visible]);
    useEffect(() => {
        pinnedRef.current = true;
    }, [filter]);

    const openSettings = useCallback(() => {
        void getInterface().app.launchSettings({ highlight: AGENT_ACCESS_SETTING_KEY });
    }, []);

    const reveal = useCallback((entry: AgentActivityEntry) => {
        if (!context || !services || !entry.reveal) {
            return;
        }
        if (revealAgentWrite(context, entry.reveal)) {
            services.follow.requestHighlight(entry.reveal);
        } else {
            services.ui.showNotification(t("workspace.agent.log.targetGone"), "info");
        }
    }, [context, services, t]);

    const handleExport = useCallback(() => {
        if (!services) {
            return;
        }
        const all = services.log.getEntries();
        if (all.length === 0) {
            services.ui.showNotification(t("workspace.agent.log.exportEmpty"), "info");
            return;
        }
        void (async () => {
            const result = await getInterface().workspace.exportConsoleLogs(exportFileName(), agentActivityToJsonl(all));
            if (!result.success) {
                services.ui.showNotification(t("workspace.agent.log.exportFailed", { error: result.error ?? "" }), "error");
                return;
            }
            if (result.data.canceled) {
                return;
            }
            services.ui.showNotification(t("workspace.agent.log.exported", { path: result.data.filePath ?? "" }), "success");
        })();
    }, [services, t]);

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface text-fg-muted">
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-edge bg-surface-sunken px-3">
                <Select
                    size="sm"
                    options={FILTER_OPTIONS}
                    value={filter}
                    onChange={value => changeFilter(isFilter(value) ? value : "all")}
                    ariaLabel={t("workspace.agent.log.filterAria")}
                    portalMenu
                />
                <span className="flex-1" />
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="border border-edge text-2xs"
                    data-tip={t("workspace.agent.log.exportHint")}
                    disabled={entries.length === 0}
                    onClick={handleExport}
                >
                    <Download className="h-3.5 w-3.5" />
                    {t("workspace.agent.log.export")}
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="border border-edge text-2xs"
                    disabled={entries.length === 0}
                    onClick={() => {
                        services?.log.clear();
                        setExpanded(new Set());
                    }}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("common.clear")}
                </Button>
            </div>

            <div
                ref={scrollRef}
                onScroll={onScroll}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1"
                role="list"
                aria-label={t("workspace.agent.log.listAria")}
            >
                {entries.length === 0 ? (
                    <EmptyState
                        size="sm"
                        className="h-full"
                        icon={<Bot className="h-8 w-8" />}
                        title={t("workspace.agent.log.empty")}
                        description={t("workspace.agent.log.emptyHint")}
                        action={(
                            <Button type="button" variant="ghost" size="sm" className="border border-edge text-2xs" onClick={openSettings}>
                                {t("workspace.agent.appMenu.settings")}
                            </Button>
                        )}
                    />
                ) : visible.length === 0 ? (
                    <p className="px-1 py-1 text-xs text-fg-subtle">{t("workspace.agent.log.emptyFiltered")}</p>
                ) : (
                    visible.map(entry => (
                        <AgentLogRow
                            key={entry.id}
                            entry={entry}
                            translator={translator}
                            expanded={expanded.has(entry.id)}
                            onToggle={toggleExpanded}
                            onReveal={reveal}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

function formatDuration(translator: Pick<Translator, "t" | "formatNumber">, durationMs: number | null): string {
    if (durationMs === null) {
        return "";
    }
    if (durationMs < 1000) {
        return translator.t("workspace.agent.log.durationMs", { value: durationMs });
    }
    return translator.t("workspace.agent.log.durationS", {
        value: translator.formatNumber(durationMs / 1000, { maximumFractionDigits: 1, minimumFractionDigits: 1 }),
    });
}

function AgentLogRow({
    entry,
    translator,
    expanded,
    onToggle,
    onReveal,
}: {
    entry: AgentActivityEntry;
    translator: Translator;
    expanded: boolean;
    onToggle: (id: number) => void;
    onReveal: (entry: AgentActivityEntry) => void;
}) {
    const { t } = translator;
    const refused = entry.status === "refused";
    const result = entry.status === "running"
        ? t("workspace.agent.log.running")
        : refused
            ? (entry.code ? t(CODE_KEYS[entry.code]) : t("workspace.agent.log.code.internal"))
            : t("workspace.agent.log.ok");
    const resultClass = entry.status === "running"
        ? "text-fg-subtle"
        : refused
            ? (entry.code === "internal" ? "text-danger/75" : "text-warning/75")
            : "text-success/75";
    const client = entry.clientName ?? t("workspace.agent.status.unknownClient");
    // A plugin's tool is named by the plugin, in the plugin's words; Studio has no translation of it.
    const title = entry.title ?? agentToolTitle(translator, entry.tool);

    const cells = (
        <>
            <span className="w-4 shrink-0 self-center text-fg-subtle">
                {refused ? <ChevronRight className={cn("h-3 w-3 transition-transform duration-150", expanded && "rotate-90")} /> : null}
            </span>
            <time className="w-16 shrink-0 tabular-nums text-2xs text-fg-subtle">{formatTime(entry.startedAt)}</time>
            <span className="w-28 shrink-0 truncate text-2xs text-fg-subtle">{client}</span>
            <span className={cn("shrink-0 text-xs", entry.write ? "text-fg" : "text-fg-muted")}>{title}</span>
            {entry.pluginId ? (
                <span className="max-w-[24%] shrink-0 truncate font-mono text-2xs text-fg-subtle" data-tip={t("workspace.agent.log.pluginTool", { plugin: entry.pluginId })}>
                    {entry.pluginId}
                </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">{entry.target ?? ""}</span>
            <span className={cn("max-w-[30%] shrink-0 truncate text-2xs", resultClass)}>{result}</span>
            <span className="w-14 shrink-0 text-right tabular-nums text-2xs text-fg-subtle">{formatDuration(translator, entry.durationMs)}</span>
        </>
    );
    const rowClass = "flex w-full min-w-0 cursor-default items-baseline gap-2 rounded-md px-1 py-0.5 text-left hover:bg-fill-subtle";

    return (
        <div role="listitem" data-agent-log-status={entry.status}>
            {entry.reveal ? (
                <button type="button" className={rowClass} data-tip={t("workspace.agent.log.showChange")} onClick={() => onReveal(entry)}>
                    {cells}
                </button>
            ) : refused ? (
                <button type="button" className={rowClass} aria-expanded={expanded} onClick={() => onToggle(entry.id)}>
                    {cells}
                </button>
            ) : (
                <div className={rowClass}>{cells}</div>
            )}
            {refused && expanded ? (
                <div className="nl-selectable-text cursor-text space-y-0.5 pb-1 pl-7 pr-2 text-2xs">
                    {entry.message ? <p className="whitespace-pre-wrap break-words text-fg-muted">{entry.message}</p> : null}
                    {entry.hint ? (
                        <p className="whitespace-pre-wrap break-words text-fg-subtle">
                            <span className="text-fg-muted">{t("workspace.agent.log.hint")}</span>
                            {" "}
                            {entry.hint}
                        </p>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
