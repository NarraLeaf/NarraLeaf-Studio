import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DevModeBundle } from "@shared/types/devMode";
import type { StoryDocument, StoryLiteralValue, StorySceneId, StoryVariableValueType } from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import type { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { GameAppStoryRuntimeBridge, StoryRuntimeStackView } from "@/lib/ui-editor/runtime/app/GameAppHost";
import { buildSceneFlowGraph } from "@/apps/workspace/modules/story-flow/sceneFlowModel";
import { SceneFlowCanvas } from "@/apps/workspace/modules/story-flow/SceneFlowCanvas";
import {
    blockIdForActionId,
    firstActionIdForBlock,
    listDeclaredStoryVariables,
    projectSceneTimeline,
    type DeclaredStoryVariable,
    type StoryRuntimeVariableScope,
    type StoryTimelineRow,
} from "./storyRuntimeDebugModel";

type StoryRuntimeTabId = "variables" | "stack" | "timeline" | "scene";

type StoryRuntimeDebugPanelProps = {
    storyRuntime: GameAppStoryRuntimeBridge;
    /** App-level persistent store (the "Persis" scope), shared with UI blueprints. */
    scopeBridge: ScopeStoreBridge;
    bundle: DevModeBundle;
    className?: string;
};

const SCOPE_LABEL: Record<StoryRuntimeVariableScope, string> = {
    // Editor command-token vocabulary (/local, /var, /persis) — see the M5 card WI-1.
    scene: "Local",
    saved: "Var",
    persistent: "Persis",
};

/** Coalesce the play-head stream to at most one re-read per frame (WI-2: throttle high-frequency). */
function useStoryRuntimeTick(storyRuntime: GameAppStoryRuntimeBridge): number {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        let raf = 0;
        const flush = (): void => {
            raf = 0;
            setTick(value => value + 1);
        };
        const unsubscribe = storyRuntime.subscribeCurrentAction(() => {
            if (!raf) {
                raf = requestAnimationFrame(flush);
            }
        });
        return () => {
            if (raf) {
                cancelAnimationFrame(raf);
            }
            unsubscribe();
        };
    }, [storyRuntime]);
    return tick;
}

/**
 * The scene currently executing: the current block resolves to whichever scene owns it (every scene
 * is compiled, so this follows jumps). Falls back to the launched scene before the first action.
 */
function resolveRunningSceneId(
    storyRuntime: GameAppStoryRuntimeBridge,
    document: StoryDocument,
    currentActionId: string | null,
    fallbackSceneId: StorySceneId,
): StorySceneId {
    const blockId = blockIdForActionId(storyRuntime.getActionIdBindings(), currentActionId);
    if (blockId) {
        for (const [id, scene] of Object.entries(document.scenes)) {
            if (blockId in scene.blocks) {
                return id;
            }
        }
    }
    return fallbackSceneId;
}

function useCurrentActionId(storyRuntime: GameAppStoryRuntimeBridge): string | null {
    const [actionId, setActionId] = useState<string | null>(() => storyRuntime.getCurrentActionId());
    useEffect(() => {
        let raf = 0;
        const flush = (): void => {
            raf = 0;
            setActionId(storyRuntime.getCurrentActionId());
        };
        setActionId(storyRuntime.getCurrentActionId());
        const unsubscribe = storyRuntime.subscribeCurrentAction(() => {
            if (!raf) {
                raf = requestAnimationFrame(flush);
            }
        });
        return () => {
            if (raf) {
                cancelAnimationFrame(raf);
            }
            unsubscribe();
        };
    }, [storyRuntime]);
    return actionId;
}

