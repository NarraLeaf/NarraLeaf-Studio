import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent } from "react";
import { AlignLeft, BookOpen, Camera, Check, ChevronDown, ChevronRight, FileText, Image as ImageIcon, ListPlus, MonitorPlay, Plus, Rows3, Trash2, Variable } from "lucide-react";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useKeybindings, whenEditorFocused, type KeybindingDefinition } from "@/apps/workspace/hooks";
import { useTranslation } from "@/lib/i18n";
import type { EditorComponentProps } from "../../types";
import { PanelPosition } from "../../../registry/types";
import { Services } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { ConsoleService } from "@/lib/workspace/services/core/ConsoleService";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import type { DevModeService } from "@/lib/workspace/services/core/DevModeService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { StoryBlock, StoryBlockId, StoryDocument, StoryScene, StorySceneUpdate } from "@shared/types/story";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import type { StorySceneEditorTabPayload } from "./storySceneEditorTabId";
import { StoryActionCreatorPanel } from "./StoryActionCreatorPanel";
import {
    STORY_ACTION_CREATE_REQUEST_EVENT,
    STORY_ACTION_CREATOR_PANEL_ID,
    type StoryActionCreateRequestDetail,
} from "./storyActionCreatorEvents";
import { STORY_MOTION_PANEL_ID } from "../../story-motion";
import { StoryVariablesPanel, STORY_VARIABLES_PANEL_ID } from "../../story-variables";
import { StorySnapshotPanel, STORY_SNAPSHOT_PANEL_ID, getSelectedSnapshotId, setSelectedSnapshotId } from "../../story-snapshots";
import { InsertRow, StoryBlockRow } from "./StorySceneEditorRows";
import { ContextMenu, useContextMenu, type ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { publishStoryInspectorState } from "./storyInspectorBridge";
import {
    isSameStoryBlockSelection,
    isStoryBlockSelectionData,
    STORY_BLOCK_SELECTION_TYPE,
    type StoryBlockSelection,
} from "./storySelection";
import { stopVoiceAudition } from "./voiceAudition";
import { STORY_DENSITY_METRICS, StoryEditorTextStyleProvider, storyEditorRootStyle } from "./storyEditorTextStyle";
import { StoryRowActionsContext, type StoryRowActions } from "./storyRowActions";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { TranslationKey } from "@shared/i18n";
import { getCharacterName, getContainerHeaderInfo, getTextSegment } from "./storySceneBlockUtils";
import { StoryFindBar } from "./StoryFindBar";
import {
    findRangesInText,
    getSegmentSlot,
    replaceAllInSegment,
    replaceInSegment,
    segmentPlainText,
    type StoryFindMatch,
} from "./storyFindReplace";
import type { VisibleStoryRow } from "./storySceneEditorTypes";
import type { Character } from "@/lib/workspace/services/character/Character";
import {
    captureStoryEditorScrollAnchor,
    getStoryEditorViewState,
    patchStoryEditorViewState,
    resolveStoryEditorRestoreScrollTop,
    STORY_EDITOR_DENSITIES,
} from "./storyEditorSessionStore";
import { useStorySceneEditorController } from "./useStorySceneEditorController";
import { subscribeStoryRowHighlight } from "./storyRowHighlightBus";
import { ResizableHandle } from "@/apps/workspace/components/ui/ResizableHandle";
import { StoryScenePreviewPane } from "./preview/StoryScenePreviewPane";
import { StoryScenePreviewFloat } from "./preview/StoryScenePreviewFloat";
import { useStoryScenePreviewController } from "./preview/useStoryScenePreviewController";
import { STORY_CONSOLE_CHANNEL } from "./preview/storyPreviewConsole";
import {
    createDefaultStoryPreviewFloatRect,
    DEFAULT_STORY_SCENE_PREVIEW_PANE_STATE,
    getStoryScenePreviewPaneState,
    patchStoryScenePreviewPaneState,
    STORY_PREVIEW_PANE_DEFAULT_WIDTH,
    STORY_PREVIEW_PANE_MAX_FRACTION,
    STORY_PREVIEW_PANE_MIN_WIDTH,
    type StoryScenePreviewFloatRect,
    type StoryScenePreviewPaneMode,
    type StoryScenePreviewPaneState,
} from "./preview/storyScenePreviewSessionStore";

/**
 * What an empty scene offers as a starting point. Deliberately the three things a first scene almost
 * always needs — a backdrop, someone on stage, someone talking — rather than a tour of the vocabulary;
 * the manual is one click away for the rest. The lines are not translated: a command is keywords, and
 * these are meant to be typed as they read.
 */
const EMPTY_SCENE_EXAMPLES: readonly { line: string; key: TranslationKey }[] = [
    { line: "/bg", key: "story.sceneEditor.emptyExampleBg" },
    { line: "/show", key: "story.sceneEditor.emptyExampleShow" },
    { line: "/say", key: "story.sceneEditor.emptyExampleSay" },
];

/**
 * The context a row inherits from rows above it: the speaker of the dialogue run it belongs to, or the
 * container it sits inside. Returns null when the row introduces its own context (a group head, a
 * container header, a top-level line) — there is nothing to restate in that case.
 */
function describeScrollContext(
    rows: readonly VisibleStoryRow[],
    characters: Character[],
    firstVisibleId: StoryBlockId | null,
): string | null {
    if (!firstVisibleId) {
        return null;
    }
    const index = rows.findIndex(row => row.block.id === firstVisibleId);
    if (index < 0) {
        return null;
    }
    const row = rows[index];
    // Inside a dialogue run: walk back to its head, which is the row carrying the nametag.
    if (row.groupRole === "member") {
        for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
            const candidate = rows[cursor];
            if (candidate.groupRole !== "head") {
                continue;
            }
            const block = candidate.block;
            if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
                return block.payload.characterId
                    ? getCharacterName(characters, block.payload.characterId)
                    : block.payload.speakerName ?? null;
            }
            return null;
        }
        return null;
    }
    // Inside a container: the nearest ancestor still above the viewport names the block.
    if (row.depth > 0) {
        for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
            const candidate = rows[cursor];
            if (candidate.depth < row.depth) {
                return getContainerHeaderInfo(candidate.block)?.pill ?? null;
            }
        }
    }
    return null;
}

/** A row's `py-1`, the part of its height the density's box does not cover. */
const ROW_VERTICAL_PADDING_PX = 8;

const SCENE_FIELD_LABEL_CLASS = "mb-1 block text-2xs font-medium text-fg-subtle";
const SCENE_TEXT_FIELD_CLASS = "w-full rounded-md border border-edge bg-surface-raised px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-primary/50";

