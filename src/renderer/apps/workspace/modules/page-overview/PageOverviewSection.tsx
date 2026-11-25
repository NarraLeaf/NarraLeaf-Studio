import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import { useTranslation } from "@/lib/i18n";
import type { SelectOption } from "@/lib/components/elements";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { LivePreviewFrame } from "../ui-editor/panel/LivePreviewFrame";
import { OverviewGroupCard } from "./OverviewGroupCard";
import { OverviewPagePreview } from "./OverviewPagePreview";
import type { OverviewEditServices } from "./pageOverviewEdits";
import {
    collectDestinations,
    PAGE_EXITS_GROUP_KEY,
    placeDestinations,
    wirePath,
    type OverviewDestination,
} from "./pageOverviewLayout";
import type { PageOverview, PageOverviewExit, PageOverviewGroup } from "./pageOverviewModel";
import { destinationKind, destinationName, destinationNote, type OverviewNames } from "./pageOverviewText";

/** The canvas's columns, in CSS pixels: page, gap, controls, gap, destinations. */
const PAD = 24;
const PAGE_W = 360;
const PREVIEW_W = PAGE_W - 24;
const GROUP_X = PAD + PAGE_W + 72;
const GROUP_W = 300;
const DEST_X = GROUP_X + GROUP_W + 88;
const DEST_W = 220;
export const PAGE_OVERVIEW_CANVAS_WIDTH = DEST_X + DEST_W + PAD;
/** Where a wire meets a card: the middle of its header row. */
const PORT_Y = 18;
const DEST_GAP = 12;
const MIN_HEIGHT = 240;

type Wire = { key: string; d: string; kind: "jump" | "dynamic" | "own" };
type Measured = { tops: Record<string, number>; wires: Wire[]; height: number };

export type PageOverviewSectionProps = {
    overview: PageOverview;
    surface: UISurface;
    document: UIDocument;
    documentService: UIDocumentService | null;
    contentRevision: number;
    renderSurface: (surface: UISurface) => ReactNode;
    surfaceRevision: (surfaceId: string) => number;
    names: OverviewNames;
    headTitle: (headType: string) => string;
    selectedElementId: string | null;
    onSelect: (surfaceId: string, elementId: string) => void;
    expanded: ReadonlySet<string>;
    onToggle: (key: string, elementId: string | null) => void;
    showJumps: boolean;
    showOwnership: boolean;
    edit: OverviewEditServices | null;
    readOnly: boolean;
    retargetFor: (group: PageOverviewGroup | null, exits: readonly PageOverviewExit[]) => { exit: PageOverviewExit; value: string; options: SelectOption[]; onChange: (surfaceId: string) => void } | null;
    onOpenLogic: (group: PageOverviewGroup | null, exit?: PageOverviewExit) => void;
    onMoreProperties: (surfaceId: string, elementId: string) => void;
    onDestination: (destination: OverviewDestination) => void;
};

/** The key an expanded group is remembered by, unique across pages for "All pages". */
export function overviewGroupKey(surfaceId: string, groupKey: string): string {
    return `${surfaceId}\u0000${groupKey}`;
}

/**
 * One page laid out in three columns: the page with its preview, a card per control, and a box per
 * place those controls lead to, with a line from each control to each of its places.
 *
 * The cards stack; the destination boxes are placed after the cards have been measured, each as
 * near as it can be to the cards that lead to it, and the lines are drawn from the measured edges.
 * Measuring follows every change of size - a card unfolding, the preview arriving - so the lines
 * always end where the boxes are.
 */