export function StoryRuntimeDebugPanel(props: StoryRuntimeDebugPanelProps): ReactNode {
    const { storyRuntime, scopeBridge, bundle, className } = props;
    const { t } = useTranslation();
    const [tab, setTab] = useState<StoryRuntimeTabId>("variables");

    // The running story + entry scene are fixed for a session; a relaunch (cold jump / snapshot
    // switch) replaces the whole GameApp session, so reading once per render is enough.
    const context = storyRuntime.getStoryContext();
    const document: StoryDocument | undefined = context
        ? bundle.storyLibrary?.documents[context.storyId]
        : undefined;

    const rootClass = ["flex h-full min-h-0 shrink-0 flex-col border-l border-edge bg-surface-sunken text-2xs text-fg-muted", className]
        .filter(Boolean)
        .join(" ");

    const snapshots = useMemo(() => {
        if (!document || !context) {
            return [];
        }
        return document.scenes[context.sceneId]?.sceneSnapshots ?? [];
    }, [document, context]);

    const onSelectSnapshot = useCallback(
        (snapshotId: string) => {
            const current = storyRuntime.getStoryContext();
            if (!current) {
                return;
            }
            void storyRuntime.relaunch({
                startBlockId: current.startBlockId,
                snapshotId: snapshotId || undefined,
            }).catch(() => {
                // Relaunch is a debug affordance; a superseded/failed run is swallowed quietly.
            });
        },
        [storyRuntime],
    );

    return (
        <div className={rootClass}>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-2 py-1.5">
                <span className="text-xs font-medium text-fg">{t("devMode.runtime.title")}</span>
                {snapshots.length > 0 ? (
                    <select
                        className="max-w-[55%] shrink-0 truncate rounded border border-edge bg-surface-sunken px-1.5 py-0.5 text-2xs text-fg-muted outline-none focus-visible:border-edge-strong"
                        value={context?.snapshotId ?? ""}
                        aria-label={t("devMode.runtime.snapshot")}
                        onChange={event => onSelectSnapshot(event.target.value)}
                    >
                        <option value="">{t("devMode.runtime.snapshotDefault")}</option>
                        {snapshots.map(snapshot => (
                            <option key={snapshot.id} value={snapshot.id}>
                                {snapshot.name}
                            </option>
                        ))}
                    </select>
                ) : null}
            </div>

            <div className="flex shrink-0 border-b border-edge bg-surface-sunken" role="tablist" aria-label={t("devMode.runtime.panelsAria")}>
                {(
                    [
                        ["variables", t("devMode.tabs.variables")],
                        ["stack", t("devMode.tabs.stack")],
                        ["timeline", t("devMode.tabs.timeline")],
                        ["scene", t("devMode.tabs.scene")],
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
                {!document || !context ? (
                    <p className="p-2 text-2xs text-fg-subtle">{t("devMode.runtime.noStory")}</p>
                ) : tab === "variables" ? (
                    <VariablesTab
                        storyRuntime={storyRuntime}
                        scopeBridge={scopeBridge}
                        document={document}
                        entrySceneId={context.sceneId}
                    />
                ) : tab === "stack" ? (
                    <StackTab storyRuntime={storyRuntime} />
                ) : tab === "timeline" ? (
                    <TimelineTab storyRuntime={storyRuntime} document={document} sceneId={context.sceneId} bundle={bundle} />
                ) : (
                    <SceneTab storyRuntime={storyRuntime} document={document} entrySceneId={context.sceneId} />
                )}
            </div>
        </div>
    );
}

// --- Variables ---------------------------------------------------------------------------------

function VariablesTab(props: {
    storyRuntime: GameAppStoryRuntimeBridge;
    scopeBridge: ScopeStoreBridge;
    document: StoryDocument;
    entrySceneId: StorySceneId;
}): ReactNode {
    const { storyRuntime, scopeBridge, document, entrySceneId } = props;
    const { t } = useTranslation();
    const currentActionId = useCurrentActionId(storyRuntime);
    const [persistTick, setPersistTick] = useState(0);
    const [writeTick, setWriteTick] = useState(0);

    useEffect(() => {
        return scopeBridge.subscribePersistence(() => setPersistTick(value => value + 1));
    }, [scopeBridge]);

    // Follow the running scene so its Local variables are shown with live values (their namespace
    // only exists while that scene is active), consistent with the timeline / scene tabs.
    const sceneId = useMemo(
        () => resolveRunningSceneId(storyRuntime, document, currentActionId, entrySceneId),
        [storyRuntime, document, currentActionId, entrySceneId],
    );

    const declared = useMemo(() => listDeclaredStoryVariables(document, sceneId), [document, sceneId]);

    const rows = useMemo(() => {
        void currentActionId;
        void persistTick;
        void writeTick;
        const namespaces = storyRuntime.getVariableNamespaces();
        const sceneNs = namespaces.sceneLocal[sceneId] ?? null;
        const sceneValues = sceneNs ? storyRuntime.readStorableNamespace(sceneNs) : null;
        const savedValues = namespaces.saved ? storyRuntime.readStorableNamespace(namespaces.saved) : null;
        return declared.map(variable => {
            let live = false;
            let value: unknown;
            if (variable.scope === "scene") {
                if (sceneValues && variable.storageKey in sceneValues) {
                    live = true;
                    value = sceneValues[variable.storageKey];
                } else {
                    value = variable.defaultValue;
                }
            } else if (variable.scope === "saved") {
                if (savedValues && variable.storageKey in savedValues) {
                    live = true;
                    value = savedValues[variable.storageKey];
                } else {
                    value = variable.defaultValue;
                }
            } else {
                const stored = scopeBridge.persistenceGet(variable.storageKey);
                live = stored !== undefined;
                value = stored !== undefined ? stored : variable.defaultValue;
            }
            return { variable, value, live };
        });
    }, [declared, sceneId, storyRuntime, scopeBridge, currentActionId, persistTick, writeTick]);

    const writeValue = useCallback(
        (variable: DeclaredStoryVariable, value: StoryLiteralValue) => {
            if (variable.scope === "persistent") {
                scopeBridge.persistenceSet(variable.storageKey, value);
            } else {
                const namespaces = storyRuntime.getVariableNamespaces();
                const name = variable.scope === "scene" ? namespaces.sceneLocal[sceneId] ?? null : namespaces.saved;
                if (name) {
                    storyRuntime.writeStorableValue(name, variable.storageKey, value);
                }
            }
            setWriteTick(value2 => value2 + 1);
        },
        [scopeBridge, storyRuntime, sceneId],
    );

    if (rows.length === 0) {
        return <p className="p-2 text-2xs text-fg-subtle">{t("devMode.runtime.noVariables")}</p>;
    }

    const scopes: StoryRuntimeVariableScope[] = ["scene", "saved", "persistent"];
    return (
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-2">
            {scopes.map(scope => {
                const scopeRows = rows.filter(row => row.variable.scope === scope);
                if (scopeRows.length === 0) {
                    return null;
                }
                return (
                    <div key={scope}>
                        <p className="mb-1 text-2xs tracking-wide text-fg-subtle">{SCOPE_LABEL[scope]}</p>
                        <ul className="space-y-1">
                            {scopeRows.map(row => (
                                <li key={`${scope}:${row.variable.id}`} className="flex items-center gap-2">
                                    <span className="w-[42%] shrink-0 truncate text-fg-muted" title={row.variable.name}>
                                        {row.variable.name}
                                    </span>
                                    <VariableValueEditor
                                        valueType={row.variable.valueType}
                                        value={row.value}
                                        live={row.live}
                                        onCommit={value => writeValue(row.variable, value)}
                                    />
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            })}
        </div>
    );
}

function VariableValueEditor(props: {
    valueType: StoryVariableValueType;
    value: unknown;
    live: boolean;
    onCommit: (value: StoryLiteralValue) => void;
}): ReactNode {
    const { valueType, value, live, onCommit } = props;

    if (valueType === "boolean") {
        return (
            <input
                type="checkbox"
                checked={value === true}
                className={`h-3 w-3 rounded border-edge-strong bg-surface-sunken ${live ? "" : "opacity-60"}`}
                onChange={event => onCommit(event.target.checked)}
            />
        );
    }
    return (
        <VariableTextEditor valueType={valueType} value={value} live={live} onCommit={onCommit} />
    );
}

function VariableTextEditor(props: {
    valueType: StoryVariableValueType;
    value: unknown;
    live: boolean;
    onCommit: (value: StoryLiteralValue) => void;
}): ReactNode {
    const { valueType, value, live, onCommit } = props;
    const initial = useMemo(() => formatEditableValue(valueType, value), [valueType, value]);
    const [draft, setDraft] = useState(initial);
    const [invalid, setInvalid] = useState(false);
    const focusedRef = useRef(false);

    // While the field is not being edited, keep it in sync with the live value.
    useEffect(() => {
        if (!focusedRef.current) {
            setDraft(initial);
            setInvalid(false);
        }
    }, [initial]);

    const commit = useCallback(() => {
        const parsed = parseEditableValue(valueType, draft);
        if (!parsed.ok) {
            setInvalid(true);
            return;
        }
        setInvalid(false);
        onCommit(parsed.value);
    }, [draft, onCommit, valueType]);

    return (
        <input
            type="text"
            value={draft}
            spellCheck={false}
            className={`min-w-0 flex-1 rounded border bg-surface-sunken px-1.5 py-0.5 text-2xs outline-none focus-visible:border-edge-strong ${
                invalid ? "border-danger/60 text-danger" : "border-edge text-fg-muted"
            } ${live ? "" : "opacity-60"}`}
            onFocus={() => { focusedRef.current = true; }}
            onBlur={() => {
                focusedRef.current = false;
                commit();
            }}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    commit();
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    setDraft(initial);
                    setInvalid(false);
                    event.currentTarget.blur();
                }
            }}
        />
    );
}

function formatEditableValue(valueType: StoryVariableValueType, value: unknown): string {
    if (value === undefined || value === null) {
        return "";
    }
    if (valueType === "json") {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

function parseEditableValue(
    valueType: StoryVariableValueType,
    raw: string,
): { ok: true; value: StoryLiteralValue } | { ok: false } {
    const trimmed = raw.trim();
    if (valueType === "number") {
        if (trimmed === "") {
            return { ok: false };
        }
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false };
    }
    if (valueType === "json") {
        if (trimmed === "") {
            return { ok: true, value: null };
        }
        try {
            return { ok: true, value: JSON.parse(trimmed) as StoryLiteralValue };
        } catch {
            return { ok: false };
        }
    }
    // string
    return { ok: true, value: raw };
}

// --- Call stack --------------------------------------------------------------------------------

function StackTab(props: { storyRuntime: GameAppStoryRuntimeBridge }): ReactNode {
    const { storyRuntime } = props;
    const { t } = useTranslation();
    const tick = useStoryRuntimeTick(storyRuntime);

    const snapshot = useMemo<StoryRuntimeStackView | null>(() => {
        void tick;
        return storyRuntime.getStackSnapshot();
    }, [storyRuntime, tick]);

    const bindings = storyRuntime.getActionIdBindings();

    if (!snapshot || (snapshot.root.frames.length === 0 && snapshot.async.length === 0)) {
        return <p className="p-2 text-2xs text-fg-subtle">{t("devMode.runtime.noStack")}</p>;
    }

    return (
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-2">
            <StackColumn label={t("devMode.runtime.stackRoot")} stack={snapshot.root} bindings={bindings} t={t} />
            {snapshot.async.map((stack, index) => (
                <StackColumn
                    key={`async-${index}`}
                    label={stack.tag ?? t("devMode.runtime.stackAsync")}
                    stack={stack}
                    bindings={bindings}
                    t={t}
                />
            ))}
        </div>
    );
}

function StackColumn(props: {
    label: string;
    stack: StoryRuntimeStackView["root"];
    bindings: readonly { staticId: string; blockId: string }[];
    t: ReturnType<typeof useTranslation>["t"];
}): ReactNode {
    const { label, stack, bindings, t } = props;
    const loop = stack.loop;
    return (
        <div>
            <p className="mb-1 flex items-center gap-2 text-2xs tracking-wide text-fg-subtle">
                <span>{label}</span>
                {loop ? (
                    <span className="text-fg-subtle">
                        {t("devMode.runtime.loop", {
                            type: loop.type,
                            counter: loop.limit != null ? `${loop.counter}/${loop.limit}` : String(loop.counter),
                        })}
                    </span>
                ) : null}
            </p>
            {stack.frames.length === 0 ? (
                <p className="text-2xs text-fg-subtle">{t("common.none")}</p>
            ) : (
                <StackFrames frames={stack.frames} bindings={bindings} t={t} depth={0} />
            )}
        </div>
    );
}

function StackFrames(props: {
    frames: StoryRuntimeStackView["root"]["frames"];
    bindings: readonly { staticId: string; blockId: string }[];
    t: ReturnType<typeof useTranslation>["t"];
    depth: number;
}): ReactNode {
    const { frames, bindings, t, depth } = props;
    return (
        <ul className="space-y-0.5">
            {frames.map((frame, index) => {
                const blockId = frame.actionId ? blockIdForActionId(bindings, frame.actionId) : null;
                return (
                    <li key={`${depth}-${index}-${frame.actionId ?? "none"}`} style={{ paddingLeft: depth * 10 }}>
                        <span className="text-fg-muted">{frame.actionType ?? "?"}</span>
                        {blockId ? <span className="text-fg-subtle"> · {blockId.slice(0, 8)}…</span> : null}
                        {frame.branchWaitType ? (
                            <span className="text-fg-subtle"> · {frame.branchWaitType}</span>
                        ) : null}
                        {frame.branches?.map((branch, branchIndex) => (
                            <div key={`branch-${branchIndex}`} className="mt-0.5 border-l border-edge-subtle pl-1.5">
                                <span className="text-2xs text-fg-subtle">
                                    {t("devMode.runtime.branch", { index: String(branchIndex + 1) })}
                                </span>
                                <StackFrames frames={branch} bindings={bindings} t={t} depth={depth + 1} />
                            </div>
                        ))}
                    </li>
                );
            })}
        </ul>
    );
}

// --- Timeline (L2) -----------------------------------------------------------------------------

function TimelineTab(props: {
    storyRuntime: GameAppStoryRuntimeBridge;
    document: StoryDocument;
    sceneId: StorySceneId;
    bundle: DevModeBundle;
}): ReactNode {
    const { storyRuntime, document, sceneId: entrySceneId, bundle } = props;
    const { t } = useTranslation();
    const currentActionId = useCurrentActionId(storyRuntime);
    const currentRowRef = useRef<HTMLLIElement>(null);

    const charactersById = useMemo(
        () => new Map((bundle.storyLibrary?.characters ?? []).map(character => [character.id, character])),
        [bundle.storyLibrary],
    );

    const currentBlockId = useMemo(
        () => blockIdForActionId(storyRuntime.getActionIdBindings(), currentActionId),
        [storyRuntime, currentActionId],
    );

    // The timeline follows the running scene so the play head stays on screen across jumps; every
    // scene is compiled, so the current block resolves to whichever scene is live. Falls back to the
    // launched scene before the first action.
    const runningSceneId = useMemo<StorySceneId>(() => {
        if (currentBlockId) {
            for (const [id, scene] of Object.entries(document.scenes)) {
                if (currentBlockId in scene.blocks) {
                    return id;
                }
            }
        }
        return entrySceneId;
    }, [currentBlockId, document, entrySceneId]);

    const rows = useMemo<StoryTimelineRow[]>(() => {
        const scene = document.scenes[runningSceneId];
        return scene ? projectSceneTimeline(scene, charactersById, document.scenes) : [];
    }, [document, runningSceneId, charactersById]);

    // Keep the play head in view as execution advances, without stealing scroll from a manual review.
    useEffect(() => {
        currentRowRef.current?.scrollIntoView({ block: "nearest" });
    }, [currentBlockId, runningSceneId]);

    const jumpToRow = useCallback(
        async (row: StoryTimelineRow) => {
            const context = storyRuntime.getStoryContext();
            if (!context) {
                return;
            }
            const bindings = storyRuntime.getActionIdBindings();
            const orderIndex = (blockId: string | null) =>
                blockId ? rows.findIndex(candidate => candidate.blockId === blockId) : -1;
            const targetIndex = orderIndex(row.blockId);
            const activeBlockId = blockIdForActionId(bindings, storyRuntime.getCurrentActionId());
            const currentIndex = orderIndex(activeBlockId);
            const targetActionId = firstActionIdForBlock(bindings, row.blockId);

            // Hot jump only forward within the running scene from the current point; anything else (or
            // a failed / unreachable fast-forward) silently falls back to a cold relaunch at the row.
            if (targetActionId && currentIndex >= 0 && targetIndex > currentIndex) {
                try {
                    const result = await storyRuntime.fastForwardToActionId(targetActionId);
                    if (result.reason === "action" && result.reachedTarget) {
                        return;
                    }
                } catch {
                    // fall through to the cold jump
                }
            }
            // The snapshot only seeds the entry scene; a cold jump into another scene uses defaults.
            await storyRuntime.relaunch({
                sceneId: runningSceneId,
                startBlockId: row.blockId,
                snapshotId: runningSceneId === entrySceneId ? context.snapshotId : undefined,
            }).catch(() => {
                // superseded / failed relaunch — swallow (debug affordance)
            });
        },
        [rows, runningSceneId, entrySceneId, storyRuntime],
    );

    if (rows.length === 0) {
        return <p className="p-2 text-2xs text-fg-subtle">{t("devMode.runtime.noRows")}</p>;
    }

    return (
        <div className="min-h-0 flex-1 overflow-auto p-1">
            <ul>
                {rows.map(row => {
                    const isCurrent = row.blockId === currentBlockId;
                    return (
                        <li
                            key={row.blockId}
                            ref={isCurrent ? currentRowRef : undefined}
                            className={`flex cursor-default items-baseline gap-2 rounded px-1.5 py-0.5 ${
                                isCurrent ? "bg-primary/15 text-fg" : "text-fg-muted hover:bg-fill"
                            } ${row.disabled ? "opacity-45" : ""}`}
                            onClick={row.disabled ? undefined : () => void jumpToRow(row)}
                        >
                            <span className="w-7 shrink-0 select-none text-right text-2xs tabular-nums text-fg-subtle">
                                {row.lineNumber}
                            </span>
                            <span
                                className="min-w-0 flex-1 truncate text-2xs"
                                style={{ paddingLeft: row.depth * 10 }}
                                title={row.summary}
                            >
                                {row.summary}
                            </span>
                            {isCurrent ? (
                                <span className="shrink-0 select-none text-2xs text-primary" aria-hidden>
                                    ▶
                                </span>
                            ) : null}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

// --- Scene graph (L1) --------------------------------------------------------------------------

function SceneTab(props: {
    storyRuntime: GameAppStoryRuntimeBridge;
    document: StoryDocument;
    entrySceneId: StorySceneId;
}): ReactNode {
    const { storyRuntime, document, entrySceneId } = props;
    const currentActionId = useCurrentActionId(storyRuntime);

    // Reuse the workspace scene-flow projection (no second node graph — see the M5 card WI-5 / §8).
    const graph = useMemo(() => buildSceneFlowGraph(document), [document]);

    // The running scene follows the play head across jumps (see resolveRunningSceneId).
    const currentSceneId = useMemo(
        () => resolveRunningSceneId(storyRuntime, document, currentActionId, entrySceneId),
        [storyRuntime, document, currentActionId, entrySceneId],
    );

    const openScene = useCallback(
        (sceneId: StorySceneId) => {
            void storyRuntime.relaunch({ sceneId }).catch(() => {
                // superseded / failed relaunch — swallow (debug affordance)
            });
        },
        [storyRuntime],
    );

    return (
        <div className="min-h-0 flex-1">
            <SceneFlowCanvas
                graph={graph}
                positionOverrides={{}}
                currentSceneId={currentSceneId}
                onOpenScene={openScene}
                // Positions are ephemeral in the read-only Dev Mode embed; drags just move the picture.
                onMoveScene={() => undefined}
            />
        </div>
    );
}
