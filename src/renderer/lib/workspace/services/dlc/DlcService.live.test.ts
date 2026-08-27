import { describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { join } from "@shared/utils/path";
import type { LiveDlcOp } from "@shared/live/ops";
import { Services, type WorkspaceContext } from "../services";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { DlcService } from "./DlcService";

/**
 * The DLC list inside a live session: what the seam does to each of this service's mutators.
 *
 * Its own file rather than a block in a service test that does not exist yet - this table had no
 * tests at all, and the ones worth having first are about the contract every mutator now shares:
 * with a sink installed the edit becomes an operation and the document is not touched.
 */

const ROOT = join("D:/projects", "my-game");
const DOCUMENT = join(ROOT, "editor", "dlc.json");

async function createHarness(): Promise<{ service: DlcService; files: Map<string, string>; history: HistoryService }> {
    const files = new Map<string, string>();
    const history = new HistoryService();

    const ok = <T,>(data: T): FsRequestResult<T> => ({ ok: true, data });
    const stubs: Record<string, unknown> = {
        [Services.FileSystem]: {
            read: async (path: string) => {
                const value = files.get(path);
                return value === undefined
                    ? { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } }
                    : ok(value);
            },
            writeFileNoFollowOrCreate: async (path: string, data: string) => {
                files.set(path, data);
                return ok(undefined);
            },
            createDir: async () => ok(undefined),
            copyFile: async (src: string, dest: string) => {
                files.set(dest, files.get(src) ?? "");
                return ok(undefined);
            },
        },
        [Services.Project]: {},
        [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument: vi.fn() },
        [Services.History]: history,
    };

    const ctx = {
        project: { getConfig: () => ({ projectPath: ROOT }) },
        services: {
            get: (id: string) => {
                const stub = stubs[id];
                if (!stub) {
                    throw new Error(`Service ${id} not found`);
                }
                return stub;
            },
        },
    } as unknown as WorkspaceContext;

    const service = new DlcService();
    await service.initialize(ctx, async () => undefined);
    return { service, files, history };
}

/** A sink that takes everything and remembers it - what `LiveSession` installs, minus the room. */
function sink(): { ops: LiveDlcOp[]; handle(op: LiveDlcOp): boolean } {
    const ops: LiveDlcOp[] = [];
    return {
        ops,
        handle(op) {
            ops.push(op);
            return true;
        },
    };
}

describe("DlcService inside a live session", () => {
    it("states every gesture and leaves the document alone", async () => {
        const { service, files } = await createHarness();
        const created = service.create({ name: "Side Story" });
        const taken = sink();
        service.setOperationSink(taken);

        service.rename(created.id, "Side Chapter");
        service.setAttachTo(created.id, "demo");
        service.delete(created.id);

        expect(taken.ops.map(op => op.op)).toEqual(["update-dlc", "update-dlc", "delete-dlc"]);
        expect(service.resolve(created.id)?.name).toBe("Side Story");
        expect(files.get(DOCUMENT)).toBeUndefined();
    });

    it("states a change of id as one operation, because changing the filename is one gesture", async () => {
        // ⚠ Addressed by the id the row has now and carrying the id it will have. Splitting it into
        // a delete and a create would be two operations, two undo steps, and - between them - a
        // project where this DLC does not exist.
        const { service } = await createHarness();
        const created = service.create({ id: "side", name: "Side Story" });
        const taken = sink();
        service.setOperationSink(taken);

        expect(service.changeId(created.id, "epilogue")).toBe("epilogue");
        expect(taken.ops[0]).toEqual({
            op: "update-dlc",
            dlcId: "side",
            dlc: { id: "epilogue", name: "Side Story", attachTo: "main" },
        });
        expect(service.resolve("side")?.id).toBe("side");
    });

    it("hands back a record that is not in the list yet, and lands it when the effect arrives", async () => {
        const { service } = await createHarness();
        const taken = sink();
        service.setOperationSink(taken);

        const asked = service.create({ name: "Side Story" });
        expect(taken.ops[0]?.op).toBe("create-dlc");
        expect(service.resolve(asked.id)).toBeNull();

        service.applyLiveOp({ op: "create-dlc", dlc: asked });
        expect(service.resolve(asked.id)?.name).toBe("Side Story");
    });

    it("applies an effect through the same normalization, and outside this author's undo stack", async () => {
        const { service, history } = await createHarness();
        service.setOperationSink(sink());

        service.applyLiveOp({ op: "create-dlc", dlc: { id: "side", name: "  ", attachTo: "" } });
        // Normalized here exactly as it would be on the machine that made the edit: a blank name
        // falls back to the id, and an unstated variant is the release one.
        expect(service.resolve("side")).toEqual({ id: "side", name: "side", attachTo: "main" });
        expect(service.isDirty()).toBe(true);
        // An effect is somebody else's edit landing here; an undo offering to take it back would be
        // offering to delete their work.
        expect(history.canUndo(projectHistoryScope())).toBe(false);
    });

    it("puts a deleted row back where it sat when an effect names its neighbour", async () => {
        const { service } = await createHarness();
        service.setOperationSink(sink());
        for (const id of ["a", "b", "c"]) {
            service.applyLiveOp({ op: "create-dlc", dlc: { id, name: id, attachTo: "main" } });
        }
        service.applyLiveOp({ op: "delete-dlc", dlcId: "b" });
        service.applyLiveOp({ op: "create-dlc", dlc: { id: "b", name: "b", attachTo: "main" }, beforeId: "c" });

        expect(service.list().map(dlc => dlc.id)).toEqual(["a", "b", "c"]);
    });

    it("does not resurrect a row an effect names that this machine does not hold", async () => {
        const { service } = await createHarness();
        service.applyLiveOp({ op: "update-dlc", dlcId: "gone", dlc: { id: "gone", name: "X", attachTo: "main" } });
        expect(service.resolve("gone")).toBeNull();
    });

    it("goes back to writing the document the moment the sink is taken away", async () => {
        const { service } = await createHarness();
        const created = service.create({ name: "Side Story" });
        service.setOperationSink(sink());
        service.setOperationSink(null);

        service.rename(created.id, "Side Chapter");
        expect(service.resolve(created.id)?.name).toBe("Side Chapter");
    });
});