export function PageOverviewSection(props: PageOverviewSectionProps) {
    const {
        overview,
        surface,
        document,
        documentService,
        contentRevision,
        renderSurface,
        surfaceRevision,
        names,
        headTitle,
        selectedElementId,
        onSelect,
        expanded,
        onToggle,
        showJumps,
        showOwnership,
        edit,
        readOnly,
        retargetFor,
        onOpenLogic,
        onMoreProperties,
        onDestination,
    } = props;
    const { t, tn } = useTranslation();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [measured, setMeasured] = useState<Measured | null>(null);

    const rows = useMemo(() => {
        const list: Array<{ key: string; exits: readonly PageOverviewExit[] }> = overview.groups.map(group => ({ key: group.elementId, exits: group.exits }));
        if (overview.pageExits.length > 0) {
            list.push({ key: PAGE_EXITS_GROUP_KEY, exits: overview.pageExits });
        }
        return list;
    }, [overview]);
    const destinations = useMemo(() => collectDestinations(rows), [rows]);
    const elementIds = useMemo(() => overview.groups.map(group => group.elementId), [overview]);
    const elementNames = useMemo(() => new Map(overview.groups.map(group => [group.elementId, group.name])), [overview]);

    const measure = useCallback(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        const origin = root.getBoundingClientRect();
        const centres = new Map<string, number>();
        const groupEdges = new Map<string, { y: number }>();
        let bottom = MIN_HEIGHT;
        for (const node of root.querySelectorAll<HTMLElement>("[data-page-overview-group]")) {
            const key = node.dataset.pageOverviewGroup ?? "";
            const rect = node.getBoundingClientRect();
            const y = rect.top - origin.top + PORT_Y;
            centres.set(key, y);
            groupEdges.set(key, { y });
            bottom = Math.max(bottom, rect.bottom - origin.top);
        }
        const heights = new Map<string, number>();
        for (const node of root.querySelectorAll<HTMLElement>("[data-page-overview-destination]")) {
            heights.set(node.dataset.pageOverviewDestination ?? "", node.offsetHeight);
        }
        const tops = placeDestinations(destinations, centres, heights, DEST_GAP, PAD);
        for (const destination of destinations) {
            bottom = Math.max(bottom, (tops.get(destination.key) ?? 0) + (heights.get(destination.key) ?? 0));
        }
        const pageNode = root.querySelector<HTMLElement>("[data-page-overview-page]");
        if (pageNode) {
            bottom = Math.max(bottom, pageNode.getBoundingClientRect().bottom - origin.top);
        }

        const wires: Wire[] = [];
        for (const destination of destinations) {
            const top = tops.get(destination.key);
            if (top === undefined) {
                continue;
            }
            for (const source of destination.sources) {
                const from = groupEdges.get(source.groupKey);
                if (!from) {
                    continue;
                }
                wires.push({
                    key: `${source.groupKey}>${destination.key}>${source.exit.nodeId}`,
                    d: wirePath(GROUP_X + GROUP_W, from.y, DEST_X - 2, top + PORT_Y),
                    kind: destination.target.kind === "dynamic" ? "dynamic" : "jump",
                });
            }
        }
        const pageRight = PAD + PAGE_W;
        for (const node of root.querySelectorAll<HTMLElement>("[data-page-overview-hit]")) {
            const elementId = node.dataset.pageOverviewHit ?? "";
            const to = groupEdges.get(elementId);
            if (!to) {
                continue;
            }
            const rect = node.getBoundingClientRect();
            wires.push({
                key: `own>${elementId}`,
                d: wirePath(pageRight, rect.top - origin.top + rect.height / 2, GROUP_X, to.y),
                kind: "own",
            });
        }
        const next: Measured = { tops: Object.fromEntries(tops), wires, height: Math.ceil(bottom + PAD) };
        setMeasured(previous => (previous && sameMeasured(previous, next) ? previous : next));
    }, [destinations]);

    useLayoutEffect(() => {
        measure();
    });

    useEffect(() => {
        const root = rootRef.current;
        if (!root || typeof ResizeObserver === "undefined") {
            return;
        }
        let pending = 0;
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(pending);
            pending = requestAnimationFrame(measure);
        });
        for (const node of root.querySelectorAll("[data-page-overview-group], [data-page-overview-destination], [data-page-overview-page]")) {
            observer.observe(node);
        }
        return () => {
            cancelAnimationFrame(pending);
            observer.disconnect();
        };
    });

    const pageCaption = tn("uiEditor.pageOverview.elements", overview.groups.length);
    const widgetCaption = (type: string) => widgetModuleRegistry.get(type)?.displayName ?? type;

    return (
        <div
            ref={rootRef}
            className="relative"
            style={{ width: PAGE_OVERVIEW_CANVAS_WIDTH, height: measured?.height ?? MIN_HEIGHT }}
            data-page-overview-section={surface.id}
        >
            <svg className="pointer-events-none absolute inset-0" width={PAGE_OVERVIEW_CANVAS_WIDTH} height={measured?.height ?? MIN_HEIGHT} aria-hidden="true">
                <defs>
                    <marker id={`page-overview-arrow-${surface.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                        <path d="M0 0 L10 5 L0 10 z" fill="currentColor" className="text-primary" />
                    </marker>
                </defs>
                {(measured?.wires ?? []).map(wire => {
                    if (wire.kind === "own") {
                        return showOwnership ? (
                            <path key={wire.key} d={wire.d} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="2 3" className="text-fg-subtle" />
                        ) : null;
                    }
                    return showJumps ? (
                        <path
                            key={wire.key}
                            d={wire.d}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            strokeDasharray={wire.kind === "dynamic" ? "5 4" : undefined}
                            markerEnd={`url(#page-overview-arrow-${surface.id})`}
                            className="text-primary"
                        />
                    ) : null;
                })}
            </svg>

            <div
                className="absolute rounded-md border border-edge bg-surface-raised"
                style={{ left: PAD, top: PAD, width: PAGE_W }}
                data-page-overview-page={surface.id}
            >
                <div className="flex min-w-0 items-baseline gap-2 border-b border-edge-subtle px-3 py-2">
                    <span className="min-w-0 truncate text-sm font-medium text-fg">{overview.name}</span>
                    <span className="shrink-0 text-2xs text-fg-subtle">{t("uiEditor.pageOverview.target.pageKind")}</span>
                </div>
                <div className="p-3">
                    <OverviewPagePreview
                        surface={surface}
                        document={document}
                        elementIds={elementIds}
                        elementNames={elementNames}
                        width={PREVIEW_W}
                        contentRevision={contentRevision}
                        renderSurface={renderSurface}
                        selectedElementId={selectedElementId}
                        onSelect={elementId => onSelect(surface.id, elementId)}
                        edit={readOnly ? null : edit}
                        onLayout={measure}
                    />
                </div>
                <div className="flex flex-col gap-0.5 px-3 pb-2.5 text-2xs text-fg-subtle">
                    <span>{pageCaption}</span>
                    {overview.hiddenCount > 0 ? <span>{tn("uiEditor.pageOverview.hidden", overview.hiddenCount)}</span> : null}
                    {!readOnly && overview.groups.length > 0 ? <span>{t("uiEditor.pageOverview.dragHint")}</span> : null}
                </div>
            </div>

            <div className="absolute flex flex-col gap-3" style={{ left: GROUP_X, top: PAD, width: GROUP_W }}>
                {overview.groups.length === 0 && overview.pageExits.length === 0 ? (
                    <div className="rounded-md border border-dashed border-edge px-3 py-3 text-xs text-fg-subtle">
                        {t("uiEditor.pageOverview.noGroups")}
                    </div>
                ) : null}
                {overview.groups.map(group => {
                    const key = overviewGroupKey(surface.id, group.elementId);
                    const notes: string[] = [];
                    if (group.hasScriptLayer) {
                        notes.push(t("uiEditor.pageOverview.group.scriptLayer"));
                    }
                    if (group.linkedComponent) {
                        notes.push(t("uiEditor.pageOverview.group.component"));
                    }
                    return (
                        <OverviewGroupCard
                            key={group.elementId}
                            groupKey={group.elementId}
                            title={group.name}
                            caption={widgetCaption(group.widgetType)}
                            exits={group.exits}
                            names={names}
                            headTitle={headTitle}
                            expanded={expanded.has(key)}
                            selected={selectedElementId === group.elementId}
                            onToggle={() => onToggle(key, group.elementId)}
                            element={document.elements[group.elementId]}
                            surfaceId={surface.id}
                            documentService={documentService}
                            hasBlueprint={Boolean(group.blueprintId)}
                            notes={notes}
                            readOnly={readOnly}
                            retarget={expanded.has(key) ? retargetFor(group, group.exits) : null}
                            onOpenLogic={exit => onOpenLogic(group, exit)}
                            onMoreProperties={() => onMoreProperties(surface.id, group.elementId)}
                        />
                    );
                })}
                {overview.pageExits.length > 0 ? (
                    <OverviewGroupCard
                        groupKey={PAGE_EXITS_GROUP_KEY}
                        title={t("uiEditor.pageOverview.pageEvents")}
                        caption={overview.name}
                        exits={overview.pageExits}
                        names={names}
                        headTitle={headTitle}
                        expanded={expanded.has(overviewGroupKey(surface.id, PAGE_EXITS_GROUP_KEY))}
                        selected={false}
                        onToggle={() => onToggle(overviewGroupKey(surface.id, PAGE_EXITS_GROUP_KEY), null)}
                        surfaceId={surface.id}
                        documentService={documentService}
                        hasBlueprint={Boolean(overview.pageBlueprintId)}
                        notes={[]}
                        readOnly={readOnly}
                        retarget={expanded.has(overviewGroupKey(surface.id, PAGE_EXITS_GROUP_KEY)) ? retargetFor(null, overview.pageExits) : null}
                        onOpenLogic={exit => onOpenLogic(null, exit)}
                    />
                ) : null}
            </div>

            {destinations.map(destination => (
                <OverviewDestinationBox
                    key={destination.key}
                    destination={destination}
                    top={measured?.tops[destination.key]}
                    names={names}
                    document={document}
                    renderSurface={renderSurface}
                    surfaceRevision={surfaceRevision}
                    onClick={() => onDestination(destination)}
                />
            ))}
        </div>
    );
}