function StorySceneOverviewBlock(props: {
    document: StoryDocument;
    scene: StoryScene;
    backgroundAsset: Asset<AssetType.Image> | null;
    onUpdateScene: (patch: StorySceneUpdate) => boolean;
    panelStateService: PanelStateService | null;
}) {
    const { t } = useTranslation();
    const { document, scene, backgroundAsset, onUpdateScene, panelStateService } = props;
    const [nameValue, setNameValue] = useState(scene.name);
    const [descriptionValue, setDescriptionValue] = useState(scene.description ?? "");
    const [selectorOpen, setSelectorOpen] = useState(false);
    const selectButtonRef = useRef<HTMLButtonElement | null>(null);
    const backgroundAssetId = scene.defaultBackgroundAssetId ?? null;
    const { url, loading, error } = useAssetObjectUrl(backgroundAssetId);

    // Collapsed by default once the scene is set up; expanded on a freshly created scene (no default
    // background yet) so the author is prompted to name it and pick a backdrop. A manual toggle is
    // remembered per scene (persisted with the rest of the editor view state), and takes precedence
    // over the config-derived default on reopen. Read once on mount — the tab is keep-alive, so this
    // component instance lives for the tab's lifetime and the default must not flip out from under a
    // toggle when the scene object updates.
    const [collapsed, setCollapsed] = useState<boolean>(() => {
        const stored = panelStateService ? getStoryEditorViewState(panelStateService, scene.id)?.overviewCollapsed : undefined;
        return stored ?? Boolean(scene.defaultBackgroundAssetId);
    });

    const toggleCollapsed = useCallback(() => {
        setCollapsed(prev => {
            const next = !prev;
            if (panelStateService) {
                patchStoryEditorViewState(panelStateService, scene.id, { overviewCollapsed: next });
            }
            return next;
        });
    }, [panelStateService, scene.id]);

    useEffect(() => {
        setNameValue(scene.name);
        setDescriptionValue(scene.description ?? "");
    }, [scene.description, scene.name]);

    const commitName = useCallback(() => {
        const nextName = nameValue.trim() || scene.name || t("story.sceneEditor.defaultSceneName");
        const changed = onUpdateScene({ name: nextName });
        if (!changed) {
            setNameValue(scene.name);
        }
    }, [nameValue, onUpdateScene, scene.name, t]);

    const commitDescription = useCallback(() => {
        const nextDescription = descriptionValue.trim();
        const changed = onUpdateScene({ description: nextDescription });
        if (!changed) {
            setDescriptionValue(scene.description ?? "");
        }
    }, [descriptionValue, onUpdateScene, scene.description]);

    const handleSelectBackground = useCallback((assets: Asset[]) => {
        const selected = assets[0];
        if (!selected) {
            return;
        }
        onUpdateScene({ defaultBackgroundAssetId: selected.id });
        setSelectorOpen(false);
    }, [onUpdateScene]);

    const clearBackground = useCallback(() => {
        onUpdateScene({ defaultBackgroundAssetId: null });
    }, [onUpdateScene]);

    const backgroundLabel = backgroundAsset?.name ?? (backgroundAssetId ? t("story.background.missingImage") : t("story.background.none"));

    return (
        <div className="mx-3 mb-3 overflow-hidden rounded-lg border border-edge bg-fill-subtle">
            <button
                type="button"
                onClick={toggleCollapsed}
                aria-expanded={!collapsed}
                title={collapsed ? t("common.expand") : t("common.collapse")}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left outline-none transition-colors hover:bg-fill focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/60"
            >
                {collapsed ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" />
                ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-fg-subtle" />
                )}
                {collapsed ? (
                    <>
                        <span className="relative h-9 w-16 shrink-0 overflow-hidden rounded-md border border-edge bg-surface">
                            {url ? (
                                <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
                            ) : (
                                <span className="flex h-full w-full items-center justify-center text-fg-subtle">
                                    <ImageIcon className="h-4 w-4" />
                                </span>
                            )}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-fg">{scene.name}</span>
                            <span className="block truncate text-2xs text-fg-subtle">
                                {scene.description?.trim() || t("story.sceneEditor.noDescription")}
                            </span>
                        </span>
                    </>
                ) : (
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-primary" />
                        <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-fg">{scene.name}</span>
                            <span className="block truncate text-2xs text-fg-subtle">{document.name}</span>
                        </span>
                    </span>
                )}
            </button>

            {collapsed ? null : (
            <div className="border-t border-edge p-3">
            <div
                className="grid items-start gap-3"
                style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}
            >
                <button
                    type="button"
                    className="group relative aspect-[16/9] min-h-40 overflow-hidden rounded-md border border-edge bg-surface text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/70"
                    onClick={() => setSelectorOpen(true)}
                    title={backgroundAssetId ? t("story.sceneEditor.changeBackgroundTitle") : t("story.sceneEditor.selectBackgroundTitle")}
                >
                    {url ? (
                        <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
                    ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-fg-subtle">
                            <ImageIcon className="h-6 w-6 text-fg-subtle" />
                            <span className="max-w-[80%] truncate">{backgroundLabel}</span>
                        </div>
                    )}
                    {loading ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-xs text-white">
                            {t("common.loading")}
                        </div>
                    ) : null}
                    <div className="absolute inset-x-0 bottom-0 flex min-h-9 items-center justify-between gap-2 bg-black/55 px-3 py-2 text-xs text-white backdrop-blur-sm">
                        <span className="min-w-0 truncate">{backgroundLabel}</span>
                        <span className="shrink-0 text-primary opacity-0 transition-opacity group-hover:opacity-100">
                            {backgroundAssetId ? t("story.sceneEditor.change") : t("story.sceneEditor.select")}
                        </span>
                    </div>
                </button>

                <div className="grid min-w-0 gap-3">
                    <div>
                        <label className={SCENE_FIELD_LABEL_CLASS}>{t("story.sceneEditor.sceneName")}</label>
                        <input
                            className={SCENE_TEXT_FIELD_CLASS}
                            value={nameValue}
                            maxLength={120}
                            onChange={event => setNameValue(event.target.value)}
                            onBlur={commitName}
                            onKeyDown={event => {
                                // Escape exits and saves, like everywhere else in the editor — blurring
                                // is what commits. Reverting here made Escape mean three different
                                // things across one tab; undo is Mod+Z's job.
                                if (event.key === "Enter" || event.key === "Escape") {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                }
                            }}
                        />
                    </div>

                    <div>
                        <label className={SCENE_FIELD_LABEL_CLASS}>{t("common.description")}</label>
                        <textarea
                            className={`${SCENE_TEXT_FIELD_CLASS} min-h-20 resize-y leading-relaxed`}
                            value={descriptionValue}
                            rows={3}
                            maxLength={600}
                            placeholder={t("story.sceneEditor.noDescription")}
                            onChange={event => setDescriptionValue(event.target.value)}
                            onBlur={commitDescription}
                            onKeyDown={event => {
                                // Exit and save (onBlur commits). Enter stays a newline — this one is
                                // genuinely multi-line, unlike a story row.
                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                }
                            }}
                        />
                    </div>

                    <div>
                        <label className={SCENE_FIELD_LABEL_CLASS}>{t("story.sceneEditor.defaultBackground")}</label>
                        <div className="flex gap-2">
                            <button
                                ref={selectButtonRef}
                                type="button"
                                className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-edge bg-surface-raised px-3 text-left text-sm text-fg-muted hover:border-primary/40"
                                onClick={() => setSelectorOpen(true)}
                            >
                                <ImageIcon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                                <span className={["truncate", backgroundAsset ? "" : "italic text-fg-subtle"].join(" ")}>
                                    {backgroundLabel}
                                </span>
                            </button>
                            <button
                                type="button"
                                className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-edge bg-fill-subtle text-fg-muted hover:border-danger/40 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                                disabled={!backgroundAssetId}
                                title={t("story.sceneEditor.clearBackground")}
                                onClick={clearBackground}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        {backgroundAssetId && error ? (
                            <div className="mt-1 text-2xs text-warning/90">
                                {t("story.sceneEditor.backgroundResolveError", { error })}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
            </div>
            )}

            <AssetSelector
                visible={selectorOpen}
                assetType={AssetType.Image}
                onClose={() => setSelectorOpen(false)}
                onConfirm={handleSelectBackground}
                selectedIds={backgroundAssetId ? [backgroundAssetId] : []}
                anchorRef={selectButtonRef}
                title={t("story.sceneEditor.selectDefaultBackground")}
                multiple={false}
            />
        </div>
    );
}

