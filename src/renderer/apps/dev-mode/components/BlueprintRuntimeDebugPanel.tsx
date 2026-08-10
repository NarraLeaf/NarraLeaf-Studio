/**
 * Interface: the running UI, as the host sees it — the blueprints this surface is made of, what
 * they logged, and the host state they read and write.
 *
 * Not the debugger: nothing here stops the game. The one thing in this panel that changes what the
 * session records — the verbose log level — is therefore not owned here either; see the
 * `outputLogLevels` prop.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Check, ChevronDown, ChevronRight, Frame } from "lucide-react";
import {
    getBlueprintDebugEventLogLevel,
    type BlueprintDebugEvent,
    type BlueprintDebugEventLogLevel,
} from "@shared/types/blueprint/debug";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import type { PreviewStudioBlueprintOpenPayload } from "@shared/types/previewStudioBlueprintOpen";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import type { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import type { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { SAFE_AREA_PRESETS } from "@/lib/ui-editor/preview/surfacePreviewFrames";
import { blueprintWidgetElementId, listDevModeBlueprints } from "./blueprintDebugPanelModel";
import { formatDebugValue } from "./debugValueFormat";
import { DevModePanelModeToggle, type DevModePanelChrome } from "./DevModePanelChrome";

/**
 * `uiState` was called `scope`, which the debugger also calls a tab — and meant something else by
 * it. The debugger's is one paused frame's variables; this one is the host's own runtime state
 * (surface store, globals, persistence, widget interaction), which no frame owns.
 */
type DebugTabId = "blueprints" | "output" | "uiState";
export type BlueprintOutputLogLevel = BlueprintDebugEventLogLevel;

const OUTPUT_LOG_LEVELS: BlueprintOutputLogLevel[] = ["error", "warning", "log", "verbose"];
/** Verbose is off by default — see the DebugBridge for what capturing it costs. Read-only: the
 *  owner (DevModeContent) seeds its state from this and must not be able to edit the default. */
export const DEFAULT_OUTPUT_LOG_LEVELS: ReadonlySet<BlueprintOutputLogLevel> = new Set<BlueprintOutputLogLevel>([
    "error",
    "warning",
    "log",
]);

type BlueprintRuntimeDebugPanelProps = {
    debug: DebugBridge;
    blueprintDocument: BlueprintDocument;
    uiDocument: UIDocument;
    activeSurfaceId: string;
    scopeBridge: ScopeStoreBridge;
    widgetRuntimeStore: WidgetRuntimeStateStore;
    projectPath: string | null;
    /**
     * Which log levels the Output list shows. Owned by DevModeContent, not by this panel: `verbose`
     * also arms capture at the DebugBridge, so it outlives the drawer being closed and the session
     * being replaced by a timeline jump.
     */
    outputLogLevels: ReadonlySet<BlueprintOutputLogLevel>;
    setOutputLogLevels: Dispatch<SetStateAction<ReadonlySet<BlueprintOutputLogLevel>>>;
    /**
     * Point at the widget a listed blueprint is attached to, or `null` for nothing. Owned by
     * DevModeContent because the box is painted over the stage, which this panel is a sibling of
     * rather than a parent — and because it must come down when the drawer closes mid-hover.
     */
    onHighlightElement: (elementId: string | null) => void;
    /**
     * Safe-area device preset drawn over the stage, `null` = off. Owned by DevModeContent for the
     * same reason as `onHighlightElement`: the overlay is painted on the stage, which this panel is
     * a sibling of — and closing the drawer must not take the frame down with it.
     */
    safeAreaId: string | null;
    setSafeAreaId: Dispatch<SetStateAction<string | null>>;
    className?: string;
    /** Dock/float mode toggle + title-bar drag, owned by DevModeContent. */
    chrome?: DevModePanelChrome;
};

