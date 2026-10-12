import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, PenLine, Plus, Spline, Trash2, Upload } from "lucide-react";
import type {
    StoryAnimationAsset,
    StoryAnimationIndexEntry,
    StoryDocument,
    StoryMotionTargetKind,
    StoryTransformRef,
} from "@shared/types/story";
import { formatStorySecondsLabel } from "@shared/utils/storyTime";
import {
    decodeStoryMotionExchange,
    encodeStoryMotionExchange,
    libraryExchangeFileName,
} from "@shared/story/libraryExchange";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import type { PanelAnchor } from "@/lib/components/elements/HintPopover";
import { Button } from "@/lib/components/elements/Button";
import { Select, type SelectOption } from "@/lib/components/elements/Select";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { TooltipGroup } from "@/lib/tooltip";
import { translate, useTranslation } from "@/lib/i18n";
import { describeAssetReadFailure } from "@/lib/workspace/assets/assetReadFailure";
import { useLibraryExchange } from "@/lib/workspace/hooks/useLibraryExchange";
import { Services } from "@/lib/workspace/services/services";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { StoryAnimationReadError, StoryService } from "@/lib/workspace/services/story/StoryService";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { useKeybindings, whenFocused, type KeybindingDefinition } from "@/apps/workspace/hooks";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { useFreezeGuard } from "../../components/ui/freezeGuard";
import { ShortcutContextMenu } from "../../components/ui/ShortcutContextMenu";
import type { EditorLayout } from "../../registry/types";
import type { PanelComponentProps } from "../types";
import { SearchBox } from "../assets/components/SearchBox";
import { createStoryMotionEditorTab, resolveStoryMotionStageSize } from "./StoryMotionEditorTab";
import { STORY_MOTION_TARGET_KINDS, StoryMotionCreatePopover } from "./StoryMotionCreatePopover";
import { StoryMotionLibraryTile, type StoryMotionLibraryLoad } from "./StoryMotionLibraryTile";
import { getStoryMotionDescriptor } from "./storyMotionAction";
import { getStoryMotionPreset } from "./storyMotionPresets";
import { resolveStoryMotionPreviewTarget } from "./storyMotionPreviewTarget";
import { createStoryMotionName, getStoryMotionDurationMs } from "./storyMotionTimeline";
import {
    STORY_MOTION_ASSET_SELECTION_TYPE,
    STORY_MOTION_KEYFRAME_SELECTION_TYPE,
    type StoryMotionActionContext,
    type StoryMotionPanelPayload,
} from "./storyMotionTypes";

/** The narrowest a tile gets before the grid drops a column. */
const TILE_MIN_WIDTH_PX = 150;
/** `gap-2`, between tiles. */
const TILE_GAP_PX = 8;
/** A tile's padding and border on each side (`p-1.5` + 1px), which the picture does not get. */
const TILE_INSET_PX = 7;

/** Menu row → the command it shares a key with, so the menu prints the key. */
const MENU_SHORTCUTS: Readonly<Record<string, string>> = {
    open: "story-motion.library.open",
    rename: "story-motion.library.rename",
    duplicate: "story-motion.library.duplicate",
    delete: "story-motion.library.delete",
};

type KindFilter = StoryMotionTargetKind | "all";

/**
 * The project's motions, in the bottom tray.
 *
 * Laid out like the tray's asset browser - a toolbar, a grid of tiles, a line of values under it -
 * because it is the same kind of thing: a library of files the author picks from, opens and sorts.
 * Each tile is the motion itself, playing while the pointer is over it, so the list answers "which
 * one was the bounce" without opening anything.
 *
 * What a motion is set to - its name, its repeats, the pictures it previews on - is in the inspector,
 * the way an asset's details are: selecting a tile makes the motion the inspector's subject.
 * Double-click or Enter opens the motion in its editor.
 *
 * When a story row that takes a motion is focused in the story editor, the tile its motion is marks
 * itself, and "Use on Current Row" sets the selected motion there.
 */
