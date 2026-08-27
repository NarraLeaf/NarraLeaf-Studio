import { describe, expect, it, vi } from "vitest";
import type { LiveVariableOp } from "@shared/live/ops";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { join } from "@shared/utils/path";
import { Services, type WorkspaceContext } from "../services";
import { VariableRegistryService } from "./VariableRegistryService";

/**
 * The live-session seam on the variable registry.
 *
 * The bargain every one of these seams makes: with a sink installed an edit becomes an operation and
 * the document is not touched, and the row moves when the operation comes back as somebody's effect.
 * Nothing is applied optimistically, so nothing ever has to be taken back.
 */

const ROOT = join("D:/projects", "my-game");
const DOCUMENT = join(ROOT, "editor", "variables.json");

type Harness = {
    service: VariableRegistryService;
    files: Map<string, string>;
    /** Every operation the sink was handed, in order. */
    handled: LiveVariableOp[];
};

async function createHarness(): Promise<Harness> {
    const files = new Map<string, string>();
    let nextId = 0;
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
        [Services.Uuid]: { generate: () => `var-${++nextId}` },
        [Services.UIGraph]: { consumeLegacyPersistentVariables: () => null },
        [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument: vi.fn() },
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

    const service = new VariableRegistryService();
    await service.initialize(ctx, async () => undefined);
    const handled: LiveVariableOp[] = [];
    service.setOperationSink({ handle: op => (handled.push(op), true), canDelete: () => true });
    return { service, files, handled };
}

