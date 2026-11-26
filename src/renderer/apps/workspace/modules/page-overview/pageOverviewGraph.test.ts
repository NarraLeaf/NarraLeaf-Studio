import { describe, expect, it } from "vitest";
import {
    buildOverviewGraph,
    destNodeId,
    exitHandleId,
    groupNodeId,
    layoutOverviewGraph,
    pageNodeId,
    type OverviewBlock,
} from "./pageOverviewGraph";
import type { PageOverview, PageOverviewExit } from "./pageOverviewModel";

const exit = (nodeId: string, partial: Pick<PageOverviewExit, "verb" | "target">): PageOverviewExit => ({
    layerId: "L",
    nodeId,
    headType: "blueprint.event.head.mouseClick",
    ...partial,
});

const toSettings = (nodeId: string) => exit(nodeId, { verb: "goPage", target: { kind: "page", surfaceId: "settings", missing: false } });

function overview(surfaceId: string, groups: Array<{ id: string; exits: PageOverviewExit[] }>, pageExits: PageOverviewExit[] = []): PageOverview {
    return {
        surfaceId,
        name: surfaceId,
        groups: groups.map(group => ({ elementId: group.id, name: group.id, widgetType: "nl.button", exits: group.exits, hasScriptLayer: false, linkedComponent: false })),
        pageExits,
        hiddenCount: 0,
    };
}

const title: OverviewBlock = {
    surfaceId: "title",
    overview: overview("title", [
        { id: "start", exits: [exit("a", { verb: "startGame", target: { kind: "story", storyId: "main", sceneId: null } })] },
        { id: "options", exits: [toSettings("b")] },
        { id: "quit", exits: [exit("c", { verb: "quitApp", target: { kind: "none" } })] },
    ], [exit("d", { verb: "goBack", target: { kind: "none" } })]),
};
const settings: OverviewBlock = { surfaceId: "settings", overview: overview("settings", [{ id: "back", exits: [exit("e", { verb: "goBack", target: { kind: "none" } })] }]) };

describe("buildOverviewGraph", () => {
    it("draws a page node, a node per control and its own events, and a box per destination", () => {
        const { nodes } = buildOverviewGraph([title], "current");
        expect(nodes.map(node => node.id)).toEqual([
            pageNodeId("title"),
            groupNodeId("title", "start"),
            groupNodeId("title", "options"),
            groupNodeId("title", "quit"),
            groupNodeId("title", "@page-events"),
            destNodeId("title", "story:main:"),
            destNodeId("title", "page:settings"),
            destNodeId("title", "none:quitApp"),
            destNodeId("title", "none:goBack"),
        ]);
    });

    it("joins each control to the page that holds it, and each exit pin to its destination", () => {
        const { edges } = buildOverviewGraph([title], "current");
        expect(edges.filter(edge => edge.kind === "own").map(edge => edge.target)).toEqual([
            groupNodeId("title", "start"),
            groupNodeId("title", "options"),
            groupNodeId("title", "quit"),
        ]);
        const jump = edges.find(edge => edge.source === groupNodeId("title", "options"));
        expect(jump).toMatchObject({ sourceHandle: exitHandleId(toSettings("b")), target: destNodeId("title", "page:settings"), kind: "jump" });
    });

    it("with all pages, lands a line to another page on that page's own node", () => {
        const { nodes, edges } = buildOverviewGraph([title, settings], "all");
        expect(nodes.some(node => node.id === destNodeId("title", "page:settings"))).toBe(false);
        expect(edges.find(edge => edge.source === groupNodeId("title", "options"))?.target).toBe(pageNodeId("settings"));
    });

    it("marks a target that arrives on a wire as dynamic", () => {
        const block: OverviewBlock = { surfaceId: "p", overview: overview("p", [{ id: "x", exits: [exit("w", { verb: "goPage", target: { kind: "dynamic" } })] }]) };
        expect(buildOverviewGraph([block], "current").edges.find(edge => edge.kind !== "own")?.kind).toBe("dynamic");
    });
});

describe("layoutOverviewGraph", () => {
    it("puts the page, the controls and the destinations in three columns, and stacks the controls", () => {
        const sizes = new Map([[groupNodeId("title", "start"), { width: 300, height: 70 }]]);
        const positions = layoutOverviewGraph([title], "current", sizes);
        const page = positions.get(pageNodeId("title"))!;
        const start = positions.get(groupNodeId("title", "start"))!;
        const options = positions.get(groupNodeId("title", "options"))!;
        const box = positions.get(destNodeId("title", "page:settings"))!;
        expect(page).toEqual({ x: 0, y: 0 });
        expect(start.x).toBeGreaterThan(page.x);
        expect(box.x).toBeGreaterThan(start.x);
        expect(options.y).toBe(start.y + 70 + 16);
    });

    it("never lets two destination boxes overlap", () => {
        const positions = layoutOverviewGraph([title], "current", new Map());
        const tops = [...positions].filter(([id]) => id.startsWith("dest:")).map(([, at]) => at.y);
        tops.forEach((y, index) => {
            if (index > 0) {
                expect(y).toBeGreaterThanOrEqual(tops[index - 1] + 60 + 16);
            }
        });
    });

    it("stacks pages below one another in all pages", () => {
        const positions = layoutOverviewGraph([title, settings], "all", new Map());
        expect(positions.get(pageNodeId("settings"))!.y).toBeGreaterThan(positions.get(pageNodeId("title"))!.y + 300);
    });
});