export function StoryMotionPanel({ panelId, payload }: PanelComponentProps<StoryMotionPanelPayload | undefined>) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab } = useRegistry();
    const exchange = useLibraryExchange("story-motion");
    // Creating, renaming, duplicating, deleting and using a motion on a row write the project;
    // browsing, previewing, opening and exporting only read, so they stay live in a frozen project.
    const freeze = useFreezeGuard();
    const storyService = useMemo(
        () => context && isInitialized ? context.services.get<StoryService>(Services.Story) : null,
        [context, isInitialized],
    );
    const uiService = useMemo(
        () => context && isInitialized ? context.services.get<UIService>(Services.UI) : null,
        [context, isInitialized],
    );
    const projectService = useMemo(
        () => context && isInitialized ? context.services.get<ProjectService>(Services.Project) : null,
        [context, isInitialized],
    );
    const stageSize = useMemo(() => resolveStoryMotionStageSize(projectService), [projectService]);
    const contentsRef = useRef<HTMLDivElement | null>(null);
    /** Scroll a tile into view once it has been drawn. */
    const revealTile = useCallback((id: string) => {
        requestAnimationFrame(() => {
            contentsRef.current
                ?.querySelector(`[data-motion-tile="${CSS.escape(id)}"]`)
                ?.scrollIntoView({ block: "nearest" });
        });
    }, []);

    /* --- The library ------------------------------------------------------------------------- */

    const [entries, setEntries] = useState<StoryAnimationIndexEntry[]>([]);
    useEffect(() => {
        if (!storyService) {
            setEntries([]);
            return;
        }
        setEntries([...storyService.listAnimationAssets()]);
        return storyService.onAnimationsChanged(index => setEntries([...index.animations]));
    }, [storyService]);
    const loads = useStoryMotionLoads(storyService, entries);

    const [query, setQuery] = useState("");
    const [kindFilter, setKindFilter] = useState<KindFilter>("all");
    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return entries.filter(entry => {
            if (kindFilter !== "all" && entry.targetKind !== kindFilter) {
                return false;
            }
            return !needle
                || entry.name.toLowerCase().includes(needle)
                || t(`motion.targetKind.${entry.targetKind}`).toLowerCase().includes(needle);
        });
    }, [entries, kindFilter, query, t]);
    const visibleIds = useMemo(() => visible.map(entry => entry.id), [visible]);

    // Only the kinds this project has: a filter offering five kinds over three motions offers
    // choices that all come back empty.
    const kindOptions = useMemo<SelectOption[]>(() => [
        { value: "all", label: t("motion.library.allKinds") },
        ...STORY_MOTION_TARGET_KINDS
            .filter(kind => entries.some(entry => entry.targetKind === kind))
            .map(kind => ({ value: kind, label: t(`motion.targetKind.${kind}`) })),
    ], [entries, t]);
    useEffect(() => {
        if (kindFilter !== "all" && !entries.some(entry => entry.targetKind === kindFilter)) {
            setKindFilter("all");
        }
    }, [entries, kindFilter]);

    /* --- The story row the story editor has focused ------------------------------------------ */

    const actionContext = useMemo(() => normalizeActionContext(payload), [payload]);
    const [storyDocument, setStoryDocument] = useState<StoryDocument | null>(null);
    // The service edits a story in place and announces the same object, so the object alone never
    // reads as changed; this counts the announcements.
    const [storyRevision, setStoryRevision] = useState(0);
    useEffect(() => {
        if (!storyService || !actionContext) {
            setStoryDocument(null);
            return;
        }
        let disposed = false;
        void storyService.loadStory(actionContext.storyId)
            .then(next => {
                if (!disposed) {
                    setStoryDocument(next);
                }
            })
            .catch(() => {
                if (!disposed) {
                    setStoryDocument(null);
                }
            });
        const dispose = storyService.onDocumentChanged(event => {
            if (event.storyId === actionContext.storyId) {
                setStoryDocument(event.document);
                setStoryRevision(revision => revision + 1);
            }
        });
        return () => {
            disposed = true;
            dispose();
        };
    }, [actionContext, storyService]);
    const block = actionContext && storyDocument
        ? storyDocument.scenes[actionContext.sceneId]?.blocks[actionContext.blockId] ?? null
        : null;
    const descriptor = useMemo(
        () => block ? getStoryMotionDescriptor(block) : null,
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the revision is what changes when the block does
        [block, storyRevision],
    );
    const rowAnimationId = descriptor?.transform?.mode === "animation" ? descriptor.transform.animationId : undefined;

    /* --- Selection --------------------------------------------------------------------------- */

    const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
    /** Where a Shift+click range starts: the tile last clicked without Shift. */
    const rangeAnchorRef = useRef<string | null>(null);

    // A motion that leaves the library leaves the selection.
    useEffect(() => {
        setSelected(current => {
            const next = new Set([...current].filter(id => entries.some(entry => entry.id === id)));
            return next.size === current.size ? current : next;
        });
    }, [entries]);

    /** The motion the inspector shows: the one selected, when exactly one is. */
    const showInInspector = useCallback((ids: ReadonlySet<string>) => {
        if (!uiService) {
            return;
        }
        const store = uiService.getStore();
        if (ids.size === 1) {
            store.setSelection({ type: STORY_MOTION_ASSET_SELECTION_TYPE, data: { animationId: [...ids][0] } });
        } else if (store.getSelection().type === STORY_MOTION_ASSET_SELECTION_TYPE) {
            store.setSelection({ type: null, data: null });
        }
    }, [uiService]);

    const select = useCallback((ids: readonly string[]) => {
        const next = new Set(ids);
        setSelected(next);
        showInInspector(next);
    }, [showInInspector]);

    const selectOnPointer = useCallback((id: string, event: React.MouseEvent) => {
        if (event.ctrlKey || event.metaKey) {
            const next = new Set(selected);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            rangeAnchorRef.current = id;
            select([...next]);
            return;
        }
        if (event.shiftKey && rangeAnchorRef.current && visibleIds.includes(rangeAnchorRef.current)) {
            const from = visibleIds.indexOf(rangeAnchorRef.current);
            const to = visibleIds.indexOf(id);
            select(visibleIds.slice(Math.min(from, to), Math.max(from, to) + 1));
            return;
        }
        rangeAnchorRef.current = id;
        select([id]);
    }, [select, selected, visibleIds]);

    /** The selection in the order the grid draws it, which is the order every action walks it in. */
    const selectedEntries = useMemo(
        () => entries.filter(entry => selected.has(entry.id)),
        [entries, selected],
    );
    const single = selectedEntries.length === 1 ? selectedEntries[0] : null;

    /* --- What a motion can have done to it --------------------------------------------------- */

    const [renamingId, setRenamingId] = useState<string | null>(null);

    const open = useCallback((id: string) => {
        openEditorTab(createStoryMotionEditorTab({ animationId: id, actionContext: actionContext ?? undefined }));
    }, [actionContext, openEditorTab]);

    const startRename = useCallback(() => {
        if (single) {
            setRenamingId(single.id);
        }
    }, [single]);

    const commitRename = useCallback(async (id: string, name: string | null) => {
        setRenamingId(null);
        // Back to the grid, so the next Enter or Ctrl+A acts on the library.
        contentsRef.current?.focus();
        if (!storyService || !name) {
            return;
        }
        const entry = entries.find(item => item.id === id);
        if (!entry || entry.name === name || freeze.frozen) {
            return;
        }
        await storyService.loadAnimationAsset(id);
        storyService.updateAnimationAsset(id, asset => ({ ...asset, name }));
    }, [entries, freeze.frozen, storyService]);

    const duplicate = useCallback(async () => {
        if (!storyService || selectedEntries.length === 0) {
            return;
        }
        const copies: string[] = [];
        for (const entry of selectedEntries) {
            const source = await storyService.loadAnimationAsset(entry.id).catch(() => null);
            if (!source) {
                continue;
            }
            const copy = await storyService.createAnimationAsset({
                name: t("motion.library.copyName", { name: source.name }),
                targetKind: source.targetKind,
                timeline: source.timeline ? clone(source.timeline) : undefined,
                sequences: clone(source.sequences),
                config: source.config ? clone(source.config) : undefined,
            });
            if (source.previewAssetId || source.previewBackgroundAssetId) {
                storyService.updateAnimationAsset(copy.id, asset => ({
                    ...asset,
                    previewAssetId: source.previewAssetId,
                    previewBackgroundAssetId: source.previewBackgroundAssetId,
                }));
            }
            copies.push(copy.id);
        }
        if (copies.length > 0) {
            select(copies);
            revealTile(copies[copies.length - 1]);
        }
    }, [revealTile, select, selectedEntries, storyService, t]);

    const remove = useCallback(async () => {
        if (!storyService || !uiService || selectedEntries.length === 0) {
            return;
        }
        const confirmed = await uiService.showDestructiveConfirm(
            selectedEntries.length === 1
                ? t("motion.library.deleteOne", { name: selectedEntries[0].name })
                : t("motion.library.deleteMany", { count: selectedEntries.length }),
            t("motion.library.deleteDetail"),
            t("common.delete"),
        );
        if (!confirmed) {
            return;
        }
        for (const entry of selectedEntries) {
            await storyService.deleteAnimationAsset(entry.id);
            clearSelectionForAnimation(uiService, entry.id);
            closeStoryMotionEditorTabs(uiService, entry.id);
        }
        setSelected(new Set());
    }, [selectedEntries, storyService, t, uiService]);

    /**
     * Write motions out to a file.
     *
     * Read through the service rather than off the index: the index carries a name and a kind, and
     * what an author takes with them is the timeline.
     */
    const exportMotions = useCallback(async (list: readonly StoryAnimationIndexEntry[]) => {
        if (!storyService || list.length === 0) {
            return;
        }
        const assets: StoryAnimationAsset[] = [];
        for (const entry of list) {
            const asset = storyService.getLoadedAnimationAsset(entry.id)
                ?? await storyService.loadAnimationAsset(entry.id).catch(() => null);
            if (asset) {
                assets.push(asset);
            }
        }
        if (assets.length === 0) {
            return;
        }
        void exchange.exportItems(
            encodeStoryMotionExchange(assets),
            libraryExchangeFileName("story-motion", assets.map(asset => asset.name)),
        );
    }, [exchange, storyService]);

    const importMotions = useCallback(async () => {
        if (!storyService) {
            return;
        }
        const items = await exchange.importItems(decodeStoryMotionExchange);
        if (!items) {
            return;
        }
        const imported: string[] = [];
        for (const item of items) {
            // Through the same door New uses, so an imported motion is normalized, indexed and
            // undoable exactly like one made here. Its preview pictures are not in the file: the
            // author picks those for this project.
            const asset = await storyService.createAnimationAsset({
                name: item.name,
                targetKind: item.targetKind,
                timeline: item.timeline,
                sequences: item.sequences,
                config: item.config,
            });
            imported.push(asset.id);
        }
        exchange.announceImported(items.length);
        if (imported.length > 0) {
            select(imported);
            revealTile(imported[imported.length - 1]);
        }
    }, [exchange, revealTile, select, storyService]);

    /* --- Using a motion on the focused row --------------------------------------------------- */

    /** Why the selected motion cannot go on the row, or null when it can. */
    const useOnRowBlocked = useMemo<string | null>(() => {
        if (!descriptor) {
            return null;
        }
        if (!single) {
            return t("motion.library.useOnRowNeedsOne");
        }
        if (single.targetKind !== descriptor.targetKind) {
            return t("motion.library.useOnRowWrongKind", { kind: t(`motion.targetKind.${descriptor.targetKind}`) });
        }
        if (single.id === rowAnimationId) {
            return t("motion.library.useOnRowAlready");
        }
        return null;
    }, [descriptor, rowAnimationId, single, t]);

    const useOnRow = useCallback(() => {
        if (!storyService || !actionContext || !block || !descriptor || !single || useOnRowBlocked) {
            return;
        }
        const transform: StoryTransformRef = {
            ...(descriptor.transform ?? {}),
            mode: "animation",
            animationId: single.id,
        };
        storyService.updateBlock(actionContext.storyId, actionContext.sceneId, block.id, descriptor.setTransform(transform));
    }, [actionContext, block, descriptor, single, storyService, useOnRowBlocked]);

    /* --- New motions ------------------------------------------------------------------------- */

    const newButtonRef = useRef<HTMLButtonElement | null>(null);
    const [creating, setCreating] = useState<{ anchor: () => PanelAnchor | null } | null>(null);
    /** The kind last chosen in the New popover, for the next time it opens with no row to follow. */
    const [lastCreateKind, setLastCreateKind] = useState<StoryMotionTargetKind>("character");
    const [createKind, setCreateKind] = useState<StoryMotionTargetKind>("character");

    const openCreate = useCallback((anchor: () => PanelAnchor | null) => {
        // A focused row decides what the new motion is for; otherwise the kind chosen last time.
        setCreateKind(descriptor?.targetKind ?? lastCreateKind);
        setCreating({ anchor });
    }, [descriptor?.targetKind, lastCreateKind]);

    const createTarget = useMemo(() => resolveStoryMotionPreviewTarget({
        // The row's own object only when the new motion is for its kind: a camera preset previewed
        // on a character is a preview of nothing.
        document: descriptor?.targetKind === createKind ? storyDocument : null,
        sceneId: actionContext?.sceneId,
        blockId: actionContext?.blockId,
        fallbackKind: createKind,
        fallbackLabel: t(`motion.targetKind.${createKind}`),
    }), [actionContext?.blockId, actionContext?.sceneId, createKind, descriptor?.targetKind, storyDocument, t]);

    const create = useCallback(async (presetId?: string) => {
        setCreating(null);
        if (!storyService || freeze.frozen) {
            return;
        }
        const preset = presetId ? getStoryMotionPreset(presetId) : undefined;
        const asset = await storyService.createAnimationAsset({
            name: createStoryMotionName(
                t(`motion.targetKind.${createKind}`),
                preset ? t(`motion.preset.${preset.id}`) : t("motion.blankMotionName"),
            ),
            targetKind: createKind,
            timeline: preset?.build(),
            config: preset?.config,
        });
        setLastCreateKind(createKind);
        if (kindFilter !== "all" && kindFilter !== createKind) {
            setKindFilter("all");
        }
        setQuery("");
        select([asset.id]);
        revealTile(asset.id);
    }, [createKind, freeze.frozen, kindFilter, revealTile, select, storyService, t]);

    /* --- Keys, menus and the grid ------------------------------------------------------------ */

    const keybindings = useMemo<KeybindingDefinition[]>(() => [
        { id: "rename", key: "f2", description: t("common.rename"), handler: freeze.run(startRename) },
        { id: "duplicate", key: "mod+d", description: t("common.duplicate"), handler: freeze.run(() => void duplicate()) },
        { id: "delete", key: "delete", description: t("common.delete"), handler: freeze.run(() => void remove()) },
    ], [duplicate, freeze, remove, startRename, t]);
    useKeybindings({
        keybindings,
        enabled: Boolean(storyService),
        when: whenFocused(FocusArea.BottomPanel, panelId),
        idPrefix: `story-motion-library-${panelId}`,
        catalogPrefix: "story-motion.library.",
    });

    const onContentKeyDown = (event: React.KeyboardEvent) => {
        if (renamingId) {
            return;
        }
        const mod = event.ctrlKey || event.metaKey;
        if (event.key === "Enter" && single) {
            event.preventDefault();
            open(single.id);
        } else if (mod && event.key.toLowerCase() === "a") {
            event.preventDefault();
            event.stopPropagation();
            select(visibleIds);
        }
    };

    const [menu, setMenu] = useState<{ kind: "tile" | "space"; x: number; y: number } | null>(null);

    const openTileMenu = useCallback((id: string, event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        // A right-click outside the selection is about that one motion.
        if (!selected.has(id)) {
            rangeAnchorRef.current = id;
            select([id]);
        }
        setMenu({ kind: "tile", x: event.clientX, y: event.clientY });
    }, [select, selected]);

    const menuItems = useMemo<ContextMenuDef>(() => {
        if (menu?.kind === "space") {
            return [
                {
                    id: "new",
                    label: t("motion.library.newMotion"),
                    icon: <Plus className="h-4 w-4" />,
                    ...freeze.menuRow(),
                    onClick: () => {
                        const point = { top: menu.y, bottom: menu.y, left: menu.x };
                        openCreate(() => point);
                    },
                },
                { id: "space-separator", separator: true },
                {
                    id: "import",
                    label: t("common.import"),
                    icon: <Upload className="h-4 w-4" />,
                    ...freeze.menuRow(),
                    onClick: () => void importMotions(),
                },
                {
                    id: "export-all",
                    label: t("common.library.exportAll"),
                    icon: <Download className="h-4 w-4" />,
                    disabled: entries.length === 0,
                    onClick: () => void exportMotions(entries),
                },
            ];
        }
        return [
            {
                id: "open",
                label: t("common.open"),
                icon: <Spline className="h-4 w-4" />,
                disabled: !single,
                onClick: () => single && open(single.id),
            },
            ...(descriptor ? [{
                id: "use-on-row",
                label: t("motion.library.useOnRow"),
                icon: <Check className="h-4 w-4" />,
                ...freeze.menuRow(Boolean(useOnRowBlocked)),
                onClick: useOnRow,
            }] : []),
            { id: "open-separator", separator: true },
            {
                id: "rename",
                label: t("common.rename"),
                icon: <PenLine className="h-4 w-4" />,
                ...freeze.menuRow(!single),
                onClick: startRename,
            },
            {
                id: "duplicate",
                label: t("common.duplicate"),
                icon: <Copy className="h-4 w-4" />,
                ...freeze.menuRow(),
                onClick: () => void duplicate(),
            },
            {
                id: "export",
                label: t("common.export"),
                icon: <Download className="h-4 w-4" />,
                onClick: () => void exportMotions(selectedEntries),
            },
            { id: "delete-separator", separator: true },
            {
                id: "delete",
                label: t("common.delete"),
                icon: <Trash2 className="h-4 w-4" />,
                ...freeze.menuRow(),
                onClick: () => void remove(),
            },
        ];
    }, [
        descriptor, duplicate, entries, exportMotions, freeze, importMotions, menu, open, openCreate, remove,
        selectedEntries, single, startRename, t, useOnRow, useOnRowBlocked,
    ]);

    // The grid's width decides the columns, and a column's width decides the picture's size.
    const [gridElement, setGridElement] = useState<HTMLDivElement | null>(null);
    const [gridWidth, setGridWidth] = useState(0);
    useLayoutEffect(() => {
        if (!gridElement || typeof ResizeObserver === "undefined") {
            return;
        }
        const measure = () => {
            const next = Math.floor(gridElement.getBoundingClientRect().width);
            // Zero is a hidden tray, which has no width to lay out by.
            if (next > 0) {
                setGridWidth(current => (current === next ? current : next));
            }
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(gridElement);
        return () => observer.disconnect();
    }, [gridElement]);
    const columns = Math.max(1, Math.floor((gridWidth + TILE_GAP_PX) / (TILE_MIN_WIDTH_PX + TILE_GAP_PX)));
    const tileWidth = gridWidth > 0 ? (gridWidth - TILE_GAP_PX * (columns - 1)) / columns : TILE_MIN_WIDTH_PX;
    const pictureWidth = Math.max(0, Math.floor(tileWidth - TILE_INSET_PX * 2));

    // The tile the focused row uses comes into view when the row changes.
    useEffect(() => {
        if (rowAnimationId) {
            revealTile(rowAnimationId);
        }
    }, [revealTile, rowAnimationId]);

    const isOnTile = (target: EventTarget) => target instanceof Element && !!target.closest("[data-motion-tile]");

    /* --- Drawing ----------------------------------------------------------------------------- */

    let content: React.ReactNode;
    if (entries.length === 0) {
        // An empty library offers the thing that fills it.
        content = (
            <div className="flex h-full items-center justify-center">
                <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => openCreate(() => anchorOf(newButtonRef.current))}
                    {...freeze.writes(!storyService, undefined)}
                >
                    <Plus className="h-3.5 w-3.5" />
                    {t("motion.library.newMotion")}
                </Button>
            </div>
        );
    } else if (visible.length === 0) {
        content = (
            <div className="flex h-full items-center justify-center px-4 text-xs text-fg-subtle">
                {t("motion.library.noMatches")}
            </div>
        );
    } else {
        content = (
            <div
                ref={setGridElement}
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
                {visible.map(entry => (
                    <StoryMotionLibraryTile
                        key={entry.id}
                        entry={entry}
                        load={loads.get(entry.id) ?? LOADING}
                        stageSize={stageSize}
                        pictureWidth={pictureWidth}
                        selected={selected.has(entry.id)}
                        inUse={entry.id === rowAnimationId}
                        renaming={renamingId === entry.id}
                        onPointerSelect={selectOnPointer}
                        onOpen={open}
                        onContextMenu={openTileMenu}
                        onRenameCommit={(id, name) => void commitRename(id, name)}
                    />
                ))}
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface text-fg">
            <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-edge px-2 py-1">
                <SearchBox
                    size="sm"
                    className="w-44 min-w-20 shrink"
                    value={query}
                    onChange={setQuery}
                    placeholder={t("motion.library.searchPlaceholder")}
                />
                <Select
                    size="sm"
                    className="w-28 shrink-0"
                    options={kindOptions}
                    value={kindFilter}
                    onChange={value => setKindFilter(value as KindFilter)}
                    ariaLabel={t("motion.library.targetKind")}
                />
                <div className="ml-auto flex shrink-0 items-center gap-1">
                    {descriptor ? (
                        <>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1.5"
                                onClick={useOnRow}
                                {...freeze.writes(Boolean(useOnRowBlocked), useOnRowBlocked ?? t("motion.library.useOnRowTip"))}
                            >
                                <Check className="h-3.5 w-3.5" />
                                {t("motion.library.useOnRow")}
                            </Button>
                            <span className="mx-1 h-4 shrink-0 border-l border-edge" />
                        </>
                    ) : null}
                    <TooltipGroup className="flex shrink-0 items-center gap-0.5">
                        <ToolbarButton
                            ref={newButtonRef}
                            size="sm"
                            aria-label={t("motion.library.newMotion")}
                            aria-expanded={creating !== null}
                            onClick={() => {
                                if (creating) {
                                    setCreating(null);
                                } else {
                                    openCreate(() => anchorOf(newButtonRef.current));
                                }
                            }}
                            {...freeze.writes(!storyService, t("motion.library.newMotion"))}
                        >
                            <Plus className="h-4 w-4" />
                        </ToolbarButton>
                        <ToolbarButton
                            size="sm"
                            aria-label={t("common.import")}
                            onClick={() => void importMotions()}
                            {...freeze.writes(!storyService, t("common.import"))}
                        >
                            <Upload className="h-4 w-4" />
                        </ToolbarButton>
                        {/* Not gated by the freeze: exporting reads the motions and writes a file
                            outside the project. */}
                        <ToolbarButton
                            size="sm"
                            aria-label={t("common.library.exportAll")}
                            data-tip={t("common.library.exportAll")}
                            disabled={entries.length === 0}
                            onClick={() => void exportMotions(entries)}
                        >
                            <Download className="h-4 w-4" />
                        </ToolbarButton>
                    </TooltipGroup>
                </div>
            </div>

            <div
                ref={contentsRef}
                tabIndex={0}
                data-motion-library-contents=""
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 outline-none"
                onKeyDown={onContentKeyDown}
                onClick={event => {
                    if (!isOnTile(event.target)) {
                        select([]);
                    }
                }}
                onContextMenu={event => {
                    if (isOnTile(event.target)) {
                        return;
                    }
                    event.preventDefault();
                    setMenu({ kind: "space", x: event.clientX, y: event.clientY });
                }}
            >
                {content}
            </div>

            <LibraryStatus selected={selectedEntries} loads={loads} count={entries.length} />

            {menu ? (
                <ShortcutContextMenu
                    items={menuItems}
                    position={{ x: menu.x, y: menu.y }}
                    visible
                    onClose={() => setMenu(null)}
                    shortcuts={MENU_SHORTCUTS}
                    iconsEnabled
                />
            ) : null}
            {creating ? (
                <StoryMotionCreatePopover
                    anchor={creating.anchor}
                    ownerRef={newButtonRef}
                    kind={createKind}
                    onKindChange={setCreateKind}
                    target={createTarget}
                    stageSize={stageSize}
                    disabled={!storyService || freeze.frozen}
                    onCreate={presetId => void create(presetId)}
                    onClose={() => setCreating(null)}
                />
            ) : null}
        </div>
    );

}

