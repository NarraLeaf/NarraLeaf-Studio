import { describe, expect, it, vi } from "vitest";
import type { LiveUIGraphOp } from "@shared/live/ops";
import { Services } from "../services";
import { UIGraphService } from "./UIGraphService";
import type { UIGraphOpSink } from "./UIGraphService";

/**
 * The blueprint document's seam, and the one place the two interface documents meet.
 *
 * Two things are being held to. A canvas gesture states what it did to the records and leaves the
 * document alone, exactly as an interface gesture does. And the reconciliation that runs behind an
 * interface effect - `UIBlueprintLifecycleCoordinator` keeping the private blueprints aligned with
 * the Surfaces and widgets that now exist - is applied rather than stated, because every machine
 * performs it from the same effect and reaches the same records.
 */

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({}),
    getPrivilegedInterface: () => ({ fs: { writeFileNoFollowOrCreate: vi.fn(), isDirExists: vi.fn(), createDir: vi.fn() } }),
}));

function createService(): UIGraphService {
    const service = new UIGraphService();
    let nextId = 0;
    service.setContext({
        project: { resolve: (...parts: string[]) => ["/p", ...parts].join("/") },
        services: {
            get(serviceId: Services) {
                if (serviceId === Services.Uuid) {
                    return { generate: () => `generated-${++nextId}` };
                }
                throw new Error(`Unexpected service ${String(serviceId)}`);
            },
        },
    } as never);
    (service as never as { document: unknown }).document =
        (service as never as { createEmptyDocument: () => unknown }).createEmptyDocument();
    return service;
}

function recordingSink(): { sink: UIGraphOpSink; ops: LiveUIGraphOp[] } {
    const ops: LiveUIGraphOp[] = [];
    return { ops, sink: { handle(op) { ops.push(op); return true; } } };
}

/** The blueprint an empty document is created with, which is the global one. */
function firstBlueprintId(service: UIGraphService): string {
    return Object.keys(service.getDocument().blueprintDocument.blueprints)[0];
}

describe("the blueprint editor's operation sink", () => {
    it("hands over what a canvas gesture did instead of doing it", () => {
        const service = createService();
        const { sink, ops } = recordingSink();
        const blueprintId = firstBlueprintId(service);
        const before = JSON.parse(JSON.stringify(service.getDocument()));

        service.setOperationSink(sink);
        service.applyGraphMutation(document => {
            document.blueprintDocument.blueprints[blueprintId].name = "Renamed";
        });

        expect(service.getDocument()).toEqual(before);
        expect(ops).toHaveLength(1);
        expect(ops[0].parts.blueprints?.[blueprintId]?.name).toBe("Renamed");
        expect(ops[0].updates).toEqual([blueprintId]);
    });

    it("says nothing when a mutation changed nothing", () => {
        // ⚠ This document gets a great many of them: the three `ensure*` helpers run after every
        // interface edit and are almost always no-ops, because the owner record is already there.
        const service = createService();
        const { sink, ops } = recordingSink();
        service.setOperationSink(sink);

        service.applyGraphMutation(() => undefined);

        expect(ops).toEqual([]);
    });

    it("applies derived reconciliation itself, and answers with what it wrote", () => {
        // The seam between the two documents. This work is performed identically on every machine
        // from one interface effect - which is why the ids it mints come from the owner key - so it
        // must not become an operation of its own: on the host that would be a second message per
        // gesture and a second press of undo, and on a guest an intent nobody asked for.
        const service = createService();
        const { sink, ops } = recordingSink();
        service.setOperationSink(sink);

        const derived = service.holdDerived(() => {
            service.applyGraphMutation(document => {
                document.blueprintDocument.ownerRecords["widgetMain:s1:e1"] = {
                    blueprintId: "bp-derived",
                };
            });
        });

        expect(ops).toEqual([]);
        expect(service.getDocument().blueprintDocument.ownerRecords["widgetMain:s1:e1"]).toBeDefined();
        // ⚠ Reported, not merely done: derived work is exactly the work that has to be fingerprinted
        // rather than assumed, and this is what puts it into the effect's digests.
        expect(Object.keys(derived?.owners ?? {})).toEqual(["widgetMain:s1:e1"]);
    });

    it("answers nothing when the reconciliation wrote nothing", () => {
        // Which is the ordinary case, and skipping the comparison there is what keeps the cost of
        // nudging one element off the whole blueprint document.
        const service = createService();
        const { sink } = recordingSink();
        service.setOperationSink(sink);

        expect(service.holdDerived(() => undefined)).toBeNull();
    });

    it("applies an arriving effect without handing it back to the sink", () => {
        const service = createService();
        const { sink, ops } = recordingSink();
        const blueprintId = firstBlueprintId(service);
        service.setOperationSink(sink);
        service.applyGraphMutation(document => {
            document.blueprintDocument.blueprints[blueprintId].name = "Renamed";
        });

        service.applyLiveOp(ops[0]);

        expect(service.getDocument().blueprintDocument.blueprints[blueprintId].name).toBe("Renamed");
        expect(ops).toHaveLength(1);
    });
});
