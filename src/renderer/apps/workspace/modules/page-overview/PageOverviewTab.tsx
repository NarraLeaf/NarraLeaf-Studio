import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import { resolveEntrySurfaceId } from "@shared/types/ui-editor/entrySurface";
import { useTranslation } from "@/lib/i18n";
import { EmptyState, Select, Switch, Button, type SelectOption } from "@/lib/components/elements";
import { resolveBlueprintNodeTitle } from "@/lib/ui-editor/blueprint-nodes/blueprintNodeI18n";
import { getEditorSurfaceAreaBackgroundColor } from "@/lib/ui-editor/runtime/surfaceBackground";
import { useBrandPaletteRevision } from "@/lib/ui-editor/runtime/useBrandPaletteRevision";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import { Services } from "@/lib/workspace/services/services";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { EditorTabComponentProps } from "@/lib/workspace/services/ui/types";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { UIEditorHistoryService, uiEditorHistoryScope } from "@/lib/workspace/services/ui-editor/UIEditorHistoryService";
import type { UIRuntimeBridgeService } from "@/lib/workspace/services/ui-editor/UIRuntimeBridgeService";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { useRegistry } from "@/apps/workspace/registry";
import { useKeybindings, whenEditorFocused } from "@/apps/workspace/hooks";
import { useHistoryStepHandlers } from "../../components/layout/WorkspaceUndoKeybindings";
import { useWorkspace } from "../../context";
import { useBlueprintDocumentRevision } from "../blueprint-lite/hooks/useBlueprintDocumentRevision";
import { useOpenBlueprintTarget } from "../blueprint-lite/hooks/useOpenBlueprintTarget";
import { createStorySceneEditorTab } from "../story/scene-editor/openStorySceneEditorTab";
import { interfaceDocumentFreezeScope } from "../ui-editor/uiFreezeScope";
import type { OverviewEditServices } from "./pageOverviewEdits";
import { retargetOverviewExit } from "./pageOverviewEdits";
import { canRetargetExit, pickedPageOf, type OverviewDestination } from "./pageOverviewLayout";
import {
    buildPageOverview,
    catalogPageOverviewNodeReader,
    type PageOverview,
    type PageOverviewExit,
    type PageOverviewGroup,
} from "./pageOverviewModel";
import { PageOverviewSection } from "./PageOverviewSection";
import { readPageOverviewPayload, type PageOverviewMode, type PageOverviewTabPayload } from "./pageOverviewTabId";
import type { OverviewNames } from "./pageOverviewText";

const PROPERTIES_PANEL_ID = "narraleaf-studio:properties";

/**
 * Each page of the project laid out with its controls and where they lead: the page in front, a
 * card per control beside it, and a line from each card to every page, story or ending its logic
 * reaches. "This page" shows one page at a time; "All pages" stacks every page in one scroll.
 *
 * A view over what the project already holds. Fields write the same documents through the same
 * services as the canvas and the properties panel, and the lines are read from the blueprints on
 * every change, so there is nothing here that can fall out of step with either.
 */