export function BlueprintRuntimeDebugPanel(props: BlueprintRuntimeDebugPanelProps) {
    const {
        debug,
        blueprintDocument,
        uiDocument,
        activeSurfaceId,
        scopeBridge,
        widgetRuntimeStore,
        projectPath,
        outputLogLevels,
        setOutputLogLevels,
        onHighlightElement,
        safeAreaId,
        setSafeAreaId,
        className,
        chrome,
    } = props;
    const { t } = useTranslation();
    const [tab, setTab] = useState<DebugTabId>("output");
    const [events, setEvents] = useState<BlueprintDebugEvent[]>(() => debug.snapshot());
    const [logLevelMenuOpen, setLogLevelMenuOpen] = useState(false);
    const [safeAreaMenuOpen, setSafeAreaMenuOpen] = useState(false);
    const [expandedBp, setExpandedBp] = useState<Set<string>>(() => new Set());
    const [studioHint, setStudioHint] = useState<string | null>(null);
    const outputScrollRef = useRef<HTMLDivElement>(null);
    const logLevelMenuRef = useRef<HTMLDivElement>(null);
    const safeAreaMenuRef = useRef<HTMLDivElement>(null);

    const [surfaceSnap, setSurfaceSnap] = useState(() =>
        scopeBridge.getSurfaceStore(activeSurfaceId).getSnapshot(),
    );
    const [globalSnap, setGlobalSnap] = useState(() => scopeBridge.getGlobalSnapshot());
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
        setWidgetSnap(widgetRuntimeStore.getSnapshot());
        return widgetRuntimeStore.subscribe(() => {
            setWidgetSnap(widgetRuntimeStore.getSnapshot());
        });
    }, [widgetRuntimeStore]);

    // The highlight belongs to the row the pointer is on, so leaving the list by any route takes it
    // down: another tab, the drawer closing, the session being replaced by a timeline jump.
    useEffect(() => () => onHighlightElement(null), [tab, onHighlightElement]);

    useEffect(() => {
        if (tab !== "output") {
            return;
        }
        const el = outputScrollRef.current;
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
    }, [events, tab, outputLogLevels]);

    useEffect(() => {
        if (!logLevelMenuOpen) {
            return;
        }
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (target && logLevelMenuRef.current?.contains(target)) {
                return;
            }
            setLogLevelMenuOpen(false);
        };
        window.addEventListener("pointerdown", onPointerDown);
        return () => window.removeEventListener("pointerdown", onPointerDown);
    }, [logLevelMenuOpen]);

    useEffect(() => {
        if (!safeAreaMenuOpen) {
            return;
        }
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (target && safeAreaMenuRef.current?.contains(target)) {
                return;
            }
            setSafeAreaMenuOpen(false);
        };
        window.addEventListener("pointerdown", onPointerDown);
        return () => window.removeEventListener("pointerdown", onPointerDown);
    }, [safeAreaMenuOpen]);

    const chooseSafeArea = useCallback(
        (id: string | null) => {
            setSafeAreaId(id);
            setSafeAreaMenuOpen(false);
        },
        [setSafeAreaId],
    );

    // "What can I open in the workspace", scoped to the surface on screen — as opposed to the
    // debugger's "what can I set a breakpoint in". Both questions live in one switch; see the model.
    const blueprintsList = useMemo(() => {
        return listDevModeBlueprints(blueprintDocument.blueprints, {
            purpose: "workspace",
            scope: { document: uiDocument, activeSurfaceId },
        });
    }, [activeSurfaceId, blueprintDocument.blueprints, uiDocument]);

    const outputLines = useMemo(() => {
        return filterBlueprintDebugEventsByLogLevel(events, outputLogLevels);
    }, [events, outputLogLevels]);

    const outputLogLevelLabel = useMemo<Record<BlueprintOutputLogLevel, string>>(() => ({
        error: t("common.error"),
        warning: t("common.warning"),
        log: t("devMode.output.level.log"),
        verbose: t("devMode.output.level.verbose"),
    }), [t]);

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

    const toggleOutputLogLevel = useCallback((level: BlueprintOutputLogLevel) => {
        setOutputLogLevels(prev => {
            const next = new Set(prev);
            if (next.has(level)) {
                next.delete(level);
            } else {
                next.add(level);
            }
            return next;
        });
    }, []);

    const openInStudio = useCallback(
        async (bp: Blueprint) => {
            setStudioHint(null);
            const payload = buildStudioOpenPayload(bp, projectPath);
            if (!payload) {
                setStudioHint(t("devMode.blueprints.cannotOpen"));
                return;
            }
            const result = await getInterface().devMode.openBlueprintInWorkspace(payload);
            if (!result.success) {
                setStudioHint(result.error ?? t("devMode.blueprints.openFailed"));
                return;
            }
            setStudioHint(null);
        },
        [projectPath, t],
    );

    const rootClass = [
        "flex h-full min-h-0 shrink-0 flex-col bg-surface-sunken text-2xs text-fg-muted",
        // See StoryRuntimeDebugPanel: the left hairline is the seam against the stage, and a floating
        // panel already has a frame of its own.
        chrome?.floating ? "" : "border-l border-edge",
        className,
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <div className={rootClass}>
            {/* Also the drag handle while floating (see StoryRuntimeDebugPanel). */}
            <div
                className={`flex shrink-0 items-center justify-between gap-2 border-b border-edge px-2 py-1.5 ${
                    chrome?.floating ? "cursor-grab select-none active:cursor-grabbing" : ""
                }`}
                onPointerDown={chrome?.onTitleBarPointerDown}
            >
                <span className="text-xs font-medium text-fg">{t("devMode.devtools.title")}</span>
                <div className="flex shrink-0 items-center gap-1">
                    {/* Session-scoped: what this window shows, not a project or Studio setting.
                        `onPointerDown` is stopped so opening the menu does not start a panel drag. */}
                    <div ref={safeAreaMenuRef} className="relative" onPointerDown={e => e.stopPropagation()}>
                        <ToolbarButton
                            size="xs"
                            active={safeAreaId != null || safeAreaMenuOpen}
                            aria-label={t("uiEditor.preview.safeArea")}
                            title={t("uiEditor.preview.safeArea")}
                            aria-haspopup="menu"
                            aria-expanded={safeAreaMenuOpen}
                            onClick={() => setSafeAreaMenuOpen(prev => !prev)}
                        >
                            <Frame className="h-3.5 w-3.5" aria-hidden />
                        </ToolbarButton>
                        {safeAreaMenuOpen ? (
                            <div
                                role="menu"
                                aria-label={t("uiEditor.preview.safeArea")}
                                // Right-anchored: the panel's right edge is the window's when docked.
                                className="absolute right-0 top-full z-20 mt-1 w-40 rounded-lg border border-edge bg-surface-overlay p-1 shadow-xl"
                            >
                                {[
                                    { id: null, label: t("uiEditor.preview.off") },
                                    ...SAFE_AREA_PRESETS.map(preset => ({ id: preset.id, label: preset.reference })),
                                ].map(option => (
                                    <button
                                        key={option.id ?? "off"}
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={safeAreaId === option.id}
                                        className="flex w-full cursor-default items-center gap-2 rounded-md px-1.5 py-1 text-left text-2xs text-fg-muted hover:bg-fill hover:text-fg"
                                        onClick={() => chooseSafeArea(option.id)}
                                    >
                                        <span className="grid h-3 w-3 shrink-0 place-items-center">
                                            {safeAreaId === option.id ? (
                                                <Check className="h-3 w-3 text-primary" aria-hidden />
                                            ) : null}
                                        </span>
                                        <span className="truncate">{option.label}</span>
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                    <DevModePanelModeToggle chrome={chrome} />
                </div>
            </div>
            <div className="flex shrink-0 border-b border-edge bg-surface-sunken" role="tablist" aria-label={t("devMode.devtools.panelsAria")}>
                {(
                    [
                        ["blueprints", t("devMode.tabs.blueprints")],
                        ["output", t("devMode.tabs.output")],
                        ["uiState", t("devMode.tabs.uiState")],
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
                                active ? "bg-surface text-fg" : "text-fg-muted hover:bg-surface hover:text-fg"
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
                        {studioHint ? <p className="mb-2 text-2xs text-warning/90">{studioHint}</p> : null}
                        {blueprintsList.length === 0 ? (
                            <p className="text-2xs text-fg-subtle">{t("devMode.blueprints.empty")}</p>
                        ) : (
                            <ul
                                className="space-y-0.5"
                                // Per row on the way in, once on the way out: moving between rows is
                                // an enter on the new one, and the gaps between them are not a reason
                                // to blink the box off and back on.
                                onPointerLeave={() => onHighlightElement(null)}
                                onBlur={() => onHighlightElement(null)}
                            >
                                {blueprintsList.map(bp => {
                                    const expanded = expandedBp.has(bp.id);
                                    const canStudio = Boolean(projectPath) && studioPayloadSupported(bp);
                                    const widgetElementId = blueprintWidgetElementId(bp);
                                    return (
                                        <li
                                            key={bp.id}
                                            className="border-b border-edge-subtle pb-1.5 last:border-0"
                                            onPointerEnter={() => onHighlightElement(widgetElementId)}
                                            onFocus={() => onHighlightElement(widgetElementId)}
                                        >
                                            <div className="flex items-start gap-1">
                                                <button
                                                    type="button"
                                                    className="mt-0.5 shrink-0 text-fg-subtle hover:text-fg-muted"
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
                                                    <div className="truncate text-fg">{bp.name}</div>
                                                    <div className="truncate text-2xs text-fg-subtle">
                                                        {bp.id.slice(0, 10)}… · {bp.owner.kind}
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled={!canStudio}
                                                    className="shrink-0 rounded-md border border-edge px-1.5 py-0.5 text-2xs text-fg-muted hover:bg-fill disabled:cursor-not-allowed disabled:opacity-40"
                                                    onClick={() => void openInStudio(bp)}
                                                >
                                                    {t("devMode.blueprints.openWorkspace")}
                                                </button>
                                            </div>
                                            {expanded ? (
                                                <div className="mt-1 ml-5 space-y-0.5 text-2xs text-fg-subtle">
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
                        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge-subtle px-2 py-1">
                            <div ref={logLevelMenuRef} className="relative">
                                <button
                                    type="button"
                                    className="inline-flex items-center gap-1 rounded-md border border-edge px-2 py-0.5 text-2xs text-fg-muted hover:bg-fill"
                                    aria-haspopup="menu"
                                    aria-expanded={logLevelMenuOpen}
                                    onClick={() => setLogLevelMenuOpen(prev => !prev)}
                                >
                                    {t("devMode.output.logLevel")}
                                    <ChevronDown className="h-3 w-3 text-fg-subtle" />
                                </button>
                                {logLevelMenuOpen ? (
                                    <div
                                        role="menu"
                                        className="absolute left-0 top-full z-20 mt-1 w-32 rounded-lg border border-edge bg-surface-overlay p-1 shadow-xl"
                                    >
                                        {OUTPUT_LOG_LEVELS.map(level => (
                                            <label
                                                key={level}
                                                className="flex cursor-default items-center gap-2 rounded-md px-1.5 py-1 text-2xs text-fg-muted hover:bg-fill"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={outputLogLevels.has(level)}
                                                    onChange={() => toggleOutputLogLevel(level)}
                                                    className="h-3 w-3 rounded-sm border-edge-strong bg-surface-sunken"
                                                />
                                                {outputLogLevelLabel[level]}
                                            </label>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                            <button
                                type="button"
                                className="rounded-md border border-edge px-2 py-0.5 text-2xs text-fg-muted hover:bg-fill"
                                onClick={() => debug.clear()}
                            >
                                {t("common.clear")}
                            </button>
                        </div>
                        <div
                            ref={outputScrollRef}
                            className="nl-selectable-text min-h-0 flex-1 cursor-text overflow-auto overscroll-contain p-2"
                        >
                            {outputLines.length === 0 ? (
                                <p className="text-2xs text-fg-subtle">{t("devMode.output.empty")}</p>
                            ) : (
                                <ul className="space-y-1">
                                    {outputLines.map((ev, i) => (
                                        <li key={`${i}-${ev.type}`} className="break-all text-2xs text-fg-subtle">
                                            <span
                                                className={outputLogLevelClassName(getBlueprintDebugEventLogLevel(ev))}
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

                {tab === "uiState" ? (
                    <div className="min-h-0 flex-1 space-y-3 overflow-auto p-2">
                        <KeyValueBlock title={t("devMode.uiState.surface")} entries={surfaceSnap} surfaceId={activeSurfaceId} />
                        <KeyValueBlock title={t("devMode.uiState.global")} entries={globalSnap} />
                        {/* No Persistence block. It used to sit here as a raw storageKey → value dump,
                            which is the same data the Saves panel now shows BY NAME, plus a named
                            "other keys" list for what no declaration claims. Two readouts of one store
                            is how a reader ends up trusting the one that says less. */}
                        <div>
                            <h3 className="mb-1 text-2xs font-medium tracking-wide text-fg-subtle">{t("devMode.uiState.widget")}</h3>
                            <ul className="space-y-0.5 text-2xs text-fg-muted">
                                <li>
                                    {t("devMode.uiState.hover")} ·{" "}
                                    {widgetSnap.hoverTargetIds.size === 0
                                        ? "-"
                                        : [...widgetSnap.hoverTargetIds].map(id => `${id.slice(0, 6)}…`).join(", ")}
                                </li>
                                <li>{t("devMode.uiState.active")} · {widgetSnap.activePointerId ?? "-"}</li>
                                <li>{t("devMode.uiState.focus")} · {widgetSnap.focusedId ?? "-"}</li>
                                <li className="break-all">
                                    {t("devMode.uiState.variants")} ·{" "}
                                    {widgetSnap.variantOverrides.size === 0
                                        ? "-"
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
    return bp.owner.kind === "surfaceMain" || bp.owner.kind === "widgetMain" || bp.owner.kind === "widgetValue";
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
    if (owner.kind === "widgetValue") {
        return {
            projectPath,
            blueprintId: bp.id,
            ownerKind: "widgetValue",
            surfaceId: owner.surfaceId,
            elementId: owner.elementId,
            propPath: owner.propPath,
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
    const { t } = useTranslation();
    const keys = [...entries.keys()].sort();
    return (
        <div>
            {/* The drawer's section-heading style (see BlueprintDebuggerPanel's `Section`): an <h3>
                carrying FieldLabel's eyebrow typography, and not uppercased. */}
            <h3 className="mb-1 text-2xs font-medium tracking-wide text-fg-subtle">
                {title}
                {surfaceId ? <span className="text-fg-subtle"> · {surfaceId.slice(0, 8)}…</span> : null}
            </h3>
            {keys.length === 0 ? (
                <p className="text-2xs text-fg-subtle">{t("common.none")}</p>
            ) : (
                <ul className="space-y-0.5">
                    {keys.map(k => (
                        <li key={k} className="flex gap-2 text-2xs text-fg-muted">
                            <span className="w-[40%] shrink-0 truncate text-fg-subtle">{k}</span>
                            <span className="min-w-0 flex-1 break-all text-fg-muted">{formatDebugValue(entries.get(k))}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
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

function formatExecutionCancelled(ev: Extract<BlueprintDebugEvent, { type: "execution.cancelled" }>): string {
    const parts = [ev.reason || "cancelled"];
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

export function filterBlueprintDebugEventsByLogLevel(
    events: readonly BlueprintDebugEvent[],
    levels: ReadonlySet<BlueprintOutputLogLevel>,
): BlueprintDebugEvent[] {
    return events.filter(event => levels.has(getBlueprintDebugEventLogLevel(event)));
}

function outputLogLevelClassName(level: BlueprintOutputLogLevel): string {
    switch (level) {
        case "error":
            return "text-danger/90";
        case "warning":
            return "text-warning/90";
        case "log":
            return "text-primary/90";
        case "verbose":
            return "text-fg-subtle";
        default:
            return "text-fg-subtle";
    }
}

function formatDevtoolsLogLevel(level: string): string {
    const normalized = level.trim().toLowerCase();
    if (normalized === "warn") {
        return "warning";
    }
    if (normalized === "info") {
        return "log";
    }
    return normalized || "log";
}

function formatEvent(ev: BlueprintDebugEvent): string {
    switch (ev.type) {
        case "execution.started":
        case "execution.finished":
            return `${ev.blueprintId.slice(0, 8)}… / ${ev.executionId.slice(0, 8)}…`;
        case "execution.error":
            return formatExecutionError(ev);
        case "execution.cancelled":
            return formatExecutionCancelled(ev);
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
        case "devtools.log":
            return `${formatDevtoolsLogLevel(ev.level)} · ${ev.message}`;
        default:
            return JSON.stringify(ev);
    }
}