const LOADING: StoryMotionLibraryLoad = { state: "loading" };

/**
 * One line of values under the grid, and no labels: the selected motion on the left, how many there
 * are on the right.
 */
function LibraryStatus(props: {
    selected: readonly StoryAnimationIndexEntry[];
    loads: ReadonlyMap<string, StoryMotionLibraryLoad>;
    count: number;
}) {
    const { t, tn } = useTranslation();
    let left = "";
    if (props.selected.length === 1) {
        const entry = props.selected[0];
        const load = props.loads.get(entry.id);
        const asset = load?.state === "ready" ? load.asset : null;
        const tracks = asset?.timeline?.tracks ?? [];
        const repeat = asset?.config?.repeat ?? 0;
        left = [
            entry.name,
            t(`motion.targetKind.${entry.targetKind}`),
            asset ? formatStorySecondsLabel(getStoryMotionDurationMs(asset.timeline)) : "",
            tracks.map(track => t(`motion.propertyLabel.${track.property}`)).join(t("motion.inspector.listSeparator")),
            repeat > 0 ? tn("motion.library.repeats", repeat) : "",
        ].filter(Boolean).join(" · ");
    } else if (props.selected.length > 1) {
        left = tn("motion.library.selected", props.selected.length);
    }
    return (
        <div className="flex h-6 shrink-0 items-center gap-3 border-t border-edge px-3 text-2xs text-fg-muted">
            <span className="min-w-0 truncate" data-motion-library-status="">{left}</span>
            <span className="ml-auto shrink-0 tabular-nums">{tn("motion.library.count", props.count)}</span>
        </div>
    );
}

