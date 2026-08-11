import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Play, RotateCw, Trash2 } from "lucide-react";
import type { DevModeBundle } from "@shared/types/devMode";
import type { StoryDocument } from "@shared/types/story";
import { sceneVariableDefs, storyPersistentDefs } from "@shared/types/story";
import { buildMergedPersistentView, type MergedPersistentEntry } from "@shared/variables/mergedPersistentView";
import type { TranslationKey } from "@shared/i18n";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import type { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type {
    GameAppSaveBridge,
    GameAppSaveRecord,
    GameAppStoryRuntimeBridge,
} from "@/lib/ui-editor/runtime/app/GameAppHost";
import type { RunningGameState, SaveLoadOutcome } from "@/lib/ui-editor/runtime/app/saveLoad";
import { collectSavedVariableView } from "@/lib/ui-editor/runtime/game/storyStageSnapshot";
import { getStorySceneName } from "@/lib/story/storyRowProjection";
import { DevModePanelModeToggle, type DevModePanelChrome } from "./DevModePanelChrome";
import { formatDebugValue } from "./debugValueFormat";
import {
    classifySaveLoadFailure,
    collectSaveLoadLosses,
    decodeSavedGameStore,
    projectPersistentStore,
    summarizeSaveSlot,
    type DecodedSave,
    type SaveLoadFailure,
    type SaveLoadLosses,
    type SaveSlotSummary,
    type SaveValueRow,
} from "./saveInspectorModel";

/** A slot as the list holds it: the heading it draws, and the record the contents section reads. */
type SaveSlotEntry = { summary: SaveSlotSummary; record: GameAppSaveRecord | null };

/** What the last load attempt on a slot did, drawn under that slot's row. */
type SaveLoadResult =
    | { kind: "ok"; losses: SaveLoadLosses }
    | { kind: "failed"; failure: SaveLoadFailure; game: RunningGameState };

/** What became of the run, as the line under a failed load. */
const RUNNING_GAME_STATE_KEYS = {
    unchanged: "devMode.saves.gameUnchanged",
    restored: "devMode.saves.gameRestored",
    lost: "devMode.saves.gameLost",
} as const satisfies Record<RunningGameState, TranslationKey>;

/**
 * A refused load as this panel draws failures.
 *
 * `missingElementId` stays null: a refusal names whatever the running story is missing, which is as
 * often an action as an element, and the wording that goes with that field claims an element.
 */
function refusalAsFailure(outcome: Extract<SaveLoadOutcome, { status: "refused" }>): SaveLoadFailure {
    return {
        tone: outcome.game === "lost" ? "danger" : "warning",
        missingElementId: null,
        message: outcome.detail,
    };
}

/**
 * The last result per slot, kept alive across this panel unmounting.
 *
 * It is unmounted far more often than it is read: closing the drawer unmounts it, and so does any
 * timeline jump, which would otherwise discard the report of the load that just failed. Module-level
 * for the same reason `StoryRuntimeDebugPanel`'s trail cache is: a Dev Mode window serves one
 * project, and these results belong to the window rather than to whichever view happens to be
 * mounted.
 */
const saveLoadResults = new Map<string, SaveLoadResult>();

type SavesDebugPanelProps = {
    /** Save slots, on the game's own Save/Load paths. */
    saves: GameAppSaveBridge;
    storyRuntime: GameAppStoryRuntimeBridge;
    /** App-level persistent store: project-wide, and deliberately NOT inside any save file. */
    scopeBridge: ScopeStoreBridge;
    bundle: DevModeBundle;
    className?: string;
    /** Dock/float mode toggle + title-bar drag, owned by DevModeContent. */
    chrome?: DevModePanelChrome;
};

/** Everything the decoder needs to turn storage keys into names, from the story that is running. */
type SaveNameTables = {
    savedNames: Map<string, string>;
    sceneNames: Map<string, string>;
    sceneVariableNames: Map<string, Map<string, string>>;
    optionNames: Map<string, string>;
};

const EMPTY_NAME_TABLES: SaveNameTables = {
    savedNames: new Map(),
    sceneNames: new Map(),
    sceneVariableNames: new Map(),
    optionNames: new Map(),
};

function buildNameTables(document: StoryDocument | undefined, bundle: DevModeBundle): SaveNameTables {
    if (!document) {
        return EMPTY_NAME_TABLES;
    }
    const tables: SaveNameTables = {
        savedNames: new Map(),
        sceneNames: new Map(),
        sceneVariableNames: new Map(),
        optionNames: new Map(),
    };
    // The merged saved view, not the story's own `/save` rows: after the declaration migration a
    // saved variable may exist only in the project registry, and reading the document alone would
    // render its key as unclaimed - the panel accusing the save of holding junk it declared itself.
    for (const entry of collectSavedVariableView(document, bundle.ui.savedVariables).entries) {
        tables.savedNames.set(entry.storageKey, entry.name);
    }
    for (const [sceneId, scene] of Object.entries(document.scenes)) {
        tables.sceneNames.set(sceneId, getStorySceneName(document.scenes, sceneId));
        const variables = new Map<string, string>();
        for (const def of Object.values(sceneVariableDefs(scene))) {
            variables.set(def.storageKey, def.name);
        }
        tables.sceneVariableNames.set(sceneId, variables);
        for (const block of Object.values(scene.blocks)) {
            if (block.kind === "nodeAction" && block.payload.action === "choiceOption") {
                tables.optionNames.set(block.id, block.payload.text.value);
            }
        }
    }
    return tables;
}

export function SavesDebugPanel(props: SavesDebugPanelProps): ReactNode {
    const { saves, storyRuntime, scopeBridge, bundle, className, chrome } = props;
    const { t, formatDate } = useTranslation();

    const [slots, setSlots] = useState<SaveSlotEntry[] | null>(null);
    const [listError, setListError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [results, setResults] = useState<Record<string, SaveLoadResult>>(
        () => Object.fromEntries(saveLoadResults),
    );

    const recordResult = useCallback((id: string, result: SaveLoadResult | null) => {
        if (result) {
            saveLoadResults.set(id, result);
        } else {
            saveLoadResults.delete(id);
        }
        setResults(previous => {
            const next = { ...previous };
            if (result) {
                next[id] = result;
            } else {
                delete next[id];
            }
            return next;
        });
    }, []);

    const context = storyRuntime.getStoryContext();
    const document: StoryDocument | undefined = context
        ? bundle.storyLibrary?.documents[context.storyId]
        : undefined;

    const names = useMemo(() => buildNameTables(document, bundle), [document, bundle]);

    /**
     * Read every slot, not just its ids.
     *
     * The record is what the list rows are made of (the last spoken line, the timestamp) AND what the
     * contents section decodes, so a second read on selection would only be a second chance for the
     * two halves to disagree. No thumbnails are read: `metadata.capture` is a base64 PNG, and
     * `readPreview` re-parses the whole record to hand one back.
     */
    const refresh = useCallback(async () => {
        setBusy(true);
        try {
            const ids = await saves.listIds();
            const entries = await Promise.all(ids.map(async (id): Promise<SaveSlotEntry> => {
                try {
                    const record = await saves.read(id);
                    return { summary: summarizeSaveSlot(id, record), record };
                } catch {
                    // A slot that will not parse is still a slot, and it is the most interesting one
                    // on the list - losing the whole list to it would hide the thing being looked for.
                    return { summary: summarizeSaveSlot(id, null), record: null };
                }
            }));
            entries.sort((a, b) => (b.summary.updatedAt ?? "").localeCompare(a.summary.updatedAt ?? ""));
            setSlots(entries);
            setListError(null);
        } catch (error) {
            setSlots([]);
            setListError(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
        }
    }, [saves]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const selected = useMemo(
        () => slots?.find(entry => entry.summary.id === selectedId) ?? null,
        [slots, selectedId],
    );

    /** One decode, read by the contents section and by the loss report a load produces. */
    const decode = useCallback((savedGame: unknown): DecodedSave => decodeSavedGameStore({
        savedGame,
        // Namespace names come from the running compile, prefix and all; nothing here rebuilds one.
        namespaces: storyRuntime.getVariableNamespaces(),
        savedNames: names.savedNames,
        sceneVariableNames: names.sceneVariableNames,
        sceneNames: names.sceneNames,
        optionNames: names.optionNames,
    }), [names, storyRuntime]);

    const decoded = useMemo<DecodedSave | null>(
        () => (selected?.record ? decode(selected.record.savedGame) : null),
        [selected, decode],
    );

    const load = useCallback(async (entry: SaveSlotEntry) => {
        const id = entry.summary.id;
        setBusy(true);
        try {
            const outcome = await saves.load(id);
            if (outcome.status === "refused") {
                recordResult(id, { kind: "failed", failure: refusalAsFailure(outcome), game: outcome.game });
                return;
            }
            const knownActionIds = new Set(storyRuntime.getActionIdBindings().map(binding => binding.staticId));
            const losses = collectSaveLoadLosses({
                savedGame: entry.record?.savedGame,
                knownActionIds,
                decoded: decode(entry.record?.savedGame),
            });
            recordResult(id, { kind: "ok", losses });
        } catch (error) {
            // Only a caller mistake reaches here now (no game runtime). It happens before anything
            // is touched, so the run is where it was.
            recordResult(id, { kind: "failed", failure: classifySaveLoadFailure(error), game: "unchanged" });
        } finally {
            setBusy(false);
        }
    }, [decode, recordResult, saves, storyRuntime]);

    const remove = useCallback(async (id: string) => {
        setBusy(true);
        try {
            await saves.remove(id);
        } catch (error) {
            setListError(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
        }
        recordResult(id, null);
        setSelectedId(current => (current === id ? null : current));
        await refresh();
    }, [recordResult, refresh, saves]);

    // `.nl-editor-surface` rather than `bg-surface-sunken`: the same paint at the author's
    // `editor.surfaceOpacity`, matching the sibling panels.
    const rootClass = cn(
        "nl-editor-surface flex h-full min-h-0 shrink-0 flex-col text-2xs text-fg-muted",
        // Docked, the left hairline is the seam against the stage. Floating, the panel carries its
        // own frame and a second line just inside it reads as a rendering fault.
        chrome?.floating ? "" : "border-l border-edge",
        className,
    );

    const formatSlotTime = useCallback((iso: string | null): string | null => {
        if (!iso) {
            return null;
        }
        const at = new Date(iso);
        return Number.isNaN(at.getTime())
            ? iso
            : formatDate(at, { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }, [formatDate]);

    return (
        <div className={rootClass}>
            {/* Also the drag handle while floating; the title stays a DIRECT child so the row keeps
                its identity as "the title bar" for anything that looks it up by its text. */}
            <div
                className={cn(
                    "flex shrink-0 items-center justify-between gap-2 border-b border-edge px-2 py-1.5",
                    chrome?.floating ? "cursor-grab select-none active:cursor-grabbing" : "",
                )}
                onPointerDown={chrome?.onTitleBarPointerDown}
            >
                <span className="text-xs font-medium text-fg">{t("devMode.saves.title")}</span>
                <div className="flex shrink-0 items-center gap-1">
                    <ToolbarButton
                        size="xs"
                        aria-label={t("devMode.saves.refresh")}
                        title={t("devMode.saves.refresh")}
                        disabled={busy}
                        onClick={() => { void refresh(); }}
                    >
                        <RotateCw className="h-3.5 w-3.5" aria-hidden />
                    </ToolbarButton>
                    <DevModePanelModeToggle chrome={chrome} />
                </div>
            </div>

            {/* Three sections, separated by the drawer's own section rule (see the debugger panel's
                `Section`) rather than by a second heading weight: the sub-groups inside Contents use
                the same eyebrow heading, and typography alone would make the two levels read flat. */}
            <div className="min-h-0 flex-1 overflow-auto font-mono leading-snug">
                <section className="border-b border-edge p-2">
                    <SectionHeading title={t("devMode.saves.slots")} />
                    {listError ? (
                        <p className="break-all text-2xs text-danger">{listError}</p>
                    ) : slots === null ? (
                        <p className="text-2xs text-fg-subtle">{t("common.loading")}</p>
                    ) : slots.length === 0 ? (
                        <p className="text-2xs text-fg-subtle">{t("devMode.saves.noSaves")}</p>
                    ) : (
                        <ul className="space-y-1">
                            {slots.map(entry => {
                                const id = entry.summary.id;
                                const active = id === selectedId;
                                const time = formatSlotTime(entry.summary.updatedAt);
                                return (
                                    <li
                                        key={id}
                                        className={cn(
                                            "cursor-default rounded-md px-1.5 py-1",
                                            active ? "bg-primary/15 text-fg" : "hover:bg-fill",
                                        )}
                                        onClick={() => setSelectedId(active ? null : id)}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="min-w-0 flex-1 truncate" title={id}>
                                                {entry.summary.label}
                                            </span>
                                            {time ? (
                                                <span className="shrink-0 tabular-nums text-fg-subtle">{time}</span>
                                            ) : null}
                                            <ToolbarButton
                                                size="xs"
                                                aria-label={t("devMode.saves.load")}
                                                title={t("devMode.saves.load")}
                                                disabled={busy || !context || !entry.record}
                                                onClick={event => {
                                                    event.stopPropagation();
                                                    void load(entry);
                                                }}
                                            >
                                                <Play className="h-3 w-3" aria-hidden />
                                            </ToolbarButton>
                                            <ToolbarButton
                                                size="xs"
                                                aria-label={t("devMode.saves.delete")}
                                                title={t("devMode.saves.delete")}
                                                disabled={busy}
                                                onClick={event => {
                                                    event.stopPropagation();
                                                    void remove(id);
                                                }}
                                            >
                                                <Trash2 className="h-3 w-3" aria-hidden />
                                            </ToolbarButton>
                                        </div>
                                        {entry.summary.lastSentence ? (
                                            <p className="truncate text-fg-subtle" title={entry.summary.lastSentence}>
                                                {entry.summary.lastSentence}
                                            </p>
                                        ) : null}
                                        {results[id] ? <LoadResultBlock result={results[id]} /> : null}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>

                <section className="border-b border-edge p-2">
                    <SectionHeading title={t("devMode.saves.contents")} />
                    {!selected ? (
                        <p className="text-2xs text-fg-subtle">{t("devMode.saves.selectSlot")}</p>
                    ) : !selected.record ? (
                        <p className="text-2xs text-fg-subtle">{t("devMode.saves.unreadable")}</p>
                    ) : (
                        <SaveContents decoded={decoded} hasRunningStory={Boolean(context)} />
                    )}
                </section>

                <section className="p-2">
                    <SectionHeading title={t("devMode.saves.persistent")} />
                    <PersistentStoreSection scopeBridge={scopeBridge} bundle={bundle} document={document} />
                </section>
            </div>
        </div>
    );
}

/**
 * The drawer's section-heading style: an `<h3>` carrying FieldLabel's eyebrow typography, and not
 * uppercased - the same rule the debugger and Interface panels follow.
 */
function SectionHeading(props: { title: string }): ReactNode {
    return <h3 className="mb-1 text-2xs font-medium tracking-wide text-fg-subtle">{props.title}</h3>;
}

/**
 * What a load attempt did, under the row it was made from.
 *
 * Warning tone, never danger, for everything except a throw whose shape is not "the story moved on":
 * an old save losing content is where saves end up, not an incident, and a red box would teach an
 * author to fear a button they should be free to press.
 */
function LoadResultBlock(props: { result: SaveLoadResult }): ReactNode {
    const { result } = props;
    const { t } = useTranslation();

    if (result.kind === "ok") {
        const { losses } = result;
        const lines: string[] = [];
        if (losses.droppedBacklog > 0) {
            lines.push(t("devMode.saves.droppedBacklog", {
                count: losses.droppedBacklog,
                total: losses.backlogTotal,
            }));
        }
        if (losses.unclaimedKeys.length > 0) {
            lines.push(t("devMode.saves.unclaimedOnLoad", { count: losses.unclaimedKeys.length }));
        }
        if (lines.length === 0) {
            return <p className="mt-1 text-2xs text-fg-subtle">{t("devMode.saves.loaded")}</p>;
        }
        return (
            <div className="mt-1 rounded-md border border-warning/30 bg-warning/10 px-1.5 py-1">
                <p className="text-2xs text-fg-muted">{t("devMode.saves.loadedWithLosses")}</p>
                {lines.map(line => (
                    <p key={line} className="text-2xs text-fg-subtle">{line}</p>
                ))}
            </div>
        );
    }

    const { failure, game } = result;
    return (
        <div
            className={cn(
                "mt-1 rounded-md border px-1.5 py-1",
                failure.tone === "danger" ? "border-danger/40 bg-danger/10" : "border-warning/30 bg-warning/10",
            )}
        >
            <p className="text-2xs text-fg-muted">
                {failure.missingElementId
                    ? t("devMode.saves.missingElement", { id: failure.missingElementId })
                    : failure.message}
            </p>
            <p className="text-2xs text-fg-subtle">{t(RUNNING_GAME_STATE_KEYS[game])}</p>
        </div>
    );
}

function SaveContents(props: { decoded: DecodedSave | null; hasRunningStory: boolean }): ReactNode {
    const { decoded, hasRunningStory } = props;
    const { t } = useTranslation();
    if (!decoded) {
        return <p className="text-2xs text-fg-subtle">{t("devMode.saves.unreadable")}</p>;
    }
    return (
        <div className="space-y-2">
            {/* Without a compiled story there are no namespace names to match, so every namespace
                falls through to "Other". Said once, here, rather than letting the reader work out
                why nothing is named. */}
            {hasRunningStory ? null : (
                <p className="text-2xs text-fg-subtle">{t("devMode.saves.noStory")}</p>
            )}
            {decoded.saved ? (
                <ValueRows title={t("devMode.saves.savedScope")} rows={decoded.saved.declared} />
            ) : null}
            {decoded.saved && decoded.saved.unclaimed.length > 0 ? (
                <ValueRows title={t("devMode.saves.unclaimed")} rows={decoded.saved.unclaimed} />
            ) : null}
            {decoded.scenes.map(scene => (
                <ValueRows
                    key={scene.namespace}
                    title={scene.sceneName ?? scene.namespace}
                    rows={scene.rows}
                />
            ))}
            {decoded.visited && (decoded.visited.scenes.length > 0 || decoded.visited.options.length > 0) ? (
                <div>
                    <SectionHeading title={t("devMode.saves.visited")} />
                    {decoded.visited.scenes.length > 0 ? (
                        <p className="break-all text-fg-muted">
                            <span className="text-fg-subtle">{t("devMode.saves.visitedScenes")} · </span>
                            {decoded.visited.scenes.map(ref => ref.name ?? shortId(ref.id)).join(", ")}
                        </p>
                    ) : null}
                    {decoded.visited.options.length > 0 ? (
                        <p className="break-all text-fg-muted">
                            <span className="text-fg-subtle">{t("devMode.saves.visitedOptions")} · </span>
                            {decoded.visited.options.map(ref => ref.name ?? shortId(ref.id)).join(", ")}
                        </p>
                    ) : null}
                </div>
            ) : null}
            {decoded.other.map(entry => (
                <ValueRows key={entry.namespace} title={entry.namespace} rows={entry.rows} />
            ))}
        </div>
    );
}

function ValueRows(props: { title: string; rows: readonly SaveValueRow[] }): ReactNode {
    const { title, rows } = props;
    const { t } = useTranslation();
    return (
        <div>
            <SectionHeading title={title} />
            {rows.length === 0 ? (
                <p className="text-2xs text-fg-subtle">{t("common.none")}</p>
            ) : (
                <ul className="space-y-0.5">
                    {rows.map(row => (
                        <li key={row.storageKey} className="flex gap-2">
                            <span className="w-[42%] shrink-0 truncate text-fg-subtle" title={row.storageKey}>
                                {row.name ?? shortId(row.storageKey)}
                            </span>
                            <span className="min-w-0 flex-1 break-all text-fg-muted">
                                {formatDebugValue(row.value)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/**
 * The project's persistent store: shared by every save, and inside none of them.
 *
 * It is read from the host bridge rather than from a save file because that is where it lives - a
 * persistent variable survives loading an older save, which is the whole difference between it and
 * a saved one. This panel is its only reader now; the Interface panel used to print the same map as
 * raw keys, which was the same data with the names removed.
 */
function PersistentStoreSection(props: {
    scopeBridge: ScopeStoreBridge;
    bundle: DevModeBundle;
    document: StoryDocument | undefined;
}): ReactNode {
    const { scopeBridge, bundle, document } = props;
    const { t } = useTranslation();
    const [snapshot, setSnapshot] = useState<ReadonlyMap<string, unknown>>(
        () => scopeBridge.getPersistenceSnapshot(),
    );

    useEffect(() => {
        setSnapshot(scopeBridge.getPersistenceSnapshot());
        return scopeBridge.subscribePersistence(() => {
            setSnapshot(scopeBridge.getPersistenceSnapshot());
        });
    }, [scopeBridge]);

    const declared = useMemo<MergedPersistentEntry[]>(
        () => buildMergedPersistentView(
            Object.values(bundle.ui.persistentVariables ?? {}),
            document ? Object.values(storyPersistentDefs(document)) : [],
        ).entries,
        [bundle.ui.persistentVariables, document],
    );

    const view = useMemo(() => projectPersistentStore(snapshot, declared), [snapshot, declared]);

    return (
        <div className="space-y-2">
            {view.declared.length === 0 ? (
                <p className="text-2xs text-fg-subtle">{t("devMode.saves.noPersistent")}</p>
            ) : (
                <ul className="space-y-0.5">
                    {view.declared.map(row => (
                        <li key={row.storageKey} className="flex gap-2">
                            <span className="w-[42%] shrink-0 truncate text-fg-subtle" title={row.storageKey}>
                                {row.name}
                            </span>
                            {/* Dimmed when the store holds nothing for it: what is shown then is the
                                declared default, and a default is not a value the game has written. */}
                            <span className={cn("min-w-0 flex-1 break-all text-fg-muted", row.live ? "" : "opacity-60")}>
                                {formatDebugValue(row.value)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            {view.unclaimed.length > 0 ? (
                <ValueRows title={t("devMode.saves.otherKeys")} rows={view.unclaimed} />
            ) : null}
        </div>
    );
}

/** A uuid nobody can act on, shortened to the width a 380px column can spare. */
function shortId(id: string): string {
    return id.length <= 10 ? id : `${id.slice(0, 8)}…`;
}
