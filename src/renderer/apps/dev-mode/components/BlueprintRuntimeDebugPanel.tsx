import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import type { PreviewStudioBlueprintOpenPayload } from "@shared/types/previewStudioBlueprintOpen";
import { getInterface } from "@/lib/app/bridge";
import type { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import type { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";

type DebugTabId = "blueprints" | "output" | "scope";

type BlueprintRuntimeDebugPanelProps = {
    debug: DebugBridge;
    blueprintDocument: BlueprintDocument;
    activeSurfaceId: string;
    scopeBridge: ScopeStoreBridge;
    widgetRuntimeStore: WidgetRuntimeStateStore;
    projectPath: string | null;
    className?: string;
};

export function BlueprintRuntimeDebugPanel(props: BlueprintRuntimeDebugPanelProps) {
    const {
        debug,
        blueprintDocument,
        activeSurfaceId,
        scopeBridge,
        widgetRuntimeStore,
        projectPath,
        className,
    } = props;
    const [tab, setTab] = useState<DebugTabId>("output");
    const [events, setEvents] = useState<BlueprintDebugEvent[]>(() => debug.snapshot());
    const [errorsOnly, setErrorsOnly] = useState(false);
    const [expandedBp, setExpandedBp] = useState<Set<string>>(() => new Set());
    const [studioHint, setStudioHint] = useState<string | null>(null);
    const outputScrollRef = useRef<HTMLDivElement>(null);

    const [surfaceSnap, setSurfaceSnap] = useState(() =>
        scopeBridge.getSurfaceStore(activeSurfaceId).getSnapshot(),
    );
    const [globalSnap, setGlobalSnap] = useState(() => scopeBridge.getGlobalSnapshot());
    const [persistSnap, setPersistSnap] = useState(() => scopeBridge.getPersistenceSnapshot());
    const [widgetSnap, setWidgetSnap] = useState(() => widgetRuntimeStore.getSnapshot());

    useEffect(() => {
        setEvents(debug.snapshot());
        return debug.subscribe(() => {
            setEvents(debug.snapshot());
        });
    }, [debug]);

    useEffect(() => {
        const store = scopeBridge.getSurfaceStore(activeSurfaceId);
        setSurfaceSnap(store.getSnapshot());
        return store.subscribe(() => {
            setSurfaceSnap(store.getSnapshot());
        });
    }, [scopeBridge, activeSurfaceId]);

    useEffect(() => {
        setGlobalSnap(scopeBridge.getGlobalSnapshot());
        return scopeBridge.subscribeGlobals(() => {
            setGlobalSnap(scopeBridge.getGlobalSnapshot());
        });
    }, [scopeBridge]);

    useEffect(() => {
        setPersistSnap(scopeBridge.getPersistenceSnapshot());
        return scopeBridge.subscribePersistence(() => {
            setPersistSnap(scopeBridge.getPersistenceSnapshot());
        });
    }, [scopeBridge]);

    useEffect(() => {
        setWidgetSnap(widgetRuntimeStore.getSnapshot());
        return widgetRuntimeStore.subscribe(() => {
            setWidgetSnap(widgetRuntimeStore.getSnapshot());
        });
    }, [widgetRuntimeStore]);

    useEffect(() => {
        if (tab !== "output") {
            return;
        }
        const el = outputScrollRef.current;
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
    }, [events, tab, errorsOnly]);

    const blueprintsList = useMemo(() => {
        const list = Object.values(blueprintDocument.blueprints);
        list.sort((a, b) => a.name.localeCompare(b.name));
        return list;
    }, [blueprintDocument.blueprints]);

    const outputLines = useMemo(() => {
        const src = errorsOnly ? events.filter(e => e.type === "execution.error") : events;
        return src.slice(-200);
    }, [events, errorsOnly]);

    const toggleExpanded = useCallback((id: string) => {
        setExpandedBp(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const openInStudio = useCallback(
        async (bp: Blueprint) => {
            setStudioHint(null);
            const payload = buildStudioOpenPayload(bp, projectPath);
            if (!payload) {
                setStudioHint("不支持从预览打开此类型");
                return;
            }
            const result = await getInterface().devMode.openBlueprintInWorkspace(payload);
            if (!result.success) {
                setStudioHint(result.error ?? "无法打开");
                return;
            }
            setStudioHint(null);
        },
        [projectPath],
    );

    const rootClass = ["flex h-full min-h-0 shrink-0 flex-col border-l border-white/10 bg-[#0d0f11] text-[11px] text-gray-300", className]
        .filter(Boolean)
        .join(" ");

    return (
        <div className={rootClass}>
            <div className="shrink-0 border-b border-white/10 px-2 py-1.5 text-xs font-medium text-gray-200">Blueprint DevTools</div>
            <div className="flex shrink-0 border-b border-white/10 bg-[#0b0d12]" role="tablist" aria-label="Debug panels">
                {(
                    [
                        ["blueprints", "蓝图"],
                        ["output", "输出"],
                        ["scope", "变量"],
                    ] as const
                ).map(([id, label]) => {
                    const active = tab === id;
                    return (
                        <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            className={`relative h-9 flex-1 cursor-default px-2 text-xs transition-colors ${
                                active ? "bg-[#12151c] text-white" : "text-gray-400 hover:bg-[#0f1115] hover:text-white"
                            }`}
                            onClick={() => setTab(id)}
                        >
                            {label}
                            {active ? (
                                <span
                                    className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-0.5 bg-primary/70"
                                    aria-hidden
                                />
                            ) : null}
                        </button>
                    );
                })}
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden font-mono leading-snug">
                {tab === "blueprints" ? (
                    <div className="min-h-0 flex-1 overflow-auto p-2">
                        {studioHint ? <p className="mb-2 text-[10px] text-amber-400/90">{studioHint}</p> : null}
                        {blueprintsList.length === 0 ? (
                            <p className="text-[10px] text-gray-600">无蓝图</p>
                        ) : (
                            <ul className="space-y-0.5">
                                {blueprintsList.map(bp => {
                                    const expanded = expandedBp.has(bp.id);
                                    const canStudio = Boolean(projectPath) && studioPayloadSupported(bp);
                                    return (
                                        <li key={bp.id} className="border-b border-white/5 pb-1.5 last:border-0">
                                            <div className="flex items-start gap-1">
                                                <button
                                                    type="button"
                                                    className="mt-0.5 shrink-0 text-gray-500 hover:text-gray-300"
                                                    aria-expanded={expanded}
                                                    onClick={() => toggleExpanded(bp.id)}
                                                >
                                                    {expanded ? (
                                                        <ChevronDown className="h-3.5 w-3.5" />
                                                    ) : (
                                                        <ChevronRight className="h-3.5 w-3.5" />
                                                    )}
                                                </button>
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate text-gray-200">{bp.name}</div>
                                                    <div className="truncate text-[10px] text-gray-500">
                                                        {bp.id.slice(0, 10)}… · {bp.owner.kind}
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled={!canStudio}
                                                    className="shrink-0 rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-gray-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                                                    onClick={() => void openInStudio(bp)}
                                                >
                                                    工作区
                                                </button>
                                            </div>
                                            {expanded ? (
                                                <div className="mt-1 ml-5 space-y-0.5 text-[10px] text-gray-500">
                                                    <div>
                                                        {bp.programKind} · {bp.frontend}
                                                    </div>
                                                    {memberCountsLine(bp)}
                                                </div>
                                            ) : null}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                ) : null}

                {tab === "output" ? (
                    <div className="flex min-h-0 flex-1 flex-col">
                        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/5 px-2 py-1">
                            <label className="flex cursor-default items-center gap-1.5 text-[10px] text-gray-500">
                                <input
                                    type="checkbox"
                                    checked={errorsOnly}
                                    onChange={e => setErrorsOnly(e.target.checked)}
                                    className="rounded border-white/20 bg-[#0b0d12]"
                                />
                                仅错误
                            </label>
                            <button
                                type="button"
                                className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-gray-300 hover:bg-white/10"
                                onClick={() => debug.clear()}
                            >
                                Clear
                            </button>
                        </div>
                        <div ref={outputScrollRef} className="min-h-0 flex-1 overflow-auto overscroll-contain p-2">
                            {outputLines.length === 0 ? (
                                <p className="text-[10px] text-gray-600">无输出</p>
                            ) : (
                                <ul className="space-y-1">
                                    {outputLines.map((ev, i) => (
                                        <li key={`${i}-${ev.type}`} className="break-all text-[10px] text-gray-500">
                                            <span
                                                className={
                                                    ev.type === "execution.error"
                                                        ? "text-amber-300/90"
                                                        : "text-cyan-400/90"
                                                }
                                            >
                                                {ev.type}
                                            </span>
                                            {" · "}
                                            {formatEvent(ev)}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                ) : null}

                {tab === "scope" ? (
                    <div className="min-h-0 flex-1 space-y-3 overflow-auto p-2">
                        <KeyValueBlock title="Surface" entries={surfaceSnap} surfaceId={activeSurfaceId} />
                        <KeyValueBlock title="Global" entries={globalSnap} />
                        <KeyValueBlock title="Persistence" entries={persistSnap} />
                        <div>
                            <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Widget</p>
                            <ul className="space-y-0.5 text-[10px] text-gray-400">
                                <li>hover · {widgetSnap.hoverTargetId ?? "—"}</li>
                                <li>active · {widgetSnap.activePointerId ?? "—"}</li>
                                <li>focus · {widgetSnap.focusedId ?? "—"}</li>
                                <li className="break-all">
                                    variants ·{" "}
                                    {widgetSnap.variantOverrides.size === 0
                                        ? "—"
                                        : [...widgetSnap.variantOverrides.entries()]
                                              .map(([k, v]) => `${k.slice(0, 6)}…=${v}`)
                                              .join(", ")}
                                </li>
                            </ul>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function studioPayloadSupported(bp: Blueprint): boolean {
    return bp.owner.kind === "surfaceMain" || bp.owner.kind === "widgetMain";
}

function buildStudioOpenPayload(
    bp: Blueprint,
    projectPath: string | null,
): (PreviewStudioBlueprintOpenPayload & { projectPath: string }) | null {
    if (!projectPath) {
        return null;
    }
    const owner = bp.owner;
    if (owner.kind === "surfaceMain") {
        return {
            projectPath,
            blueprintId: bp.id,
            ownerKind: "surfaceMain",
            surfaceId: owner.surfaceId,
            title: bp.name,
        };
    }
    if (owner.kind === "widgetMain") {
        return {
            projectPath,
            blueprintId: bp.id,
            ownerKind: "widgetMain",
            surfaceId: owner.surfaceId,
            elementId: owner.elementId,
            title: bp.name,
        };
    }
    return null;
}

function memberCountsLine(bp: Blueprint): string {
    const v = Object.keys(bp.members?.variables ?? {}).length;
    const f = Object.keys(bp.members?.fields ?? {}).length;
    const fn = Object.keys(bp.members?.functions ?? {}).length;
    return `members · ${v} vars · ${f} fields · ${fn} fn`;
}

function KeyValueBlock(props: {
    title: string;
    entries: ReadonlyMap<string, unknown>;
    surfaceId?: string;
}): ReactNode {
    const { title, entries, surfaceId } = props;
    const keys = [...entries.keys()].sort();
    return (
        <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">
                {title}
                {surfaceId ? <span className="text-gray-600"> · {surfaceId.slice(0, 8)}…</span> : null}
            </p>
            {keys.length === 0 ? (
                <p className="text-[10px] text-gray-600">空</p>
            ) : (
                <ul className="space-y-0.5">
                    {keys.map(k => (
                        <li key={k} className="flex gap-2 text-[10px] text-gray-400">
                            <span className="w-[40%] shrink-0 truncate text-gray-500">{k}</span>
                            <span className="min-w-0 flex-1 break-all text-gray-300">{formatDebugValue(entries.get(k))}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function formatDebugValue(value: unknown, maxLen = 180): string {
    if (value === undefined) {
        return "undefined";
    }
    if (value === null) {
        return "null";
    }
    if (typeof value === "string") {
        return value.length > maxLen ? `${value.slice(0, maxLen)}…` : value;
    }
    try {
        const s = JSON.stringify(value);
        return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
    } catch {
        return "[unserializable]";
    }
}

function formatExecutionError(ev: Extract<BlueprintDebugEvent, { type: "execution.error" }>): string {
    const parts = [ev.message];
    if (ev.blueprintId) {
        parts.push(`bp:${ev.blueprintId.slice(0, 8)}…`);
    }
    if (ev.eventId) {
        parts.push(`evt:${ev.eventId}`);
    }
    if (ev.nodeId) {
        parts.push(`node:${ev.nodeId.slice(0, 10)}…`);
    }
    if (ev.graphId) {
        parts.push(`graph:${String(ev.graphId).slice(0, 14)}…`);
    }
    return parts.join(" · ");
}

function formatEvent(ev: BlueprintDebugEvent): string {
    switch (ev.type) {
        case "execution.started":
        case "execution.finished":
            return `${ev.blueprintId.slice(0, 8)}… / ${ev.executionId.slice(0, 8)}…`;
        case "execution.error":
            return formatExecutionError(ev);
        case "node.enter":
        case "node.exit":
            return `${ev.nodeId.slice(0, 12)}…`;
        case "state.read":
        case "state.write":
            return `${ev.scope} · ${ev.key}`;
        case "binding.evaluated":
            return ev.bindingId.slice(0, 10);
        case "function.call":
        case "function.return":
            return ev.functionId;
        default:
            return JSON.stringify(ev);
    }
}
