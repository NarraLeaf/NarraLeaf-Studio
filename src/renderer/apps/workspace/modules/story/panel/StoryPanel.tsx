import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, FileText, MoreVertical, Plus, RefreshCw, Star, Waypoints } from "lucide-react";
import type { StoryChapter, StoryDocument, StoryId, StoryLibraryEntry, StoryScene } from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import { createInputDialog } from "@/lib/components/dialogs";
import { Accordion, AccordionItem } from "@/lib/components/elements/Accordion";
import { ContextMenu, type ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { useWorkspace } from "../../../context";
import { useRegistry } from "../../../registry";
import { useFreezeGuard } from "../../../components/ui/freezeGuard";
import type { PanelComponentProps } from "../../types";
import { closeStoryEditorTabs, closeStorySceneEditorTabs } from "./closeStoryEditorTabs";
import { createStorySceneEditorTab } from "../scene-editor/openStorySceneEditorTab";
import { openSceneFlowTab } from "../../story-flow/openSceneFlowTab";
import { buildStorySceneTextProjection } from "../projection/storySceneProjection";
import { useStoryScriptIo } from "../script/useStoryScriptIo";
import { appendDeveloperIdSection, type DeveloperIdEntry } from "@/lib/developer";

interface StoryPanelState {
    selectedStoryId?: string;
    rootOpenItems?: string[];
    chapterOpenItemsByStoryId?: Record<string, string[]>;
}

const DEFAULT_STORY_ROOT_OPEN_ITEMS = ["stories", "outline"];
const STORY_ROOT_ITEM_IDS = new Set(DEFAULT_STORY_ROOT_OPEN_ITEMS);

function filterStoryRootOpenItems(ids: string[] | undefined): string[] {
    if (!Array.isArray(ids)) {
        return DEFAULT_STORY_ROOT_OPEN_ITEMS;
    }
    return ids.filter(id => STORY_ROOT_ITEM_IDS.has(id));
}

function getRenderedStoryRootOpenItems(ids: string[], hasOutline: boolean): string[] {
    return ids.filter(id => hasOutline || id !== "outline");
}

function filterStoryChapterOpenItems(ids: string[], document: StoryDocument): string[] {
    const chapterIds = new Set(document.chapters.map(chapter => chapter.id));
    return ids.filter(id => chapterIds.has(id));
}

export function StoryPanel({ panelId }: PanelComponentProps) {
    const { t, tn } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab } = useRegistry();
    // Creating, renaming and deleting write the story document; opening a scene, opening the flow,
    // exporting a script and picking which story is selected do not, and stay live so a frozen
    // project can still be read.
    const freeze = useFreezeGuard();
    const { beginExport: beginScriptExport, beginImport: beginScriptImport, dialogs: scriptDialogs } = useStoryScriptIo();
    const [stories, setStories] = useState<StoryLibraryEntry[]>([]);
    const [defaultStoryId, setDefaultStoryId] = useState<StoryId | undefined>();
    const [selectedStoryId, setSelectedStoryId] = useState<StoryId | null>(null);
    const [document, setDocument] = useState<StoryDocument | null>(null);
    const [loadingDocument, setLoadingDocument] = useState(false);
    const [menuItems, setMenuItems] = useState<ContextMenuDef>([]);
    const [rootOpenItems, setRootOpenItems] = useState<string[]>(DEFAULT_STORY_ROOT_OPEN_ITEMS);
    const [chapterOpenItemsByStoryId, setChapterOpenItemsByStoryId] = useState<Record<string, string[]>>({});
    const [stateReady, setStateReady] = useState(false);
    const [disableAccordionAnimation, setDisableAccordionAnimation] = useState(true);
    const { menuState, showMenu, hideMenu } = useContextMenu();

    const storyService = useMemo(() => {
        if (!context || !isInitialized) {
            return null;
        }
        return context.services.get<StoryService>(Services.Story);
    }, [context, isInitialized]);

    const uiService = useMemo(() => {
        if (!context || !isInitialized) {
            return null;
        }
        return context.services.get<UIService>(Services.UI);
    }, [context, isInitialized]);

    const inputDialog = useMemo(() => {
        return uiService ? createInputDialog(uiService) : null;
    }, [uiService]);

    useEffect(() => {
        if (!context) {
            return;
        }
        setStateReady(false);
        setDisableAccordionAnimation(true);
        setRootOpenItems(DEFAULT_STORY_ROOT_OPEN_ITEMS);
        setChapterOpenItemsByStoryId({});

        const panelStateService = context.services.get<PanelStateService>(Services.PanelState);
        const saved = panelStateService.getPanelState<StoryPanelState>(panelId);
        if (typeof saved?.selectedStoryId === "string" && saved.selectedStoryId.length > 0) {
            setSelectedStoryId(saved.selectedStoryId);
        }
        setRootOpenItems(filterStoryRootOpenItems(saved?.rootOpenItems));
        if (saved?.chapterOpenItemsByStoryId && typeof saved.chapterOpenItemsByStoryId === "object") {
            const next: Record<string, string[]> = {};
            Object.entries(saved.chapterOpenItemsByStoryId).forEach(([storyId, chapterIds]) => {
                if (typeof storyId === "string" && storyId && Array.isArray(chapterIds)) {
                    next[storyId] = chapterIds.filter(id => typeof id === "string" && id.length > 0);
                }
            });
            setChapterOpenItemsByStoryId(next);
        }
        setStateReady(true);
    }, [context, panelId]);

    const refreshLibrary = useCallback(() => {
        if (!storyService) {
            return;
        }
        const nextStories = storyService.listStories();
        const nextDefault = storyService.getDefaultStoryId();
        setStories(nextStories);
        setDefaultStoryId(nextDefault);
        setSelectedStoryId(current => {
            if (current && nextStories.some(story => story.id === current)) {
                return current;
            }
            return nextDefault ?? nextStories[0]?.id ?? null;
        });
    }, [storyService]);

    const selectedEntry = stories.find(story => story.id === selectedStoryId);

    useEffect(() => {
        refreshLibrary();
    }, [refreshLibrary]);

    useEffect(() => {
        if (!storyService) {
            return;
        }
        return storyService.onLibraryChanged(index => {
            setStories([...index.stories]);
            setDefaultStoryId(index.defaultStoryId);
            setSelectedStoryId(current => {
                if (current && index.stories.some(story => story.id === current)) {
                    return current;
                }
                return index.defaultStoryId ?? index.stories[0]?.id ?? null;
            });
        });
    }, [storyService]);

    useEffect(() => {
        if (!storyService) {
            return;
        }
        return storyService.onDocumentChanged(event => {
            setDocument(current => {
                if (event.storyId !== selectedStoryId) {
                    return current;
                }
                return { ...event.document };
            });
        });
    }, [storyService, selectedStoryId]);

    useEffect(() => {
        if (!storyService || !selectedStoryId) {
            setDocument(null);
            return;
        }
        let cancelled = false;
        setLoadingDocument(true);
        storyService
            .loadStory(selectedStoryId)
            .then(doc => {
                if (!cancelled) {
                    setDocument({ ...doc });
                }
            })
            .catch(error => {
                if (!cancelled) {
                    setDocument(null);
                    uiService?.showError(error instanceof Error ? error : String(error));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoadingDocument(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [storyService, selectedStoryId, uiService]);

    useEffect(() => {
        if (!document || !selectedStoryId) {
            return;
        }
        setChapterOpenItemsByStoryId(prev => {
            const hasSavedForStory = Object.prototype.hasOwnProperty.call(prev, selectedStoryId);
            const current = hasSavedForStory ? prev[selectedStoryId] : document.chapters.map(chapter => chapter.id);
            const filtered = filterStoryChapterOpenItems(current, document);
            if (hasSavedForStory && filtered.length === current.length) {
                return prev;
            }
            return {
                ...prev,
                [selectedStoryId]: filtered,
            };
        });
    }, [document, selectedStoryId]);

    useEffect(() => {
        if (!context || !stateReady) {
            return;
        }
        const panelStateService = context.services.get<PanelStateService>(Services.PanelState);
        panelStateService.setPanelState<StoryPanelState>(panelId, {
            selectedStoryId: selectedStoryId ?? undefined,
            rootOpenItems: filterStoryRootOpenItems(rootOpenItems),
            chapterOpenItemsByStoryId,
        });
    }, [chapterOpenItemsByStoryId, context, panelId, rootOpenItems, selectedStoryId, stateReady]);

    useEffect(() => {
        if (selectedStoryId) {
            setDisableAccordionAnimation(true);
        }
    }, [selectedStoryId]);

    useEffect(() => {
        if (!stateReady || loadingDocument) {
            return;
        }
        if (selectedStoryId && document?.id !== selectedStoryId) {
            return;
        }
        const frame = requestAnimationFrame(() => setDisableAccordionAnimation(false));
        return () => cancelAnimationFrame(frame);
    }, [document?.id, loadingDocument, panelId, selectedStoryId, stateReady]);

    const handleCreateStory = useCallback(async () => {
        if (!storyService || !inputDialog) {
            return;
        }
        const name = await inputDialog.show({
            title: t("story.panel.newStory"),
            placeholder: t("story.panel.newStoryPlaceholder"),
            required: true,
            maxLength: 120,
        });
        if (!name) {
            return;
        }
        const entry = storyService.createStory(name);
        setSelectedStoryId(entry.id);
        refreshLibrary();
    }, [inputDialog, refreshLibrary, storyService, t]);

    const handleRenameStory = useCallback(async (entry: StoryLibraryEntry) => {
        if (!storyService || !inputDialog) {
            return;
        }
        const name = await inputDialog.showRenameDialog(entry.name, "story");
        if (!name) {
            return;
        }
        storyService.renameStory(entry.id, name);
        refreshLibrary();
    }, [inputDialog, refreshLibrary, storyService]);

    const handleDeleteStory = useCallback(async (entry: StoryLibraryEntry) => {
        if (!storyService || !uiService) {
            return;
        }
        const confirmed = await uiService.showConfirm(
            t("story.panel.deleteStoryConfirm", { name: entry.name }),
            t("story.panel.deleteStoryDetail"),
        );
        if (!confirmed) {
            return;
        }
        if (await storyService.deleteStory(entry.id)) {
            // Everything of this story's, by id prefix: its scenes and its flow map. Reading the
            // document first to find out what to close would be the wrong way round for the one
            // call whose whole job is to get rid of it.
            closeStoryEditorTabs(uiService, entry.id);
        }
        refreshLibrary();
    }, [refreshLibrary, storyService, uiService, t]);

    const handleSetDefaultStory = useCallback((entry: StoryLibraryEntry) => {
        if (!storyService) {
            return;
        }
        storyService.setDefaultStory(entry.id);
        refreshLibrary();
    }, [refreshLibrary, storyService]);

    const handleOpenSceneFlow = useCallback((entry: StoryLibraryEntry) => {
        if (!context) {
            return;
        }
        openSceneFlowTab(context, entry.id, entry.name);
    }, [context]);

    const buildStoryContextMenu = useCallback((entry: StoryLibraryEntry): ContextMenuDef => {
        const isDefault = entry.id === defaultStoryId;
        return [
            {
                id: "set-default-story",
                label: t("story.panel.setDefault"),
                ...freeze.menuRow(isDefault),
                onClick: () => handleSetDefaultStory(entry),
            },
            {
                id: "open-scene-flow",
                label: t("story.flow.action.openFlow"),
                onClick: () => handleOpenSceneFlow(entry),
            },
            {
                id: "rename-story",
                label: t("common.rename"),
                ...freeze.menuRow(),
                onClick: () => {
                    void handleRenameStory(entry);
                },
            },
            { id: "story-script-separator", separator: true },
            {
                id: "export-story-script",
                label: t("story.script.exportStory"),
                onClick: () => beginScriptExport({ storyId: entry.id, sceneIds: null }),
            },
            {
                id: "import-story-script",
                label: t("story.script.import"),
                ...freeze.menuRow(),
                onClick: () => beginScriptImport(entry.id),
            },
            { id: "story-actions-separator", separator: true },
            {
                id: "delete-story",
                label: t("common.delete"),
                ...freeze.menuRow(),
                onClick: () => {
                    void handleDeleteStory(entry);
                },
            },
        ];
    }, [beginScriptExport, beginScriptImport, defaultStoryId, freeze, handleDeleteStory, handleOpenSceneFlow, handleRenameStory, handleSetDefaultStory, t]);

    /**
     * The developer section, wired the same way for all three of this panel's menus: what the row
     * stands for, and where to say the identifier landed on the clipboard.
     */
    const withDeveloperRows = useCallback((items: ContextMenuDef, entries: DeveloperIdEntry[]) => (
        appendDeveloperIdSection(items, entries, {
            hideMenu,
            notify: uiService ? (message, type) => uiService.showNotification(message, type) : undefined,
        })
    ), [hideMenu, uiService]);

    const handleOpenStoryMenu = useCallback((event: React.MouseEvent, entry: StoryLibraryEntry) => {
        event.stopPropagation();
        setMenuItems(withDeveloperRows(buildStoryContextMenu(entry), [{ kind: "story", value: entry.id }]));
        showMenu(event);
    }, [buildStoryContextMenu, showMenu, withDeveloperRows]);

    const handleCreateChapter = useCallback(async () => {
        if (!storyService || !inputDialog || !selectedStoryId) {
            return;
        }
        const name = await inputDialog.show({
            title: t("story.panel.newChapter"),
            placeholder: t("story.panel.newChapterPlaceholder"),
            required: true,
            maxLength: 120,
        });
        if (!name) {
            return;
        }
        storyService.createChapter(selectedStoryId, name);
    }, [inputDialog, selectedStoryId, storyService, t]);

    const handleCreateScene = useCallback(async (chapterId?: string) => {
        if (!storyService || !inputDialog || !selectedStoryId) {
            return;
        }
        const name = await inputDialog.show({
            title: t("story.panel.newSceneTitle"),
            placeholder: t("story.panel.newScenePlaceholder"),
            required: true,
            maxLength: 120,
        });
        if (!name) {
            return;
        }
        storyService.createScene(selectedStoryId, { chapterId, name });
    }, [inputDialog, selectedStoryId, storyService, t]);

    const handleRenameChapter = useCallback(async (chapter: StoryChapter) => {
        if (!storyService || !inputDialog || !selectedStoryId) {
            return;
        }
        const name = await inputDialog.showRenameDialog(chapter.name, "chapter");
        if (!name) {
            return;
        }
        storyService.renameChapter(selectedStoryId, chapter.id, name);
    }, [inputDialog, selectedStoryId, storyService]);

    /**
     * The confirm names the scene count because that is the part a chapter row does not show:
     * deleting a chapter deletes every scene in it, and the row itself only says how many there are
     * once it is expanded.
     */
    const handleDeleteChapter = useCallback(async (chapter: StoryChapter) => {
        if (!storyService || !uiService || !selectedStoryId) {
            return;
        }
        const confirmed = await uiService.showConfirm(
            t("story.panel.deleteChapterConfirm", { name: chapter.name }),
            tn("story.panel.deleteChapterDetail", chapter.sceneIds.length),
        );
        if (!confirmed) {
            return;
        }
        // Read the membership before the delete: afterwards the chapter is gone and there is nothing
        // left to ask which scenes it held.
        const sceneIds = [...chapter.sceneIds];
        if (storyService.deleteChapter(selectedStoryId, chapter.id)) {
            closeStorySceneEditorTabs(uiService, selectedStoryId, sceneIds);
        }
    }, [selectedStoryId, storyService, t, tn, uiService]);

    const handleRenameScene = useCallback(async (scene: StoryScene) => {
        if (!storyService || !inputDialog || !selectedStoryId) {
            return;
        }
        const name = await inputDialog.showRenameDialog(scene.name, "scene");
        if (!name) {
            return;
        }
        storyService.renameScene(selectedStoryId, scene.id, name);
    }, [inputDialog, selectedStoryId, storyService]);

    const handleDeleteScene = useCallback(async (scene: StoryScene) => {
        if (!storyService || !uiService || !selectedStoryId) {
            return;
        }
        const confirmed = await uiService.showConfirm(
            t("story.panel.deleteSceneConfirm", { name: scene.name }),
            t("story.panel.deleteSceneDetail"),
        );
        if (!confirmed) {
            return;
        }
        if (storyService.deleteScene(selectedStoryId, scene.id)) {
            closeStorySceneEditorTabs(uiService, selectedStoryId, [scene.id]);
        }
    }, [selectedStoryId, storyService, uiService, t]);

    const handleSetEntryScene = useCallback((scene: StoryScene) => {
        if (!storyService || !selectedStoryId) {
            return;
        }
        storyService.setEntryScene(selectedStoryId, scene.id);
    }, [selectedStoryId, storyService]);

    const handleOpenScene = useCallback((sceneId: string, sceneName: string) => {
        if (!selectedStoryId) {
            return;
        }
        openEditorTab(createStorySceneEditorTab({
            storyId: selectedStoryId,
            sceneId,
        }, sceneName));
    }, [openEditorTab, selectedStoryId]);

    const buildSceneContextMenu = useCallback((scene: StoryScene): ContextMenuDef => {
        const isEntry = document?.entrySceneId === scene.id;
        return [
            {
                id: "open-scene",
                label: t("common.open"),
                onClick: () => handleOpenScene(scene.id, scene.name),
            },
            {
                id: "set-entry-scene",
                label: t("story.panel.setEntryScene"),
                ...freeze.menuRow(isEntry),
                onClick: () => handleSetEntryScene(scene),
            },
            { id: "scene-script-separator", separator: true },
            {
                id: "export-scene-script",
                label: t("story.script.exportScene"),
                onClick: () => {
                    if (selectedStoryId) {
                        beginScriptExport({ storyId: selectedStoryId, sceneIds: [scene.id] });
                    }
                },
            },
            {
                // Story-scoped despite sitting on a scene row: the file decides which scenes it
                // carries, and the confirm dialog names every one of them before anything is written.
                id: "import-scene-script",
                label: t("story.script.import"),
                ...freeze.menuRow(),
                onClick: () => {
                    if (selectedStoryId) {
                        beginScriptImport(selectedStoryId);
                    }
                },
            },
            { id: "scene-actions-separator", separator: true },
            {
                id: "rename-scene",
                label: t("common.rename"),
                ...freeze.menuRow(),
                onClick: () => {
                    void handleRenameScene(scene);
                },
            },
            {
                id: "delete-scene",
                label: t("common.delete"),
                ...freeze.menuRow(),
                onClick: () => {
                    void handleDeleteScene(scene);
                },
            },
        ];
    }, [beginScriptExport, beginScriptImport, document?.entrySceneId, freeze, handleDeleteScene, handleOpenScene, handleRenameScene, handleSetEntryScene, selectedStoryId, t]);

    const buildChapterContextMenu = useCallback((chapter: StoryChapter): ContextMenuDef => [
        {
            id: "new-scene-in-chapter",
            label: t("story.panel.newSceneInChapter"),
            ...freeze.menuRow(),
            onClick: () => {
                void handleCreateScene(chapter.id);
            },
        },
        { id: "chapter-actions-separator", separator: true },
        {
            id: "rename-chapter",
            label: t("common.rename"),
            ...freeze.menuRow(),
            onClick: () => {
                void handleRenameChapter(chapter);
            },
        },
        {
            id: "delete-chapter",
            label: t("common.delete"),
            ...freeze.menuRow(),
            onClick: () => {
                void handleDeleteChapter(chapter);
            },
        },
    ], [freeze, handleCreateScene, handleDeleteChapter, handleRenameChapter, t]);

    const handleOpenChapterMenu = useCallback((event: React.MouseEvent, chapter: StoryChapter) => {
        event.preventDefault();
        // Without this the accordion header treats the click as a toggle, so the menu opens and the
        // chapter collapses under it.
        event.stopPropagation();
        setMenuItems(withDeveloperRows(buildChapterContextMenu(chapter), [{ kind: "chapter", value: chapter.id }]));
        showMenu(event);
    }, [buildChapterContextMenu, showMenu, withDeveloperRows]);

    const handleOpenSceneMenu = useCallback((event: React.MouseEvent, scene: StoryScene) => {
        event.preventDefault();
        event.stopPropagation();
        setMenuItems(withDeveloperRows(buildSceneContextMenu(scene), [{ kind: "scene", value: scene.id }]));
        showMenu(event);
    }, [buildSceneContextMenu, showMenu, withDeveloperRows]);

    const chapterOpenItems = selectedStoryId ? chapterOpenItemsByStoryId[selectedStoryId] ?? [] : [];

    const handleRootOpenChange = useCallback((nextOpenItems: string[]) => {
        setRootOpenItems(filterStoryRootOpenItems(nextOpenItems));
    }, []);

    const handleChapterOpenChange = useCallback((nextOpenItems: string[]) => {
        if (!selectedStoryId || !document) {
            return;
        }
        setChapterOpenItemsByStoryId(prev => ({
            ...prev,
            [selectedStoryId]: filterStoryChapterOpenItems(nextOpenItems, document),
        }));
    }, [document, selectedStoryId]);

    return (
        <div className="flex h-full min-h-0 flex-col" data-panel-id={panelId}>
            <div className="min-h-0 flex-1 overflow-y-auto">
                <Accordion
                    openItems={getRenderedStoryRootOpenItems(filterStoryRootOpenItems(rootOpenItems), Boolean(selectedEntry))}
                    onOpenChange={handleRootOpenChange}
                    multiple
                    disableAnimation={disableAccordionAnimation}
                >
                    <AccordionItem
                        id="stories"
                        title={t("story.panel.storiesCount", { count: stories.length })}
                        className="!border-b-0"
                        actions={
                            <>
                                <button
                                    type="button"
                                    className="p-1 hover:text-primary"
                                    title={t("common.refresh")}
                                    onClick={refreshLibrary}
                                >
                                    <RefreshCw className="h-3 w-3" />
                                </button>
                                <button
                                    type="button"
                                    className="p-1 hover:text-primary disabled:text-fg-subtle disabled:hover:text-fg-subtle"
                                    {...freeze.writes(false, t("story.panel.newStory"))}
                                    onClick={() => {
                                        void handleCreateStory();
                                    }}
                                >
                                    <Plus className="h-3 w-3" />
                                </button>
                            </>
                        }
                    >
                        {stories.length === 0 ? (
                            <div className="px-3 py-4 text-center text-xs text-fg-subtle">{t("story.panel.emptyStories")}</div>
                        ) : (
                            <div className="py-1">
                                {stories.map(entry => {
                                    const selected = entry.id === selectedStoryId;
                                    const isDefault = entry.id === defaultStoryId;
                                    return (
                                        <div
                                            key={entry.id}
                                            className={`group/story flex cursor-default items-center gap-2 px-3 py-1.5 hover:bg-fill ${
                                                selected ? "border-l-2 border-primary bg-primary/20" : ""
                                            }`}
                                            onClick={() => setSelectedStoryId(entry.id)}
                                            onContextMenu={event => handleOpenStoryMenu(event, entry)}
                                        >
                                            {isDefault ? (
                                                <Star className="h-4 w-4 shrink-0 text-fg-muted" />
                                            ) : (
                                                <BookOpen className="h-4 w-4 shrink-0 text-fg-muted" />
                                            )}
                                            <span className="min-w-0 flex-1 truncate text-sm text-fg">{entry.name}</span>
                                            <button
                                                type="button"
                                                className="rounded-md p-1 text-fg-muted opacity-0 hover:bg-fill hover:text-fg group-hover/story:opacity-100"
                                                title={t("story.panel.storyActions")}
                                                onClick={event => handleOpenStoryMenu(event, entry)}
                                            >
                                                <MoreVertical className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </AccordionItem>

                    {selectedEntry ? (
                        <AccordionItem
                            id="outline"
                            title={
                                <span className="flex min-w-0 items-center gap-2">
                                    <span className="truncate">{t("story.panel.outline")}</span>
                                    <span className="truncate text-xs text-fg-subtle">{selectedEntry.name}</span>
                                </span>
                            }
                            className="!border-b-0"
                            actions={
                                <>
                                    <button
                                        type="button"
                                        className="p-1 hover:text-primary"
                                        title={t("story.flow.action.openFlow")}
                                        onClick={() => handleOpenSceneFlow(selectedEntry)}
                                    >
                                        <Waypoints className="h-3 w-3" />
                                    </button>
                                    <button
                                        type="button"
                                        className="p-1 hover:text-primary disabled:text-fg-subtle disabled:hover:text-fg-subtle"
                                        {...freeze.writes(false, t("story.panel.newChapter"))}
                                        onClick={handleCreateChapter}
                                    >
                                        <Plus className="h-3 w-3" />
                                    </button>
                                </>
                            }
                        >
                            {loadingDocument ? (
                                <div className="flex items-center gap-2 px-3 py-3 text-sm text-fg-muted">
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    {t("story.panel.loadingStory")}
                                </div>
                            ) : document ? (
                                <Accordion
                                    key={document.id}
                                    openItems={chapterOpenItems}
                                    onOpenChange={handleChapterOpenChange}
                                    multiple
                                    disableAnimation={disableAccordionAnimation}
                                    className="border-t border-edge-subtle"
                                >
                                    {document.chapters.map(chapter => (
                                        <AccordionItem
                                            key={chapter.id}
                                            id={chapter.id}
                                            level={1}
                                            title={t("story.panel.chapterTitle", { name: chapter.name, count: chapter.sceneIds.length })}
                                            className="!border-b-0"
                                            headerProps={{ onContextMenu: event => handleOpenChapterMenu(event, chapter) }}
                                            actions={
                                                <>
                                                    <button
                                                        type="button"
                                                        className="p-1 hover:text-primary disabled:text-fg-subtle disabled:hover:text-fg-subtle"
                                                        {...freeze.writes(false, t("story.panel.newSceneInChapter"))}
                                                        onClick={() => handleCreateScene(chapter.id)}
                                                    >
                                                        <Plus className="h-3 w-3" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="p-1 text-fg-muted hover:text-fg"
                                                        title={t("story.panel.chapterActions")}
                                                        onClick={event => handleOpenChapterMenu(event, chapter)}
                                                    >
                                                        <MoreVertical className="h-3.5 w-3.5" />
                                                    </button>
                                                </>
                                            }
                                            headerClassName="bg-fill-subtle"
                                            contentClassName="py-1"
                                        >
                                            {chapter.sceneIds.length === 0 ? (
                                                <div className="px-8 py-2 text-xs text-fg-subtle">{t("story.panel.emptyScenes")}</div>
                                            ) : (
                                                chapter.sceneIds.map(sceneId => {
                                                    const scene = document.scenes[sceneId];
                                                    if (!scene) {
                                                        return null;
                                                    }
                                                    const isEntry = document.entrySceneId === scene.id;
                                                    const lineCount = buildStorySceneTextProjection(scene).lines.length;
                                                    return (
                                                        <div
                                                            key={scene.id}
                                                            className="group/scene flex cursor-default items-center gap-2 px-3 py-1.5 hover:bg-fill"
                                                            style={{ paddingLeft: "44px" }}
                                                            onClick={() => handleOpenScene(scene.id, scene.name)}
                                                            onContextMenu={event => handleOpenSceneMenu(event, scene)}
                                                        >
                                                            {isEntry ? (
                                                                <Star className="h-4 w-4 shrink-0 text-fg-muted" />
                                                            ) : (
                                                                <FileText className="h-4 w-4 shrink-0 text-fg-muted" />
                                                            )}
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex min-w-0 items-center gap-2">
                                                                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{scene.name}</span>
                                                                </div>
                                                                <div className="truncate text-2xs text-fg-subtle">{tn("story.panel.lineCount", lineCount)}</div>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                className="rounded-md p-1 text-fg-muted opacity-0 hover:bg-fill hover:text-fg group-hover/scene:opacity-100"
                                                                title={t("story.panel.sceneActions")}
                                                                onClick={event => handleOpenSceneMenu(event, scene)}
                                                            >
                                                                <MoreVertical className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </AccordionItem>
                                    ))}
                                </Accordion>
                            ) : (
                                <div className="px-3 py-3 text-sm text-fg-muted">{t("story.panel.documentUnavailable")}</div>
                            )}
                        </AccordionItem>
                    ) : null}
                </Accordion>
            </div>
            <ContextMenu
                items={menuItems}
                position={menuState.position}
                visible={menuState.visible}
                onClose={hideMenu}
            />
            {scriptDialogs}
        </div>
    );
}
