import { collectDestinations, PAGE_EXITS_GROUP_KEY, placeDestinations, type OverviewDestination } from "./pageOverviewLayout";
import type { PageOverview, PageOverviewExit } from "./pageOverviewModel";
import type { PageOverviewMode } from "./pageOverviewTabId";

/**
 * The Page Overview as a graph on the blueprint canvas: which nodes there are, where they start, and
 * which wires join them. Pure, so the arrangement can be tested without React Flow.
 *
 * Three kinds of node, laid out in three columns per page: the page (where a run starts, drawn like
 * an event head), a card per control with one exec pin per place its logic leads, and a box per
 * place (where a run ends, drawn like a terminal node). In "All pages" each page is a block of its
 * own, stacked down the canvas, and a line to another page lands on that page's own node instead of
 * on a box standing in for it.
 */

export const OVERVIEW_PAGE_W = 320;
export const OVERVIEW_GROUP_W = 300;
export const OVERVIEW_DEST_W = 220;
const COLUMN_GAP_1 = 120;
const COLUMN_GAP_2 = 160;
const STACK_GAP = 16;
const BLOCK_GAP = 200;
/** Where a node's input pin sits: the middle of its header. */
export const OVERVIEW_HEADER_PIN_Y = 22;
/** A card's header, then one exec pin row per exit at this height. */
const GROUP_HEADER_H = 44;
export const OVERVIEW_EXIT_ROW_H = 24;
/** What a node is assumed to measure before React Flow has measured it. */
const ESTIMATE = { page: 300, group: 80, dest: 60 } as const;

export type OverviewBlock = { surfaceId: string; overview: PageOverview };

export type OverviewNodeSpec =
    | { id: string; kind: "page"; surfaceId: string }
    | { id: string; kind: "group"; surfaceId: string; groupKey: string }
    | { id: string; kind: "dest"; surfaceId: string; destination: OverviewDestination };

export type OverviewEdgeSpec = {
    id: string;
    source: string;
    sourceHandle: string;
    target: string;
    targetHandle: string;
    kind: "jump" | "dynamic" | "own";
};

export const pageNodeId = (surfaceId: string) => `page:${surfaceId}`;
export const groupNodeId = (surfaceId: string, groupKey: string) => `group:${surfaceId}:${groupKey}`;
export const destNodeId = (surfaceId: string, destinationKey: string) => `dest:${surfaceId}:${destinationKey}`;
export const ownHandleId = (elementId: string) => `own:${elementId}`;
export const exitHandleId = (exit: Pick<PageOverviewExit, "layerId" | "nodeId">) => `exit:${exit.layerId}:${exit.nodeId}`;
export const IN_HANDLE = "in";

/** The rows a page's middle column holds: its controls, then its own events when it has any. */
export function overviewRows(overview: PageOverview): Array<{ key: string; exits: readonly PageOverviewExit[] }> {
    const rows: Array<{ key: string; exits: readonly PageOverviewExit[] }> = overview.groups.map(group => ({ key: group.elementId, exits: group.exits }));
    if (overview.pageExits.length > 0) {
        rows.push({ key: PAGE_EXITS_GROUP_KEY, exits: overview.pageExits });
    }
    return rows;
}

/** Whether a destination is drawn as the page's own node rather than a box: a live page that is on the canvas. */
function landsOnPageNode(destination: OverviewDestination, mode: PageOverviewMode, pagesOnCanvas: ReadonlySet<string>): string | null {
    const target = destination.target;
    if (mode !== "all" || target.kind !== "page" || target.missing || !pagesOnCanvas.has(target.surfaceId)) {
        return null;
    }
    return target.surfaceId;
}

