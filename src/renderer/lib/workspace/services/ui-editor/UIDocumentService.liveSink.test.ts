import { describe, expect, it, vi } from "vitest";
import type { LiveUIOp } from "@shared/live/ops";
import { Services } from "../services";
import { UIDocumentService } from "./UIDocumentService";
import type { UIOpSink } from "./UIDocumentService";

/**
 * The seam a live session hangs the interface editor off.
 *
 * **What is being asserted is that nothing in the editor knows a session exists.** The forty public
 * mutators are unchanged; with a sink installed they run against a copy, state what the copy now
 * holds differently, and leave the document alone. So these tests drive the ordinary methods and
 * look at what came out of the sink - which is exactly what a session does.
 */

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({}),
    getPrivilegedInterface: () => ({ fs: { writeFileNoFollowOrCreate: vi.fn(), isDirExists: vi.fn(), createDir: vi.fn() } }),
}));

function createService(): UIDocumentService {
    const service = new UIDocumentService();
    let nextId = 0;
    service.setContext({
        project: { resolve: (...parts: string[]) => ["/p", ...parts].join("/") },
        services: {
            get(serviceId: Services) {
                switch (serviceId) {
                    case Services.Uuid: return { generate: () => `generated-${++nextId}` };
                    case Services.Project: return { getProjectConfig: () => ({ metadata: { resolution: { width: 1280, height: 720 } } }) };
                    default: throw new Error(`Unexpected service ${String(serviceId)}`);
                }
            },
        },
    } as never);
    (service as never as { document: unknown }).document =
        (service as never as { createEmptyDocument: () => unknown }).createEmptyDocument();
    return service;
}

/** A sink that takes everything and remembers it, which is what a host's does. */
function recordingSink(): { sink: UIOpSink; ops: LiveUIOp[] } {
    const ops: LiveUIOp[] = [];
    return {
        ops,
        sink: {
            handle(op) {
                ops.push(op);
                return true;
            },
        },
    };
}

/** The first element of the first Surface, which every empty document has. */
function firstElementId(service: UIDocumentService): string {
    return service.getDocument().surfaces[0].rootElementId;
}

describe("the interface editor's operation sink", () => {
    it("hands over what a gesture did instead of doing it", () => {
        const service = createService();
        const { sink, ops } = recordingSink();
        const rootId = firstElementId(service);
        const before = JSON.parse(JSON.stringify(service.getDocument()));

        service.setOperationSink(sink);
        service.updateElementLayout(rootId, { x: 120 });

        // Nothing moved on this machine. The screen changes when the effect comes back, which is the
        // whole design: nothing is applied optimistically, so nothing ever has to be taken back.
        expect(service.getDocument()).toEqual(before);
        expect(ops).toHaveLength(1);
        expect(ops[0].op).toBe("write-ui");
        expect(Object.keys(ops[0].parts.elements ?? {})).toEqual([rootId]);
        // And it says the element was already there, which is what makes a deleted one refusable.
        expect(ops[0].updates).toEqual([{ componentId: null, elementId: rootId }]);
    });

    it("says nothing when a gesture changed nothing", () => {
        // A room full of empty operations would cost a broadcast, a sequence number and an undo step
        // each - and several of this service's methods are no-ops against the wrong element.
        const service = createService();
        const { sink, ops } = recordingSink();
        service.setOperationSink(sink);

        service.updateElementLayout("no-such-element", { x: 4 });
        service.updateElementProps("no-such-element", { text: "x" });

        expect(ops).toEqual([]);
    });

    it("covers a gesture nobody wrote a verb for, because the delta is the statement", () => {
        // ⚠ The property the whole design rests on. Renaming is not a verb anywhere in the
        // vocabulary; it is carried because it changes a record, and so is every gesture that lands
        // after this is written.
        const service = createService();
        const { sink, ops } = recordingSink();
        const surfaceId = service.getDocument().surfaces[0].id;
        service.setOperationSink(sink);

        service.renameSurface(surfaceId, "Renamed");

        expect(ops).toHaveLength(1);
        expect((ops[0].parts.surfaces?.[surfaceId] as { name?: string } | null)?.name).toBe("Renamed");
        // And the order travels with it, so a machine cannot guess where a Surface belongs.
        expect(ops[0].parts.surfaceOrder).toEqual([surfaceId]);
    });

    it("applies an arriving effect without handing it back to the sink", () => {
        const service = createService();
        const { sink, ops } = recordingSink();
        const rootId = firstElementId(service);
        service.setOperationSink(sink);
        service.updateElementLayout(rootId, { x: 120 });
        const op = ops[0];

        service.applyLiveOp(op);

        expect(service.getDocument().elements[rootId].layout.x).toBe(120);
        // Still one: applying an effect that went back through the sink would answer the room for
        // ever.
        expect(ops).toHaveLength(1);
    });

    it("takes the records out of the message rather than keeping a reference into it", () => {
        // The host keeps every effect it broadcast, and applying writes the record into the document
        // - which then edits it in place. A shared reference would rewrite the message.
        const service = createService();
        const { sink, ops } = recordingSink();
        const rootId = firstElementId(service);
        service.setOperationSink(sink);
        service.updateElementLayout(rootId, { x: 120 });
        const op = ops[0];

        service.applyLiveOp(op);
        service.setOperationSink(null);
        service.updateElementLayout(rootId, { x: 300 });

        expect((op.parts.elements?.[rootId] as { layout: { x: number } } | null)?.layout.x).toBe(120);
    });

    it("goes back to writing the document when the sink is taken away", () => {
        const service = createService();
        const { sink } = recordingSink();
        const rootId = firstElementId(service);
        service.setOperationSink(sink);
        service.setOperationSink(null);

        service.updateElementLayout(rootId, { x: 42 });

        expect(service.getDocument().elements[rootId].layout.x).toBe(42);
    });
});
