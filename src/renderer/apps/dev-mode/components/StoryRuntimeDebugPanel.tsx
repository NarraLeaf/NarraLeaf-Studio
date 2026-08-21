import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type { DevModeBundle } from "@shared/types/devMode";
import type { StoryBlock, StoryBlockId, StoryDocument, StoryLiteralValue, StoryScene, StorySceneId, StoryVariableValueType } from "@shared/types/story";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { getInterface } from "@/lib/app/bridge";
import { Select } from "@/lib/components/elements/Select";
import { Switch } from "@/lib/components/elements";
import type { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { GameAppStoryRuntimeBridge } from "@/lib/ui-editor/runtime/app/GameAppHost";
import { buildSceneFlowGraph } from "@/apps/workspace/modules/story-flow/sceneFlowModel";
import { SceneFlowCanvas } from "@/apps/workspace/modules/story-flow/SceneFlowCanvas";
import {
    branchDeltaFor,
    collectBranchEffects,
    computeVariableRanges,
    listNumericStoryVariables,
    type SceneFlowNumericVariable,
} from "@/apps/workspace/modules/story-flow/sceneFlowVariables";
import { getStorySceneName, storyRowSentence, type StoryRowLookups } from "@/lib/story/storyRowProjection";
// The editor's own row furniture, so a row reads the same in both places. All three marks are
// plain React with no workspace service behind them, and `getBlockBadgeInfo` takes a block and
// nothing else — the same seam the shared row projection was split along.
import { getBlockBadgeInfo } from "@/apps/workspace/modules/story/scene-editor/storySceneBlockUtils";
import {
    StoryCommandGlyphMark,
    StoryNarratorRingMark,
    StorySpeakerDiscMark,
    StorySpeakerName,
    STORY_MARK_PX,
} from "@/apps/workspace/modules/story/scene-editor/StoryRowGutterMark";
import {
    characterSpeakerIdentity,
    unknownSpeakerIdentity,
    type StorySpeakerIdentity,
} from "@/apps/workspace/modules/story/scene-editor/storySpeakerIdentity";
import { DevModePanelModeToggle, type DevModePanelChrome } from "./DevModePanelChrome";
import {
    advanceStoryRunTrail,
    blockIdForActionId,
    buildStorySceneBlockIndex,
    formatStoryVariableDeltaChip,
    formatStoryVariableRangeChip,
    listDeclaredStoryVariables,
    projectExecutionContext,
    projectSceneTimeline,
    projectStoryTrailHighlight,
    resolveSceneIdForBlock,
    seedStoryRunTrail,
    type DeclaredStoryVariable,
    type StackViewLike,
    type StoryRuntimeVariableScope,
    type StoryRunTrail,
    type StorySceneBlockIndex,
    type StoryTimelineRow,
} from "./storyRuntimeDebugModel";
import { buildStoryRowLookups } from "./runtimeIssueModel";

type StoryRuntimeTabId = "variables" | "context" | "timeline" | "scene";

/**
 * Node titles in the Dev Mode embed must stay readable after the fit zooms the graph down to fit a
 * 380px panel: at the measured 0.60 the 12px title rendered at 7.2px. The canvas compensates by
 * scaling its type up as the zoom drops (see `SceneFlowCanvas.minTitleRenderedPx`).
 */
const SCENE_GRAPH_MIN_TITLE_PX = 11.5;

/**
 * The timeline's single-line box, and the two fixed columns measured against it.
 *
 * {@link STORY_MARK_PX} rather than the editor's own 28px row box: that number exists to clear the
 * dialogue nametag control, which this surface does not have, so here the mark is the tallest thing
 * in a row and the box is its height. Everything in a row centres inside this box and the row grows
 * below it, which is what keeps a number, a mark and a sentence on one line.
 */
const TIMELINE_ROW_BOX_PX = STORY_MARK_PX;
const TIMELINE_MARK_PX = STORY_MARK_PX;

/** Wide enough for three digits at `text-2xs`; a scene with four is longer than anyone scrolls. */
const TIMELINE_NUMBER_PX = 20;

/**
 * One nesting level, in px. Tighter than the editor's, and deliberately: 380px of panel spends 46 of
 * them on the two fixed columns before a word is printed, and a choice three levels deep still has
 * to have a sentence left.
 */
const TIMELINE_INDENT_PX = 8;

/**
 * The lookups the shared row projection takes, from what a Dev Mode bundle actually carries.
 *
 * This is the whole of what the M5 stopgap could not do: characters arrive as `DevModeCharacterSummary`
 * (a name, no service) and asset names as the bundle's `assetNames` table, so the panel can read a row
 * exactly as the editor writes it without ever reaching for a workspace service.
 *
 * The building itself lives in `runtimeIssueModel` because the error banner needs the identical
 * lookups with no panel in sight — an error that quotes line 37 has to quote it the way this panel
 * and the editor do, and two copies of the rule would drift with only one of them being watched.
 */
function useStoryRowLookups(bundle: DevModeBundle, document: StoryDocument, scene: StoryScene | undefined): StoryRowLookups {
    return useMemo(
        () => buildStoryRowLookups(bundle, document, scene),
        [bundle, document, scene],
    );
}

/**
 * The project variable registry, both scopes, as this window can actually reach it.
 *
 * Off the bundle and NOT off `LocalBlueprintService`: Dev Mode is a separate window with no workspace
 * services at all, which is why the registry is baked into the bundle in the first place. It is also
 * why there is no subscription to refresh — a bundle is a snapshot of the project the running game
 * was compiled from, and a panel that reported a variable the run does not have would be describing a
 * different game than the one on screen.
 */
function useBundleVariableRegistry(bundle: DevModeBundle): {
    saved: VariableRegistryEntry[];
    persistent: VariableRegistryEntry[];
} {
    return useMemo(() => ({
        saved: Object.values(bundle.ui.savedVariables ?? {}),
        persistent: Object.values(bundle.ui.persistentVariables ?? {}),
    }), [bundle]);
}

type StoryRuntimeDebugPanelProps = {
    storyRuntime: GameAppStoryRuntimeBridge;
    /** App-level persistent store (the "Persis" scope), shared with UI blueprints. */
    scopeBridge: ScopeStoreBridge;
    bundle: DevModeBundle;
    /** The project this window is running, for the one affordance that leaves it: open a row in Studio. */
    projectPath: string | null;
    className?: string;
    /** Dock/float mode toggle + title-bar drag, owned by DevModeContent. */
    chrome?: DevModePanelChrome;
};

const SCOPE_LABEL: Record<StoryRuntimeVariableScope, string> = {
    // Editor command-token vocabulary (/local, /var, /persis).
    scene: "Local",
    saved: "Var",
    persistent: "Persis",
};

/** Coalesce the play-head stream to at most one re-read per frame. */
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
 * The scene currently executing, starting from an engine action id rather than a Studio block —
 * which is what the two tabs that track the play head with {@link useCurrentActionId} hold.
 */
function resolveRunningSceneId(
    storyRuntime: GameAppStoryRuntimeBridge,
    document: StoryDocument,
    currentActionId: string | null,
    fallbackSceneId: StorySceneId,
): StorySceneId {
    return resolveSceneIdForBlock(
        document,
        blockIdForActionId(storyRuntime.getActionIdBindings(), currentActionId),
        fallbackSceneId,
    );
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

const EMPTY_SCENE_BLOCK_INDEX: StorySceneBlockIndex = {
    sceneIdByBlockId: new Map(),
    jumpBlockIds: new Set(),
};

/**
 * The trail of a run, kept alive across the panel closing.
 *
 * Keyed by the run's own action↔block binding table, which is exactly the right key: every relaunch
 * (snapshot switch, cold jump, hot reload) recompiles the story and mints a new one, so a resumed
 * trail can only ever be this run's, and a relaunched run always starts from an empty one. Weak, so
 * a finished run's trail goes when its compiled story does.
 *
 * It is a module-level cache rather than state because the debug drawer is closed and reopened
 * constantly and unmounts this panel every time; without it, watching the game for ten seconds would
 * erase the record of the ten minutes before.
 */
const trailByRun = new WeakMap<object, StoryRunTrail>();

/**
 * Where this run has been — the half of the scene map only Dev Mode can draw.
 *
 * Folded out of the play-head stream because nothing else keeps it (see {@link StoryRunTrail}), and
 * folded INSIDE the subscription rather than at flush time for the reason {@link useCurrentBlockId}
 * records: the id stream is not replayable, and a jump that shares a frame with the target scene's
 * first action would otherwise never be seen — which is precisely the action the arm attribution
 * needs. Renders are still coalesced to one per frame.
 *
 * What it cannot know is stated where it is drawn: a scene entered before this panel was ever opened
 * leaves no step, and a timeline restore rewinds the run without rewinding the trail.
 */
function useStoryRunTrail(
    storyRuntime: GameAppStoryRuntimeBridge,
    document: StoryDocument | undefined,
    entrySceneId: StorySceneId | null,
): StoryRunTrail {
    const index = useMemo(
        () => (document ? buildStorySceneBlockIndex(document) : EMPTY_SCENE_BLOCK_INDEX),
        [document],
    );
    const [trail, setTrail] = useState<StoryRunTrail>(
        () => trailByRun.get(storyRuntime.getActionIdBindings()) ?? seedStoryRunTrail(entrySceneId),
    );

    useEffect(() => {
        let raf = 0;
        let bindings: object = storyRuntime.getActionIdBindings();
        let next = trailByRun.get(bindings) ?? seedStoryRunTrail(
            storyRuntime.getStoryContext()?.sceneId ?? entrySceneId,
        );
        trailByRun.set(bindings, next);
        setTrail(next);

        const flush = (): void => {
            raf = 0;
            setTrail(next);
        };
        const unsubscribe = storyRuntime.subscribeCurrentAction(actionId => {
            const current = storyRuntime.getActionIdBindings();
            if (current !== bindings) {
                // A relaunch recompiles the story and hands back a new binding table. Whatever was
                // walked belonged to the run that table replaced, so the trail starts over — which
                // is also why no "reset trail" button is needed.
                bindings = current;
                next = seedStoryRunTrail(storyRuntime.getStoryContext()?.sceneId ?? entrySceneId);
            }
            const blockId = blockIdForActionId(current, actionId);
            const advanced = advanceStoryRunTrail(next, {
                sceneId: blockId ? index.sceneIdByBlockId.get(blockId) ?? null : null,
                blockId,
                isJump: blockId !== null && index.jumpBlockIds.has(blockId),
            });
            trailByRun.set(bindings, advanced);
            if (advanced === next) {
                return;
            }
            next = advanced;
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
    }, [storyRuntime, index, entrySceneId]);

    return trail;
}

export function StoryRuntimeDebugPanel(props: StoryRuntimeDebugPanelProps): ReactNode {
    const { storyRuntime, scopeBridge, bundle, projectPath, className, chrome } = props;
    const { t } = useTranslation();
    const [tab, setTab] = useState<StoryRuntimeTabId>("variables");

    // The running story + entry scene are fixed for a session; a relaunch (cold jump / snapshot
    // switch) replaces the whole GameApp session, so reading once per render is enough.
    const context = storyRuntime.getStoryContext();
    const document: StoryDocument | undefined = context
        ? bundle.storyLibrary?.documents[context.storyId]
        : undefined;

    // Subscribed at the panel, not inside the Scene tab: the trail is a record of the run, and a
    // record that only accrues while one of four tabs happens to be open is not one.
    const trail = useStoryRunTrail(storyRuntime, document, context?.sceneId ?? null);

    // `.nl-editor-surface` rather than `bg-surface-sunken`: the same paint, at the
    // `editor.surfaceOpacity` the author chose for the editor's reading surfaces. Identical at the
    // default 100%.
    const rootClass = [
        "nl-editor-surface flex h-full min-h-0 shrink-0 flex-col text-2xs text-fg-muted",
        // Docked, the left hairline is the seam against the stage. Floating, the panel carries its
        // own frame, and a second line just inside it reads as a rendering fault.
        chrome?.floating ? "" : "border-l border-edge",
        className,
    ]
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
            {/* Also the drag handle while floating: the press is taken on this row and the owner
                moves the whole panel. The title stays a DIRECT child so the row keeps its identity
                as "the title bar" for anything that looks it up by its text. */}
            <div
                className={`flex shrink-0 items-center justify-between gap-2 border-b border-edge px-2 py-1.5 ${
                    chrome?.floating ? "cursor-grab select-none active:cursor-grabbing" : ""
                }`}
                onPointerDown={chrome?.onTitleBarPointerDown}
            >
                <span className="text-xs font-medium text-fg">{t("devMode.runtime.title")}</span>
                <div className="flex shrink-0 items-center gap-1">
                    {snapshots.length > 0 ? (
                        <Select
                            className="max-w-[13rem] shrink-0"
                            size="sm"
                            portalMenu
                            options={snapshotOptions}
                            value={context?.snapshotId ?? ""}
                            onChange={value => onSelectSnapshot(String(value))}
                        />
                    ) : null}
                    <DevModePanelModeToggle chrome={chrome} />
                </div>
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
                        bundle={bundle}
                    />
                ) : tab === "context" ? (
                    <ExecutionContextTab
                        storyRuntime={storyRuntime}
                        document={document}
                        entrySceneId={context.sceneId}
                        bundle={bundle}
                    />
                ) : tab === "timeline" ? (
                    <TimelineTab
                        storyRuntime={storyRuntime}
                        document={document}
                        sceneId={context.sceneId}
                        bundle={bundle}
                        projectPath={projectPath}
                    />
                ) : (
                    <SceneTab
                        storyRuntime={storyRuntime}
                        scopeBridge={scopeBridge}
                        document={document}
                        entrySceneId={context.sceneId}
                        trail={trail}
                        bundle={bundle}
                    />
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
    bundle: DevModeBundle;
}): ReactNode {
    const { storyRuntime, scopeBridge, document, entrySceneId, bundle } = props;
    const registry = useBundleVariableRegistry(bundle);
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

    const declared = useMemo(
        () => listDeclaredStoryVariables(document, sceneId, registry.saved, registry.persistent),
        [document, sceneId, registry],
    );

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
                        <h3 className="mb-1 text-2xs font-medium tracking-wide text-fg-subtle">{SCOPE_LABEL[scope]}</h3>
                        <ul className="space-y-1">
                            {scopeRows.map(row => (
                                <li key={`${scope}:${row.variable.id}`} className="flex items-center gap-2">
                                    <span className="w-[42%] shrink-0 truncate text-fg-muted" data-tip={row.variable.name}>
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
            <Switch
                size="sm"
                checked={value === true}
                className={live ? undefined : "opacity-60"}
                onCheckedChange={onCommit}
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

    const sceneId = useMemo<StorySceneId>(
        () => resolveSceneIdForBlock(document, currentBlockId, entrySceneId),
        [currentBlockId, document, entrySceneId],
    );

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
                // Read-only surface: no editing placeholders (same as the timeline above).
                return block ? storyRowSentence(block, lookups, { editingPlaceholders: false }) : null;
            },
        });
    }, [tick, storyRuntime, scene, sceneId, document, currentBlockId, lookups]);

    return (
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-2">
            <div>
                <h3 className="mb-1 text-2xs font-medium tracking-wide text-fg-subtle">{t("devMode.runtime.contextScene")}</h3>
                <p className="truncate text-fg" data-tip={view.sceneName}>{view.sceneName}</p>
            </div>

            {view.chain.length > 0 || view.orphanRound ? (
                <div>
                    <h3 className="mb-1 text-2xs font-medium tracking-wide text-fg-subtle">{t("devMode.runtime.contextInside")}</h3>
                    <ul className="space-y-0.5">
                        {view.chain.map((rung, index) => (
                            <li key={rung.blockId} className="flex items-baseline gap-1.5" style={{ paddingLeft: index * 10 }}>
                                <span className="truncate text-fg-muted">{rung.pill}</span>
                                <RoundCounter round={rung.round} times={rung.times} />
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
                    <h3 className="mb-1 text-2xs font-medium tracking-wide text-fg-subtle">{t("devMode.runtime.contextRunning")}</h3>
                    <ul className="space-y-0.5">
                        {view.branches.map(branch => (
                            <li key={branch.index} className="flex items-baseline gap-1.5">
                                {/* The play head is in exactly one branch; the marker is the whole
                                    point of the list, since numbering branches was what the old
                                    tab already did and it said nothing. */}
                                <span className="w-2 shrink-0 select-none text-primary" aria-hidden>
                                    {branch.current ? "▸" : ""}
                                </span>
                                <span
                                    className={`min-w-0 truncate ${branch.current ? "text-fg" : "text-fg-muted"}`}
                                    data-tip={branch.sentence ?? undefined}
                                >
                                    {branch.sentence}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}

/**
 * `2/3` when the engine reports which round is running, `×3` when only the document knows how many
 * rounds there are — which is the case for every `/repeat` today (see `findReportedLoop`). Tabular so
 * the digits do not jitter as it counts.
 */
function RoundCounter(props: { round?: { current: number; limit?: number }; times?: number }): ReactNode {
    const { round, times } = props;
    if (round) {
        return (
            <span className="shrink-0 tabular-nums text-fg-subtle">
                {round.limit != null ? `${round.current}/${round.limit}` : String(round.current)}
            </span>
        );
    }
    if (times !== undefined) {
        return <span className="shrink-0 tabular-nums text-fg-subtle">{`×${times}`}</span>;
    }
    return null;
}

// --- Timeline (L2) -----------------------------------------------------------------------------

/**
 * The speaker of a dialogue row, as the disc and the nametag both need it.
 *
 * One function because §3.3 promises a character is ONE colour in every position they appear in, and
 * two derivations of "which colour is this name" is the only way to break it. The colour arrives
 * already judged for readability by the row projection, so it is honoured verbatim; a row with no
 * speaker yet is a person nobody has named, never the narrator.
 */
function timelineSpeakerIdentity(row: StoryTimelineRow, unassignedLabel: string): StorySpeakerIdentity {
    if (!row.speaker) {
        return unknownSpeakerIdentity(unassignedLabel);
    }
    return characterSpeakerIdentity(row.speaker, { hasPortrait: false, color: row.speakerColor ?? undefined });
}

/**
 * The mark at the head of a timeline row: who says it, or that nothing does.
 *
 * The editor's own gutter vocabulary, drawn by the editor's own components: a person is a solid disc,
 * the narrator a hollow ring, a directive a bare glyph in its category's hue. Not an approximation of
 * it — a `/bg` row has to be the same drawing here as in the editor, or this panel is a second
 * reading of the script rather than the same one.
 *
 * The one shape this surface cannot draw is the portrait: sprites need the asset library, which no
 * Dev Mode window has. The disc is that mark's documented downgrade — same size, same colour — so a
 * character still reads as that character.
 */
function TimelineRowMark(props: {
    row: StoryTimelineRow;
    block: StoryBlock | undefined;
    narratorLabel: string;
    unassignedLabel: string;
}): ReactNode {
    const { row, block, narratorLabel, unassignedLabel } = props;
    if (!block) {
        return null;
    }
    if (block.kind === "nodeAction" && block.payload.action === "narration") {
        return <StoryNarratorRingMark label={narratorLabel} />;
    }
    if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
        return <StorySpeakerDiscMark identity={timelineSpeakerIdentity(row, unassignedLabel)} />;
    }
    const badge = getBlockBadgeInfo(block);
    return <StoryCommandGlyphMark icon={badge.icon} label={badge.label} color={badge.iconColor} />;
}

function TimelineTab(props: {
    storyRuntime: GameAppStoryRuntimeBridge;
    document: StoryDocument;
    sceneId: StorySceneId;
    bundle: DevModeBundle;
    /** Names the workspace a row is opened in. Absent = no project behind this window, so no button. */
    projectPath: string | null;
}): ReactNode {
    const { storyRuntime, document, sceneId: entrySceneId, bundle, projectPath } = props;
    const { t } = useTranslation();
    const currentRowRef = useRef<HTMLLIElement>(null);

    const currentBlockId = useCurrentBlockId(storyRuntime);

    // The timeline follows the running scene so the play head stays on screen across jumps.
    const runningSceneId = useMemo<StorySceneId>(
        () => resolveSceneIdForBlock(document, currentBlockId, entrySceneId),
        [currentBlockId, document, entrySceneId],
    );

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

    /**
     * Open one row in the workspace story editor — the same request the debug menu makes of the play
     * head, asked of a row the author points at instead.
     *
     * Swallowed on failure like its neighbour above: the only way it fails is a project with no
     * workspace window, which cannot outlive the Dev Mode window it would have opened, and a list of
     * rows has nowhere to put a sentence about one of them.
     */
    const openRowInStudio = useCallback(
        async (row: StoryTimelineRow) => {
            const context = storyRuntime.getStoryContext();
            if (!projectPath || !context) {
                return;
            }
            const result = await getInterface().devMode.openStoryRowInWorkspace({
                projectPath,
                storyId: context.storyId,
                sceneId: runningSceneId,
                blockId: row.blockId,
            });
            if (!result.success) {
                console.warn("[DevMode] open row in Studio failed", result.error);
            }
        },
        [projectPath, runningSceneId, storyRuntime],
    );

    if (rows.length === 0) {
        return <p className="p-2 text-2xs text-fg-subtle">{t("devMode.runtime.noRows")}</p>;
    }

    const narratorLabel = t("story.badge.narration");
    const unassignedLabel = t("story.characterName.unassigned");
    const boxStyle = { height: TIMELINE_ROW_BOX_PX, lineHeight: `${TIMELINE_ROW_BOX_PX}px` };

    return (
        // `font-sans` cancels the panel's monospace. The other three tabs show values, and mono is
        // what tells a value from prose; this one shows the script, and a page of dialogue set in a
        // console face reads as a log OF the game rather than as the game.
        <div className="min-h-0 flex-1 overflow-auto py-1 font-sans">
            <ul>
                {rows.map(row => {
                    const isCurrent = row.blockId === currentBlockId;
                    const block = runningScene?.blocks[row.blockId];
                    return (
                        <li
                            key={row.blockId}
                            ref={isCurrent ? currentRowRef : undefined}
                            // The editor's row shell, to the class: one left rule that is the only
                            // thing ever coloured, and a fill that means "you are here". The 3px
                            // category bar this row used to carry is gone for the reason the editor
                            // dropped its own — a screen of directives became a screen of coloured
                            // bars. That colour lives on the glyph now, where it names one command
                            // rather than shouting a category.
                            className={cn(
                                "group flex cursor-default items-start gap-2 border-l-2 py-1 pl-1 pr-1",
                                isCurrent
                                    ? "border-primary bg-primary/15 text-fg"
                                    : "border-transparent text-fg-muted hover:bg-fill-subtle",
                                row.disabled ? "opacity-45" : "",
                            )}
                            onClick={row.disabled ? undefined : () => void jumpToRow(row)}
                        >
                            {/* Every column is centred inside the same single-line box and the row
                                grows below it (`items-start`), so a wrapped line would keep its first
                                line level with its mark instead of floating to the middle. */}
                            <span
                                className={cn(
                                    "shrink-0 select-none text-right text-2xs tabular-nums transition-colors",
                                    isCurrent ? "text-primary" : "text-fg-subtle/60 group-hover:text-fg-subtle",
                                )}
                                style={{ ...boxStyle, width: TIMELINE_NUMBER_PX }}
                            >
                                {row.lineNumber}
                            </span>
                            <span
                                className="flex shrink-0 items-center justify-center"
                                style={{
                                    ...boxStyle,
                                    width: TIMELINE_MARK_PX,
                                    marginLeft: row.depth * TIMELINE_INDENT_PX,
                                }}
                            >
                                <TimelineRowMark
                                    row={row}
                                    block={block}
                                    narratorLabel={narratorLabel}
                                    unassignedLabel={unassignedLabel}
                                />
                            </span>
                            <span
                                className="min-w-0 flex-1 truncate text-xs"
                                style={boxStyle}
                                data-tip={row.speaker ? `${row.speaker}: ${row.summary}` : row.summary}
                            >
                                {row.speaker ? (
                                    <StorySpeakerName
                                        identity={timelineSpeakerIdentity(row, unassignedLabel)}
                                        className="mr-1.5"
                                    />
                                ) : null}
                                {row.summary}
                            </span>
                            {/* Painted only on the row under the pointer, but present on every one:
                                it holds its own width, so the sentence beside it does not re-truncate
                                as the pointer moves down the list. Opacity rather than `hidden`,
                                because a control that leaves the DOM cannot be tabbed to. */}
                            {projectPath ? (
                                <button
                                    type="button"
                                    className="flex shrink-0 items-center justify-center rounded-md px-0.5 text-fg-subtle opacity-0 transition-opacity hover:bg-fill hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
                                    style={{ height: TIMELINE_ROW_BOX_PX }}
                                    data-tip={t("devMode.openInStudio")}
                                    aria-label={t("devMode.openInStudio")}
                                    onClick={event => {
                                        // The row underneath means "play from here"; this means "go
                                        // and edit it". Two requests on one target, so the press must
                                        // not reach both.
                                        event.stopPropagation();
                                        void openRowInStudio(row);
                                    }}
                                >
                                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                                </button>
                            ) : null}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

// --- Scene graph (L1) --------------------------------------------------------------------------

/**
 * The focused counter's value in the run that is happening.
 *
 * Read exactly the way `VariablesTab` reads its rows — and refusing exactly the fallback that tab
 * makes: a declared default is NOT a live value. A number on this strip is read as "the run is
 * here", so a variable the namespace has not written yet, a scope with no namespace, or a value that
 * is not a finite number all report nothing. A wrong live number is worse than no number, because
 * the static range beside it is right and the author would trust the pair.
 */
function readLiveNumericValue(
    storyRuntime: GameAppStoryRuntimeBridge,
    scopeBridge: ScopeStoreBridge,
    document: StoryDocument,
    sceneId: StorySceneId,
    variable: SceneFlowNumericVariable,
    registry: { saved: readonly VariableRegistryEntry[]; persistent: readonly VariableRegistryEntry[] },
): number | null {
    // Matched on scope + id rather than re-deriving the storage key: `listDeclaredStoryVariables` is
    // what the Variables tab reads, and two derivations of one key is how a panel starts showing a
    // value that belongs to nothing.
    const declared = listDeclaredStoryVariables(document, sceneId, registry.saved, registry.persistent).find(
        candidate => candidate.scope === variable.scope && candidate.id === variable.variableId,
    );
    if (!declared) {
        return null;
    }
    let raw: unknown;
    if (declared.scope === "persistent") {
        raw = scopeBridge.persistenceGet(declared.storageKey);
    } else {
        const namespaces = storyRuntime.getVariableNamespaces();
        const name = declared.scope === "scene" ? namespaces.sceneLocal[sceneId] ?? null : namespaces.saved;
        const values = name ? storyRuntime.readStorableNamespace(name) : null;
        if (!values || !(declared.storageKey in values)) {
            return null;
        }
        raw = values[declared.storageKey];
    }
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function SceneTab(props: {
    storyRuntime: GameAppStoryRuntimeBridge;
    scopeBridge: ScopeStoreBridge;
    document: StoryDocument;
    entrySceneId: StorySceneId;
    trail: StoryRunTrail;
    bundle: DevModeBundle;
}): ReactNode {
    const { storyRuntime, scopeBridge, document, entrySceneId, trail, bundle } = props;
    const registry = useBundleVariableRegistry(bundle);
    // Flat, both scopes: every API below keys an entry by the scope it declares, and a counter an
    // author wants the map focused on is as likely to be a game-level flag as a per-playthrough one.
    const registryVariables = useMemo(() => [...registry.saved, ...registry.persistent], [registry]);
    const { t } = useTranslation();
    const currentActionId = useCurrentActionId(storyRuntime);

    // Ephemeral by construction, like the positions beside them: this embed restores no viewport and
    // persists no layout, so an expansion that outlived the panel would be the only thing that did.
    const [expandedSceneIds, setExpandedSceneIds] = useState<ReadonlySet<StorySceneId>>(() => new Set());
    /**
     * Scenes the author closed by hand.
     *
     * Tracked explicitly rather than left to effect ordering: auto-expansion follows the play head
     * and fires again on the very next action, so without a record of the manual close the author
     * would be re-opening a box the panel re-opens under them. Expanding it again by hand hands it
     * back to the play head.
     */
    const collapsedByHandRef = useRef<Set<StorySceneId>>(new Set());
    /** `storyVariableRefKey` of the focused counter; empty means no focus (chips off). */
    const [focusKey, setFocusKey] = useState("");
    const [persistTick, setPersistTick] = useState(0);

    // Reuse the workspace scene-flow projection (no second node graph).
    // The SAME set goes to the builder and to the canvas: the builder packs the column against the
    // taller boxes, and a canvas drawing rows the layout did not budget for overlaps its neighbours.
    const graph = useMemo(
        () => buildSceneFlowGraph(document, { expandedSceneIds }),
        [document, expandedSceneIds],
    );

    // The running scene follows the play head across jumps (see resolveRunningSceneId).
    const currentSceneId = useMemo(
        () => resolveRunningSceneId(storyRuntime, document, currentActionId, entrySceneId),
        [storyRuntime, document, currentActionId, entrySceneId],
    );

    const scenesWithArms = useMemo(
        () => new Set(graph.branches.map(branch => branch.sceneId)),
        [graph],
    );

    // The scene the run is in opens itself: it is the one the author is looking at, and at 380px
    // hunting for a chevron on a graph zoomed to fit is most of the interaction budget.
    useEffect(() => {
        if (!scenesWithArms.has(currentSceneId) || collapsedByHandRef.current.has(currentSceneId)) {
            return;
        }
        setExpandedSceneIds(current => {
            if (current.has(currentSceneId)) {
                return current;
            }
            const next = new Set(current);
            next.add(currentSceneId);
            return next;
        });
    }, [currentSceneId, scenesWithArms]);

    const toggleSceneExpanded = useCallback((sceneId: StorySceneId) => {
        setExpandedSceneIds(current => {
            const next = new Set(current);
            if (next.delete(sceneId)) {
                collapsedByHandRef.current.add(sceneId);
            } else {
                next.add(sceneId);
                collapsedByHandRef.current.delete(sceneId);
            }
            return next;
        });
    }, []);

    useEffect(() => {
        return scopeBridge.subscribePersistence(() => setPersistTick(value => value + 1));
    }, [scopeBridge]);

    const numericVariables = useMemo(
        () => listNumericStoryVariables(document, registryVariables),
        [document, registryVariables],
    );
    const focused = useMemo(
        () => numericVariables.find(variable => variable.key === focusKey) ?? null,
        [numericVariables, focusKey],
    );

    const focusOptions = useMemo(
        () => [
            { value: "", label: t("devMode.runtime.focusNone") },
            ...numericVariables.map(variable => ({ value: variable.key, label: variable.name })),
        ],
        [numericVariables, t],
    );

    /** What each arm does to the counter — the same arithmetic the workspace map labels its lines with. */
    const branchChips = useMemo(() => {
        if (!focused) {
            return undefined;
        }
        const effects = collectBranchEffects(graph, document);
        const chips: Record<string, string> = {};
        for (const branch of graph.branches) {
            const delta = branchDeltaFor(effects.get(branch.id) ?? [], focused.key);
            // Arms that never touch it carry no chip at all — absent and `?` are different answers.
            if (delta) {
                chips[branch.id] = formatStoryVariableDeltaChip(delta);
            }
        }
        return chips;
    }, [focused, graph, document]);

    /**
     * The counter's range ON ARRIVAL at each scene — what the author could be holding when they get
     * there, over every path, before that scene's own writes. Not a current value and not a final
     * one; the live number on the strip above is the only thing here that is either.
     */
    const sceneChips = useMemo(() => {
        if (!focused) {
            return undefined;
        }
        const chips: Record<StorySceneId, string> = {};
        for (const [sceneId, range] of computeVariableRanges(graph, document, focused.key, registryVariables)) {
            chips[sceneId] = formatStoryVariableRangeChip(range);
        }
        return chips;
    }, [focused, graph, document, registryVariables]);

    const liveValue = useMemo(() => {
        void currentActionId;
        void persistTick;
        return focused
            ? readLiveNumericValue(storyRuntime, scopeBridge, document, currentSceneId, focused, registry)
            : null;
    }, [focused, storyRuntime, scopeBridge, document, currentSceneId, currentActionId, persistTick, registry]);

    /**
     * The path this run has walked, dimming what it did not.
     *
     * Masked only once the run has actually gone somewhere: one scene is a position, not a path, and
     * masking on it would drop the whole map to 30% the instant the game starts to say something the
     * current-scene ring already says.
     */
    const highlight = useMemo(
        () => (trail.steps.length > 1 ? projectStoryTrailHighlight(trail, graph) : null),
        [trail, graph],
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
        <div className="flex min-h-0 flex-1 flex-col">
            {/* The picker lives here rather than in the title bar, which belongs to the snapshot
                select and the dock toggle — both of which act on the panel, not on this tab. */}
            {numericVariables.length > 0 ? (
                <div className="flex shrink-0 items-center gap-2 border-b border-edge px-2 py-1">
                    <Select
                        className="min-w-0 flex-1"
                        size="sm"
                        fullWidth
                        portalMenu
                        // Changes what is shown and writes nothing, so a frozen project must not
                        // clamp it shut.
                        inspectOnly
                        options={focusOptions}
                        value={focusKey}
                        onChange={value => setFocusKey(String(value))}
                    />
                    {focused && liveValue !== null ? (
                        <span
                            className="shrink-0 tabular-nums text-fg"
                            data-tip={t("devMode.runtime.focusLive")}
                        >
                            {`${focused.name} = ${liveValue}`}
                        </span>
                    ) : null}
                </div>
            ) : null}

            <div className="min-h-0 flex-1">
                <SceneFlowCanvas
                    graph={graph}
                    positionOverrides={{}}
                    currentSceneId={currentSceneId}
                    onOpenScene={openScene}
                    // Positions are ephemeral in the read-only Dev Mode embed; drags just move the picture.
                    onMoveScene={() => undefined}
                    expandedSceneIds={expandedSceneIds}
                    onToggleSceneExpanded={toggleSceneExpanded}
                    branchChips={branchChips}
                    sceneChips={sceneChips}
                    highlight={highlight}
                    // A 380px panel fits the graph at a zoom that shrinks the titles below legibility, so
                    // the embed asks for a floor and buys the rest back with a tighter frame.
                    minTitleRenderedPx={SCENE_GRAPH_MIN_TITLE_PX}
                    fitPadding={0.06}
                />
            </div>
        </div>
    );
}
