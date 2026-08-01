import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DevModeBundle } from "@shared/types/devMode";
import type { StoryBlockId, StoryDocument, StoryLiteralValue, StoryScene, StorySceneId, StoryVariableValueType } from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import { Select } from "@/lib/components/elements/Select";
import type { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { GameAppStoryRuntimeBridge } from "@/lib/ui-editor/runtime/app/GameAppHost";
import { buildSceneFlowGraph } from "@/apps/workspace/modules/story-flow/sceneFlowModel";
import { SceneFlowCanvas } from "@/apps/workspace/modules/story-flow/SceneFlowCanvas";
// The same readability band the story editor's nametag uses. Imported rather than restated so an
// accent that the editor refuses to draw cannot quietly reappear here (both are Studio chrome, both
// render on the light and the dark surface).
import { isReadableAccentColor } from "@/apps/workspace/modules/story/scene-editor/storySceneBlockUtils";
import {
    branchDeltaFor,
    collectBranchEffects,
    computeVariableRanges,
    listNumericStoryVariables,
    type SceneFlowNumericVariable,
} from "@/apps/workspace/modules/story-flow/sceneFlowVariables";
import { getStorySceneName, storyRowSentence, type StoryRowLookups } from "@/lib/story/storyRowProjection";
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
    seedStoryRunTrail,
    type DeclaredStoryVariable,
    type StackViewLike,
    type StoryRuntimeVariableScope,
    type StoryRunTrail,
    type StorySceneBlockIndex,
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
 *
 * The accent colour is banded here, at the lookup, rather than where it is painted: the projection's
 * `StoryRowCharacter.color` is documented as "when the surface has one and *it is readable*", so the
 * one place that knows this is Studio chrome is the one place that fills the slot.
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
            if (!character) {
                return null;
            }
            const color = character.color;
            return {
                name: character.name,
                ...(color && isReadableAccentColor(color) ? { color } : {}),
            };
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
    /** Dock/float mode toggle + title-bar drag, owned by DevModeContent. */
    chrome?: DevModePanelChrome;
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
    const { storyRuntime, scopeBridge, bundle, className, chrome } = props;
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
                    <SceneTab
                        storyRuntime={storyRuntime}
                        scopeBridge={scopeBridge}
                        document={document}
                        entrySceneId={context.sceneId}
                        trail={trail}
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
                // Read-only surface: no editing placeholders (same as the timeline above).
                return block ? storyRowSentence(block, lookups, { editingPlaceholders: false }) : null;
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
                    <p className="mb-1 text-2xs tracking-wide text-fg-subtle">{t("devMode.runtime.contextRunning")}</p>
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
                                    title={branch.sentence ?? undefined}
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
                                {row.speaker ? (
                                    <span
                                        className={row.speakerColor ? undefined : "text-fg-subtle"}
                                        style={row.speakerColor ? { color: row.speakerColor } : undefined}
                                    >
                                        {row.speaker}:{" "}
                                    </span>
                                ) : null}
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
): number | null {
    // Matched on scope + id rather than re-deriving the storage key: `listDeclaredStoryVariables` is
    // what the Variables tab reads, and two derivations of one key is how a panel starts showing a
    // value that belongs to nothing.
    const declared = listDeclaredStoryVariables(document, sceneId).find(
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
}): ReactNode {
    const { storyRuntime, scopeBridge, document, entrySceneId, trail } = props;
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

    // Reuse the workspace scene-flow projection (no second node graph — see the M5 card WI-5 / §8).
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

    const numericVariables = useMemo(() => listNumericStoryVariables(document), [document]);
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
        for (const [sceneId, range] of computeVariableRanges(graph, document, focused.key)) {
            chips[sceneId] = formatStoryVariableRangeChip(range);
        }
        return chips;
    }, [focused, graph, document]);

    const liveValue = useMemo(() => {
        void currentActionId;
        void persistTick;
        return focused
            ? readLiveNumericValue(storyRuntime, scopeBridge, document, currentSceneId, focused)
            : null;
    }, [focused, storyRuntime, scopeBridge, document, currentSceneId, currentActionId, persistTick]);

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
                            title={t("devMode.runtime.focusLive")}
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
