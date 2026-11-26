import { describe, expect, it } from "vitest";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    canRetargetExit,
    collectDestinations,
    destinationKeyOf,
    pickedPageOf,
    placeDestinations,
    wirePath,
} from "./pageOverviewLayout";
import type { PageOverviewExit } from "./pageOverviewModel";

const exit = (nodeId: string, partial: Partial<PageOverviewExit> & Pick<PageOverviewExit, "verb" | "target">): PageOverviewExit => ({
    layerId: "L",
    nodeId,
    headType: "blueprint.event.head.mouseClick",
    ...partial,
});

const toSettings = exit("a", { verb: "goPage", target: { kind: "page", surfaceId: "settings", missing: false } });
const alsoToSettings = exit("b", { verb: "showLayer", target: { kind: "page", surfaceId: "settings", missing: false } });
const back = exit("c", { verb: "goBack", target: { kind: "none" } });
const quit = exit("d", { verb: "quitApp", target: { kind: "none" } });
const wiredOne = exit("e", { verb: "goPage", target: { kind: "dynamic" } });
const wiredTwo = exit("f", { verb: "startGame", target: { kind: "dynamic" } });

describe("destinations", () => {
    it("draws one box per place, however many controls lead there", () => {
        expect(destinationKeyOf(toSettings)).toBe(destinationKeyOf(alsoToSettings));
        expect(destinationKeyOf(wiredOne)).toBe(destinationKeyOf(wiredTwo));
        // Back and quit point nowhere, but they are different endings.
        expect(destinationKeyOf(back)).not.toBe(destinationKeyOf(quit));
    });

    it("keeps the order the controls come in, and remembers every source", () => {
        const destinations = collectDestinations([
            { key: "start", exits: [toSettings, back] },
            { key: "options", exits: [alsoToSettings] },
        ]);
        expect(destinations.map(destination => destination.key)).toEqual(["page:settings", "none:goBack"]);
        expect(destinations[0].sources.map(source => source.groupKey)).toEqual(["start", "options"]);
    });
});

describe("placeDestinations", () => {
    it("centres a box on the rows that lead to it", () => {
        const destinations = collectDestinations([
            { key: "a", exits: [toSettings] },
            { key: "b", exits: [alsoToSettings] },
        ]);
        const tops = placeDestinations(destinations, new Map([["a", 100], ["b", 200]]), new Map([["page:settings", 40]]), 12);
        expect(tops.get("page:settings")).toBe(130);
    });

    it("pushes a box down rather than letting it overlap the one above", () => {
        const destinations = collectDestinations([
            { key: "a", exits: [toSettings] },
            { key: "b", exits: [back] },
        ]);
        const tops = placeDestinations(destinations, new Map([["a", 100], ["b", 104]]), new Map([["page:settings", 80], ["none:goBack", 40]]), 12, 0);
        expect(tops.get("page:settings")).toBe(60);
        expect(tops.get("none:goBack")).toBe(152);
    });

    it("never starts above the top margin", () => {
        const destinations = collectDestinations([{ key: "a", exits: [toSettings] }]);
        expect(placeDestinations(destinations, new Map([["a", 0]]), new Map([["page:settings", 100]]), 12, 24).get("page:settings")).toBe(24);
    });
});

describe("wirePath", () => {
    it("leaves and arrives level", () => {
        expect(wirePath(0, 10, 200, 50)).toBe("M0 10 C100 10 100 50 200 50");
    });

    it("keeps a bend on a short wire", () => {
        expect(wirePath(0, 0, 20, 0)).toBe("M0 0 C40 0 -20 0 20 0");
    });
});

describe("canRetargetExit", () => {
    const ir: BlueprintGraphIr = {
        nodes: { a: { id: "a", type: "blueprint.page.go" }, e: { id: "e", type: "blueprint.page.go" } },
        edges: [
            { from: { nodeId: "h", port: "then" }, to: { nodeId: "a", port: "in" } },
            { from: { nodeId: "v", port: "value" }, to: { nodeId: "a", port: "props" } },
        ],
    };

    it("allows a picked page with nothing wired into the page's own inputs", () => {
        expect(canRetargetExit(toSettings, ir, new Set(["difficulty"]))).toBe(true);
    });

    it("refuses when a wire runs into an input the picked page gives the node", () => {
        const wired: BlueprintGraphIr = { ...ir, edges: [...(ir.edges ?? []), { from: { nodeId: "v", port: "value" }, to: { nodeId: "a", port: "difficulty" } }] };
        expect(canRetargetExit(toSettings, wired, new Set(["difficulty"]))).toBe(false);
    });

    it("refuses a target that arrives on a wire, a step with no page, and a node that is gone", () => {
        expect(canRetargetExit(wiredOne, ir, new Set())).toBe(false);
        expect(canRetargetExit(back, ir, new Set())).toBe(false);
        expect(canRetargetExit(exit("gone", { verb: "goPage", target: { kind: "unset" } }), ir, new Set())).toBe(false);
    });

    it("offers a picker for a step left unfinished or sent to the first page", () => {
        expect(canRetargetExit(exit("a", { verb: "replacePage", target: { kind: "unset" } }), ir, new Set())).toBe(true);
        expect(canRetargetExit(exit("a", { verb: "goPage", target: { kind: "stackRoot" } }), ir, new Set())).toBe(true);
    });

    it("shows the page the node names as chosen", () => {
        expect(pickedPageOf(toSettings)).toBe("settings");
        expect(pickedPageOf(exit("a", { verb: "goPage", target: { kind: "stackRoot" } }))).toBe("");
    });
});