describe("the variable registry inside a live session", () => {
    it("states a creation and files nothing, so the row arrives with the effect", async () => {
        const { service, handled } = await createHarness();
        service.setOperationSink(null);
        service.setOperationSink({ handle: op => (handled.push(op), true), canDelete: () => true });

        const entry = service.createEntry("saved", { name: "Gold", valueType: "number" });

        expect(handled).toEqual([{ op: "create-variable", entry }]);
        expect(service.getEntry(entry.id)).toBeUndefined();
    });

    it("states the entry as it WOULD have been written, never the field that changed", async () => {
        // A patch states an intention and every receiving machine would have to resolve it against
        // its own copy - and the panel's retype gesture rewrites the value type and the default
        // together, so a field-level statement would carry half of one act.
        const { service, handled } = await createHarness();
        service.setOperationSink(null);
        const entry = service.createEntry("saved", { name: "Gold", valueType: "number" });
        service.setOperationSink({ handle: op => (handled.push(op), true), canDelete: () => true });

        service.renameEntry(entry.id, "Coins");
        service.setEntryValueType(entry.id, "string");
        service.setEntryDefault(entry.id, "none");
        service.setEntryDescription(entry.id, "spending money");

        expect(handled.map(op => op.op)).toEqual(Array(4).fill("update-variable"));
        expect(handled.map(op => (op.op === "update-variable" ? op.entry : null))).toEqual([
            { ...entry, name: "Coins" },
            { ...entry, valueType: "string" },
            { ...entry, defaultValue: "none" },
            { ...entry, description: "spending money" },
        ]);
        // Nothing moved locally. The row moves when the effect comes back.
        expect(service.getEntry(entry.id)).toEqual(entry);
    });

    it("drops a cleared default rather than stating `undefined`, which no receiver could save", async () => {
        // The canonical encoder refuses a property holding `undefined` by name, so an operation
        // carrying one would be an entry that stopped every machine's registry saving.
        const { service, handled } = await createHarness();
        service.setOperationSink(null);
        const entry = service.createEntry("saved", { name: "Gold", valueType: "number", defaultValue: 10 });
        service.setOperationSink({ handle: op => (handled.push(op), true), canDelete: () => true });

        service.setEntryDefault(entry.id, undefined);

        const stated = handled[0];
        expect(stated.op).toBe("update-variable");
        expect(stated.op === "update-variable" && "defaultValue" in stated.entry).toBe(false);
    });

    it("says nothing about a rename the registry would refuse anyway", async () => {
        // An emptied box leaves the entry exactly as it was, and an operation for it would be an
        // effect for a change nobody made.
        const { service, handled } = await createHarness();
        service.setOperationSink(null);
        const entry = service.createEntry("saved", { name: "Gold" });
        service.setOperationSink({ handle: op => (handled.push(op), true), canDelete: () => true });

        service.renameEntry(entry.id, "   ");

        expect(handled).toEqual([]);
        expect(service.getEntry(entry.id)?.name).toBe("Gold");
    });

    it("states a removal and files nothing, so the row leaves with the effect", async () => {
        // Removing a variable also clears the `savedVariableId` / `persistentVariableId` params of
        // every node that named it. That sweep is DERIVED now that a session carries the blueprint
        // document - every machine works out the same nodes from this one statement - so the gesture
        // travels instead of being refused.
        const { service, handled } = await createHarness();
        service.setOperationSink(null);
        const entry = service.createEntry("saved", { name: "Gold" });
        service.setOperationSink({ handle: op => (handled.push(op), true), canDelete: () => true });

        expect(service.canDeleteEntry()).toBe(true);
        expect(service.deleteEntry(entry.id)).toBe(true);
        // Not written here: the row leaves the panel when the effect comes back, with every other
        // gesture in this file.
        expect(service.getEntry(entry.id)).toBeDefined();
        expect(handled).toEqual([{ op: "delete-variable", variableId: entry.id }]);
    });

    it("refuses to remove an entry when the session cannot carry the node sweep", async () => {
        // A window that could not read the two interface documents carries neither, so there is
        // nowhere for the sweep to land - and the old ruling is still the right one there. Refused
        // at the service, exactly as the asset library refuses an import: the write boundary would
        // let it through, and it would land here and nowhere else.
        const { service, handled } = await createHarness();
        service.setOperationSink(null);
        const entry = service.createEntry("saved", { name: "Gold" });
        service.setOperationSink({ handle: op => (handled.push(op), true), canDelete: () => false });

        expect(service.canDeleteEntry()).toBe(false);
        expect(service.deleteEntry(entry.id)).toBe(false);
        expect(service.getEntry(entry.id)).toBeDefined();
        expect(handled).toEqual([]);

        service.setOperationSink(null);
        expect(service.canDeleteEntry()).toBe(true);
        expect(service.deleteEntry(entry.id)).toBe(true);
        expect(service.getEntry(entry.id)).toBeUndefined();
    });

    it("refuses a whole-registry restore, because undo inside a session is an inverse operation", async () => {
        // A snapshot restore would overwrite every entry everybody else has edited since, on this
        // machine alone, with nothing anywhere reporting it.
        const { service } = await createHarness();
        expect(service.replaceRegistry({ schemaVersion: 2, entries: {} })).toBe(false);
        service.setOperationSink(null);
        expect(service.replaceRegistry({ schemaVersion: 2, entries: {} })).toBe(true);
    });

    it("applies an effect without consulting the sink, which is the other side of the seam", async () => {
        const { service, handled } = await createHarness();
        const entry = { id: "v1", name: "Gold", scope: "saved", valueType: "number", storageKey: "v1" } as const;

        service.applyLiveOp({ op: "create-variable", entry });
        expect(service.getEntry("v1")).toEqual(entry);

        service.applyLiveOp({ op: "update-variable", variableId: "v1", entry: { ...entry, name: "Coins" } });
        expect(service.getEntry("v1")?.name).toBe("Coins");

        service.applyLiveOp({ op: "delete-variable", variableId: "v1" });
        expect(service.getEntry("v1")).toBeUndefined();
        expect(handled).toEqual([]);
    });

    it("ignores an update naming an entry it does not hold, rather than creating one", async () => {
        // An applier runs inside reading a message and must not throw; the divergence guard catches
        // it on this very effect instead, because a missing entry has a digest of its own.
        const { service } = await createHarness();
        service.applyLiveOp({
            op: "update-variable",
            variableId: "ghost",
            entry: { id: "ghost", name: "Ghost", scope: "saved", valueType: "boolean", storageKey: "ghost" },
        });
        expect(service.getEntry("ghost")).toBeUndefined();
    });

    it("says it holds a registry it could read, which is what decides whether a session carries it", async () => {
        const { service } = await createHarness();
        expect(service.isReadable()).toBe(true);
        expect(DOCUMENT.endsWith("variables.json")).toBe(true);
    });
});

describe("retyping a variable, which is one gesture", () => {
    it("states the type and the starting value as ONE operation", async () => {
        // ⚠ The failure this pins: two calls would be two operations, and the second is built from a
        // document the first has not been allowed to change - so it carries the OLD value type and
        // undoes the retype on every machine in the room.
        const { service, handled } = await createHarness();
        service.setOperationSink(null);
        const entry = service.createEntry("saved", { name: "Gold", valueType: "boolean", defaultValue: false });
        service.setOperationSink({ handle: op => (handled.push(op), true), canDelete: () => true });

        service.setEntryValueType(entry.id, "number", 0);

        expect(handled).toEqual([{
            op: "update-variable",
            variableId: entry.id,
            entry: { ...entry, valueType: "number", defaultValue: 0 },
        }]);
    });

    it("leaves the default alone when the caller only changes the type", async () => {
        const { service, handled } = await createHarness();
        service.setOperationSink(null);
        const entry = service.createEntry("saved", { name: "Gold", valueType: "boolean", defaultValue: false });
        service.setOperationSink({ handle: op => (handled.push(op), true), canDelete: () => true });

        service.setEntryValueType(entry.id, "number");

        expect(handled).toEqual([{
            op: "update-variable",
            variableId: entry.id,
            entry: { ...entry, valueType: "number" },
        }]);
    });
});