export function PageOverviewTab({ tabId, payload, active }: EditorTabComponentProps<PageOverviewTabPayload>) {
    const { t, tn } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab } = useRegistry();
    const openBlueprint = useOpenBlueprintTarget();
    const blueprintRevision = useBlueprintDocumentRevision();
    const brandRevision = useBrandPaletteRevision();
    const freeze = useFreezeGuard(interfaceDocumentFreezeScope());
    const readOnly = freeze.frozen;
    const [uiRevision, setUiRevision] = useState(0);
    const [storyRevision, setStoryRevision] = useState(0);

    const services = useMemo(() => {
        if (!isInitialized || !context) {
            return null;
        }
        const get = context.services;
        return {
            ui: get.get<UIService>(Services.UI),
            uiDocument: get.get<UIDocumentService>(Services.UIDocument),
            localBp: get.get<LocalBlueprintService>(Services.LocalBlueprint),
            nodeCatalog: get.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog),
            runtimeBridge: get.get<UIRuntimeBridgeService>(Services.RuntimeBridge),
            story: get.get<StoryService>(Services.Story),
            uiHistory: get.get<UIEditorHistoryService>(Services.UIEditorHistory),
            history: get.get<HistoryService>(Services.History),
        };
    }, [context, isInitialized]);

    useEffect(() => {
        if (!services) {
            return;
        }
        return services.uiDocument.onDocumentChanged(() => setUiRevision(value => value + 1));
    }, [services]);

    useEffect(() => {
        if (!services) {
            return;
        }
        const bump = () => setStoryRevision(value => value + 1);
        // A Start Game line is named by its story and scene, and a story is only in memory once an
        // editor has opened it.
        let disposed = false;
        void services.story.loadAllStories().then(() => {
            if (!disposed) {
                bump();
            }
        });
        const offDocument = services.story.onDocumentChanged(bump);
        const offLibrary = services.story.onLibraryChanged(bump);
        return () => {
            disposed = true;
            offDocument();
            offLibrary();
        };
    }, [services]);

    // What the overview last drew from. Frozen while the tab is hidden, so a hidden overview reads
    // nothing on each keystroke elsewhere, and catches up the moment it is shown.
    const [shown, setShown] = useState({ blueprint: blueprintRevision, ui: uiRevision, story: storyRevision, brand: brandRevision });
    useEffect(() => {
        if (active) {
            setShown({ blueprint: blueprintRevision, ui: uiRevision, story: storyRevision, brand: brandRevision });
        }
    }, [active, blueprintRevision, uiRevision, storyRevision, brandRevision]);

    const documents = useMemo<{ ui: UIDocument; blueprints: BlueprintDocument } | null>(() => {
        if (!services) {
            return null;
        }
        try {
            return { ui: services.uiDocument.getDocument(), blueprints: services.localBp.getBlueprintDocument() };
        } catch {
            return null;
        }
        // The documents are mutated in place; the revisions stand in for them.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [services, shown]);

    const pages = useMemo<UISurface[]>(
        () => (documents?.ui.surfaces ?? []).filter(surface => surface.kind === "appSurface"),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [documents, shown],
    );

    // --- Which page, which mode -------------------------------------------------------------
    const requested = readPageOverviewPayload(payload);
    const mode: PageOverviewMode = requested.mode ?? "current";
    const fallbackSurfaceId = useMemo(() => {
        if (!documents) {
            return null;
        }
        const entry = resolveEntrySurfaceId(documents.ui);
        return pages.some(page => page.id === entry) ? entry : pages[0]?.id ?? null;
    }, [documents, pages]);
    const currentSurfaceId = requested.surfaceId && pages.some(page => page.id === requested.surfaceId)
        ? requested.surfaceId
        : fallbackSurfaceId;

    const setPayload = useCallback((next: PageOverviewTabPayload) => {
        services?.ui.editor.updatePayload<PageOverviewTabPayload>(tabId, next);
    }, [services, tabId]);

    // --- Names ------------------------------------------------------------------------------
    const names = useMemo<OverviewNames>(() => ({
        pageName: surfaceId => documents?.ui.surfaces.find(surface => surface.id === surfaceId)?.name ?? null,
        storyName: (storyId, sceneId) => {
            if (!services) {
                return null;
            }
            const story = services.story.listStories().find(entry => entry.id === storyId);
            if (!story) {
                return null;
            }
            const scene = sceneId ? services.story.getLoadedStoryDocument(story.id)?.scenes[sceneId as keyof object] : undefined;
            const sceneName = (scene as { name?: string } | undefined)?.name;
            return sceneName ? `${story.name} · ${sceneName}` : story.name;
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [documents, services, shown]);

    const headTitles = useRef(new Map<string, string>());
    useEffect(() => {
        headTitles.current.clear();
    }, [t]);
    const headTitle = useCallback((headType: string) => {
        const cached = headTitles.current.get(headType);
        if (cached !== undefined) {
            return cached;
        }
        let title = headType;
        try {
            const entry = services?.nodeCatalog.resolveCatalogEntryForNode(headType, {});
            if (entry && !entry.unknown) {
                title = resolveBlueprintNodeTitle(entry.displayName, t);
            }
        } catch {
            // A head from a plugin that is not loaded keeps its type id.
        }
        headTitles.current.set(headType, title);
        return title;
    }, [services, t]);

    // --- The overviews ------------------------------------------------------------------------
    const [showAllElements, setShowAllElements] = useState(false);
    const reader = useMemo(() => (services ? catalogPageOverviewNodeReader(services.nodeCatalog) : null), [services]);
    const overviews = useMemo<Array<{ surface: UISurface; overview: PageOverview }>>(() => {
        if (!documents || !reader) {
            return [];
        }
        const wanted = mode === "all" ? pages : pages.filter(page => page.id === currentSurfaceId);
        return wanted.flatMap(surface => {
            const overview = buildPageOverview({ ui: documents.ui, blueprints: documents.blueprints, surfaceId: surface.id, read: reader, showAll: showAllElements });
            return overview ? [{ surface, overview }] : [];
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [documents, reader, mode, pages, currentSurfaceId, showAllElements, shown]);

    // --- Selection ----------------------------------------------------------------------------
    const [selection, setSelection] = useState<{ surfaceId: string; elementId: string } | null>(null);
    useEffect(() => {
        if (!services) {
            return;
        }
        const read = () => {
            const current = services.ui.getStore().getSelection();
            if (current.type === "element" && current.data.elementIds.length > 0) {
                setSelection({ surfaceId: current.data.surfaceId, elementId: current.data.primaryId ?? current.data.elementIds[0] });
            } else {
                setSelection(null);
            }
        };
        read();
        return services.ui.getEvents().on("selectionChanged", read);
    }, [services]);

    const selectElement = useCallback((surfaceId: string, elementId: string) => {
        services?.ui.getStore().setSelection({
            type: "element",
            data: { editor: "ui", surfaceId, elementIds: [elementId], primaryId: elementId },
        });
    }, [services]);

    // --- Undo ---------------------------------------------------------------------------------
    // While the overview is on screen, a scope-less Ctrl+Z means the page it is showing - the stack
    // every write here lands on. In "All pages" that is the page of the selected control.
    const scopeSurfaceId = mode === "all" ? selection?.surfaceId ?? currentSurfaceId : currentSurfaceId;
    useEffect(() => {
        if (!services || !active || !scopeSurfaceId) {
            return undefined;
        }
        const scopeId = uiEditorHistoryScope(scopeSurfaceId);
        services.history.setActiveScope(scopeId);
        return () => {
            if (services.history.getActiveScopeId() === scopeId) {
                services.history.setActiveScope(null);
            }
        };
    }, [active, scopeSurfaceId, services]);

    // The shell's Undo key stands down inside editors, so an editor whose edits are undoable has to
    // carry its own. These name the page's stack - the one every write here lands on.
    const undoScope = useCallback(
        () => uiEditorHistoryScope(scopeSurfaceId ?? ""),
        [scopeSurfaceId],
    );
    const step = useHistoryStepHandlers(undoScope);
    const undoKeybindings = useMemo(() => [
        { id: "undo", key: "mod+z", description: "Undo the last change to the page shown", handler: step.undo },
        { id: "redo", key: "mod+shift+z", description: "Redo the last change to the page shown", handler: step.redo },
    ], [step]);
    useKeybindings({
        keybindings: undoKeybindings,
        when: whenEditorFocused(tabId),
        idPrefix: `page-overview-history-${tabId}`,
        catalogPrefix: "workspace.",
    });

    const blueprintPreview = useMemo(
        () => ({ localBp: services?.localBp ?? null, nodeCatalog: services?.nodeCatalog ?? null, revision: shown.blueprint }),
        [services, shown.blueprint],
    );

    const edit = useMemo<OverviewEditServices | null>(() => (services
        ? { documentService: services.uiDocument, localBlueprint: services.localBp, uiHistory: services.uiHistory, history: services.history }
        : null), [services]);

    // --- Folding ------------------------------------------------------------------------------
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
    const toggle = useCallback((key: string, elementId: string | null, surfaceId: string) => {
        setExpanded(previous => {
            const next = new Set(previous);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
        if (elementId) {
            selectElement(surfaceId, elementId);
        }
    }, [selectElement]);

    // Picking a control in the preview opens its card, so what was picked is what is shown.
    const selectFromPreview = useCallback((surfaceId: string, elementId: string) => {
        selectElement(surfaceId, elementId);
        setExpanded(previous => {
            const key = `${surfaceId}\u0000${elementId}`;
            if (previous.has(key)) {
                return previous;
            }
            const next = new Set(previous);
            next.add(key);
            return next;
        });
    }, [selectElement]);

    // --- Lines and toggles --------------------------------------------------------------------
    const [showJumps, setShowJumps] = useState(true);
    const [showOwnership, setShowOwnership] = useState(true);

    // --- Changing a target --------------------------------------------------------------------
    const pageOptions = useMemo<SelectOption[]>(() => pages.map(page => ({ value: page.id, label: page.name })), [pages]);
    const retargetFor = useCallback((surfaceId: string, group: PageOverviewGroup | null, overview: PageOverview, exits: readonly PageOverviewExit[]) => {
        if (!services || !documents || !edit) {
            return null;
        }
        const blueprintId = group ? group.blueprintId : overview.pageBlueprintId;
        const blueprint = blueprintId ? documents.blueprints.blueprints[blueprintId] : undefined;
        if (!blueprint || !blueprintId) {
            return null;
        }
        const candidates = exits.filter(exit => {
            const ir = blueprint.graphs.events[exit.layerId]?.graph;
            const node = ir?.nodes?.[exit.nodeId];
            if (!node) {
                return false;
            }
            const pins = pageParamPinIds(services.nodeCatalog, node.type, node.params ?? {});
            return pins !== null && canRetargetExit(exit, ir, pins);
        });
        // One page step to change is one picker; more than one is a choice the blueprint shows better.
        if (candidates.length !== 1) {
            return null;
        }
        const exit = candidates[0];
        const options: SelectOption[] = exit.verb === "goPage"
            ? [{ value: "", label: t("uiEditor.pageOverview.target.stackRoot") }, ...pageOptions]
            : pageOptions;
        const value = pickedPageOf(exit);
        if (value && !options.some(option => option.value === value)) {
            options.push({ value, label: names.pageName(value) ?? t("uiEditor.pageOverview.target.missingPage") });
        }
        return {
            exit,
            value,
            options,
            onChange: (next: string) => {
                if (next !== value) {
                    retargetOverviewExit(edit, surfaceId, blueprintId, exit, next);
                }
            },
        };
    }, [documents, edit, names, pageOptions, services, t]);

    // --- Opening things -----------------------------------------------------------------------
    const openLogic = useCallback((surface: UISurface, overview: PageOverview, group: PageOverviewGroup | null, exit?: PageOverviewExit) => {
        if (!services) {
            return;
        }
        let blueprintId = group ? group.blueprintId : overview.pageBlueprintId;
        if (!blueprintId) {
            if (readOnly) {
                return;
            }
            const element = group ? services.uiDocument.getDocument().elements[group.elementId] : undefined;
            blueprintId = group
                ? services.localBp.ensureWidgetMain(surface.id, group.elementId, group.name, element?.type)
                : services.localBp.ensureSurfaceMain(surface.id, surface.name);
        }
        openBlueprint({
            blueprintId,
            ownerKind: group ? "widgetMain" : "surfaceMain",
            surfaceId: surface.id,
            ...(group ? { elementId: group.elementId } : {}),
            title: group ? group.name : surface.name,
            ...(exit ? { focusEventId: exit.layerId, focusNodeId: exit.nodeId } : {}),
        });
    }, [openBlueprint, readOnly, services]);

    const showMoreProperties = useCallback((surfaceId: string, elementId: string) => {
        if (!services) {
            return;
        }
        selectElement(surfaceId, elementId);
        services.ui.panels.show(PROPERTIES_PANEL_ID);
    }, [selectElement, services]);

    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const showPage = useCallback((surfaceId: string) => {
        if (mode === "current") {
            setPayload({ ...requested, surfaceId });
            scrollerRef.current?.scrollTo({ top: 0 });
            return;
        }
        setPayload({ ...requested, surfaceId });
        const section = scrollerRef.current?.querySelector(`[data-page-overview-section="${CSS.escape(surfaceId)}"]`);
        section?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, [mode, requested, setPayload]);

    // A page named from outside - the panel, a menu - is scrolled to in "All pages" as well.
    const lastScrolledTo = useRef<string | null>(null);
    useEffect(() => {
        if (mode !== "all" || !requested.surfaceId || lastScrolledTo.current === requested.surfaceId) {
            return;
        }
        lastScrolledTo.current = requested.surfaceId;
        const frame = requestAnimationFrame(() => {
            scrollerRef.current
                ?.querySelector(`[data-page-overview-section="${CSS.escape(requested.surfaceId ?? "")}"]`)
                ?.scrollIntoView({ block: "start" });
        });
        return () => cancelAnimationFrame(frame);
    }, [mode, requested.surfaceId, overviews]);

    const openDestination = useCallback((destination: OverviewDestination) => {
        const target = destination.target;
        if (target.kind === "page") {
            showPage(target.surfaceId);
            return;
        }
        if (target.kind === "story" && target.sceneId) {
            const title = names.storyName(target.storyId, target.sceneId) ?? target.storyId;
            openEditorTab(createStorySceneEditorTab({ storyId: target.storyId as never, sceneId: target.sceneId as never }, title));
        }
    }, [names, openEditorTab, showPage]);

    const renderSurface = useCallback((surface: UISurface) => {
        if (!services) {
            return null;
        }
        const backgroundColor = getEditorSurfaceAreaBackgroundColor(surface);
        return services.runtimeBridge.renderSurface({
            surfaceId: surface.id,
            hostAdapter: { host: surface.host },
            className: "relative",
            style: backgroundColor ? { backgroundColor } : undefined,
        });
        // A palette edit repaints `nlbrand:` colours without touching the document.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [services, shown.brand]);
    const surfaceRevision = useCallback(
        (surfaceId: string) => (services?.uiDocument.getSurfaceContentRevision(surfaceId) ?? 0) + shown.brand * 1_000_000,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [services, shown],
    );

    const modeOptions = useMemo<SelectOption[]>(() => [
        { value: "current", label: t("uiEditor.pageOverview.mode.current") },
        { value: "all", label: t("uiEditor.pageOverview.mode.all") },
    ], [t]);

    if (!services || !documents) {
        return <div className="h-full bg-surface" />;
    }

    return (
        <div className="flex h-full min-h-0 bg-surface" data-page-overview="" data-help-topic="pageOverview">
            <nav className="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-edge px-1.5 py-2" aria-label={t("uiEditor.pageOverview.pages")}>
                <div className="px-2 pb-1.5 pt-1 text-2xs text-fg-subtle">{t("uiEditor.pageOverview.pages")}</div>
                {pages.map(page => {
                    const current = page.id === currentSurfaceId;
                    return (
                        <button
                            key={page.id}
                            type="button"
                            className={`flex min-h-7 min-w-0 items-center rounded-md px-2 text-left text-xs transition-colors duration-100 ${
                                current ? "bg-primary/15 text-fg" : "text-fg-muted hover:bg-fill hover:text-fg"
                            }`}
                            onClick={() => showPage(page.id)}
                            aria-current={current ? "page" : undefined}
                        >
                            <span className="truncate">{page.name}</span>
                        </button>
                    );
                })}
            </nav>

            <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-edge px-3 py-1.5">
                    <h1 className="min-w-0 truncate text-sm font-medium text-fg">
                        {mode === "all" ? t("uiEditor.pageOverview.title") : names.pageName(currentSurfaceId ?? "") ?? t("uiEditor.pageOverview.title")}
                    </h1>
                    <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-fg-muted">{t("uiEditor.pageOverview.modeLabel")}</span>
                            <Select
                                size="sm"
                                className="w-28"
                                options={modeOptions}
                                value={mode}
                                onChange={value => setPayload({ ...requested, mode: value === "all" ? "all" : "current" })}
                                ariaLabel={t("uiEditor.pageOverview.modeLabel")}
                            />
                        </div>
                        <ToggleRow label={t("uiEditor.pageOverview.showJumps")} checked={showJumps} onChange={setShowJumps} />
                        <ToggleRow label={t("uiEditor.pageOverview.showOwnership")} checked={showOwnership} onChange={setShowOwnership} />
                        <ToggleRow label={t("uiEditor.pageOverview.showAllElements")} checked={showAllElements} onChange={setShowAllElements} />
                        <Button size="sm" variant="secondary" onClick={() => setExpanded(new Set())} disabled={expanded.size === 0}>
                            {t("uiEditor.pageOverview.collapseAll")}
                        </Button>
                    </div>
                </div>

                <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto bg-surface-sunken">
                    {pages.length === 0 ? (
                        <div className="p-8">
                            <EmptyState title={t("uiEditor.pageOverview.noPages")} />
                        </div>
                    ) : null}
                    {overviews.map(({ surface, overview }, index) => (
                        <div key={surface.id} className={index > 0 ? "border-t border-edge" : undefined}>
                            <PageOverviewSection
                                overview={overview}
                                surface={surface}
                                document={documents.ui}
                                documentService={services.uiDocument}
                                contentRevision={surfaceRevision(surface.id)}
                                renderSurface={renderSurface}
                                surfaceRevision={surfaceRevision}
                                names={names}
                                headTitle={headTitle}
                                selectedElementId={selection?.surfaceId === surface.id ? selection.elementId : null}
                                onSelect={selectFromPreview}
                                expanded={expanded}
                                onToggle={(key, elementId) => toggle(key, elementId, surface.id)}
                                showJumps={showJumps}
                                showOwnership={showOwnership}
                                edit={edit}
                                blueprintPreview={blueprintPreview}
                                readOnly={readOnly}
                                retargetFor={(group, exits) => retargetFor(surface.id, group, overview, exits)}
                                onOpenLogic={(group, exit) => openLogic(surface, overview, group, exit)}
                                onMoreProperties={showMoreProperties}
                                onDestination={openDestination}
                            />
                        </div>
                    ))}
                </div>
                {mode === "all" && overviews.length > 0 ? (
                    <div className="shrink-0 border-t border-edge px-3 py-1 text-2xs text-fg-subtle">
                        {tn("uiEditor.pageOverview.elements", overviews.reduce((sum, entry) => sum + entry.overview.groups.length, 0))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
            <Switch size="sm" checked={checked} onCheckedChange={onChange} aria-label={label} />
            <span>{label}</span>
        </label>
    );
}

/**
 * The inputs a page-picking node has only because of the page it names now: its pins with that page
 * picked, less its pins with no page picked. A wire into one of those would be left hanging if the
 * overview picked a different page, so it is what decides whether the group may offer a picker.
 */
function pageParamPinIds(catalog: BlueprintNodeCatalogService, type: string, params: Record<string, unknown>): Set<string> | null {
    try {
        const withPage = catalog.resolveCatalogEntryForNode(type, params).pins;
        const withoutPage = new Set(catalog.resolveCatalogEntryForNode(type, { ...params, surfaceId: "" }).pins.map(pin => pin.id));
        return new Set(withPage.filter(pin => pin.kind === "input" && !withoutPage.has(pin.id)).map(pin => pin.id));
    } catch {
        // Unknown to the catalogue: nothing can be said about its pins, so offer no picker.
        return null;
    }
}