/** A destination's box in the third column. Pages carry a small preview, and every box that leads somewhere can be followed. */
function OverviewDestinationBox({
    destination,
    top,
    names,
    document,
    renderSurface,
    surfaceRevision,
    onClick,
}: {
    destination: OverviewDestination;
    top: number | undefined;
    names: OverviewNames;
    document: UIDocument;
    renderSurface: (surface: UISurface) => ReactNode;
    surfaceRevision: (surfaceId: string) => number;
    onClick: () => void;
}) {
    const { t } = useTranslation();
    const target = destination.target;
    const page = target.kind === "page" && !target.missing ? document.surfaces.find(surface => surface.id === target.surfaceId) : undefined;
    const followable = Boolean(page) || target.kind === "story";
    const uncertain = target.kind === "dynamic" || target.kind === "unset" || (target.kind === "page" && target.missing);
    const name = destinationName(target, destination.verb, names, t);
    const note = destinationNote(destination, t);
    const body = (
        <>
            <div className="flex min-w-0 items-baseline gap-2 px-3 py-2">
                <span className="min-w-0 truncate text-sm font-medium text-fg">{name}</span>
                <span className={`shrink-0 text-2xs ${uncertain ? "text-warning" : "text-fg-subtle"}`}>{destinationKind(destination, t)}</span>
            </div>
            {page ? (
                <div className="px-3 pb-3">
                    <LivePreviewFrame
                        previewId={`overview-destination:${page.id}`}
                        contentRevision={surfaceRevision(page.id)}
                        render={() => renderSurface(page)}
                        designWidth={page.designSize.width}
                        designHeight={page.designSize.height}
                        frameHeight={Math.round(((DEST_W - 24) * page.designSize.height) / Math.max(1, page.designSize.width))}
                        className="overflow-hidden rounded-sm bg-surface-canvas"
                    />
                </div>
            ) : null}
            {note ? <div className="px-3 pb-2.5 text-xs text-fg-muted">{note}</div> : null}
        </>
    );
    const className = `absolute block rounded-md border bg-surface-raised text-left transition-colors duration-150 ${
        uncertain ? "border-dashed border-warning/60" : "border-edge"
    } ${followable ? "hover:border-edge-strong hover:bg-fill-subtle" : ""}`;
    const style = { left: DEST_X, top: top ?? 0, width: DEST_W, visibility: top === undefined ? "hidden" as const : undefined };
    return followable ? (
        <button
            type="button"
            className={className}
            style={style}
            onClick={onClick}
            data-tip={page ? t("uiEditor.pageOverview.target.jumpToPage") : undefined}
            data-page-overview-destination={destination.key}
        >
            {body}
        </button>
    ) : (
        <div className={className} style={style} data-page-overview-destination={destination.key}>
            {body}
        </div>
    );
}

function sameMeasured(a: Measured, b: Measured): boolean {
    if (a.height !== b.height || a.wires.length !== b.wires.length) {
        return false;
    }
    const aKeys = Object.keys(a.tops);
    if (aKeys.length !== Object.keys(b.tops).length || aKeys.some(key => Math.abs((a.tops[key] ?? 0) - (b.tops[key] ?? -1)) >= 0.5)) {
        return false;
    }
    return a.wires.every((wire, index) => wire.key === b.wires[index].key && wire.d === b.wires[index].d && wire.kind === b.wires[index].kind);
}