/** Every node and wire, before anything is placed. */
export function buildOverviewGraph(blocks: readonly OverviewBlock[], mode: PageOverviewMode): { nodes: OverviewNodeSpec[]; edges: OverviewEdgeSpec[] } {
    const pagesOnCanvas = new Set(blocks.map(block => block.surfaceId));
    const nodes: OverviewNodeSpec[] = [];
    const edges: OverviewEdgeSpec[] = [];
    for (const { surfaceId, overview } of blocks) {
        const page = pageNodeId(surfaceId);
        nodes.push({ id: page, kind: "page", surfaceId });
        const rows = overviewRows(overview);
        for (const row of rows) {
            const group = groupNodeId(surfaceId, row.key);
            nodes.push({ id: group, kind: "group", surfaceId, groupKey: row.key });
            if (row.key !== PAGE_EXITS_GROUP_KEY) {
                edges.push({ id: `own:${surfaceId}:${row.key}`, source: page, sourceHandle: ownHandleId(row.key), target: group, targetHandle: IN_HANDLE, kind: "own" });
            }
        }
        for (const destination of collectDestinations(rows)) {
            const landing = landsOnPageNode(destination, mode, pagesOnCanvas);
            const target = landing ? pageNodeId(landing) : destNodeId(surfaceId, destination.key);
            if (!landing) {
                nodes.push({ id: target, kind: "dest", surfaceId, destination });
            }
            for (const source of destination.sources) {
                edges.push({
                    id: `jump:${surfaceId}:${source.groupKey}:${source.exit.layerId}:${source.exit.nodeId}`,
                    source: groupNodeId(surfaceId, source.groupKey),
                    sourceHandle: exitHandleId(source.exit),
                    target,
                    targetHandle: IN_HANDLE,
                    kind: destination.target.kind === "dynamic" ? "dynamic" : "jump",
                });
            }
        }
    }
    return { nodes, edges };
}

export type OverviewSize = { width: number; height: number };

/**
 * Where every node starts. The page at the left of its block, its cards stacked beside it, and each
 * box as near as it can be to the pins that lead to it without overlapping the one above. Blocks
 * stack downward with a gap, each as tall as its tallest column.
 *
 * Sizes come from React Flow once it has measured a node; until then an estimate stands in, and the
 * arrangement is recomputed as the real sizes arrive.
 */
export function layoutOverviewGraph(
    blocks: readonly OverviewBlock[],
    mode: PageOverviewMode,
    sizes: ReadonlyMap<string, OverviewSize>,
): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();
    const pagesOnCanvas = new Set(blocks.map(block => block.surfaceId));
    const heightOf = (id: string, fallback: number) => sizes.get(id)?.height ?? fallback;
    const groupX = OVERVIEW_PAGE_W + COLUMN_GAP_1;
    const destX = groupX + OVERVIEW_GROUP_W + COLUMN_GAP_2;
    let top = 0;
    for (const { surfaceId, overview } of blocks) {
        const page = pageNodeId(surfaceId);
        positions.set(page, { x: 0, y: top });
        let bottom = top + heightOf(page, ESTIMATE.page);

        const rows = overviewRows(overview);
        const pinCentres = new Map<string, number>();
        let y = top;
        for (const row of rows) {
            const id = groupNodeId(surfaceId, row.key);
            positions.set(id, { x: groupX, y });
            // A box centres on the pins that lead to it, and a card's pins start under its header.
            const firstPin = y + GROUP_HEADER_H + OVERVIEW_EXIT_ROW_H / 2;
            pinCentres.set(row.key, firstPin + ((row.exits.length - 1) * OVERVIEW_EXIT_ROW_H) / 2);
            y += heightOf(id, ESTIMATE.group) + STACK_GAP;
        }
        bottom = Math.max(bottom, y - STACK_GAP);

        const boxes = collectDestinations(rows).filter(destination => !landsOnPageNode(destination, mode, pagesOnCanvas));
        const boxHeights = new Map(boxes.map(destination => [destination.key, heightOf(destNodeId(surfaceId, destination.key), ESTIMATE.dest)]));
        // Placed by the middle of the header, where its pin is, rather than by its top.
        const centres = new Map([...pinCentres].map(([key, value]) => [key, value - OVERVIEW_HEADER_PIN_Y]));
        const tops = placeDestinations(boxes, centres, new Map([...boxHeights].map(([key]) => [key, 0])), 0, top);
        let floor = top;
        for (const destination of boxes) {
            const wanted = tops.get(destination.key) ?? floor;
            const at = Math.max(floor, wanted);
            positions.set(destNodeId(surfaceId, destination.key), { x: destX, y: at });
            floor = at + (boxHeights.get(destination.key) ?? ESTIMATE.dest) + STACK_GAP;
        }
        bottom = Math.max(bottom, floor - STACK_GAP);
        top = bottom + BLOCK_GAP;
    }
    return positions;
}