/**
 * Every listed motion's file, read once and re-read when the library changes.
 *
 * The tiles draw the timeline, which the index does not carry. The service caches what it has read,
 * so after the first pass this only picks up edits and new motions.
 */
function useStoryMotionLoads(
    storyService: StoryService | null,
    entries: readonly StoryAnimationIndexEntry[],
): ReadonlyMap<string, StoryMotionLibraryLoad> {
    const [loads, setLoads] = useState<ReadonlyMap<string, StoryMotionLibraryLoad>>(() => new Map());
    useEffect(() => {
        if (!storyService) {
            setLoads(new Map());
            return;
        }
        let disposed = false;
        const next = new Map<string, StoryMotionLibraryLoad>();
        const pending: StoryAnimationIndexEntry[] = [];
        for (const entry of entries) {
            const cached = storyService.getLoadedAnimationAsset(entry.id);
            if (cached) {
                next.set(entry.id, { state: "ready", asset: cached });
            } else {
                next.set(entry.id, { state: "loading" });
                pending.push(entry);
            }
        }
        setLoads(next);
        for (const entry of pending) {
            void storyService.loadAnimationAsset(entry.id)
                .then(asset => ({ state: "ready", asset }) as const)
                // Said by the motion's name and what the read answered; the error's own message is
                // English and names the file by the motion's id.
                .catch((error: unknown) => ({
                    state: "failed",
                    reason: describeAssetReadFailure(
                        entry.id,
                        entry.name,
                        error instanceof StoryAnimationReadError ? error.code : undefined,
                        translate,
                    ),
                }) as const)
                .then(load => {
                    if (!disposed) {
                        setLoads(current => new Map(current).set(entry.id, load));
                    }
                });
        }
        return () => {
            disposed = true;
        };
    }, [entries, storyService]);
    return loads;
}

