/**
 * A flush the dialogue box asks for runs now, not on the next frame.
 *
 * Every flush waits in a queue that drains once a frame. For the dialogue box's line beat that was a
 * frame or two of the new line drawn with what the previous line's flush had set: an outfit change
 * showed the old avatar for a frame when the box came back, and every change of speaker showed the
 * last speaker's for a frame or two. `drainPendingFlushes` runs what is queued at once, so the line's
 * flush lands before the frame that shows it (`StageSlotSurfaceRuntime.flushSlotElements`).
 *
 * Comments in English per project convention.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH, BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, BLUEPRINT_NODE_TYPE_LOG } from "@shared/types/blueprint/graph";
import { buildUIListItemInstanceKey } from "@shared/types/ui-editor/list";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { blueprintOf, createRowRuntime, graphOf, tileRow } from "../testing/rowRuntimeTestKit";
import { LAB, labDocument } from "../testing/drawingLabFixture";

beforeAll(() => {
    registerCoreBlueprintNodes();
});

/** A frame that never comes: whatever runs here ran without waiting for one. */
const realFrame = globalThis.requestAnimationFrame;
let page: ReturnType<typeof createRowRuntime> | null = null;

afterEach(() => {
    globalThis.requestAnimationFrame = realFrame;
    page?.release();
    page = null;
});

function lineRuntime() {
    globalThis.requestAnimationFrame = (() => 0) as typeof globalThis.requestAnimationFrame;
    return createRowRuntime(
        [blueprintOf("bp-toggle", { kind: "widgetMain", surfaceId: LAB, elementId: "toggle" }, {
            flush: {
                graph: graphOf({
                    nodes: {
                        head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH },
                        value: { type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params: { field: "f-name" } },
                        log: { type: BLUEPRINT_NODE_TYPE_LOG },
                    },
                    exec: ["head", "log"],
                    data: [["value", "value", "log", "value"]],
                }),
            },
        })],
        { document: labDocument },
    );
}

const ROW = { listItemScope: tileRow("Alpha", 0), instanceKey: buildUIListItemInstanceKey(undefined, "grid", "Alpha") };

describe("a flush drained now", () => {
    it("runs without waiting for the next frame, and resolves once it has run", async () => {
        page = lineRuntime();
        const flushed = page.runtime.dispatchElementBlueprintEvent("toggle", "flush", undefined, ROW);
        expect(page.runtime.drainPendingFlushes).toBeTypeOf("function");
        await page.runtime.drainPendingFlushes?.();
        await flushed;
        expect(page.logs).toEqual(["Alpha"]);
        expect(page.errors).toEqual([]);
    });

    it("waits for the frame when nobody asks for now", async () => {
        page = lineRuntime();
        void page.runtime.dispatchElementBlueprintEvent("toggle", "flush", undefined, ROW);
        await new Promise(resolve => setTimeout(resolve, 30));
        expect(page.logs).toEqual([]);
    });
});
