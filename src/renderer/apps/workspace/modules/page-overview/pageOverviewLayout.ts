import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import type { PageOverviewExit, PageOverviewExitVerb, PageOverviewTarget } from "./pageOverviewModel";

/**
 * The geometry and bookkeeping of the Page Overview canvas, apart from React so it can be tested.
 *
 * The canvas is three columns - the page, its controls, where they lead - and the third column is
 * the only one that is not simply stacked: each destination is drawn once however many controls go
 * there, as near as it can be to the controls that point at it.
 */

/**
 * The row the page's own blueprint takes in the middle column. Element ids are generated and never
 * start with `@`, so this cannot name a control; it is also written into a data attribute, so it
 * stays a plain printable string.
 */
export const PAGE_EXITS_GROUP_KEY = "@page-events";

/** One destination in the third column, and every exit that leads to it. */
export type OverviewDestination = {
    key: string;
    target: PageOverviewTarget;
    /** The verb of the first exit that leads here, for the steps that point nowhere (back, quit). */
    verb: PageOverviewExitVerb;
    sources: Array<{ groupKey: string; exit: PageOverviewExit }>;
};

/**
 * Which destination an exit belongs to. Two exits with the same key are drawn into the same box.
 *
 * "Decided while running" and "not set" are one box each rather than one per exit: they say the
 * same thing however many controls say it, and a column of identical boxes would only push the
 * real destinations further from their controls.
 */
export function destinationKeyOf(exit: Pick<PageOverviewExit, "target" | "verb">): string {
    const target = exit.target;
    switch (target.kind) {
        case "page":
            return `page:${target.surfaceId}`;
        case "story":
            return `story:${target.storyId}:${target.sceneId ?? ""}`;
        case "function":
            return `fn:${String(target.fnRef ?? "")}`;
        case "none":
            return `none:${exit.verb}`;
        default:
            return target.kind;
    }
}

/** Every destination, in the order the controls that lead there come down the middle column. */
export function collectDestinations(groups: ReadonlyArray<{ key: string; exits: readonly PageOverviewExit[] }>): OverviewDestination[] {
    const byKey = new Map<string, OverviewDestination>();
    for (const group of groups) {
        for (const exit of group.exits) {
            const key = destinationKeyOf(exit);
            let destination = byKey.get(key);
            if (!destination) {
                destination = { key, target: exit.target, verb: exit.verb, sources: [] };
                byKey.set(key, destination);
            }
            destination.sources.push({ groupKey: group.key, exit });
        }
    }
    return [...byKey.values()];
}

/**
 * Where each destination's box starts, top to bottom.
 *
 * Each box is centred on the average height of the rows that lead to it, then pushed down just far
 * enough not to overlap the box above. Boxes are placed in the order they arrive in, which is the
 * order of their first source, so the lines leave the middle column roughly in order and seldom
 * cross.
 */
export function placeDestinations(
    destinations: readonly OverviewDestination[],
    rowCentres: ReadonlyMap<string, number>,
    heights: ReadonlyMap<string, number>,
    gap: number,
    top = 0,
): Map<string, number> {
    const placed = new Map<string, number>();
    let floor = top;
    for (const destination of destinations) {
        const centres = destination.sources
            .map(source => rowCentres.get(source.groupKey))
            .filter((value): value is number => typeof value === "number");
        const height = heights.get(destination.key) ?? 0;
        const wanted = centres.length > 0
            ? centres.reduce((sum, value) => sum + value, 0) / centres.length - height / 2
            : floor;
        const y = Math.max(floor, wanted);
        placed.set(destination.key, y);
        floor = y + height + gap;
    }
    return placed;
}

/**
 * A wire from one column to the next: leaves level, bends once, arrives level.
 *
 * The bend is at least 40 wide so a wire between two rows at the same height still reads as a
 * connector rather than a rule, and never more than half the gap so two wires into one box fan in
 * rather than running parallel to the end.
 */
export function wirePath(x1: number, y1: number, x2: number, y2: number): string {
    const bend = Math.max(40, (x2 - x1) / 2);
    const round = (value: number) => Math.round(value * 10) / 10;
    return `M${round(x1)} ${round(y1)} C${round(x1 + bend)} ${round(y1)} ${round(x2 - bend)} ${round(y2)} ${round(x2)} ${round(y2)}`;
}

/** The verbs whose target is one of the project's pages, picked on the card. */
const PAGE_PICKING_VERBS: ReadonlySet<PageOverviewExitVerb> = new Set([
    "goPage",
    "replacePage",
    "showLayer",
    "showConfirm",
    "quitGame",
]);

/**
 * Whether the overview may change where `exit` goes by itself, with a page picker on the group.
 *
 * Only for a node that picks a page on its card and has nothing wired into the inputs the picked
 * page gives it: `Go Page` grows one input per parameter of the page it names, so a wire into one
 * of those would be left hanging off a pin that a different page does not have. Those, and targets
 * that arrive on a wire, are edited in the blueprint.
 *
 * `pageParamPinIds` are the inputs that exist only because of the page picked now.
 */
export function canRetargetExit(exit: PageOverviewExit, ir: BlueprintGraphIr | undefined, pageParamPinIds: ReadonlySet<string>): boolean {
    if (!PAGE_PICKING_VERBS.has(exit.verb)) {
        return false;
    }
    if (exit.target.kind !== "page" && exit.target.kind !== "unset" && exit.target.kind !== "stackRoot") {
        return false;
    }
    if (!ir?.nodes?.[exit.nodeId]) {
        return false;
    }
    return !(ir.edges ?? []).some(edge => edge.to.nodeId === exit.nodeId && pageParamPinIds.has(edge.to.port));
}

/** The page a picker on the group should show as chosen: the page id, or "" for none. */
export function pickedPageOf(exit: PageOverviewExit): string {
    return exit.target.kind === "page" ? exit.target.surfaceId : "";
}