function anchorOf(element: HTMLElement | null): PanelAnchor | null {
    return element?.getBoundingClientRect() ?? null;
}

function normalizeActionContext(payload: StoryMotionPanelPayload | undefined): StoryMotionActionContext | null {
    if (!payload?.storyId || !payload.sceneId || !payload.blockId) {
        return null;
    }
    return {
        storyId: payload.storyId,
        sceneId: payload.sceneId,
        blockId: payload.blockId,
        storyName: payload.storyName,
        sceneName: payload.sceneName,
    };
}

function clearSelectionForAnimation(uiService: UIService, animationId: string): void {
    const selection = uiService.getStore().getSelection();
    if (
        (selection.type === STORY_MOTION_KEYFRAME_SELECTION_TYPE || selection.type === STORY_MOTION_ASSET_SELECTION_TYPE)
        && selection.data.animationId === animationId
    ) {
        uiService.getStore().setSelection({ type: null, data: null });
    }
}

function closeStoryMotionEditorTabs(uiService: UIService, animationId: string): void {
    const tabs: Array<{ tabId: string; groupId: string }> = [];
    collectStoryMotionEditorTabs(uiService.getStore().getEditorLayout(), animationId, tabs);
    for (const tab of tabs) {
        uiService.getStore().closeEditorTabInGroup(tab.tabId, tab.groupId);
    }
}

function collectStoryMotionEditorTabs(
    layout: Readonly<EditorLayout>,
    animationId: string,
    acc: Array<{ tabId: string; groupId: string }>,
): void {
    if ("tabs" in layout) {
        for (const tab of layout.tabs) {
            const payload = tab.payload as Partial<{ animationId: string }> | undefined;
            const related = tab.id === `story-motion:${animationId}`
                || (payload && typeof payload === "object" && payload.animationId === animationId);
            if (related) {
                acc.push({ tabId: tab.id, groupId: layout.id });
            }
        }
        return;
    }
    collectStoryMotionEditorTabs(layout.first, animationId, acc);
    collectStoryMotionEditorTabs(layout.second, animationId, acc);
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