export function StorySceneEditorTab({ tabId, payload, active }: EditorComponentProps<StorySceneEditorTabPayload | undefined>) {
    const { t } = useTranslation();
    const editor = useStorySceneEditorController(tabId, payload);
    // The command reference overlay (WI-2), opened from the header. Local state, not a panel — it is a
    // read-only reference the author dips into, not a docked surface, so it mirrors the cheat sheet.
    const sensors = useSensors(
        useSensor(PointerSensor),
    );
    // The find bar's opener lives with the rest of the find state, further down; the binding table is
    // built before it exists, so it reaches the current one through a ref.
    const openFindRef = useRef<() => void>(() => {});

    const keybindings = useMemo<KeybindingDefinition[]>(() => [
        {
            id: "find",
            key: "mod+f",
            description: t("story.keybindings.find"),
            handler: () => openFindRef.current(),
        },
        {
            id: "delete",
            key: "delete",
            description: t("story.keybindings.deleteRows"),
            handler: () => {
                void editor.deleteSelection({ confirmMultiple: false });
            },
        },
        {
            // Backspace first tries the blank-line closure - a single selected leaf action row becomes an
            // empty narration line with the caret in it, and the *next* Backspace is the empty-line rung
            // that already exists. Everything it declines (multi-selection, containers, text rows) falls
            // through to the delete this binding has always been.
            id: "backspace",
            key: "backspace",
            description: t("story.keybindings.deleteRowsConfirm"),
            handler: () => {
                if (editor.replaceRowWithBlankLine()) {
                    return;
                }
                void editor.deleteSelection({ confirmMultiple: true });
            },
        },
        {
            id: "undo",
            key: "mod+z",
            description: t("story.keybindings.undo"),
            handler: editor.undoEdit,
        },
        {
            id: "redo",
            key: "mod+shift+z",
            description: t("story.keybindings.redo"),
            handler: editor.redoEdit,
        },
        {
            id: "edit-active",
            key: "enter",
            description: t("story.keybindings.editRow"),
            handler: editor.enterEditOrInspectorForActive,
        },
        {
            // The inspector's own Escape only fires with focus inside it; opened via Enter, focus stays
            // on the row, so this is the rung that closes it. Bindings default to `allowInEditable:
            // false`, so this never steals Escape from a text edit or an insert slot (those have their
            // own). See the exit ladder in docs/story-editor-interaction-model.md.
            id: "close-inspector",
            key: "escape",
            description: t("story.keybindings.closeInspector"),
            handler: editor.closeInspector,
        },
        {
            id: "insert-blank-after-selection",
            key: "shift+enter",
            description: t("story.keybindings.insertRow"),
            handler: editor.startInsertAfterSelection,
        },
        {
            id: "indent",
            key: "tab",
            description: t("story.keybindings.indent"),
            handler: () => editor.indentSelection("in"),
        },
        {
            id: "outdent",
            key: "shift+tab",
            description: t("story.keybindings.outdent"),
            handler: () => editor.indentSelection("out"),
        },
        {
            id: "select-all",
            key: "mod+a",
            description: t("story.keybindings.selectAll"),
            handler: editor.selectAllRows,
        },
        {
            id: "duplicate",
            key: "mod+d",
            description: t("story.keybindings.duplicateRows"),
            handler: editor.duplicateSelection,
        },
        {
            id: "move-selection-down",
            key: "arrowdown",
            description: t("story.keybindings.moveSelectionDown"),
            handler: () => editor.moveActiveRowSelection("down"),
        },
        {
            id: "move-selection-up",
            key: "arrowup",
            description: t("story.keybindings.moveSelectionUp"),
            handler: () => editor.moveActiveRowSelection("up"),
        },
        {
            id: "extend-selection-down",
            key: "shift+arrowdown",
            description: t("story.keybindings.extendSelectionDown"),
            handler: () => editor.extendRowSelection("down"),
        },
        {
            id: "extend-selection-up",
            key: "shift+arrowup",
            description: t("story.keybindings.extendSelectionUp"),
            handler: () => editor.extendRowSelection("up"),
        },
        {
            id: "move-row-down",
            key: "alt+arrowdown",
            description: t("story.keybindings.moveRowDown"),
            handler: () => editor.moveSelectedRows("down"),
        },
        {
            id: "move-row-up",
            key: "alt+arrowup",
            description: t("story.keybindings.moveRowUp"),
            handler: () => editor.moveSelectedRows("up"),
        },
        {
            id: "select-first",
            key: "home",
            description: t("story.keybindings.selectFirst"),
            handler: () => editor.jumpRowSelection("first"),
        },
        {
            id: "select-last",
            key: "end",
            description: t("story.keybindings.selectLast"),
            handler: () => editor.jumpRowSelection("last"),
        },
        {
            id: "select-first-mod",
            key: "mod+home",
            description: t("story.keybindings.selectFirst"),
            handler: () => editor.jumpRowSelection("first"),
        },
        {
            id: "select-last-mod",
            key: "mod+end",
            description: t("story.keybindings.selectLast"),
            handler: () => editor.jumpRowSelection("last"),
        },
        {
            id: "page-down",
            key: "pagedown",
            description: t("story.keybindings.pageDown"),
            handler: () => editor.pageRowSelection("down"),
        },
        {
            id: "page-up",
            key: "pageup",
            description: t("story.keybindings.pageUp"),
            handler: () => editor.pageRowSelection("up"),
        },
    ], [
        editor.closeInspector,
        editor.deleteSelection,
        editor.duplicateSelection,
        editor.enterEditOrInspectorForActive,
        editor.extendRowSelection,
        editor.indentSelection,
        editor.jumpRowSelection,
        editor.moveActiveRowSelection,
        editor.moveSelectedRows,
        editor.pageRowSelection,
        editor.redoEdit,
        editor.replaceRowWithBlankLine,
        editor.selectAllRows,
        editor.startInsertAfterSelection,
        editor.undoEdit,
        t,
    ]);

    useKeybindings({
        keybindings,
        enabled: editor.isInitialized && Boolean(editor.context && payload?.storyId && payload.sceneId),
        when: whenEditorFocused(tabId),
        idPrefix: `story-scene-editor-${tabId}`,
        catalogPrefix: "story.",
    });

    // Side panels are global (keyed by fixed ids), so only the visible scene tab may own them —
    // otherwise several kept-alive scene tabs would fight over the same registration. Gate on `active`.
    useEffect(() => {
        if (!active || !editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
            return;
        }
        const uiService = editor.context.services.get<UIService>(Services.UI);
        const unregister = uiService.panels.register({
            id: STORY_ACTION_CREATOR_PANEL_ID,
            title: t("story.commandManual.title"),
            icon: <ListPlus className="w-4 h-4" />,
            position: PanelPosition.Right,
            component: StoryActionCreatorPanel,
            defaultVisible: false,
            order: 10,
            payload: {
                tabId,
                storyId: payload.storyId,
                sceneId: payload.sceneId,
            },
        });
        return () => {
            uiService.panels.hide(STORY_ACTION_CREATOR_PANEL_ID);
            unregister();
        };
    }, [active, editor.context, editor.isInitialized, payload?.sceneId, payload?.storyId, tabId, t]);

    useEffect(() => {
        if (!active || !editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
            return;
        }
        const uiService = editor.context.services.get<UIService>(Services.UI);
        uiService.panels.updatePayload(STORY_ACTION_CREATOR_PANEL_ID, {
            tabId,
            storyId: payload.storyId,
            sceneId: payload.sceneId,
            storyName: editor.document?.name,
            sceneName: editor.scene?.name,
        });
    }, [active, editor.context, editor.document?.name, editor.isInitialized, editor.scene?.name, payload?.sceneId, payload?.storyId, tabId]);

    useEffect(() => {
        if (!active || !editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
            return;
        }
        const uiService = editor.context.services.get<UIService>(Services.UI);
        const unregister = uiService.panels.register({
            id: STORY_VARIABLES_PANEL_ID,
            title: t("story.sceneEditor.variablesPanel"),
            icon: <Variable className="w-4 h-4" />,
            position: PanelPosition.Right,
            component: StoryVariablesPanel,
            defaultVisible: false,
            order: 11,
            payload: {
                tabId,
                storyId: payload.storyId,
                sceneId: payload.sceneId,
            },
        });
        return () => {
            uiService.panels.hide(STORY_VARIABLES_PANEL_ID);
            unregister();
        };
    }, [active, editor.context, editor.isInitialized, payload?.sceneId, payload?.storyId, tabId, t]);

    useEffect(() => {
        if (!active || !editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
            return;
        }
        const uiService = editor.context.services.get<UIService>(Services.UI);
        uiService.panels.updatePayload(STORY_VARIABLES_PANEL_ID, {
            tabId,
            storyId: payload.storyId,
            sceneId: payload.sceneId,
            storyName: editor.document?.name,
            sceneName: editor.scene?.name,
        });
    }, [active, editor.context, editor.document?.name, editor.isInitialized, editor.scene?.name, payload?.sceneId, payload?.storyId, tabId]);

    useEffect(() => {
        if (!active || !editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
            return;
        }
        const uiService = editor.context.services.get<UIService>(Services.UI);
        const unregister = uiService.panels.register({
            id: STORY_SNAPSHOT_PANEL_ID,
            title: t("story.sceneEditor.snapshotsPanel"),
            icon: <Camera className="w-4 h-4" />,
            position: PanelPosition.Right,
            component: StorySnapshotPanel,
            defaultVisible: false,
            order: 12,
            payload: {
                tabId,
                storyId: payload.storyId,
                sceneId: payload.sceneId,
            },
        });
        return () => {
            uiService.panels.hide(STORY_SNAPSHOT_PANEL_ID);
            unregister();
        };
    }, [active, editor.context, editor.isInitialized, payload?.sceneId, payload?.storyId, tabId, t]);

    useEffect(() => {
        if (!active || !editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
            return;
        }
        const uiService = editor.context.services.get<UIService>(Services.UI);
        uiService.panels.updatePayload(STORY_SNAPSHOT_PANEL_ID, {
            tabId,
            storyId: payload.storyId,
            sceneId: payload.sceneId,
            storyName: editor.document?.name,
            sceneName: editor.scene?.name,
        });
    }, [active, editor.context, editor.document?.name, editor.isInitialized, editor.scene?.name, payload?.sceneId, payload?.storyId, tabId]);

    useEffect(() => {
        if (!active || !editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
            return;
        }
        const uiService = editor.context.services.get<UIService>(Services.UI);
        uiService.panels.updatePayload(STORY_MOTION_PANEL_ID, {
            storyId: payload.storyId,
            sceneId: payload.sceneId,
            blockId: editor.activeBlockId ?? undefined,
            storyName: editor.document?.name,
            sceneName: editor.scene?.name,
        });
    }, [active, editor.activeBlockId, editor.context, editor.document?.name, editor.isInitialized, editor.scene?.name, payload?.sceneId, payload?.storyId]);

    // Gates the bridge republish to real changes of what the rail draws, so typing in another row —
    // which rewrites the whole scene snapshot every keystroke — does not re-render the panel.
    const lastInspectorSigRef = useRef<{
        blockId: string | null;
        payload: unknown;
        characters: unknown;
        sceneList: string;
        sceneMeta: string;
    } | null>(null);
    // Latest controller handle, read by the bridge's published callbacks so they never edit through a
    // stale scene snapshot. The republish gate below fires only when the inspected block changes, so
    // between republishes an untracked scene change (a quickParam click or a drag on another row) would
    // otherwise leave the panel's callbacks closed over the pre-change scene — the next panel edit would
    // then record that stale scene as its undo snapshot, so one Ctrl+Z silently reverts two edits (WI-0).
    const editorRef = useRef(editor);
    editorRef.current = editor;

    const sortableRowIds = useMemo(() => editor.visibleRows.map(row => row.block.id), [editor.visibleRows]);

    /**
     * The row list is windowed: only the rows on screen (plus a little overscan) exist in the DOM.
     *
     * Interaction cost is already flat — the rows are memoised — but *mounting* was not. Opening a
     * 400-row scene cost one 340ms frozen frame, and that is linear: a 1500-line chapter froze the
     * window for over a second on this machine and several times that on a slow one. Windowing makes
     * opening a scene cost what a screenful costs, whatever the chapter's length.
     *
     * `scrollMargin` is what makes it agree with the rest of the column: the scene overview sits above
     * the list inside the same scroller, so the virtualiser has to know the list does not start at
     * scroll offset zero. Heights are measured rather than assumed, because a wrapped line of dialogue
     * is taller than a `/bg` row and the estimate only has to be close enough to size the scrollbar.
     */
    const rowListRef = useRef<HTMLDivElement | null>(null);
    const [rowListMargin, setRowListMargin] = useState(0);
    const estimatedRowHeight = STORY_DENSITY_METRICS[editor.density].rowBox + ROW_VERTICAL_PADDING_PX;
    const rowVirtualizer = useVirtualizer({
        count: editor.visibleRows.length,
        getScrollElement: () => editor.scrollContainerRef.current,
        estimateSize: () => estimatedRowHeight,
        overscan: 12,
        scrollMargin: rowListMargin,
        getItemKey: index => editor.visibleRows[index]?.block.id ?? index,
    });

    // The overview block's height changes (collapse, a background image loading), and the list's start
    // offset with it. Measured after every commit rather than once: a stale margin puts every row a
    // constant distance from where the scrollbar says it is.
    useLayoutEffect(() => {
        const list = rowListRef.current;
        const scroller = editor.scrollContainerRef.current;
        if (!list || !scroller) {
            return;
        }
        const margin = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
        setRowListMargin(previous => (Math.abs(previous - margin) > 0.5 ? margin : previous));
    });

    /**
     * Throw away the measured heights when the density changes.
     *
     * The cache is keyed by row id, and a density switch changes every row's height without changing a
     * single id — so the cache survives it and each row lands at the *previous* density's offset. The
     * rows themselves are the new height, so they overlap: `comfortable`'s dialogue blocks stacked
     * 40px apart, the standard row pitch, with the text of one block printing over the next.
     *
     * The per-element ResizeObserver does not save it either: it re-measures whatever is mounted, and
     * a windowed list has a screenful. Dropping the cache outright is the honest answer — every row
     * re-measures as it comes into view, which is what happens on first open anyway.
     */
    useLayoutEffect(() => {
        rowVirtualizer.measure();
    }, [editor.density, rowVirtualizer]);

    /**
     * The row whose wrapper currently holds the insert slot, or null when no slot is inside one.
     *
     * A slot is not a row of its own: it renders *inside* its host row's wrapper — the very element
     * the virtualiser measures — so opening or closing one changes that row's height without changing
     * a single row id, exactly like a density switch does. Which row hosts it depends on the slot:
     * a rewrite renders in place of the row, an "insert above" in front of it, everything else after
     * it. A slot with no host (`afterBlockId` null and no before-target) renders outside the list and
     * moves nothing.
     */
    const insertSlotHostId: StoryBlockId | null = editor.editorMode.kind === "insert"
        ? editor.editorMode.slot.replaceBlockId
            ?? editor.editorMode.slot.target?.beforeBlockId
            ?? editor.editorMode.slot.afterBlockId
        : null;
    const measuredSlotHostRef = useRef<StoryBlockId | null>(null);
    /**
     * Re-measure the host before the browser paints, instead of a frame later.
     *
     * Backspace on an empty dialogue deletes the row and opens a blank slot where it stood, in the
     * previous row's wrapper. Both land in one commit, but only one of them is a fact the virtualiser
     * knows: the list is one row shorter, so every row below moves *up* by the deleted row's height —
     * while the wrapper that grew by the slot's height is still cached at its old size. Measured on a
     * run of YouKi's, the slot and the next line of dialogue were handed the identical 40px band, one
     * drawn over the other, until the ResizeObserver reported the new height and everything below
     * dropped back. That correction cannot arrive in the same commit, so the wrong frame is always
     * painted: the flash the author sees on the line they just backspaced.
     *
     * Reading the height here is what the observer would have read, only in time to be used. It costs
     * one `offsetHeight` on the two rows a slot moves between, and only on the commit that moves it.
     * `resizeItem` rather than `measureElement`: the latter returns the cached size when it is called
     * without a ResizeObserver entry, which is the number we are here to correct.
     */
    useLayoutEffect(() => {
        const previousHostId = measuredSlotHostRef.current;
        if (previousHostId === insertSlotHostId) {
            return;
        }
        measuredSlotHostRef.current = insertSlotHostId;
        const list = rowListRef.current;
        if (!list) {
            return;
        }
        // Both ends of the move: the row the slot left (shrunk back) and the one it landed on (grown).
        for (const blockId of [previousHostId, insertSlotHostId]) {
            if (!blockId) {
                continue;
            }
            const index = editor.visibleRows.findIndex(row => row.block.id === blockId);
            if (index < 0) {
                continue;
            }
            const element = list.querySelector<HTMLElement>(`[data-index="${index}"]`);
            if (element) {
                rowVirtualizer.resizeItem(index, element.offsetHeight);
            }
        }
    });

    /**
     * Put a row on screen by index, whether or not it is currently mounted.
     *
     * Everything that used to reach for a row's DOM node — deep links, the Dev Mode play head,
     * keyboard navigation — could assume the node existed. Under windowing it may not, and the fix
     * cannot be "scroll the node into view" because there is no node until it is scrolled to.
     */
    const scrollRowIntoView = useCallback((blockId: StoryBlockId, align: "center" | "auto" = "auto") => {
        const index = editor.visibleRows.findIndex(row => row.block.id === blockId);
        if (index < 0) {
            return false;
        }
        rowVirtualizer.scrollToIndex(index, { align });
        return true;
    }, [editor.visibleRows, rowVirtualizer]);

    /**
     * Keep the active row on screen. Arrow-navigating a long scene used to walk the selection off the
     * viewport and leave it there — survivable while every row was in the DOM, fatal once they are
     * not, because Enter would open an editor on a row that does not exist.
     */
    useEffect(() => {
        if (!active || !editor.activeBlockId || editor.editorMode.kind === "text") {
            return;
        }
        const scroller = editor.scrollContainerRef.current;
        const row = scroller?.querySelector<HTMLElement>(`[data-story-row-block-id="${CSS.escape(editor.activeBlockId)}"]`);
        if (!scroller) {
            return;
        }
        if (!row) {
            scrollRowIntoView(editor.activeBlockId, "center");
            return;
        }
        const rowRect = row.getBoundingClientRect();
        const viewRect = scroller.getBoundingClientRect();
        if (rowRect.top < viewRect.top || rowRect.bottom > viewRect.bottom) {
            row.scrollIntoView({ block: "nearest" });
        }
    }, [active, editor.activeBlockId, editor.editorMode.kind, editor.scrollContainerRef, scrollRowIntoView]);

    /**
     * The right rail follows the selected row (U2 WI-1).
     *
     * Two things are published from here, and the split matters:
     *
     *  - the *subject*, as the app-wide selection (`storyBlock`), which is what makes the properties
     *    panel show this tab's inspector at all. It addresses the row; it does not carry it.
     *  - the *content*, through the per-tab bridge: the block itself, the scene, and the controller
     *    callbacks that edit them.
     *
     * Neither one shows or hides a panel. The rail's contents used to be driven by `editorMode`
     * ("inspector") plus manual `panels.show/hide`, which is what made it possible to select a row and
     * have the rail keep showing the *previous* one, to have it jump to Story Variables when a panel
     * was hidden underneath the author, and to have a second Enter on the same row do nothing at all.
     * There is nothing to reveal now: the panel is already there because the selection is.
     *
     * With no row focused the subject is the scene (`blockId: null`) — the panel then renders the
     * scene's own fields, so it is never empty and never has to explain itself.
     */
    useEffect(() => {
        if (!active || !editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
            return;
        }
        const store = editor.context.services.get<UIService>(Services.UI).getStore();
        const scene = editor.scene;
        const storyDocument = editor.document;
        if (!scene || !storyDocument) {
            return;
        }
        const blockId = editor.activeBlockId && scene.blocks[editor.activeBlockId] ? editor.activeBlockId : null;
        const block = blockId ? scene.blocks[blockId] ?? null : null;

        // Republish only when something the panel renders changes. Editing any row rewrites the scene
        // snapshot (and so `editor.scene`/`editor.document` identity) every keystroke, so gating on the
        // selected block's payload keeps the panel from re-rendering on unrelated typing. The panel also
        // draws the speaker dropdown from `characters`, the jump-target dropdown from the scene list, and
        // — with no row selected — the scene's own name/description/background, so all four are in the
        // signature. `characters` re-identifies only on a character edit, and the two string signatures
        // read ids/names only, so they stay stable under row typing while catching real edits.
        const sceneList = Object.values(storyDocument.scenes).map(entry => `${entry.id}:${entry.name}`).join("|");
        const sceneMeta = JSON.stringify([scene.name, scene.description ?? "", scene.defaultBackgroundAssetId ?? ""]);
        // A block's payload is a fresh object on every edit to it (updateBlockPayload reassigns) and is
        // untouched by edits to other rows, so its reference is a cheap version token.
        const sig = { blockId, payload: block?.payload ?? null, characters: editor.characters, sceneList, sceneMeta };
        const previous = lastInspectorSigRef.current;
        if (
            !previous
            || previous.blockId !== sig.blockId
            || previous.payload !== sig.payload
            || previous.characters !== sig.characters
            || previous.sceneList !== sig.sceneList
            || previous.sceneMeta !== sig.sceneMeta
        ) {
            lastInspectorSigRef.current = sig;
            publishStoryInspectorState(tabId, {
                storyId: payload.storyId,
                sceneId: payload.sceneId,
                scene,
                document: storyDocument,
                characters: editor.characters,
                block,
                // Route through editorRef (the latest controller), not the render-time `editor`, so an
                // edit made after an untracked scene change still records the current scene as its undo
                // snapshot rather than the one captured at the last republish.
                onUpdatePayload: nextPayload => {
                    if (blockId) {
                        editorRef.current.updateBlockPayloadFor(blockId, nextPayload);
                    }
                },
                onClose: () => editorRef.current.closeInspector(),
                onSetDialogueCharacter: characterId => {
                    const target = blockId ? editorRef.current.scene?.blocks[blockId] : null;
                    if (target) {
                        editorRef.current.setDialogueSpeaker(target, characterId ? { characterId } : null);
                    }
                },
                generateTextId: () => editorRef.current.uuidService?.generate() ?? crypto.randomUUID(),
                onCreateLayer: nextBeforeBlockId => editorRef.current.createLayerBeforeBlock(nextBeforeBlockId),
                onUpdateScene: patch => editorRef.current.updateSceneMetadata(patch),
            });
        }

        // Claim the rail for this row. Written only when the store does not already say so, so a
        // republish (a keystroke elsewhere in the scene) does not emit a selection event — but a
        // selection made somewhere else in the app, e.g. clicking an asset, IS taken back the next time
        // the author touches a row. `selectionRevision` is what makes re-clicking the *same* row count
        // as touching it.
        const selection: StoryBlockSelection = {
            editor: "story",
            tabId,
            storyId: payload.storyId,
            sceneId: payload.sceneId,
            blockId,
        };
        const current = store.getSelection();
        const isOurs = current.type === STORY_BLOCK_SELECTION_TYPE
            && isStoryBlockSelectionData(current.data)
            && isSameStoryBlockSelection(current.data, selection);
        if (!isOurs) {
            store.setSelection({ type: STORY_BLOCK_SELECTION_TYPE, data: selection });
        }
    }, [
        active,
        editor.activeBlockId,
        editor.characters,
        editor.context,
        editor.document,
        editor.isInitialized,
        editor.scene,
        editor.selectionRevision,
        payload?.sceneId,
        payload?.storyId,
        tabId,
    ]);

    // Hand the rail back when this tab stops owning it (closed, or another editor focused). Clearing
    // only our own selection keeps a click on an asset — which legitimately took the rail — untouched.
    useEffect(() => {
        if (!active || !editor.context) {
            return;
        }
        const store = editor.context.services.get<UIService>(Services.UI).getStore();
        return () => {
            lastInspectorSigRef.current = null;
            publishStoryInspectorState(tabId, null);
            const current = store.getSelection();
            if (current.type === STORY_BLOCK_SELECTION_TYPE && isStoryBlockSelectionData(current.data) && current.data.tabId === tabId) {
                store.setSelection({ type: null, data: null });
            }
        };
    }, [active, editor.context, tabId]);

    useEffect(() => {
        const handleCreateRequest = (event: Event) => {
            const detail = (event as CustomEvent<StoryActionCreateRequestDetail>).detail;
            if (detail?.tabId !== tabId) {
                return;
            }
            editor.createActionFromSidebar(detail.commandId);
        };
        window.addEventListener(STORY_ACTION_CREATE_REQUEST_EVENT, handleCreateRequest);
        return () => window.removeEventListener(STORY_ACTION_CREATE_REQUEST_EVENT, handleCreateRequest);
    }, [editor.createActionFromSidebar, tabId]);

    // Silence any voice audition this tab started when it loses focus or closes — the app-wide player
    // otherwise plays the take to its end after the author has switched tabs or closed the project (#6).
    useEffect(() => {
        if (!active) {
            stopVoiceAudition();
        }
        return () => stopVoiceAudition();
    }, [active]);

    // Cold-mount restore: reposition to the author's saved place once the scene's rows are laid out.
    // With keep-alive tabs this runs only on a true cold mount (first open, app restart, or LRU
    // eviction reopen) — in-session tab switches keep the DOM mounted and are handled by the
    // hidden→shown restore below. Scroll is anchored to the focus row (not a raw pixel offset), so it
    // survives rows re-flowing after mount; we re-apply over a few frames until the target sticks.
    const scrollContainerRef = editor.scrollContainerRef;
    const sceneId = editor.scene?.id;
    const rowCount = editor.visibleRows.length;
    const deepLinkBlockId = payload?.activeBlockId ?? null;
    const panelStateService = useMemo(
        () => (editor.context && editor.isInitialized ? editor.context.services.get<PanelStateService>(Services.PanelState) : null),
        [editor.context, editor.isInitialized],
    );
    const scrollSaveRafRef = useRef<number | null>(null);
    const didRestoreRef = useRef<string | null>(null);
    // Last real scrollTop while the tab was visible (display:none reports 0), so we can put the tab
    // back where it was when it is shown again. Null until the tab has actually been scrolled/mounted.
    const liveScrollTopRef = useRef<number | null>(null);
    // Last element focused inside this editor, to restore keyboard focus that display:none blurred.
    const lastFocusedRef = useRef<HTMLElement | null>(null);
    const prevActiveRef = useRef(active);
    const handledDeepLinkRef = useRef<string | null>(null);
    const addRowButtonRef = useRef<HTMLButtonElement | null>(null);

    // Keep the "add a row" line in view when the keyboard cursor lands on it (Down past the last row),
    // the same courtesy the deep-link effect does for a targeted block.
    useEffect(() => {
        if (editor.addRowFocused) {
            addRowButtonRef.current?.scrollIntoView({ block: "nearest" });
        }
    }, [editor.addRowFocused]);

    useLayoutEffect(() => {
        const el = scrollContainerRef.current;
        // Skip the saved-anchor restore when opening via a deep link — the deep-link effect below
        // positions the view on the target block instead.
        if (!el || !sceneId || !panelStateService || rowCount === 0 || didRestoreRef.current === sceneId || deepLinkBlockId) {
            return;
        }
        didRestoreRef.current = sceneId;
        const view = getStoryEditorViewState(panelStateService, sceneId);
        if (!view) {
            return;
        }
        // Mount-timing safety: the container's content grows to full height over the first few frames
        // after mount (rows measure, the overview image sizes in), so a single scrollTop assignment can
        // get clamped. Re-apply each frame — recomputing the target for the current layout — until it
        // sticks (the container is tall enough to actually reach it) or we run out of the short window.
        const MAX_FRAMES = 20;
        let frame = 0;
        let rafId = 0;
        const attempt = () => {
            const target = resolveStoryEditorRestoreScrollTop(el, view);
            if (target == null) {
                return;
            }
            if (Math.abs(el.scrollTop - target) > 1) {
                el.scrollTop = target;
            }
            const stuck = Math.abs(el.scrollTop - target) <= 1;
            if ((!stuck || frame < 2) && frame++ < MAX_FRAMES) {
                rafId = window.requestAnimationFrame(attempt);
            }
        };
        attempt();
        return () => window.cancelAnimationFrame(rafId);
    }, [scrollContainerRef, sceneId, rowCount, panelStateService, deepLinkBlockId]);

    // Capture the scroll anchor at most once per frame while scrolling (querying row geometry on every
    // raw scroll event would thrash layout on long scenes). The live scrollTop is recorded eagerly so
    // the keep-alive restore has an accurate value even for the last scroll before a tab switch.
    /**
     * What has scrolled off the top: the speaker of the dialogue run you are reading inside, or the
     * container whose header is now above the viewport.
     *
     * A long back-and-forth drops its nametag after the first line by design (that is the grouping),
     * and a container's header is one row among hundreds — so ten screens into a scene there is
     * nothing on screen saying who is talking or what block you are in. This says it, and only while
     * the row that would have said it is out of sight.
     */
    const [scrollContext, setScrollContext] = useState<string | null>(null);
    const scrollContextRef = useRef<() => void>(() => {});
    scrollContextRef.current = () => {
        const el = scrollContainerRef.current;
        if (!el) {
            return;
        }
        const top = el.getBoundingClientRect().top;
        // Only the mounted rows are candidates, which is at most a window's worth — and the read is
        // once per animation frame while scrolling, not once per scroll event.
        const rows = el.querySelectorAll<HTMLElement>("[data-story-row-block-id]");
        let firstVisibleId: StoryBlockId | null = null;
        for (const node of rows) {
            if (node.getBoundingClientRect().bottom > top + 1) {
                firstVisibleId = node.dataset.storyRowBlockId ?? null;
                break;
            }
        }
        setScrollContext(describeScrollContext(editorRef.current.visibleRows, editorRef.current.characters, firstVisibleId));
    };

    const handleScroll = useCallback(() => {
        const el = scrollContainerRef.current;
        if (el) {
            liveScrollTopRef.current = el.scrollTop;
        }
        if (scrollSaveRafRef.current !== null) {
            return;
        }
        scrollSaveRafRef.current = window.requestAnimationFrame(() => {
            scrollSaveRafRef.current = null;
            scrollContextRef.current();
            const el = scrollContainerRef.current;
            if (el && sceneId && panelStateService) {
                patchStoryEditorViewState(panelStateService, sceneId, { scroll: captureStoryEditorScrollAnchor(el) });
            }
        });
    }, [scrollContainerRef, sceneId, panelStateService]);

    useEffect(() => () => {
        if (scrollSaveRafRef.current !== null) {
            window.cancelAnimationFrame(scrollSaveRafRef.current);
            scrollSaveRafRef.current = null;
        }
    }, []);

    // Record focus moves inside the editor so keyboard focus can be restored when the tab is shown.
    const handleEditorFocusCapture = useCallback((event: ReactFocusEvent<HTMLElement>) => {
        if (event.target instanceof HTMLElement) {
            lastFocusedRef.current = event.target;
        }
    }, []);

    // Keep-alive: when the tab goes from hidden to shown, put the scroll position and keyboard focus
    // back. display:none preserves React state and the DOM subtree, but blurs focus and reports
    // scrollTop as 0 while hidden — so we re-apply the last live values on the hidden→shown edge.
    useLayoutEffect(() => {
        const wasActive = prevActiveRef.current;
        prevActiveRef.current = active;
        if (!active || wasActive) {
            return;
        }
        const el = scrollContainerRef.current;
        if (el && liveScrollTopRef.current != null && Math.abs(el.scrollTop - liveScrollTopRef.current) > 1) {
            el.scrollTop = liveScrollTopRef.current;
        }
        const target = lastFocusedRef.current;
        if (target && target.isConnected) {
            window.requestAnimationFrame(() => {
                if (lastFocusedRef.current === target && target.isConnected) {
                    target.focus();
                }
            });
        }
    }, [active, scrollContainerRef]);

    // Deep-link navigation: bring the payload's target block into view and focus the editor once its
    // row exists in the DOM (fresh open after the async load, or re-navigation to an already-open tab).
    useLayoutEffect(() => {
        if (!active || !deepLinkBlockId || handledDeepLinkRef.current === deepLinkBlockId) {
            return;
        }
        const el = scrollContainerRef.current;
        if (!el) {
            return;
        }
        // The row may not be in the DOM — the list is windowed — so this asks the virtualiser to put
        // it there rather than looking for a node. A `false` means the row is not in the visible set
        // at all (still loading, or inside a collapsed parent), which is the old bail-out: the effect
        // re-runs when the rows change.
        if (!scrollRowIntoView(deepLinkBlockId, "center")) {
            return;
        }
        handledDeepLinkRef.current = deepLinkBlockId;
        editor.revealBlock(deepLinkBlockId);
        editor.focusRoot();
    }, [active, deepLinkBlockId, rowCount, scrollContainerRef, scrollRowIntoView, editor.revealBlock, editor.focusRoot]);

    // Dev Mode play head (WI-2): follow the running row in place when this editor owns the scene.
    // Uses the plain row-select visual — never `revealBlock` (which would flip the author's
    // "narrative only" filter) and never `focusRoot` — so watching the game neither reshapes the
    // author's view nor pulls keyboard focus. Only rows the author is currently showing react: a row
    // hidden by the filter or a collapsed parent is not in the DOM, so it is silently skipped.
    const lastPlayHeadBlockRef = useRef<StoryBlockId | null>(null);
    const scrollRowIntoViewRef = useRef(scrollRowIntoView);
    scrollRowIntoViewRef.current = scrollRowIntoView;
    useEffect(() => {
        lastPlayHeadBlockRef.current = null;
        return subscribeStoryRowHighlight(highlight => {
            if (!active || highlight.storyId !== payload?.storyId || highlight.sceneId !== payload?.sceneId) {
                return;
            }
            if (lastPlayHeadBlockRef.current === highlight.blockId) {
                return;
            }
            // Windowed list: ask for the row by index rather than by node, and skip when the author
            // is not showing it at all (filtered out, or inside a collapsed parent) — same silence as
            // before, for the same reason.
            if (!scrollRowIntoViewRef.current(highlight.blockId, "auto")) {
                return;
            }
            lastPlayHeadBlockRef.current = highlight.blockId;
            editorRef.current.selectRow(highlight.blockId);
        });
    }, [active, payload?.storyId, payload?.sceneId, scrollContainerRef]);

    // Live preview pane: layout state persists globally (one workbench preference, not per-scene).
    const [previewPane, setPreviewPane] = useState<StoryScenePreviewPaneState | null>(null);
    useEffect(() => {
        if (panelStateService && previewPane === null) {
            setPreviewPane(getStoryScenePreviewPaneState(panelStateService));
        }
    }, [panelStateService, previewPane]);
    const previewOpen = previewPane?.open === true;
    const previewWidth = previewPane?.width ?? STORY_PREVIEW_PANE_DEFAULT_WIDTH;
    const previewMode: StoryScenePreviewPaneMode = previewPane?.mode ?? "dock";
    const previewFloat = previewPane?.float ?? null;
    const previewWidthRef = useRef(previewWidth);
    previewWidthRef.current = previewWidth;
    const editorBodyRef = useRef<HTMLDivElement | null>(null);

    const togglePreview = useCallback(() => {
        setPreviewPane(current => {
            const base = current ?? DEFAULT_STORY_SCENE_PREVIEW_PANE_STATE;
            const next = { ...base, open: !base.open };
            if (panelStateService) {
                patchStoryScenePreviewPaneState(panelStateService, { open: next.open });
            }
            return next;
        });
    }, [panelStateService]);

    // Switch the (open) pane between docked and picture-in-picture. Popping out for the first time
    // seeds a bottom-right float placement from the editor body's current size.
    const setPreviewMode = useCallback((mode: StoryScenePreviewPaneMode) => {
        setPreviewPane(current => {
            const base = current ?? DEFAULT_STORY_SCENE_PREVIEW_PANE_STATE;
            const el = editorBodyRef.current;
            const float = mode === "float" && base.float === null
                ? createDefaultStoryPreviewFloatRect(el ? { width: el.clientWidth, height: el.clientHeight } : null)
                : base.float;
            const next = { ...base, open: true, mode, float };
            if (panelStateService) {
                patchStoryScenePreviewPaneState(panelStateService, { open: true, mode, float });
            }
            return next;
        });
    }, [panelStateService]);

    // Persist float geometry once a drag/resize settles (called on pointer-up, not per frame).
    const commitPreviewFloat = useCallback((float: StoryScenePreviewFloatRect) => {
        setPreviewPane(current => {
            if (!current) {
                return current;
            }
            const next = { ...current, float };
            if (panelStateService) {
                patchStoryScenePreviewPaneState(panelStateService, { float });
            }
            return next;
        });
    }, [panelStateService]);

    // The handle sits on the pane's left edge: dragging right shrinks the pane. Returns the
    // unconsumed delta so ResizableHandle keeps its anchor aligned with the divider when clamped.
    const handlePreviewResize = useCallback((delta: number): number => {
        const width = previewWidthRef.current;
        const containerWidth = editorBodyRef.current?.clientWidth ?? width * 2;
        const maxWidth = Math.max(STORY_PREVIEW_PANE_MIN_WIDTH, containerWidth * STORY_PREVIEW_PANE_MAX_FRACTION);
        const nextWidth = Math.round(Math.min(maxWidth, Math.max(STORY_PREVIEW_PANE_MIN_WIDTH, width - delta)));
        if (nextWidth !== width) {
            previewWidthRef.current = nextWidth;
            setPreviewPane(current => ({ ...(current ?? DEFAULT_STORY_SCENE_PREVIEW_PANE_STATE), width: nextWidth }));
            if (panelStateService) {
                patchStoryScenePreviewPaneState(panelStateService, { width: nextWidth });
            }
        }
        return (width - nextWidth) - delta;
    }, [panelStateService]);

    // Register the "Story" console channel while this scene editor is mounted, so the shared bottom
    // console shows a Story tab that the preview writes its diagnostics/warnings to. Ref-counted in
    // ConsoleService: several kept-alive scene tabs share one channel, removed only when the last
    // story editor closes. Not gated on `active` — the tab stays across keep-alive switches.
    useEffect(() => {
        if (!editor.context) {
            return;
        }
        const consoleService = editor.context.services.get<ConsoleService>(Services.Console);
        return consoleService.registerChannel(STORY_CONSOLE_CHANNEL);
    }, [editor.context]);

    const preview = useStoryScenePreviewController({
        context: editor.context,
        document: editor.document,
        scene: editor.scene,
        sceneId: payload?.sceneId ?? null,
        activeBlockId: editor.activeBlockId,
        active,
        open: previewOpen,
    });

    // A row's ▶ launches the real game in Dev Mode, entering at that row — this is where the
    // interactive "play from here" lives now (the live preview stays a frozen state view). It carries
    // the scene's selected Scene Snapshot so conditions on non-static variables (e.g. global flags)
    // launch with concrete values; with no snapshot yet, it opens the panel and prompts instead.
    const playFromRow = useCallback((blockId: StoryBlockId) => {
        const storyId = payload?.storyId;
        const sceneId = payload?.sceneId;
        if (!editor.context || !storyId || !sceneId) {
            return;
        }
        const services = editor.context.services;
        const storyService = services.get<StoryService>(Services.Story);
        const uiService = services.get<UIService>(Services.UI);
        const snapshots = storyService.listSceneSnapshots(storyId, sceneId);
        if (snapshots.length === 0) {
            uiService.panels.show(STORY_SNAPSHOT_PANEL_ID);
            uiService.notifications.warning(
                t("storySnapshot.launch.needSnapshot"),
                t("storySnapshot.launch.needSnapshotDetail"),
                [{
                    label: t("storySnapshot.launch.createAction"),
                    primary: true,
                    onClick: () => {
                        const created = storyService.createSceneSnapshot(storyId, sceneId, `${t("storySnapshot.defaultName")} 1`);
                        if (created && panelStateService) {
                            setSelectedSnapshotId(panelStateService, storyId, sceneId, created);
                        }
                    },
                }],
            );
            return;
        }
        const saved = panelStateService ? getSelectedSnapshotId(panelStateService, storyId, sceneId) : undefined;
        const snapshotId = saved && snapshots.some(snapshot => snapshot.id === saved) ? saved : snapshots[0].id;
        services.get<DevModeService>(Services.DevMode).launch({
            kind: "story",
            storyId,
            sceneId,
            blockId,
            snapshotId,
        });
    }, [editor.context, payload?.storyId, payload?.sceneId, panelStateService, t]);

    // Row context menu (WI-3). Right-clicking a row outside the current selection selects just it first,
    // so the menu's selection-scoped actions act on exactly what the author pointed at; inside the
    // selection, the whole selection is kept.
    const rowMenu = useContextMenu();
    const densityMenu = useContextMenu();
    const [menuTargetId, setMenuTargetId] = useState<StoryBlockId | null>(null);
    const openRowContextMenu = useCallback((event: ReactMouseEvent, blockId: StoryBlockId) => {
        if (!editor.selectedBlockIds.has(blockId)) {
            editor.selectRow(blockId);
        }
        setMenuTargetId(blockId);
        rowMenu.showMenu(event);
    }, [editor, rowMenu]);

    /**
     * Find and replace, scoped to this scene.
     *
     * The searched set is `visibleRows` — what the author is actually showing. A row hidden by a
     * collapsed container is hidden because they collapsed it, and "narrative only" hides staging
     * rows, which carry no prose. Searching what is not on the page would find hits the author cannot
     * see the context of, and replacing in them would edit a part of the scene they had put away.
     */
    const [findOpen, setFindOpen] = useState(false);
    const [findQuery, setFindQuery] = useState("");
    const [findReplacement, setFindReplacement] = useState("");
    const [findCaseSensitive, setFindCaseSensitive] = useState(false);
    const [findCursor, setFindCursor] = useState(0);
    const [findFocusToken, setFindFocusToken] = useState(0);

    const findMatches = useMemo<StoryFindMatch[]>(() => {
        if (!findOpen || !findQuery) {
            return [];
        }
        const matches: StoryFindMatch[] = [];
        editor.visibleRows.forEach((row, rowIndex) => {
            const slot = getSegmentSlot(row.block);
            if (!slot) {
                return;
            }
            for (const range of findRangesInText(segmentPlainText(slot.segment), findQuery, { caseSensitive: findCaseSensitive })) {
                matches.push({ ...range, blockId: row.block.id, rowIndex });
            }
        });
        return matches;
    }, [editor.visibleRows, findCaseSensitive, findOpen, findQuery]);

    // A shrinking result set must not leave the cursor pointing past the end.
    const activeFindIndex = findMatches.length === 0 ? 0 : findCursor % findMatches.length;

    const goToMatch = useCallback((index: number) => {
        const match = findMatches[index];
        if (!match) {
            return;
        }
        setFindCursor(index);
        editor.selectRow(match.blockId);
        scrollRowIntoView(match.blockId, "center");
    }, [editor, findMatches, scrollRowIntoView]);

    const stepMatch = useCallback((delta: number) => {
        if (findMatches.length === 0) {
            return;
        }
        goToMatch((activeFindIndex + delta + findMatches.length) % findMatches.length);
    }, [activeFindIndex, findMatches.length, goToMatch]);

    const replaceCurrentMatch = useCallback(() => {
        const match = findMatches[activeFindIndex];
        const block = match ? editor.scene?.blocks[match.blockId] : null;
        const slot = block ? getSegmentSlot(block) : null;
        if (!match || !block || !slot) {
            return;
        }
        const next = replaceInSegment(slot.segment, match, findReplacement);
        editor.updateBlockPayloads([{ blockId: match.blockId, payload: slot.withSegment(next).payload }]);
        // Stay put: the list re-derives and the cursor lands on whatever now occupies this position,
        // which is the next hit when the replacement no longer matches.
    }, [activeFindIndex, editor, findMatches, findReplacement]);

    const replaceAllMatches = useCallback(() => {
        if (findMatches.length === 0) {
            return;
        }
        const byBlock = new Map<StoryBlockId, StoryFindMatch[]>();
        for (const match of findMatches) {
            const bucket = byBlock.get(match.blockId);
            bucket ? bucket.push(match) : byBlock.set(match.blockId, [match]);
        }
        const edits: { blockId: StoryBlockId; payload: StoryBlock["payload"] }[] = [];
        for (const [blockId, ranges] of byBlock) {
            const block = editor.scene?.blocks[blockId];
            const slot = block ? getSegmentSlot(block) : null;
            if (!block || !slot) {
                continue;
            }
            const next = replaceAllInSegment(slot.segment, ranges, findReplacement);
            edits.push({ blockId, payload: slot.withSegment(next).payload });
        }
        // One history entry for the sweep, not one per row.
        editor.updateBlockPayloads(edits);
        setFindCursor(0);
    }, [editor, findMatches, findReplacement]);

    const openFind = useCallback(() => {
        setFindOpen(true);
        setFindFocusToken(token => token + 1);
    }, []);
    openFindRef.current = openFind;

    const openCommandManual = useCallback(() => {
        if (!editor.context) {
            return;
        }
        editor.context.services.get<UIService>(Services.UI).panels.show(STORY_ACTION_CREATOR_PANEL_ID);
    }, [editor.context]);

    /**
     * `SortableContext` lists its items as a memo dependency, so a fresh array here would publish a
     * fresh context value on every render — and a changed context re-renders every `useSortable`
     * consumer, i.e. every row, which is exactly what `memo` on the row is there to stop.
     */

    /**
     * The rows' action surface, published once and never rebuilt.
     *
     * Identity is the whole point: this goes through context, and a context value that changes
     * identity re-renders every consumer — which would undo `memo` on the row and put us back at a
     * full re-render per keystroke. The closures it needs (`editor` is a fresh object every render)
     * are read from a ref refreshed after each commit, so the handlers always see current state
     * without ever appearing in a dependency array. Handlers only run from events, which is after
     * the commit that refreshed the ref.
     */
    const rowActionsLatest = useRef({ editor, openRowContextMenu, playFromRow });
    useLayoutEffect(() => {
        rowActionsLatest.current = { editor, openRowContextMenu, playFromRow };
    });
    const rowActions = useMemo<StoryRowActions>(() => {
        const latest = () => rowActionsLatest.current;
        /** The row's block, by id, from whatever scene is current. */
        const blockOf = (blockId: StoryBlockId) => latest().editor.scene?.blocks[blockId] ?? null;
        return {
            select: (blockId, event) => latest().editor.selectRow(blockId, event),
            contextMenu: (blockId, event) => latest().openRowContextMenu(event, blockId),
            mouseDown: (blockId, event) => latest().editor.beginDragSelection(blockId, event),
            mouseEnter: blockId => latest().editor.extendDragSelection(blockId),
            toggleCollapsed: blockId => latest().editor.toggleCollapsed(blockId),
            startTextEdit: blockId => {
                const block = blockOf(blockId);
                const text = block ? getTextSegment(block) : null;
                if (text) {
                    latest().editor.setEditorMode({ kind: "text", blockId, value: text.value, rich: text.rich });
                }
            },
            editRichChange: (blockId, value, rich) => {
                const { editor: current } = latest();
                current.resetGoalColumn();
                current.setEditorMode(mode => mode.kind === "text" && mode.blockId === blockId
                    ? { ...mode, value, rich }
                    : mode);
            },
            commitTextEdit: () => latest().editor.commitTextEdit(),
            exitTextEdit: () => {
                const { editor: current } = latest();
                current.commitTextEdit();
                current.focusRoot();
            },
            continueRow: () => latest().editor.insertContinuationAfterCurrentTextEdit(),
            arrowOut: (direction, caretX) => latest().editor.navigateFromTextEdit(direction, caretX),
            goalColumnInvalidated: () => latest().editor.resetGoalColumn(),
            backspaceAtEmptyStart: () => latest().editor.handleBackspaceAtEmptyStart(),
            // The row's own stack is spent, so the caret is back where the edit opened and committing
            // is a no-op (`commitTextEdit` short-circuits when nothing changed, recording no history).
            // Leaving the field first is what lets a further Mod+Z reach story history.
            undoBeyondRow: () => {
                const { editor: current } = latest();
                current.commitTextEdit();
                current.focusRoot();
                current.undoEdit();
            },
            redoBeyondRow: () => {
                const { editor: current } = latest();
                current.commitTextEdit();
                current.focusRoot();
                current.redoEdit();
            },
            openInspector: blockId => latest().editor.activateBlockForInspectorOrOp(blockId),
            updatePayload: (blockId, payload) => latest().editor.updateBlockPayloadFor(blockId, payload),
            setDialogueCharacter: (blockId, characterId) => {
                const block = blockOf(blockId);
                if (block) {
                    latest().editor.setDialogueSpeaker(block, characterId ? { characterId } : null);
                }
            },
            setPosition: (blockId, position, sourceId) => {
                const block = blockOf(blockId);
                if (block) {
                    latest().editor.setDialogueGroupPosition(block, position, sourceId);
                }
            },
            setSpeaker: (blockId, speaker) => {
                const block = blockOf(blockId);
                if (block) {
                    latest().editor.setDialogueSpeaker(block, speaker);
                }
            },
            createCharacter: (blockId, name) => {
                const block = blockOf(blockId);
                if (block) {
                    latest().editor.createCharacterFromSpeaker(block, name);
                }
            },
            insertAfter: blockId => latest().editor.startInsertAfter(blockId, true),
            deleteRow: blockId => void latest().editor.deleteRows([blockId]),
            addInside: parentId => latest().editor.addInsideContainer(parentId),
            addBranch: (conditionId, branch) => latest().editor.addConditionBranch(conditionId, branch),
            playFromRow: blockId => latest().playFromRow(blockId),
            toggleLens: blockId => latest().editor.toggleContainerLens(blockId),
        };
    }, []);

    if (!editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-fg-muted">
                {t("story.sceneEditor.tabInvalid")}
            </div>
        );
    }

    if (editor.loading) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-fg-muted">
                {t("story.sceneEditor.loadingScene")}
            </div>
        );
    }

    const document = editor.document;
    const scene = editor.scene;

    if (!document || !scene) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-warning">
                {t("story.sceneEditor.notFound")}
            </div>
        );
    }

    const lastVisibleRowId = editor.visibleRows[editor.visibleRows.length - 1]?.block.id ?? null;
    const isInsertingAfterLastRow = editor.editorMode.kind === "insert" && !editor.editorMode.slot.replaceBlockId && editor.editorMode.slot.afterBlockId === lastVisibleRowId;
    // While an insert slot is open it *is* the active line (it carries its own highlight and the
    // caret), so no row shows as active/selected — otherwise the row the slot sits after would look
    // focused too. The row's own highlight comes back when the slot closes (commit selects the new
    // row; cancel leaves activeBlockId on the row the slot opened from, so focus returns there).
    const insertActive = editor.editorMode.kind === "insert";
    const assetsService = editor.context.services.get<AssetsService>(Services.Assets);
    const backgroundAsset = scene.defaultBackgroundAssetId
        ? assetsService.getAssets()[AssetType.Image]?.[scene.defaultBackgroundAssetId] ?? null
        : null;
    const handleDragEnd = (event: DragEndEvent) => {
        const activeId = String(event.active.id);
        const overId = event.over ? String(event.over.id) : null;
        if (!overId || activeId === overId) {
            return;
        }
        editor.moveDraggedBlockToSortablePosition(activeId, overId);
    };

    // Row context-menu items (WI-3). Insert / play / inspector act on the pointed-at row; duplicate /
    // disable / delete act on the whole selection (which the right-click already normalized). The
    // disable rung reads "Enable" when every targeted root is already disabled, so one action toggles.
    const densityMenuItems: ContextMenuDef = STORY_EDITOR_DENSITIES.map(density => ({
        id: density,
        label: t(`story.view.density.${density}` as TranslationKey),
        icon: editor.density === density ? <Check className="h-3.5 w-3.5 text-primary" /> : undefined,
        onClick: () => editor.setDensity(density),
    }));

    const menuTarget = menuTargetId;
    const menuRoots = editor.selectionRootIds();
    const menuAllDisabled = menuRoots.length > 0 && menuRoots.every(id => scene.blocks[id]?.disabled);
    const rowMenuItems: ContextMenuDef = menuTarget ? [
        { id: "insert-above", label: t("story.rowMenu.insertAbove"), onClick: () => editor.startInsertBefore(menuTarget) },
        { id: "insert-below", label: t("story.rowMenu.insertBelow"), onClick: () => editor.startInsertAfter(menuTarget, true) },
        { id: "sep-insert", separator: true },
        { id: "duplicate", label: t("story.rowMenu.duplicate"), onClick: () => editor.duplicateSelection() },
        { id: "disable", label: menuAllDisabled ? t("story.rowMenu.enable") : t("story.rowMenu.disable"), onClick: () => editor.toggleDisableSelection() },
        { id: "sep-op", separator: true },
        { id: "play", label: t("story.rowMenu.playFromHere"), onClick: () => playFromRow(menuTarget) },
        { id: "inspector", label: t("story.rowMenu.openInspector"), onClick: () => editor.activateBlockForInspectorOrOp(menuTarget) },
        { id: "sep-del", separator: true },
        { id: "delete", label: t("story.rowMenu.delete"), onClick: () => void editor.deleteRows(editor.selectedBlockIds.size > 0 ? [...editor.selectedBlockIds] : [menuTarget]) },
    ] : [];

    return (
        <StoryEditorTextStyleProvider density={editor.density}>
        <StoryRowActionsContext.Provider value={rowActions}>
        <div
            ref={editor.rootRef}
            tabIndex={0}
            data-story-density={editor.density}
            style={storyEditorRootStyle(editor.density, editor.visibleRows.length)}
            className="flex h-full min-h-0 flex-col bg-surface text-fg outline-none"
            onFocus={editor.focusWorkspace}
            onFocusCapture={handleEditorFocusCapture}
            onKeyDown={editor.handleKeyDown}
            onCopy={editor.copySelectionToClipboard}
            onPaste={editor.handlePaste}
        >
            <div className="flex min-h-[44px] items-center gap-3 border-b border-edge px-3">
                <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-fg">{scene.name}</div>
                        <div className="truncate text-2xs text-fg-muted">{document.name}</div>
                    </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                    <button
                        type="button"
                        onClick={() => editor.setNarrativeOnly(!editor.narrativeOnly)}
                        title={t("story.view.narrativeOnly")}
                        aria-label={t("story.view.narrativeOnly")}
                        aria-pressed={editor.narrativeOnly}
                        className={["rounded-md p-1.5 transition-colors", editor.narrativeOnly ? "bg-primary/15 text-primary" : "text-fg-muted hover:bg-fill hover:text-fg"].join(" ")}
                    >
                        <AlignLeft className="h-4 w-4" />
                    </button>
                    {/* Three densities, so a two-state toggle can no longer say which one is on. The
                        menu names them and ticks the current one; the button still reads as "not the
                        default" at a glance. `StretchVertical` used to sit here and it is two vertical
                        bars — a pause glyph, in an editor that also has a playback control. Rows is
                        the ordinary idiom for list density and cannot be misread as transport. */}
                    <button
                        type="button"
                        onClick={event => densityMenu.showMenu(event)}
                        title={t("story.view.density")}
                        aria-label={t("story.view.density")}
                        aria-haspopup="menu"
                        aria-pressed={editor.density !== "compact"}
                        className={["rounded-md p-1.5 transition-colors", editor.density !== "compact" ? "bg-primary/15 text-primary" : "text-fg-muted hover:bg-fill hover:text-fg"].join(" ")}
                    >
                        <Rows3 className="h-4 w-4" />
                    </button>
                    {/* The manual used to be a modal, which meant closing what you were reading before
                        you could use it. It is the right-hand panel now, so the documentation and the
                        line you are writing are on screen together. */}
                    <button
                        type="button"
                        onClick={openCommandManual}
                        title={t("story.commandManual.open")}
                        aria-label={t("story.commandManual.open")}
                        className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                    >
                        <BookOpen className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {findOpen ? (
                <StoryFindBar
                    query={findQuery}
                    onQueryChange={value => { setFindQuery(value); setFindCursor(0); }}
                    replacement={findReplacement}
                    onReplacementChange={setFindReplacement}
                    caseSensitive={findCaseSensitive}
                    onToggleCaseSensitive={() => setFindCaseSensitive(value => !value)}
                    matchCount={findMatches.length}
                    activeMatch={findMatches.length === 0 ? 0 : activeFindIndex + 1}
                    onNext={() => stepMatch(1)}
                    onPrevious={() => stepMatch(-1)}
                    onReplace={replaceCurrentMatch}
                    onReplaceAll={replaceAllMatches}
                    onClose={() => { setFindOpen(false); editor.focusRoot(); }}
                    focusToken={findFocusToken}
                />
            ) : null}

            <div ref={editorBodyRef} className="relative flex min-h-0 flex-1 flex-row">
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {/* The prose surface. A custom workspace background clears every base `bg-surface` fill
                (see styles.css), which is right for chrome and wrong for the text you are reading,
                so this one paints its own — at the `editor.surfaceOpacity` the author chose. Opaque
                by default; `.nl-editor-surface` is the one rule the three reading surfaces share. */}
            <div
                ref={editor.scrollContainerRef}
                className="nl-editor-surface min-h-0 flex-1 overflow-auto py-2"
                onMouseDown={editor.focusRoot}
                onScroll={handleScroll}
            >
                <StorySceneOverviewBlock
                    document={document}
                    scene={scene}
                    backgroundAsset={backgroundAsset}
                    onUpdateScene={editor.updateSceneMetadata}
                    panelStateService={panelStateService}
                />
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    {/* `items` stays the WHOLE list, not the window. dnd-kit tolerates a rect it has
                        not measured (its strategy and gap helpers both guard on it), and telling it
                        only about the rows currently on screen would make "which index is this" mean
                        something different from what the document says. */}
                    <SortableContext items={sortableRowIds} strategy={verticalListSortingStrategy}>
                    <div ref={rowListRef} style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
                        {rowVirtualizer.getVirtualItems().map(virtualRow => {
                            const row = editor.visibleRows[virtualRow.index];
                            if (!row) {
                                return null;
                            }
                            return (
                            <div
                                key={row.block.id}
                                data-index={virtualRow.index}
                                ref={rowVirtualizer.measureElement}
                                // `start` is measured from the top of the SCROLLER, so the list's own offset has to come
                                // back off it — the list element is already that far down the flow. Leaving it in
                                // pushes every row down by the height of the scene overview above it.
                                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start - rowListMargin}px)` }}
                            >
                                {/* "Insert above" (WI-3): a before-target slot renders in front of this row at
                                    its own depth, so the new line lands above it whether or not it has a
                                    previous sibling. */}
                                {editor.editorMode.kind === "insert" && !editor.editorMode.slot.replaceBlockId && editor.editorMode.slot.afterBlockId === null && editor.editorMode.slot.target?.beforeBlockId === row.block.id ? (
                                    <InsertRow
                                        mode={editor.editorMode}
                                        depth={row.depth}
                                        characters={editor.characters}
                                        commandContext={editor.commandContext}
                                        inputRef={editor.insertInputRef}
                                        onValueChange={editor.handleInsertValueChange}
                                        onCommitNarration={focusNext => editor.commitNarrationFromInsert(focusNext)}
                                        onDismissChooser={editor.dismissInsertChooser}
                                        onDiscardSlot={editor.discardInsertSlot}
                                        onResolveLine={editor.resolveInsertLine}
                                        onCommitInvalid={editor.commitInvalidFromInsert}
                                        onChooseCommand={editor.chooseCommand}
                                        onChooseCharacter={editor.chooseCharacterForInsert}
                                        onChooseTempSpeaker={editor.chooseTempSpeakerForInsert}
                                        tempSpeakers={editor.tempSpeakers}
                                        onBackspaceEmpty={editor.handleInsertBackspaceEmpty}
                                        slashAtAlias={editor.slashAtAlias}
                                    />
                                ) : null}
                                {/* A row being rewritten (an invalid line re-opened for editing) renders
                                    *as* the editable line, in its own place. Rendering the slot beside it
                                    instead would show the row twice — once broken, once being fixed —
                                    which reads as "double-click added a row", the way it was reported. */}
                                {editor.editorMode.kind === "insert" && editor.editorMode.slot.replaceBlockId === row.block.id ? (
                                    <InsertRow
                                        mode={editor.editorMode}
                                        depth={row.depth}
                                        characters={editor.characters}
                                        commandContext={editor.commandContext}
                                        inputRef={editor.insertInputRef}
                                        onValueChange={editor.handleInsertValueChange}
                                        onCommitNarration={focusNext => editor.commitNarrationFromInsert(focusNext)}
                                        onDismissChooser={editor.dismissInsertChooser}
                                        onDiscardSlot={editor.discardInsertSlot}
                                        onResolveLine={editor.resolveInsertLine}
                                        onCommitInvalid={editor.commitInvalidFromInsert}
                                        onChooseCommand={editor.chooseCommand}
                                        onChooseCharacter={editor.chooseCharacterForInsert}
                                        onChooseTempSpeaker={editor.chooseTempSpeakerForInsert}
                                        tempSpeakers={editor.tempSpeakers}
                                        onBackspaceEmpty={editor.handleInsertBackspaceEmpty}
                                        slashAtAlias={editor.slashAtAlias}
                                    />
                                ) : (
                                <StoryBlockRow
                                    row={row}
                                    scene={scene}
                                    document={document}
                                    characters={editor.characters}
                                    commandContext={editor.commandContext}
                                    selected={!insertActive && editor.selectedBlockIds.has(row.block.id)}
                                    active={!insertActive && editor.activeBlockId === row.block.id}
                                    collapsed={editor.collapsedBlockIds.has(row.block.id)}
                                    editing={editor.editorMode.kind === "text" && editor.editorMode.blockId === row.block.id}
                                    editInitialCaret={editor.editorMode.kind === "text" && editor.editorMode.blockId === row.block.id ? (editor.editorMode.caret ?? "end") : undefined}
                                    textInputRef={editor.textInputRef}
                                    tempSpeakers={editor.tempSpeakers}
                                    lensActive={editor.lensContainerIds.has(row.block.id)}
                                    density={editor.density}
                                />
                                )}
                                {editor.shouldRenderActiveInsertSlot && editor.editorMode.kind === "insert" && !editor.editorMode.slot.replaceBlockId && editor.editorMode.slot.afterBlockId === row.block.id ? (
                                    <InsertRow
                                        mode={editor.editorMode}
                                        // Inserting *inside* this row (its `+ Add action`) nests one level
                                        // deeper; a sibling-after slot keeps the row's own depth.
                                        depth={editor.editorMode.slot.target?.parentId === row.block.id ? row.depth + 1 : row.depth}
                                        characters={editor.characters}
                                        commandContext={editor.commandContext}
                                        inputRef={editor.insertInputRef}
                                        onValueChange={editor.handleInsertValueChange}
                                        onCommitNarration={focusNext => editor.commitNarrationFromInsert(focusNext)}
                                        onDismissChooser={editor.dismissInsertChooser}
                                        onDiscardSlot={editor.discardInsertSlot}
                                        onResolveLine={editor.resolveInsertLine}
                                        onCommitInvalid={editor.commitInvalidFromInsert}
                                        onChooseCommand={editor.chooseCommand}
                                        onChooseCharacter={editor.chooseCharacterForInsert}
                                        onChooseTempSpeaker={editor.chooseTempSpeakerForInsert}
                                        tempSpeakers={editor.tempSpeakers}
                                        onBackspaceEmpty={editor.handleInsertBackspaceEmpty}
                                        slashAtAlias={editor.slashAtAlias}
                                    />
                                ) : null}
                            </div>
                            );
                        })}
                    </div>
                    </SortableContext>
                </DndContext>
                {editor.editorMode.kind === "insert" && !editor.editorMode.slot.replaceBlockId && editor.editorMode.slot.afterBlockId === null && !editor.editorMode.slot.target?.beforeBlockId ? (
                    <InsertRow
                        mode={editor.editorMode}
                        depth={0}
                        characters={editor.characters}
                        commandContext={editor.commandContext}
                        inputRef={editor.insertInputRef}
                        onValueChange={editor.handleInsertValueChange}
                        onCommitNarration={focusNext => editor.commitNarrationFromInsert(focusNext)}
                        onDismissChooser={editor.dismissInsertChooser}
                        onDiscardSlot={editor.discardInsertSlot}
                        onResolveLine={editor.resolveInsertLine}
                        onCommitInvalid={editor.commitInvalidFromInsert}
                        onChooseCommand={editor.chooseCommand}
                        onChooseCharacter={editor.chooseCharacterForInsert}
                        onChooseTempSpeaker={editor.chooseTempSpeakerForInsert}
                        tempSpeakers={editor.tempSpeakers}
                        onBackspaceEmpty={editor.handleInsertBackspaceEmpty}
                        slashAtAlias={editor.slashAtAlias}
                    />
                ) : isInsertingAfterLastRow ? null : (
                    <button
                        ref={addRowButtonRef}
                        type="button"
                        // Down off the last row lands the keyboard cursor here; the ring is how the
                        // author sees that Enter will open a new row (see moveActiveRowSelection).
                        className={[
                            "mt-1 flex min-h-[32px] w-full items-center gap-2 pl-[calc(var(--nl-story-gutter)+var(--nl-story-handle,20px))] pr-3 text-left text-sm italic",
                            editor.addRowFocused
                                ? "bg-primary/10 text-fg-muted ring-1 ring-inset ring-primary/50"
                                : "text-fg-subtle hover:bg-fill-subtle hover:text-fg-muted",
                        ].join(" ")}
                        onClick={() => editor.startInsertAfter(null, true)}
                    >
                        <Plus className="h-4 w-4 text-primary" />
                        {t("story.sceneEditor.addRow")}
                    </button>
                )}
                {/* A scene with nothing in it is the one place a new author is guaranteed to look, and
                    all it used to say was "click or type to add a row" — true, and no help at all with
                    the question actually being asked, which is "what can I write here". Three lines and
                    the way in. It disappears the moment there is anything to read. */}
                {editor.visibleRows.length === 0 && editor.editorMode.kind !== "insert" ? (
                    <div className="mx-auto mt-6 flex max-w-md flex-col gap-2 px-6 text-xs text-fg-subtle">
                        <p>{t("story.sceneEditor.emptyHint", { trigger: editor.slashAtAlias ? "@" : "/" })}</p>
                        <ul className="flex flex-col gap-1">
                            {EMPTY_SCENE_EXAMPLES.map(example => (
                                <li key={example.line} className="flex flex-wrap items-baseline gap-x-2">
                                    <code className="rounded-md border border-edge-subtle bg-surface-sunken px-1.5 py-0.5 font-mono text-2xs text-fg-muted">
                                        {example.line}
                                    </code>
                                    <span className="text-2xs">{t(example.key)}</span>
                                </li>
                            ))}
                        </ul>
                        <button
                            type="button"
                            className="self-start rounded-md px-0 py-0.5 text-2xs text-primary underline-offset-2 hover:underline"
                            onClick={openCommandManual}
                        >
                            {t("story.sceneEditor.emptyOpenManual")}
                        </button>
                    </div>
                ) : null}
                {/* Always keep roughly one screen (minus a row) of empty scroll space below the
                    content so the last row can be scrolled up to the top of the editor. The height is
                    a percentage of the (definite, flex-sized) scroll container, so no measurement is
                    needed and scroll-position restore keeps working. */}
                <div aria-hidden style={{ height: "calc(100% - 40px)" }} />
            </div>
            {/* Pinned over the scroller rather than sticky inside it: the rows are a windowed absolute
                layout, so there is no ancestor for a sticky row to stick within. */}
            {scrollContext ? (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-[4] flex justify-start px-3 pt-1">
                    <span className="truncate rounded-md border border-edge bg-surface-overlay/95 px-2 py-0.5 text-2xs text-fg-muted shadow-sm">
                        {scrollContext}
                    </span>
                </div>
            ) : null}
            <ContextMenu
                items={rowMenuItems}
                position={rowMenu.menuState.position}
                visible={rowMenu.menuState.visible}
                onClose={rowMenu.hideMenu}
            />
            <ContextMenu
                items={densityMenuItems}
                position={densityMenu.menuState.position}
                visible={densityMenu.menuState.visible}
                onClose={densityMenu.hideMenu}
            />
            <button
                type="button"
                className={`absolute bottom-3 right-3 z-[5] flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs shadow-lg transition-colors ${previewOpen ? "bg-primary/20 text-primary" : "bg-surface-overlay text-fg-muted hover:bg-fill"}`}
                onClick={togglePreview}
                title={previewOpen ? t("story.preview.closePreview") : t("story.preview.openPreview")}
            >
                <MonitorPlay className="h-4 w-4" />
                {t("story.preview.label")}
            </button>
            </div>
            {previewOpen && previewMode === "dock" ? (
                <>
                    <ResizableHandle
                        direction="horizontal"
                        onResize={handlePreviewResize}
                        className="w-1 shrink-0 border-r-2 border-transparent bg-fill-subtle"
                    />
                    <div style={{ width: previewWidth }} className="min-h-0 shrink-0 border-l border-edge">
                        <StoryScenePreviewPane
                            controller={preview}
                            onClose={togglePreview}
                            mode="dock"
                            onToggleFloat={() => setPreviewMode("float")}
                        />
                    </div>
                </>
            ) : null}
            {previewOpen && previewMode === "float" ? (
                <StoryScenePreviewFloat
                    controller={preview}
                    containerRef={editorBodyRef}
                    initialRect={previewFloat ?? createDefaultStoryPreviewFloatRect(null)}
                    onClose={togglePreview}
                    onToggleDock={() => setPreviewMode("dock")}
                    onCommit={commitPreviewFloat}
                />
            ) : null}
            </div>
        </div>
        </StoryRowActionsContext.Provider>
        </StoryEditorTextStyleProvider>
    );
}
