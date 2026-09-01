import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, FileText, MoreVertical, Plus, RefreshCw, Star, Waypoints } from "lucide-react";
import type { StoryChapter, StoryDocument, StoryId, StoryLibraryEntry, StoryScene } from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { createInputDialog } from "@/lib/components/dialogs";
import { Accordion, AccordionItem } from "@/lib/components/elements/Accordion";
import { DropIndicator } from "@/lib/components/elements/DropIndicator";
import { ContextMenu, type ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { DlcService } from "@/lib/workspace/services/dlc/DlcService";
import type { ProjectDlc } from "@shared/types/dlc";
import { useWorkspace } from "../../../context";
import { useRegistry } from "../../../registry";
import { useFreezeGuard } from "../../../components/ui/freezeGuard";
import type { PanelComponentProps } from "../../types";
import { closeStoryEditorTabs, closeStorySceneEditorTabs } from "./closeStoryEditorTabs";
import { createStorySceneEditorTab } from "../scene-editor/openStorySceneEditorTab";
import { getStorySceneEditorTabId } from "../scene-editor/storySceneEditorTabId";
import { storyDocumentFreezeScope } from "../scene-editor/storySceneReadOnly";
import { storyEditGuard, useStoryLiveSessionGuard } from "../storyLiveSession";
import { syncEditorTabTitle } from "@/lib/workspace/services/ui/editorTabTitle";
import { openSceneFlowTab } from "../../story-flow/openSceneFlowTab";
import { buildStorySceneTextProjection } from "../projection/storySceneProjection";
import { useStoryScriptIo } from "../script/useStoryScriptIo";
import { useNarralangExport } from "../narralang/useNarralangExport";
import { narralangUiEnabled } from "../narralang/narralangUi";
import { appendDeveloperIdSection, type DeveloperIdEntry } from "@/lib/developer";
import {
    buildOutlineRows,
    isOutlineDropAllowed,
    outlineChapterGapForRow,
    outlineGapAnchor,
    outlineGapForRow,
    outlineHalfFromPointer,
    resolveChapterDropAtGap,
    resolveSceneDropAtGap,
    type StoryOutlineDrag,
    type StoryOutlineDropHint,
    type StoryOutlineGap,
} from "./storyOutlineDnd";

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
    // Opening a scene, opening the flow, exporting a script and picking which story is selected write
    // nothing, and stay live so a frozen project can still be read. What does write is split in two,
    // because this panel edits at two levels and only one of them is a story document.
    //
    // The library: creating, renaming and deleting a story, and choosing the default. All four write
    // `StoryService`'s index - a separate document that no partial freeze leaves writable - so they
    // name no scope and stay frozen by any freeze at all.
    const freeze = useFreezeGuard();
    const { beginExport: beginScriptExport, beginImport: beginScriptImport, dialogs: scriptDialogs } = useStoryScriptIo();
    const { beginExport: beginNarralangExport, dialogs: narralangDialogs } = useNarralangExport();
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
    /**
     * The other half of the freeze answer: the outline - chapters and scenes - which lives inside the
     * selected story's own document.
     *
     * Scoped to that document, so a freeze that leaves it writable leaves the outline editable:
     * renaming a scene here writes the same file as typing a line into it, and a panel that refused
     * the first while the editor allowed the second would be saying two things about one document.
     * `undefined` while no story is selected, which is the conservative answer and also the state in
     * which none of these controls is reachable.
     */
    const outlineFreeze = useFreezeGuard(storyDocumentFreezeScope(selectedStoryId ?? undefined));
    /**
     * The outline splits again inside a live session, and along a different line: not which file is
     * written, but which edits reach the other people in the room.
     *
     * Renaming a scene, renaming the story, reordering chapters and choosing the entry scene are
     * operations a session carries, so they keep the answer above and stay live. Creating and
     * deleting a scene or a chapter are not - the vocabulary a session speaks has no word for them
     * (`@shared/live/ops`) - so they are written here and nowhere else, and the copies part company
     * with nothing on screen to say so. Those controls ask {@link outlineStructure} instead.
     */
    const liveSession = useStoryLiveSessionGuard(selectedStoryId ?? undefined);
    const outlineStructure = storyEditGuard(outlineFreeze, liveSession);

    /**
     * The outline drag, held twice on purpose.
     *
     * A native drag runs a nested message loop, so the state set in `dragstart` is not reliably
     * there to be read by the `dragover` that has to decide whether this is a drop target at all -
     * the ref is, and every decision reads it. The state beside it drives what is drawn.
     *
     * ⚠ **The hint carries which kind of row is being dragged, rather than the drawing asking
     * `outlineDrag` for it.** Those are two separate state updates, and the one from `dragstart`
     * does not always land before the first `dragover` renders - which showed up as a chapter drag
     * that highlighted nothing at all, intermittently, because the row it was over asked a value
     * that was still null. The hint is written in `dragover` from the ref, so it cannot disagree
     * with itself.
     */
    const outlineDragRef = useRef<StoryOutlineDrag | null>(null);
    const [outlineDrag, setOutlineDrag] = useState<StoryOutlineDrag | null>(null);
    const [outlineDropHint, setOutlineDropHint] = useState<StoryOutlineDropHint | null>(null);

    // The same default as the effect further down, applied a render earlier so the first paint after
    // a switch is already expanded instead of expanding a frame later. A deliberately emptied outline
    // is a stored `[]` and survives this, since only a missing entry falls back.
    const chapterOpenItems = selectedStoryId && document?.id === selectedStoryId
        ? chapterOpenItemsByStoryId[selectedStoryId] ?? document.chapters.map(chapter => chapter.id)
        : [];

    /**
     * The outline as one flat list of rows, which is what a drag reasons about.
     *
     * Up here rather than beside the JSX because every drag handler needs it, and it has to be the
     * same list the rows are drawn from - a gap index means nothing against a different list.
     */
    const outlineRows = useMemo(
        () => (document ? buildOutlineRows(document, new Set(chapterOpenItems)) : []),
        [chapterOpenItems, document],
    );

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

    const dlcService = useMemo(() => {
        if (!context || !isInitialized) {
            return null;
        }
        return context.services.get<DlcService>(Services.Dlc);
    }, [context, isInitialized]);

    /**
     * The project's DLC, for the row that says which one ships a story.
     *
     * Watched rather than read once: making a DLC and marking a story for it is one flow, and an
     * author who adds one in Project comes straight back here to use it.
     */
    const [dlcs, setDlcs] = useState<ProjectDlc[]>([]);
    useEffect(() => {
        if (!dlcService) {
            setDlcs([]);
            return;
        }
        setDlcs(dlcService.list());
        return dlcService.onDlcChanged(setDlcs);
    }, [dlcService]);

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
                    const ids = chapterIds.filter(id => typeof id === "string" && id.length > 0);
                    // An entry that names no chapter is not restored, so the story comes back to the
                    // expanded default rather than to an outline with nothing under any heading.
                    // Collapsing every chapter still holds for as long as the panel is open; it just
                    // is not a state worth carrying across sessions, and a stored empty list is also
                    // what older builds wrote when a story switch mixed two documents up.
                    if (ids.length > 0) {
                        next[storyId] = ids;
                    }
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

    /**
     * A story the panel has not shown before opens with every chapter expanded: an outline that
     * hides its own scenes is a list of chapter names, and nobody picked that.
     *
     * Guarded on the document belonging to the selected story, because it does not while a switch
     * is in flight - `document` still holds the story being left until the new one finishes
     * loading. Without the guard this effect read the outgoing story's chapter ids, stored them
     * under the incoming story's id, and then, when the real document arrived, filtered that list
     * against chapters it shared none of and settled on the empty set. Every switch landed on a
     * fully collapsed outline, and the empty set was persisted, so it stayed that way.
     */
    useEffect(() => {
        if (!document || !selectedStoryId || document.id !== selectedStoryId) {
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
            /*
             * Which DLC ships this story - shown only once the project has one, because until then
             * there is one answer and a row offering it says nothing.
             *
             * A submenu rather than a dialog: it is a choice from a short list the author already
             * wrote, and the tick says which one is in force without opening anything.
             */
            ...(dlcs.length > 0
                ? [{
                    id: "story-dlc",
                    label: t("story.panel.dlc.title"),
                    submenuIconsEnabled: true,
                    submenu: [
                        {
                            id: "story-dlc-none",
                            label: t("story.panel.dlc.base"),
                            ...(entry.dlcId ? {} : { icon: <Check className="h-3.5 w-3.5" /> }),
                            ...freeze.menuRow(),
                            onClick: () => { storyService?.setStoryDlc(entry.id, null); },
                        },
                        ...dlcs.map(dlc => ({
                            id: `story-dlc-${dlc.id}`,
                            label: dlc.name,
                            ...(entry.dlcId === dlc.id ? { icon: <Check className="h-3.5 w-3.5" /> } : {}),
                            ...freeze.menuRow(),
                            onClick: () => { storyService?.setStoryDlc(entry.id, dlc.id); },
                        })),
                    ],
                }]
                : []),
            { id: "story-script-separator", separator: true },
            {
                id: "export-story-script",
                label: t("story.script.exportStory"),
                onClick: () => beginScriptExport({ storyId: entry.id, sceneIds: null }),
            },
            ...(narralangUiEnabled()
                ? [{
                    // Beside the `.txt` export rather than in a submenu of its own: they are one
                    // feature in two formats, and the format is the only choice between them.
                    id: "export-story-narralang",
                    label: t("story.narralang.exportStory"),
                    onClick: () => beginNarralangExport({ storyId: entry.id, sceneId: null }),
                }]
                : []),
            {
                // Unscoped for two reasons: this row names whichever story was right-clicked rather
                // than the selected one, and an import replaces whole scenes from a file on this
                // machine's disk - see the same row on a scene.
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
    }, [beginNarralangExport, beginScriptExport, beginScriptImport, defaultStoryId, dlcs, freeze, handleDeleteStory, handleOpenSceneFlow, handleRenameStory, handleSetDefaultStory, storyService, t]);

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
        if (storyService.renameScene(selectedStoryId, scene.id, name)) {
            // The tab strip holds a snapshot of the name it was opened under, so the open scene has
            // to be re-titled here as well as in the editor's own rename path.
            syncEditorTabTitle(uiService, getStorySceneEditorTabId(selectedStoryId, scene.id), name);
        }
    }, [inputDialog, selectedStoryId, storyService, uiService]);

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

    /**
     * Pick a row up.
     *
     * `text/plain` is set because a drag with an empty data transfer is not a drag at all in
     * Chromium - nothing is being handed anywhere else, so it carries the row's own id and no more.
     */
    const handleOutlineDragStart = useCallback((event: React.DragEvent, drag: StoryOutlineDrag) => {
        event.stopPropagation();
        outlineDragRef.current = drag;
        setOutlineDrag(drag);
        setOutlineDropHint(null);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", drag.kind === "scene" ? drag.sceneId : drag.chapterId);
    }, []);

    const handleOutlineDragEnd = useCallback(() => {
        outlineDragRef.current = null;
        setOutlineDrag(null);
        setOutlineDropHint(null);
    }, []);

    /**
     * Light a gap up, or leave it alone.
     *
     * Not calling `preventDefault` is how a row says it is not a target, which is what draws the
     * "no drop" cursor - so this asks the same resolvers the drop asks rather than a looser test of
     * its own. A gap that lit up and then refused would be the worse of the two answers.
     */
    const handleOutlineDragOver = useCallback((event: React.DragEvent, gap: StoryOutlineGap | null) => {
        const drag = outlineDragRef.current;
        if (gap === null || !drag || !document || !isOutlineDropAllowed(document, outlineRows, drag, gap)) {
            // The line is on screen exactly while a drop would land. Leaving the last good one up
            // while the pointer sits somewhere that refuses it points at a place the row is not
            // going, which is worse than no line at all - the cursor already says "not here".
            setOutlineDropHint(null);
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        // Also the repair for a `dragstart` whose state update has not landed: the row being carried
        // is greyed from here on, whether or not the first update arrived.
        setOutlineDrag(current => (current === drag ? current : drag));
        setOutlineDropHint(current => (
            current && current.gap === gap && current.dragKind === drag.kind
                ? current
                : { gap, dragKind: drag.kind }
        ));
    }, [document, outlineRows]);

    const handleOutlineDrop = useCallback((event: React.DragEvent, gap: StoryOutlineGap | null) => {
        event.preventDefault();
        event.stopPropagation();
        const drag = outlineDragRef.current;
        handleOutlineDragEnd();
        if (gap === null || !drag || !storyService || !selectedStoryId || !document || outlineFreeze.frozen) {
            return;
        }
        if (drag.kind === "scene") {
            const move = resolveSceneDropAtGap(document, outlineRows, drag.sceneId, gap);
            if (move) {
                storyService.moveScene(selectedStoryId, drag.sceneId, move);
                // A scene dropped into a collapsed chapter would otherwise vanish: it is gone from
                // where it was and the chapter now holding it is not showing its scenes, so the only
                // sign that anything happened is a count going up on a heading.
                setChapterOpenItemsByStoryId(previous => {
                    const current = previous[selectedStoryId] ?? document.chapters.map(chapter => chapter.id);
                    if (current.includes(move.chapterId)) {
                        return previous;
                    }
                    return { ...previous, [selectedStoryId]: [...current, move.chapterId] };
                });
            }
            return;
        }
        const move = resolveChapterDropAtGap(document, outlineRows, drag.chapterId, gap);
        if (move) {
            storyService.moveChapter(selectedStoryId, drag.chapterId, move.beforeChapterId);
        }
    }, [document, handleOutlineDragEnd, outlineFreeze, outlineRows, selectedStoryId, storyService]);

    /**
     * The gap a pointer over this row is aiming at.
     *
     * A chapter heading answers differently from a scene row for a chapter drag: its halves are the
     * two ends of the chapter's whole block rather than the two sides of the heading itself, because
     * the gaps inside the block are not places a chapter can go. See `outlineChapterGapForRow`.
     */
    const outlineGapAt = useCallback((event: React.DragEvent, rowIndex: number): StoryOutlineGap | null => {
        if (rowIndex < 0) {
            return null;
        }
        const half = outlineHalfFromPointer(event.clientY, event.currentTarget.getBoundingClientRect());
        return outlineDragRef.current?.kind === "chapter"
            ? outlineChapterGapForRow(outlineRows, rowIndex, half)
            : outlineGapForRow(rowIndex, half);
    }, [outlineRows]);

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
                ...outlineFreeze.menuRow(isEntry),
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
            ...(narralangUiEnabled()
                ? [{
                    id: "export-scene-narralang",
                    label: t("story.narralang.exportScene"),
                    onClick: () => {
                        if (selectedStoryId) {
                            beginNarralangExport({ storyId: selectedStoryId, sceneId: scene.id });
                        }
                    },
                }]
                : []),
            {
                // Story-scoped despite sitting on a scene row: the file decides which scenes it
                // carries, and the confirm dialog names every one of them before anything is written.
                //
                // The one outline row that keeps the unscoped answer. What it writes is the story
                // document, so a partial freeze would allow it - but it replaces whole scenes from a
                // file on this machine's disk, and inside a live session the other participants have
                // nothing to derive that from. Left conservative until a session has a way to carry it.
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
                ...outlineFreeze.menuRow(),
                onClick: () => {
                    void handleRenameScene(scene);
                },
            },
            {
                id: "delete-scene",
                label: t("common.delete"),
                ...outlineStructure.menuRow(),
                onClick: () => {
                    void handleDeleteScene(scene);
                },
            },
        ];
    }, [beginNarralangExport, beginScriptExport, beginScriptImport, document?.entrySceneId, freeze, handleDeleteScene, handleOpenScene, handleRenameScene, handleSetEntryScene, outlineFreeze, outlineStructure, selectedStoryId, t]);

    const buildChapterContextMenu = useCallback((chapter: StoryChapter): ContextMenuDef => [
        {
            id: "new-scene-in-chapter",
            label: t("story.panel.newSceneInChapter"),
            ...outlineStructure.menuRow(),
            onClick: () => {
                void handleCreateScene(chapter.id);
            },
        },
        { id: "chapter-actions-separator", separator: true },
        {
            // A chapter's name is not a scene's: a session carries `rename-scene` and has no word
            // for renaming a chapter, so this one comes off with the rest of the structure.
            id: "rename-chapter",
            label: t("common.rename"),
            ...outlineStructure.menuRow(),
            onClick: () => {
                void handleRenameChapter(chapter);
            },
        },
        {
            id: "delete-chapter",
            label: t("common.delete"),
            ...outlineStructure.menuRow(),
            onClick: () => {
                void handleDeleteChapter(chapter);
            },
        },
    ], [handleCreateScene, handleDeleteChapter, handleRenameChapter, outlineStructure, t]);

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

    /**
     * Where the one drop indicator goes: which row it hangs on and which edge of it.
     *
     * Computed once for the whole outline rather than asked per row, so that "is this gap the one"
     * is a comparison against a single answer. Two rows can never both draw a line.
     */
    const dropAnchor = outlineDropHint ? outlineGapAnchor(outlineRows.length, outlineDropHint.gap) : null;

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
            {/*
              * A row that accepts a drop stops the event here, so anything that reaches this
              * container is a place no row would take - including the empty space below the last
              * one. Clearing here is what stops a line hanging about over ground that refuses it.
              */}
            <div
                className="min-h-0 flex-1 overflow-y-auto"
                onDragOver={outlineFreeze.gesture(() => setOutlineDropHint(null))}
            >
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
                                                data-tip={t("story.panel.storyActions")} aria-label={t("story.panel.storyActions")}
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
                                        {...outlineStructure.writes(false, t("story.panel.newChapter"))}
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
                                    {document.chapters.map(chapter => {
                                        const chapterRowIndex = outlineRows.findIndex(row => row.kind === "chapter" && row.chapterId === chapter.id);
                                        const chapterDrag = { kind: "chapter" as const, chapterId: chapter.id };
                                        // The one indicator, on the row the gap hangs from. Nothing
                                        // else in the outline draws a drop hint of its own.
                                        const chapterMark = dropAnchor?.rowIndex === chapterRowIndex ? dropAnchor.edge : null;
                                        return (
                                            <div key={chapter.id} className="relative">
                                                {chapterMark === "before" ? <DropIndicator edge="before" /> : null}
                                                {chapterMark === "after" ? <DropIndicator edge="after" /> : null}
                                                <AccordionItem
                                                    id={chapter.id}
                                                    level={1}
                                                    title={t("story.panel.chapterTitle", { name: chapter.name, count: chapter.sceneIds.length })}
                                                    className="!border-b-0"
                                                    headerProps={{
                                                        className: cn(
                                                            // Without this class the global `-webkit-user-drag: none`
                                                            // leaves `draggable` inert and no drag starts at all.
                                                            !outlineFreeze.frozen && "nl-drag-source",
                                                            outlineDrag?.kind === "chapter" && outlineDrag.chapterId === chapter.id && "opacity-50",
                                                        ),
                                                        draggable: !outlineFreeze.frozen,
                                                        onContextMenu: event => handleOpenChapterMenu(event, chapter),
                                                        onDragStart: outlineFreeze.gesture((event: React.DragEvent) => handleOutlineDragStart(event, chapterDrag)),
                                                        onDragEnd: outlineFreeze.gesture(handleOutlineDragEnd),
                                                        onDragOver: outlineFreeze.gesture((event: React.DragEvent) => handleOutlineDragOver(event, outlineGapAt(event, chapterRowIndex))),
                                                        onDrop: outlineFreeze.gesture((event: React.DragEvent) => handleOutlineDrop(event, outlineGapAt(event, chapterRowIndex))),
                                                    }}
                                                    actions={
                                                        <>
                                                            <button
                                                                type="button"
                                                                className="p-1 hover:text-primary disabled:text-fg-subtle disabled:hover:text-fg-subtle"
                                                                {...outlineStructure.writes(false, t("story.panel.newSceneInChapter"))}
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
                                                        // An empty chapter draws no scene rows, so the only gap inside it is
                                                        // the one below its heading - which is what this stands in for.
                                                        <div
                                                            className="px-8 py-2 text-xs text-fg-subtle"
                                                            onDragOver={outlineFreeze.gesture((event: React.DragEvent) => handleOutlineDragOver(event, chapterRowIndex < 0 ? null : chapterRowIndex + 1))}
                                                            onDrop={outlineFreeze.gesture((event: React.DragEvent) => handleOutlineDrop(event, chapterRowIndex < 0 ? null : chapterRowIndex + 1))}
                                                        >
                                                            {t("story.panel.emptyScenes")}
                                                        </div>
                                                    ) : (
                                                        chapter.sceneIds.map(sceneId => {
                                                            const scene = document.scenes[sceneId];
                                                            if (!scene) {
                                                                return null;
                                                            }
                                                            const isEntry = document.entrySceneId === scene.id;
                                                            const lineCount = buildStorySceneTextProjection(scene).lines.length;
                                                            const sceneRowIndex = outlineRows.findIndex(row => row.kind === "scene" && row.sceneId === scene.id);
                                                            const sceneDrag = { kind: "scene" as const, sceneId: scene.id };
                                                            const sceneMark = dropAnchor?.rowIndex === sceneRowIndex ? dropAnchor.edge : null;
                                                            return (
                                                                <div
                                                                    key={scene.id}
                                                                    className={cn(
                                                                        "group/scene relative flex cursor-default items-center gap-2 px-3 py-1.5 hover:bg-fill",
                                                                        // See the chapter header: `draggable` alone is inert.
                                                                        !outlineFreeze.frozen && "nl-drag-source",
                                                                        outlineDrag?.kind === "scene" && outlineDrag.sceneId === scene.id && "opacity-50",
                                                                    )}
                                                                    style={{ paddingLeft: "44px" }}
                                                                    draggable={!outlineFreeze.frozen}
                                                                    onDragStart={outlineFreeze.gesture((event: React.DragEvent) => handleOutlineDragStart(event, sceneDrag))}
                                                                    onDragEnd={outlineFreeze.gesture(handleOutlineDragEnd)}
                                                                    onDragOver={outlineFreeze.gesture((event: React.DragEvent) => handleOutlineDragOver(event, outlineGapAt(event, sceneRowIndex)))}
                                                                    onDrop={outlineFreeze.gesture((event: React.DragEvent) => handleOutlineDrop(event, outlineGapAt(event, sceneRowIndex)))}
                                                                    onClick={() => handleOpenScene(scene.id, scene.name)}
                                                                    onContextMenu={event => handleOpenSceneMenu(event, scene)}
                                                                >
                                                                    {sceneMark === "before" ? <DropIndicator edge="before" /> : null}
                                                                    {sceneMark === "after" ? <DropIndicator edge="after" /> : null}
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
                                                                        data-tip={t("story.panel.sceneActions")} aria-label={t("story.panel.sceneActions")}
                                                                        onClick={event => handleOpenSceneMenu(event, scene)}
                                                                    >
                                                                        <MoreVertical className="h-3.5 w-3.5" />
                                                                    </button>
                                                                </div>
                                                            );
                                                        })
                                                    )}
                                                </AccordionItem>
                                            </div>
                                        );
                                    })}
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
            {narralangDialogs}
        </div>
    );
}
