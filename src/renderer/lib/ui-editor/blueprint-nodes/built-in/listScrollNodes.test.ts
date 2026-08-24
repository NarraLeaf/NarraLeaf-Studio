/**
 * The four nodes that answer "where is this list?".
 *
 * `graphParamResolvers.test.ts` proves every pure output pin resolves to *something*; this proves
 * these ones resolve to what the list would say. What they are for is the graph that was not
 * triggered by the list - a wheel handler on the page around it - which cannot be told and has to
 * ask, so the reading has to be the live one rather than whatever a Scroll head last mirrored into
 * a variable.
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_LIST_GET_SCROLL_OFFSET,
    BLUEPRINT_NODE_TYPE_LIST_GET_SCROLL_PROGRESS,
    BLUEPRINT_NODE_TYPE_LIST_IS_SCROLLED_TO_END,
    BLUEPRINT_NODE_TYPE_LIST_IS_SCROLLED_TO_START,
} from "@shared/types/blueprint/graph";
import { resolveUIListScrollMetrics, type UIListScrollMetrics } from "@shared/types/ui-editor/list";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";
import { resolveDataPinValue, type DataPinGraph } from "./graphParamResolvers";

beforeAll(() => {
    registerCoreBlueprintNodes();
});

const LIST_ID = "list-element";

/** Just enough host API for the resolver: it asks one list for its properties and reads `scroll`. */
function runtimeReporting(scroll: UIListScrollMetrics) {
    return {
        executionOwner: { surfaceId: "surface", elementId: LIST_ID, elementType: "nl.list" },
        hostAdapter: {
            blueprintRuntime: {
                surfaceId: "surface",
                hostApi: {
                    widget: {
                        getListProperties: (elementId: string) => {
                            if (elementId !== LIST_ID) {
                                throw new Error(`asked about ${elementId}`);
                            }
                            return { items: [], selectedIndex: -1, struct: null, scroll };
                        },
                    },
                },
            },
        },
    } as unknown as Parameters<typeof resolveDataPinValue>[6];
}

function read(type: string, portId: string, scroll: UIListScrollMetrics): unknown {
    const graph = { id: "graph", nodes: { node: { type, params: {} } }, edges: [] } as unknown as DataPinGraph;
    return resolveDataPinValue(graph, "node", portId, {}, {}, 0, runtimeReporting(scroll));
}

describe("reading where a list has got to", () => {
    const scrolling = resolveUIListScrollMetrics(400, 1000, 150);

    it("reports the fraction travelled", () => {
        expect(read(BLUEPRINT_NODE_TYPE_LIST_GET_SCROLL_PROGRESS, "progress", scrolling)).toBeCloseTo(0.25);
    });

    it("reports the offset and the range it is measured against", () => {
        expect(read(BLUEPRINT_NODE_TYPE_LIST_GET_SCROLL_OFFSET, "offset", scrolling)).toBe(150);
        expect(read(BLUEPRINT_NODE_TYPE_LIST_GET_SCROLL_OFFSET, "maxOffset", scrolling)).toBe(600);
    });

    it("answers both edges", () => {
        expect(read(BLUEPRINT_NODE_TYPE_LIST_IS_SCROLLED_TO_START, "atStart", scrolling)).toBe(false);
        expect(read(BLUEPRINT_NODE_TYPE_LIST_IS_SCROLLED_TO_END, "atEnd", scrolling)).toBe(false);

        const atTop = resolveUIListScrollMetrics(400, 1000, 0);
        expect(read(BLUEPRINT_NODE_TYPE_LIST_IS_SCROLLED_TO_START, "atStart", atTop)).toBe(true);
        expect(read(BLUEPRINT_NODE_TYPE_LIST_IS_SCROLLED_TO_END, "atEnd", atTop)).toBe(false);

        const atBottom = resolveUIListScrollMetrics(400, 1000, 600);
        expect(read(BLUEPRINT_NODE_TYPE_LIST_IS_SCROLLED_TO_START, "atStart", atBottom)).toBe(false);
        expect(read(BLUEPRINT_NODE_TYPE_LIST_IS_SCROLLED_TO_END, "atEnd", atBottom)).toBe(true);
    });

    // The reading a list that cannot scroll gives, and the one a Scroll head can never deliver
    // because a viewport with nothing to scroll never fires one.
    it("calls a list that fits on one screen both at the start and at the end", () => {
        const fits = resolveUIListScrollMetrics(400, 120, 0);
        expect(read(BLUEPRINT_NODE_TYPE_LIST_IS_SCROLLED_TO_START, "atStart", fits)).toBe(true);
        expect(read(BLUEPRINT_NODE_TYPE_LIST_IS_SCROLLED_TO_END, "atEnd", fits)).toBe(true);
        expect(read(BLUEPRINT_NODE_TYPE_LIST_GET_SCROLL_PROGRESS, "progress", fits)).toBe(1);
    });
});
