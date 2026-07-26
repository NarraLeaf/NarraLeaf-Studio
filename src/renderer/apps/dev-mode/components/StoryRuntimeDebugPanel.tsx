import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DevModeBundle } from "@shared/types/devMode";
import type { StoryBlockId, StoryDocument, StoryLiteralValue, StoryScene, StorySceneId, StoryVariableValueType } from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import { Select } from "@/lib/components/elements/Select";
import type { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { GameAppStoryRuntimeBridge } from "@/lib/ui-editor/runtime/app/GameAppHost";
import { buildSceneFlowGraph } from "@/apps/workspace/modules/story-flow/sceneFlowModel";
import { SceneFlowCanvas } from "@/apps/workspace/modules/story-flow/SceneFlowCanvas";
import { getStorySceneName, storyRowSentence, type StoryRowLookups } from "@/lib/story/storyRowProjection";
import {
    blockIdForActionId,
    listDeclaredStoryVariables,
    projectExecutionContext,
    projectSceneTimeline,
    type DeclaredStoryVariable,
    type StackViewLike,
    type StoryRuntimeVariableScope,
    type StoryTimelineRow,
} from "./storyRuntimeDebugModel";

type StoryRuntimeTabId = "variables" | "context" | "timeline" | "scene";

/**
 * Node titles in the Dev Mode embed must stay readable after the fit zooms the graph down to fit a
 * 380px panel: at the measured 0.60 the 12px title rendered at 7.2px. The canvas compensates by
 * scaling its type up as the zoom drops (see `SceneFlowCanvas.minTitleRenderedPx`).
 */
const SCENE_GRAPH_MIN_TITLE_PX = 11.5;

/**
 * The lookups the shared row projection takes, from what a Dev Mode bundle actually carries.
 *
 * This is the whole of what the M5 stopgap could not do: characters arrive as `DevModeCharacterSummary`
 * (a name, no service) and asset names as the bundle's `assetNames` table, so the panel can read a row
 * exactly as the editor writes it without ever reaching for a workspace service.
 */
function useStoryRowLookups(bundle: DevModeBundle, document: StoryDocument, scene: StoryScene | undefined): StoryRowLookups {
    const charactersById = useMemo(
        () => new Map((bundle.storyLibrary?.characters ?? []).map(character => [character.id, character])),
        [bundle.storyLibrary],
    );
    const assetNames = bundle.storyLibrary?.assetNames;
    return useMemo<StoryRowLookups>(() => ({
        character: characterId => {
            const character = charactersById.get(characterId);
            return character ? { name: character.name } : null;
        },
        assetName: assetId => assetNames?.[assetId] ?? null,
        scene,
        scenes: document.scenes,
        document,
    }), [charactersById, assetNames, scene, document]);
}

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

/**
 * The play head as a Studio row: the last block an executed action belonged to.
 *
 * Resolved inside the subscription rather than at flush time, because the id stream is not
 * replayable — a row whose action shares a frame with a later one (the engine's own tail action
 * after the last row of a scene, an async branch) would otherwise never be seen, and the play head
 * would sit a row behind whatever actually ran. Ids that belong to no Studio block leave the head
 * where it is; a null id (no story running) clears it.
 */
function useCurrentBlockId(storyRuntime: GameAppStoryRuntimeBridge): StoryBlockId | null {
    const [blockId, setBlockId] = useState<StoryBlockId | null>(
        () => blockIdForActionId(storyRuntime.getActionIdBindings(), storyRuntime.getCurrentActionId()),
    );
    useEffect(() => {
        let raf = 0;
        let next: StoryBlockId | null = blockIdForActionId(
            storyRuntime.getActionIdBindings(),
            storyRuntime.getCurrentActionId(),
        );
        setBlockId(next);
        const flush = (): void => {
            raf = 0;
            setBlockId(next);
        };
        const unsubscribe = storyRuntime.subscribeCurrentAction(actionId => {
            if (actionId !== null) {
                const resolved = blockIdForActionId(storyRuntime.getActionIdBindings(), actionId);
                if (!resolved) {
                    return;
                }
                next = resolved;
            } else {
                next = null;
            }
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
    return blockId;
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

    // `.nl-editor-surface` rather than `bg-surface-sunken`: the same paint, at the
    // `editor.surfaceOpacity` the author chose for the editor's reading surfaces. Identical at the
    // default 100%.
    const rootClass = ["nl-editor-surface flex h-full min-h-0 shrink-0 flex-col border-l border-edge text-2xs text-fg-muted", className]
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

    const snapshotOptions = useMemo(
        () => [
            { value: "", label: t("devMode.runtime.snapshotDefault") },
            ...snapshots.map(snapshot => ({ value: snapshot.id, label: snapshot.name })),
        ],
        [snapshots, t],
    );

    // Permanent, unlike the old Stack tab that vanished whenever the root stack drained: at the root
    // of a scene it still answers "which scene is running", which is a question demo3 could never get
    // an answer to from anywhere in this panel.
    const tabs = useMemo(
        () => ([
            ["variables", t("devMode.tabs.variables")],
            ["context", t("devMode.tabs.context")],
            ["timeline", t("devMode.tabs.timeline")],
            ["scene", t("devMode.tabs.scene")],
        ] as [StoryRuntimeTabId, string][]),
        [t],
    );
    return (
        <div className={rootClass}>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-2 py-1.5">
                <span className="text-xs font-medium text-fg">{t("devMode.runtime.title")}</span>
                {snapshots.length > 0 ? (
                    <Select
                        className="max-w-[55%] shrink-0"
                        size="sm"
                        portalMenu
                        options={snapshotOptions}
                        value={context?.snapshotId ?? ""}
                        onChange={value => onSelectSnapshot(String(value))}
                    />
                ) : null}
            </div>

            {/* No fill of its own: it is a direct child of the panel surface and the paint was the
                same token, so repeating it here would double the alpha at anything under 100%. */}
            <div className="flex shrink-0 border-b border-edge" role="tablist" aria-label={t("devMode.runtime.panelsAria")}>
                {tabs.map(([id, label]) => {
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
                ) : tab === "context" ? (
                    <ExecutionContextTab
                        storyRuntime={storyRuntime}
                        document={document}
                        entrySceneId={context.sceneId}
                        bundle={bundle}
                    />
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
                className={`h-3 w-3 rounded-sm border-edge-strong bg-surface-sunken ${live ? "" : "opacity-60"}`}
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
            className={`min-w-0 flex-1 rounded-md border bg-surface-sunken px-1.5 py-0.5 text-2xs outline-none focus-visible:border-edge-strong ${
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

// --- Execution context -------------------------------------------------------------------------

/**
 * Where the story is, in the author's terms.
 *
 * What it replaced printed the engine's stack verbatim — `Root  control:all · u4f1x7e0… · all
 * branch 1`: two engine enums, a truncated block id shown to a person who cannot use it, branches
 * numbered but not named, and no round count at all. None of those is a question an author asks. The
 * four that they do ask — which scene, inside what, which round, who is running — are the four things
 * this tab answers, and three of them come from the story document rather than the engine.
 */
function ExecutionContextTab(props: {
    storyRuntime: GameAppStoryRuntimeBridge;
    document: StoryDocument;
    entrySceneId: StorySceneId;
    bundle: DevModeBundle;
}): ReactNode {
    const { storyRuntime, document, entrySceneId, bundle } = props;
    const { t } = useTranslation();
    const tick = useStoryRuntimeTick(storyRuntime);
    const currentBlockId = useCurrentBlockId(storyRuntime);

    const sceneId = useMemo<StorySceneId>(() => {
        if (currentBlockId) {
            for (const [id, scene] of Object.entries(document.scenes)) {
                if (currentBlockId in scene.blocks) {
                    return id;
                }
            }
        }
        return entrySceneId;
    }, [currentBlockId, document, entrySceneId]);

    const scene = document.scenes[sceneId];
    const lookups = useStoryRowLookups(bundle, document, scene);

    const view = useMemo(() => {
        void tick;
        const stack = storyRuntime.getStackSnapshot() as StackViewLike | null;
        const bindings = storyRuntime.getActionIdBindings();
        return projectExecutionContext({
            scene,
            sceneName: getStorySceneName(document.scenes, sceneId),
            currentBlockId,
            stack,
            bindings,
            rowSentence: blockId => {
                const block = scene?.blocks[blockId];
                return block ? storyRowSentence(block, lookups) : null;
            },
        });
    }, [tick, storyRuntime, scene, sceneId, document, currentBlockId, lookups]);

    return (
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-2">
            <div>
                <p className="mb-1 text-2xs tracking-wide text-fg-subtle">{t("devMode.runtime.contextScene")}</p>
                <p className="truncate text-fg" title={view.sceneName}>{view.sceneName}</p>
            </div>

            {view.chain.length > 0 || view.orphanRound ? (
                <div>
                    <p className="mb-1 text-2xs tracking-wide text-fg-subtle">{t("devMode.runtime.contextInside")}</p>
                    <ul className="space-y-0.5">
                        {view.chain.map((rung, index) => (
                            <li key={rung.blockId} className="flex items-baseline gap-1.5" style={{ paddingLeft: index * 10 }}>
                                <span className="truncate text-fg-muted">{rung.pill}</span>
                                {rung.round ? <RoundCounter round={rung.round} /> : null}
                            </li>
                        ))}
                        {view.orphanRound ? (
                            <li className="flex items-baseline gap-1.5" style={{ paddingLeft: view.chain.length * 10 }}>
                                <RoundCounter round={view.orphanRound} />
                            </li>
                        ) : null}
                    </ul>
                </div>
            ) : null}

            {view.branches.length > 0 ? (
                <div>
                    <p className="mb-1 text-2xs tracking-wide text-fg-subtle">{t("devMode.runtime.contextRunning")}</p>
                    <ul className="space-y-0.5">
                        {view.branches.map(branch => (
                            <li key={branch.index} className="flex items-baseline gap-1.5">
                                <span className="w-3 shrink-0 select-none text-right tabular-nums text-fg-subtle">
                                    {branch.index}
                                </span>
                                <span className="min-w-0 truncate text-fg-muted" title={branch.sentence ?? undefined}>
                                    {branch.sentence ?? t("common.none")}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}

/** `2/3` — which round of a repeat is running. Tabular so the digits do not jitter as it counts. */
function RoundCounter(props: { round: { current: number; limit?: number } }): ReactNode {
    const { round } = props;
    return (
        <span className="shrink-0 tabular-nums text-fg-subtle">
            {round.limit != null ? `${round.current}/${round.limit}` : String(round.current)}
        </span>
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
    const currentRowRef = useRef<HTMLLIElement>(null);

    const currentBlockId = useCurrentBlockId(storyRuntime);

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

    const runningScene = document.scenes[runningSceneId];
    const lookups = useStoryRowLookups(bundle, document, runningScene);

    const rows = useMemo<StoryTimelineRow[]>(
        () => (runningScene ? projectSceneTimeline(runningScene, lookups) : []),
        [runningScene, lookups],
    );

    // Keep the play head in view as execution advances, without stealing scroll from a manual review.
    useEffect(() => {
        currentRowRef.current?.scrollIntoView({ block: "nearest" });
    }, [currentBlockId, runningSceneId]);

    /**
     * Snapshot first: a row this session already played is restored from its own backlog snapshot —
     * exact, immediate, no replay. Everything else (never played, played but not a backlog line, a
     * trimmed backlog after an earlier restore) is a cold relaunch that enters the story at that
     * row. Row order is deliberately not consulted: with `/label` + `/goto` it is not the execution
     * order, and "has it played" is the question that actually decides which mechanism applies.
     */
    const jumpToRow = useCallback(
        async (row: StoryTimelineRow) => {
            const context = storyRuntime.getStoryContext();
            if (!context) {
                return;
            }
            const token = storyRuntime.getPlayedBlockTokens()[row.blockId];
            if (token && storyRuntime.restoreToHistoryToken(token)) {
                return;
            }
            try {
                // The snapshot only seeds the entry scene; a cold jump into another scene uses defaults.
                await storyRuntime.relaunch({
                    sceneId: runningSceneId,
                    startBlockId: row.blockId,
                    snapshotId: runningSceneId === entrySceneId ? context.snapshotId : undefined,
                });
            } catch (error) {
                // A superseded or failed relaunch leaves the play head where it was; say so in the
                // console rather than looking like a click that did nothing.
                console.warn("[DevMode] timeline jump failed", error);
            }
        },
        [runningSceneId, entrySceneId, storyRuntime],
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
                            className={`relative flex cursor-default items-baseline gap-2 rounded-md px-1.5 py-0.5 ${
                                isCurrent ? "bg-primary/15 text-fg" : "text-fg-muted hover:bg-fill"
                            } ${row.disabled ? "opacity-45" : ""}`}
                            onClick={row.disabled ? undefined : () => void jumpToRow(row)}
                        >
                            {/* The editor's own category bar, same hue and same weight - a row that is
                                a `/bg` there has to look like a `/bg` here, or the two lists are two
                                different readings of one story. Prose rows carry none in either. */}
                            {row.barColor ? (
                                <span
                                    aria-hidden
                                    className="pointer-events-none absolute inset-y-0 left-0 w-[3px] rounded-l-md"
                                    style={{ backgroundColor: row.barColor, opacity: 0.85 }}
                                />
                            ) : null}
                            <span className="w-7 shrink-0 select-none text-right text-2xs tabular-nums text-fg-subtle">
                                {row.lineNumber}
                            </span>
                            <span
                                className="min-w-0 flex-1 truncate text-2xs"
                                style={{ paddingLeft: row.depth * 10 }}
                                title={row.speaker ? `${row.speaker}: ${row.summary}` : row.summary}
                            >
                                {/* Repeated on every line, unlike the editor's grouped nametag: at
                                    380px there is no second line to hang an attribution rail from, so
                                    the name has to ride with the words it belongs to. */}
                                {row.speaker ? <span className="text-fg-subtle">{row.speaker}: </span> : null}
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
                // A 380px panel fits the graph at a zoom that shrinks the titles below legibility, so
                // the embed asks for a floor and buys the rest back with a tighter frame.
                minTitleRenderedPx={SCENE_GRAPH_MIN_TITLE_PX}
                fitPadding={0.06}
            />
        </div>
    );
}
